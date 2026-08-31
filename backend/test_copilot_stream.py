import io
import time

import pytest

from copilot_engine import (
    DEFAULT_COPILOT_TIMEOUT_SECONDS,
    _copilot_timeout,
    stream_copilot,
)


class FakeProcess:
    def __init__(self, stdout=None, stderr=None):
        self.stdout = stdout or io.StringIO(
            '{"type":"model.call_start","data":{"model":"gpt-test"}}\n'
            '{"type":"assistant.message_delta","data":{"deltaContent":"Hello"}}\n'
        )
        self.stderr = stderr or io.StringIO("")
        self.returncode = 0
        self.terminated = False

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.terminated = True
        self.returncode = -9


def test_stream_copilot_reads_process_pipes_without_selectors(monkeypatch):
    popen_calls = []

    def fake_popen(args, **kwargs):
        popen_calls.append((args, kwargs))
        return FakeProcess()

    monkeypatch.setattr("copilot_engine.subprocess.Popen", fake_popen)

    events = list(stream_copilot("session-1", "Say hello"))

    assert events == [
        {"type": "model", "model": "gpt-test"},
        {"type": "delta", "content": "Hello"},
    ]
    assert popen_calls[0][0] == [
        "copilot",
        "-p",
        "Say hello",
        "--session-id",
        "session-1",
        "--allow-all-tools",
        "--no-remote",
        "--stream",
        "on",
        "--output-format",
        "json",
    ]
    assert popen_calls[0][1]["encoding"] == "utf-8"
    assert popen_calls[0][1]["errors"] == "replace"


class SlowStream:
    def __iter__(self):
        time.sleep(0.04)
        yield '{"type":"assistant.message_delta","data":{"deltaContent":"Done"}}\n'


def test_stream_copilot_reports_quiet_periods(monkeypatch):
    def fake_popen(*_args, **_kwargs):
        return FakeProcess(stdout=SlowStream())

    monkeypatch.setattr("copilot_engine.subprocess.Popen", fake_popen)
    monkeypatch.setattr(
        "copilot_engine.DEFAULT_SILENCE_NOTICE_INTERVAL_SECONDS",
        0.01,
    )

    events = list(stream_copilot("session-1", "Slow prompt"))

    assert any(
        event["type"] == "activity"
        and event["id"] == "copilot-waiting"
        and event["state"] == "running"
        for event in events
    )
    assert events[-1] == {"type": "delta", "content": "Done"}


def test_copilot_timeout_defaults_to_longer_local_cli_window(monkeypatch):
    monkeypatch.delenv("WCG_COPILOT_TIMEOUT_SECONDS", raising=False)

    assert _copilot_timeout(None) == DEFAULT_COPILOT_TIMEOUT_SECONDS


def test_copilot_timeout_can_be_configured(monkeypatch):
    monkeypatch.setenv("WCG_COPILOT_TIMEOUT_SECONDS", "900")

    assert _copilot_timeout(None) == 900
    assert _copilot_timeout(12) == 12


def test_copilot_timeout_rejects_invalid_configuration(monkeypatch):
    monkeypatch.setenv("WCG_COPILOT_TIMEOUT_SECONDS", "soon")

    with pytest.raises(RuntimeError, match="must be a number"):
        _copilot_timeout(None)
