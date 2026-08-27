import tempfile
import subprocess
from pathlib import Path
from autocommit import ensure_git_repo, autocommit

def test_ensure_git_repo_initializes_once():
    with tempfile.TemporaryDirectory() as tmp:
        ensure_git_repo(Path(tmp))
        assert (Path(tmp) / ".git").exists()
        ensure_git_repo(Path(tmp))
        assert (Path(tmp) / ".git").exists()

def test_autocommit_creates_a_commit():
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp)
        ensure_git_repo(vault)
        (vault / "test.txt").write_text("hello")
        autocommit(vault, message="test commit")
        log = subprocess.run(
            ["git", "-C", str(vault), "log", "--oneline"], capture_output=True, text=True
        ).stdout
        assert "test commit" in log
