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
import os
import queue
import subprocess
import threading
import time

DEFAULT_COPILOT_TIMEOUT_SECONDS = 300
DEFAULT_SILENCE_NOTICE_INTERVAL_SECONDS = 5


def _copilot_timeout(timeout: float | None) -> float:
    if timeout is not None:
        return timeout
    configured = os.environ.get("WCG_COPILOT_TIMEOUT_SECONDS")
    if not configured:
        return DEFAULT_COPILOT_TIMEOUT_SECONDS
    try:
        parsed = float(configured)
    except ValueError as error:
        raise RuntimeError("WCG_COPILOT_TIMEOUT_SECONDS must be a number") from error
    if parsed <= 0:
        raise RuntimeError("WCG_COPILOT_TIMEOUT_SECONDS must be greater than zero")
    return parsed


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


def ask_copilot(session_id: str, prompt: str, timeout: float | None = None) -> str:
    effective_timeout = _copilot_timeout(timeout)
    result = subprocess.run(
        [
            "copilot", "-p", prompt,
            "--session-id", session_id,
            "--allow-all-tools",
            "--no-remote",
        ],
        capture_output=True, text=True, timeout=effective_timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"copilot CLI failed: {result.stderr}")
    return result.stdout.strip()


def stream_copilot(session_id: str, prompt: str, timeout: float | None = None):
    effective_timeout = _copilot_timeout(timeout)
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
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    if process.stdout is None:
        raise RuntimeError("copilot CLI did not expose a response stream")

    output_queue: queue.Queue[tuple[str, str | None]] = queue.Queue()

    def enqueue_lines(name: str, stream):
        try:
            for line in stream:
                output_queue.put((name, line))
        finally:
            output_queue.put((name, None))

    threading.Thread(
        target=enqueue_lines,
        args=("stdout", process.stdout),
        daemon=True,
    ).start()
    if process.stderr is not None:
        threading.Thread(
            target=enqueue_lines,
            args=("stderr", process.stderr),
            daemon=True,
        ).start()
    now = time.monotonic()
    deadline = now + effective_timeout
    next_silence_notice = now + DEFAULT_SILENCE_NOTICE_INTERVAL_SECONDS
    active_tool_ids: list[str] = []
    tool_sequence = 0
    stderr_lines: list[str] = []
    active_streams = {"stdout"}
    if process.stderr is not None:
        active_streams.add("stderr")

    try:
        while active_streams:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.kill()
                raise TimeoutError(
                    "copilot CLI produced no output for "
                    f"{effective_timeout:g} seconds"
                )

            now = time.monotonic()
            try:
                stream_name, line = output_queue.get(
                    timeout=min(
                        0.25,
                        DEFAULT_SILENCE_NOTICE_INTERVAL_SECONDS,
                        remaining,
                    )
                )
            except queue.Empty:
                now = time.monotonic()
                if now >= next_silence_notice:
                    elapsed = round(now - (deadline - effective_timeout))
                    yield {
                        "type": "activity",
                        "id": "copilot-waiting",
                        "kind": "status",
                        "label": "Waiting for Copilot",
                        "detail": f"No output for {elapsed:g}s; the CLI is still running.",
                        "state": "running",
                    }
                    next_silence_notice = (
                        now + DEFAULT_SILENCE_NOTICE_INTERVAL_SECONDS
                    )
                continue
            if line is None:
                active_streams.discard(stream_name)
                continue

            deadline = time.monotonic() + effective_timeout
            next_silence_notice = (
                time.monotonic() + DEFAULT_SILENCE_NOTICE_INTERVAL_SECONDS
            )
            if stream_name == "stderr":
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
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
