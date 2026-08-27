import uuid
from copilot_engine import ask_copilot

def test_ask_copilot_returns_nonempty_text():
    session_id = str(uuid.uuid4())
    reply = ask_copilot(session_id, "Reply with exactly the word PONG and nothing else.")
    assert "PONG" in reply.upper()
