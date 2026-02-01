import os
import re
import fnmatch
import json
from typing import List, Optional
from utils.schema_helper import tool
from utils.secure_fs import resolve_path, SecurityError

@tool
def grep_tool(
    query: str, 
    path: str = ".", 
    include: Optional[List[str]] = None, 
    exclude: Optional[List[str]] = None, 
    case_sensitive: bool = False
) -> str:
    """
    Search for a regular expression pattern in files. 
    Returns a JSON string containing match details.

    :param query: The regular expression pattern to search for.
    :param path: The relative path to the directory to search in.
    :param include: Glob patterns to include (e.g. ["*.ts"]).
    :param exclude: Glob patterns to exclude (e.g. ["**/node_modules"]).
    :param case_sensitive: Whether the search should be case sensitive.
    """
    result = {
        "status": "success",
        "matches": [],
        "count": 0,
        "limit_hit": False,
        "output": "",
        "error": None
    }

    # 1. Path Resolution & Security
    try:
        target_dir = resolve_path(path)
        workspace_root = resolve_path(".")
    except SecurityError as e:
        result["status"] = "error"
        result["error"] = f"Security Error: {str(e)}"
        return json.dumps(result)

    if not os.path.exists(target_dir):
        result["status"] = "error"
        result["error"] = f"Path not found: {path}"
        return json.dumps(result)

    # 2. Compile Regex
    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        regex = re.compile(query, flags)
    except re.error as e:
        result["status"] = "error"
        result["error"] = f"Invalid Regex: {str(e)}"
        return json.dumps(result)

    MAX_RESULTS = 1000
    
    # 3. Walk and Search
    # Default exclusions to keep search fast
    DEFAULT_EXCLUDES = {'.git', 'node_modules', '__pycache__', '.next', 'dist', 'build', '.DS_Store'}
    
    formatted_lines = []

    # If path is a single file, handle it directly
    if os.path.isfile(target_dir):
        files_to_scan = [target_dir]
        walk_generator = []
    else:
        files_to_scan = []
        walk_generator = os.walk(target_dir)

    for root, dirs, files in walk_generator:
        # Prune directories in-place
        dirs[:] = [d for d in dirs if d not in DEFAULT_EXCLUDES]
        
        # Apply custom exclude to directories
        if exclude:
            dirs[:] = [d for d in dirs if not any(fnmatch.fnmatch(d, p) for p in exclude)]

        for filename in files:
            files_to_scan.append(os.path.join(root, filename))

    for file_path in files_to_scan:
        if result["limit_hit"]:
            break

        rel_path = os.path.relpath(file_path, workspace_root)

        # Filter: Include
        if include and not any(fnmatch.fnmatch(rel_path, p) for p in include):
            continue
        
        # Filter: Exclude (Files)
        if exclude and any(fnmatch.fnmatch(rel_path, p) for p in exclude):
            continue

        try:
            # Read file (skip binary/encoding errors)
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                # Check first chunk for binary null bytes
                if '\0' in f.read(1024): 
                    continue
                f.seek(0) # Reset read pointer

                for line_idx, line in enumerate(f):
                    if regex.search(line):
                        content = line.strip()
                        # Truncate extremely long lines
                        if len(content) > 300:
                            content = content[:300] + "..."

                        match_obj = {
                            "file": rel_path,
                            "line": line_idx + 1,
                            "content": content
                        }
                        
                        result["matches"].append(match_obj)
                        formatted_lines.append(f"{rel_path}:{line_idx + 1}: {content}")

                        if len(result["matches"]) >= MAX_RESULTS:
                            result["limit_hit"] = True
                            break
        except Exception:
            continue

    # 4. Finalize Output
    result["count"] = len(result["matches"])
    
    if result["count"] == 0:
        result["output"] = "No matches found."
    else:
        result["output"] = "\n".join(formatted_lines)
        if result["limit_hit"]:
            result["output"] += f"\n\n(Results truncated at {MAX_RESULTS} matches)"

    return json.dumps(result)