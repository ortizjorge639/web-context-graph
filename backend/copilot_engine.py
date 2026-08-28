"""
Wraps the CONFIRMED (via live spike during planning) headless invocation:
    copilot -p "<prompt>" --session-id=<uuid> --allow-all-tools --no-remote
Session IDs are per-thread (stored in ThreadMeta.copilot_session_id), so
calling this repeatedly with the same thread's session_id gives Copilot CLI
native multi-turn memory of that thread's lineage -- no manual context
re-injection needed (resolves D11/Q3).

NOTE (from spike): ~5s latency and ~20k+ token overhead per call even for
trivial prompts -- do not call this in a tight loop or in test suites beyond
a small number of smoke tests.
"""
import json
import selectors
import subprocess
import time


def _tool_activity(event_type: str, data: dict) -> dict:
    tool_name = str(data.get("toolName") or data.get("name") or "tool")
    tool_id = str(data.get("toolCallId") or data.get("callId") or f"tool-{tool_name}")
    arguments = data.get("arguments") if isinstance(data.get("arguments"), dict) else {}
    detail = (
        arguments.get("description")
        or arguments.get("command")
        or arguments.get("path")
        or arguments.get("query")
        or arguments.get("url")
    )
    if detail:
        detail = " ".join(str(detail).split())[:180]
    labels = {
        "bash": "Running a command",
        "view": "Reading a file",
        "rg": "Searching the workspace",
        "glob": "Finding files",
        "web_search": "Searching the web",
        "web_fetch": "Reading a web page",
    }
    success = data.get("success", True)
    return {
        "type": "activity",
        "id": tool_id,
        "kind": "tool",
        "label": labels.get(tool_name, f"Using {tool_name.replace('_', ' ')}"),
        "detail": detail,
        "state": (
            "running" if event_type == "tool.execution_start"
            else "complete" if success else "error"
        ),
    }


def _translate_stream_event(event: dict) -> dict | None:
    event_type = event.get("type")
    data = event.get("data", {})
    if event_type == "session.tools_updated":
        return {
            "type": "activity",
            "id": "startup",
            "kind": "status",
            "label": "Agent tools ready",
            "detail": data.get("model"),
            "state": "complete",
        }
    if event_type == "model.model_call_started":
        return {
            "type": "activity",
            "id": "thinking",
            "kind": "status",
            "label": "Thinking",
            "state": "running",
        }
    if event_type in {"tool.execution_start", "tool.execution_complete"}:
        return _tool_activity(event_type, data)
    if event_type == "model.call_start":
        return {"type": "model", "model": data.get("model", "unknown")}
    if event_type == "assistant.message_delta" and data.get("deltaContent"):
        return {"type": "delta", "content": data["deltaContent"]}
    if event_type == "model.model_call_success":
        usage = data.get("responseChunk", {}).get("usage", {})
        return {
            "type": "usage",
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
    return None


def ask_copilot(session_id: str, prompt: str, timeout: int = 60) -> str:
    result = subprocess.run(
        [
            "copilot", "-p", prompt,
            "--session-id", session_id,
            "--allow-all-tools",
            "--no-remote",
        ],
        capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"copilot CLI failed: {result.stderr}")
    return result.stdout.strip()


def stream_copilot(session_id: str, prompt: str, timeout: int = 60):
    process = subprocess.Popen(
        [
            "copilot", "-p", prompt,
            "--session-id", session_id,
            "--allow-all-tools",
            "--no-remote",
            "--stream", "on",
            "--output-format", "json",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    if process.stdout is None:
        raise RuntimeError("copilot CLI did not expose a response stream")

    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, data="stdout")
    if process.stderr is not None:
        selector.register(process.stderr, selectors.EVENT_READ, data="stderr")
    deadline = time.monotonic() + timeout
    active_tool_ids: list[str] = []
    tool_sequence = 0
    stderr_lines: list[str] = []

    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.kill()
                raise TimeoutError(f"copilot CLI timed out after {timeout} seconds")

            ready = selector.select(timeout=min(0.25, remaining))
            if not ready:
                if process.poll() is not None:
                    break
                continue

            key, _ = ready[0]
            line = key.fileobj.readline()
            if not line:
                selector.unregister(key.fileobj)
                if process.poll() is not None and not selector.get_map():
                    break
                continue
            deadline = time.monotonic() + timeout
            if key.data == "stderr":
                stderr_lines.append(line.rstrip())
                stderr_lines = stderr_lines[-100:]
                continue

            event = json.loads(line)
            translated = _translate_stream_event(event)
            if translated and translated.get("kind") == "tool":
                if translated["state"] == "running":
                    if translated["id"].startswith("tool-"):
                        tool_sequence += 1
                        translated["id"] = f"tool-{tool_sequence}"
                    active_tool_ids.append(translated["id"])
                elif active_tool_ids:
                    if translated["id"] in active_tool_ids:
                        active_tool_ids.remove(translated["id"])
                    else:
                        translated["id"] = active_tool_ids.pop(0)
            if translated:
                yield translated
        return_code = process.wait()
        if return_code != 0:
            stderr = "\n".join(stderr_lines).strip()
            raise RuntimeError(f"copilot CLI failed: {stderr}")

    finally:
        selector.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
