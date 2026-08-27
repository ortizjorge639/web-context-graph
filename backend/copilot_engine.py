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
import subprocess


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
