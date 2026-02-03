import pathlib
from typing import Optional

# Global variable to store the authorized workspace root
# Default to None to prevent accidental edits before initialization
_PROJECT_ROOT: Optional[pathlib.Path] = None

# Blocklist remains the same
BLOCKED_FILES = {".env", ".env.local", "secrets.json", "id_rsa", ".DS_Store"}
BLOCKED_DIRS = {".git", ".vscode", ".idea", "__pycache__", "env", "venv", "node_modules"}

class SecurityError(Exception):
    """Custom exception for security violations."""
    pass

def set_workspace_root(path: str):
    """
    Sets the allowed sandbox root. Called by server.py on startup.
    """
    global _PROJECT_ROOT
    try:
        # Resolve immediately to handle symlinks/relative paths
        _PROJECT_ROOT = pathlib.Path(path).resolve()
        
        # Verify the path actually exists
        if not _PROJECT_ROOT.exists():
            raise FileNotFoundError(f"Workspace path does not exist: {path}")
            
    except Exception as e:
        raise SecurityError(f"Failed to set workspace root: {e}")

def get_workspace_root() -> pathlib.Path:
    if _PROJECT_ROOT is None:
        raise SecurityError("Axiom Backend not initialized: Workspace root not set.")
    return _PROJECT_ROOT

def resolve_path(path: str) -> str:
    """
    Resolves a relative path to an absolute path and verifies it is safe.
    """
    root = get_workspace_root()
    
    # 1. Resolve Absolute Path
    try:
        # Join with the configured root, not os.getcwd()
        target_path = (root / path).resolve()
    except Exception as e:
        raise SecurityError(f"Invalid path structure: {path}")

    # 2. Sandbox Check (Prevent Path Traversal)
    if root not in target_path.parents and target_path != root:
         raise SecurityError(f"Access denied. Path '{path}' is outside the workspace '{root}'.")

    # 3. Hidden File/Dir Check
    try:
        relative_parts = target_path.relative_to(root).parts
    except ValueError:
        raise SecurityError("Path is not relative to root.")

    for part in relative_parts:
        if part in BLOCKED_FILES or part in BLOCKED_DIRS:
            raise SecurityError(f"Access denied. '{part}' is restricted.")
            
        if part.startswith("."):
            raise SecurityError(f"Access denied. Hidden item '{part}' is protected.")

    return str(target_path)