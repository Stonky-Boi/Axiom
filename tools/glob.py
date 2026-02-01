import glob
import os
import fnmatch
import json
from typing import Optional
from utils.schema_helper import tool
from utils.secure_fs import resolve_path, SecurityError

@tool
def glob_tool(pattern: str, exclude: Optional[str] = None) -> str:
    """
    Fast file pattern matching using glob patterns. 
    Returns a JSON string with the list of matches.

    :param pattern: The glob pattern to search for (e.g. "src/**/*.py").
    :param exclude: An optional glob pattern to filter out results.
    """
    result = {
        "status": "failed",
        "matches": [],
        "count": 0,
        "output": "",
        "error": None
    }

    # 1. Path Resolution & Security
    try:
        search_root = resolve_path(".")
    except SecurityError as e:
        result["error"] = f"Security Error: {str(e)}"
        result["output"] = result["error"]
        return json.dumps(result)

    try:
        # 2. Execute Glob
        # recursive=True allows ** to work
        # root_dir  makes the glob relative to that dir
        raw_matches = glob.glob(pattern, recursive=True, root_dir=search_root)
        
        # 3. Apply Exclusion
        if exclude:
            raw_matches = [m for m in raw_matches if not fnmatch.fnmatch(m, exclude)]

        # 4. Sort for deterministic output
        raw_matches.sort()

        # 5. Format Matches (Append / to directories)
        formatted_matches = []
        for m in raw_matches:
            full_path = os.path.join(search_root, m)
            if os.path.isdir(full_path):
                formatted_matches.append(f"{m}/")
            else:
                formatted_matches.append(m)

        # 6. Construct Success Response
        result["status"] = "success"
        result["matches"] = formatted_matches
        result["count"] = len(formatted_matches)
        
        if not formatted_matches:
            result["output"] = "No matches found."
        else:
            # Create a clean, newline-separated string for the LLM to read
            # Truncate output string if it's Too long to save tokens
            limit = 200
            if len(formatted_matches) > limit:
                display_list = formatted_matches[:limit]
                result["output"] = "\n".join(display_list) + f"\n... (and {len(formatted_matches) - limit} more)"
            else:
                result["output"] = "\n".join(formatted_matches)

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        result["output"] = f"Glob Error: {str(e)}"

    return json.dumps(result)