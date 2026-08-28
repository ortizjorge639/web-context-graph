"""
Resolves the spec's 'Autosave + irreversible delete interaction' NFR:
D6 (autosave every turn) + D7 (edit deletes downstream, no undo except
manual git) means the "manual git" escape hatch is only real if the
implementation actually commits every turn. This module does that.
"""
import subprocess
from pathlib import Path


def ensure_git_repo(vault_root: Path) -> None:
    if not (vault_root / ".git").exists():
        subprocess.run(["git", "init"], cwd=vault_root, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "wcg@localhost"], cwd=vault_root, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Web Context Graph"], cwd=vault_root, capture_output=True)


def autocommit(vault_root: Path, message: str, *, check: bool = False) -> None:
    subprocess.run(
        ["git", "add", "-A"],
        cwd=vault_root,
        capture_output=True,
        check=check,
    )
    subprocess.run(
        ["git", "commit", "-m", message, "--allow-empty-message", "--quiet"],
        cwd=vault_root,
        capture_output=True,
        check=check,
    )
