import os
import json
from typing import Optional
from utils.schema_helper import tool
from utils.secure_fs import resolve_path, SecurityError

@tool
def edit_file(file_path: str, content: str, workdir: Optional[str] = None) -> str:
    """
    Overwrites a file with the provided content. 
    Returns a JSON string containing the operation status.

    :param file_path: The path to the file to edit (relative to workdir or root).
    :param content: The new content to write to the file.
    :param workdir: Optional relative path to the working directory.
    """
    result = {
        "status": "failed",
        "output": "",
        "error": None,
        "path": file_path
    }

    try:
        # 1. Construct the relative path based on workdir
        # This ensures we resolve the final destination relative to the project root
        base_dir = workdir if workdir else "."
        target_relative_path = os.path.join(base_dir, file_path)

        # 2. Resolve Absolute Path & Verify Security
        # resolve_path raises SecurityError if the path tries to escape the sandbox
        full_abs_path = resolve_path(target_relative_path)

        # 3. Ensure parent directories exist
        parent_dir = os.path.dirname(full_abs_path)
        if not os.path.exists(parent_dir):
            os.makedirs(parent_dir, exist_ok=True)

        # 4. Write Content
        with open(full_abs_path, 'w', encoding='utf-8') as file:
            file.write(content)

        result["status"] = "success"
        result["output"] = f"Successfully wrote {len(content)} characters to {file_path}"

    except SecurityError as e:
        result["error"] = f"Security check failed: {str(e)}"
        result["output"] = result["error"]
        
    except IOError as e:
        result["error"] = f"IO Error: {str(e)}"
        result["output"] = f"Failed to write file: {str(e)}"
        
    except Exception as e:
        result["error"] = str(e)
        result["output"] = f"Unexpected error: {str(e)}"

    return json.dumps(result)