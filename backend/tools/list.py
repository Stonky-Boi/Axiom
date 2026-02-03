import os
import fnmatch
import json
from typing import List, Optional
from utils.schema_helper import tool
from utils.secure_fs import resolve_path, SecurityError

@tool
def list_files(path: str = ".", ignore: Optional[List[str]] = None) -> str:
    """
    Lists files and directories in a given path.
    Returns a JSON string containing the list of entries.
    
    :param path: Relative path to list (default is root '.').
    :param ignore: Optional list of glob patterns to ignore (e.g., ['*.pyc', '__pycache__']).
    """
    if ignore is None:
        ignore = []

    result = {
        "status": "success",
        "files": [],      # List of strings (e.g. ["folder/", "file.txt"])
        "count": 0,
        "output": "",     # Clean string for LLM
        "error": None,
        "path": path      # Echo back the requested path
    }

    # 1. Path Resolution & Security
    try:
        resolved_path = resolve_path(path)
    except SecurityError as e:
        result["status"] = "error"
        result["error"] = f"Security Error: {e}"
        return json.dumps(result)

    # 2. Existence & Directory Check
    if not os.path.exists(resolved_path):
        result["status"] = "error"
        result["error"] = f"Directory not found: {path}"
        return json.dumps(result)
    
    if not os.path.isdir(resolved_path):
        result["status"] = "error"
        result["error"] = f"Path is not a directory: {path}. Use 'read_file' to view contents."
        return json.dumps(result)

    # 3. Read Directory
    try:
        entries = os.listdir(resolved_path)
        
        # 4. Filter & Sort
        entries.sort()
        
        formatted_entries = []
        for entry in entries:
            # Check against ignore patterns
            if any(fnmatch.fnmatch(entry, pattern) for pattern in ignore):
                continue

            full_path = os.path.join(resolved_path, entry)
            
            # Visual indicator for directories (Standard convention for LLMs)
            if os.path.isdir(full_path):
                formatted_entries.append(f"{entry}/")
            else:
                formatted_entries.append(entry)

        result["files"] = formatted_entries
        result["count"] = len(formatted_entries)

        # 5. Output Construction for LLM
        if not formatted_entries:
            result["output"] = "(empty directory)"
        else:
            # Provide a simple newline-separated list
            result["output"] = "\n".join(formatted_entries)
            
            # Context footer for Large directories
            if result["count"] > 50:
                result["output"] += f"\n\n(Total: {result['count']} items)"

    except OSError as e:
        result["status"] = "error"
        result["error"] = f"Failed to read directory: {str(e)}"
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"Unexpected error: {str(e)}"

    return json.dumps(result)