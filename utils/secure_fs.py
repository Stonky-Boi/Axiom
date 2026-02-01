import os
import pathlib

# Define the Sandbox Root once
# resolving strictly to avoid symlink attacks or relative path issues
PROJECT_ROOT = pathlib.Path(os.getcwd()).resolve()

# Add additional files/folders to your blocklist with proper path if needed
BLOCKED_FILES = {
    ".env",
    ".env.local", 
    "secrets.json",
    "id_rsa",
    ".DS_Store"
}

BLOCKED_DIRS = {
    ".git",
    ".vscode",
    ".idea",
    "__pycache__",
    "env",
    "venv",
    "node_modules"
}

class SecurityError(Exception):
    """Custom exception for security violations."""
    pass

def resolve_path(path: str) -> str:
    """
    Resolves a relative path to an absolute path and verifies it is safe.
    
    Returns:
        The absolute, safe path.
    
    Raises:
        SecurityError: If the path is outside the sandbox or targets sensitive files.
    """
    # 1. Resolve Absolute Path
    try:
        # Prevent climbing out with '..' before resolving
        target_path = (PROJECT_ROOT / path).resolve()
    except Exception as e:
        raise SecurityError(f"Invalid path structure: {path}")

    # 2. Sandbox Check (Prevent Path Traversal)
    # Checks if PROJECT_ROOT is explicitly a parent of target_path
    # (or if they are the exact same folder)
    if PROJECT_ROOT not in target_path.parents and target_path != PROJECT_ROOT:
         raise SecurityError(f"Access denied. Path '{path}' is outside the project workspace.")

    # 3. Hidden File/Dir Check (Block dotfiles)
    # Checks every single folder in the path AND the filename at the end.
    try:
        relative_parts = target_path.relative_to(PROJECT_ROOT).parts
    except ValueError:
        # Should be caught by Sandbox Check, but double safety
        raise SecurityError("Path is not relative to root.")

    for part in relative_parts:
        # Check against BOTH lists for every part of the path
        if part in BLOCKED_FILES or part in BLOCKED_DIRS:
            raise SecurityError(f"Access denied. '{part}' is restricted.")
            
        if part.startswith("."):
            raise SecurityError(f"Access denied. Hidden item '{part}' is protected.")

    return str(target_path)