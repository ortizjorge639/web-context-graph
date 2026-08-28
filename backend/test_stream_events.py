from copilot_engine import _translate_stream_event


def test_translates_per_call_usage_event():
    event = {
        "type": "model.model_call_success",
        "data": {
            "responseChunk": {
                "usage": {
                    "prompt_tokens": 101,
                    "completion_tokens": 7,
                    "total_tokens": 108,
                }
            }
        },
    }

    assert _translate_stream_event(event) == {
        "type": "usage",
        "input_tokens": 101,
        "output_tokens": 7,
        "total_tokens": 108,
    }


def test_translates_agent_and_tool_activity():
    assert _translate_stream_event({
        "type": "session.tools_updated",
        "data": {"model": "gpt-test"},
    }) == {
        "type": "activity",
        "id": "startup",
        "kind": "status",
        "label": "Agent tools ready",
        "detail": "gpt-test",
        "state": "complete",
    }
    assert _translate_stream_event({
        "type": "tool.execution_start",
        "data": {
            "toolCallId": "call-1",
            "toolName": "bash",
            "arguments": {"description": "Run the focused tests"},
        },
    }) == {
        "type": "activity",
        "id": "call-1",
        "kind": "tool",
        "label": "Running a command",
        "detail": "Run the focused tests",
        "state": "running",
    }
    assert _translate_stream_event({
        "type": "tool.execution_complete",
        "data": {"toolCallId": "call-1", "success": True},
    }) == {
        "type": "activity",
        "id": "call-1",
        "kind": "tool",
        "label": "Using tool",
        "detail": None,
        "state": "complete",
    }
