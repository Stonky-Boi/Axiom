import os
import json
from utils.schema_helper import tool
from utils.secure_fs import resolve_path, SecurityError

@tool
def write_file(file_path: str, content: str) -> str:
    """
    Writes content to a file. Returns a JSON string with write statistics.

    IMPORTANT:
    1. This tool will OVERWRITE existing files.
    2. Ensure parent directories are created automatically.
    
    :param file_path: Relative path to the file (e.g., 'src/utils.py').
    :param content: The full text content to write.
    """
    result = {
        "status": "failed",
        "output": "",
        "error": None,
        "file_path": file_path,
        "bytes_written": 0,
        "lines_written": 0
    }

    # 1. Path Resolution & Security
    try:
        resolved_path = resolve_path(file_path)
    except SecurityError as e:
        result["error"] = f"Security Error: {e}"
        result["output"] = result["error"]
        return json.dumps(result)

    # 2. Directory Check
    if os.path.exists(resolved_path) and os.path.isdir(resolved_path):
        result["error"] = f"Cannot write to '{file_path}': It is a directory."
        result["output"] = result["error"]
        return json.dumps(result)

    # 3. Create Parent Directories
    dir_name = os.path.dirname(resolved_path)
    if dir_name and not os.path.exists(dir_name):
        try:
            os.makedirs(dir_name, exist_ok=True)
        except OSError as e:
            result["error"] = f"Failed to create directory '{dir_name}': {str(e)}"
            result["output"] = result["error"]
            return json.dumps(result)

    # 4. Write Content
    try:
        with open(resolved_path, 'w', encoding='utf-8') as f:
            f.write(content)
            
        # 5. Calculate Stats
        byte_size = len(content.encode('utf-8'))
        line_count = len(content.split('\n'))
        
        result["status"] = "success"
        result["bytes_written"] = byte_size
        result["lines_written"] = line_count
        result["output"] = f"Success: Wrote {byte_size} bytes ({line_count} lines) to '{file_path}'."

    except Exception as e:
        result["error"] = str(e)
        result["output"] = f"Error writing file: {str(e)}"

    return json.dumps(result)