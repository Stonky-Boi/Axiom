import os
import json
import difflib
from typing import Optional
from utils.schema_helper import tool
from utils.secure_fs import resolve_path, SecurityError

@tool
def propose_edit(file_path: str, search_text: str, replace_text: str) -> str:
    """
    Proposes an edit to a file by replacing specific text. 
    Generates a Diff for the user to review.
    
    :param file_path: Relative path to the file.
    :param search_text: The exact text block to find and replace.
    :param replace_text: The new text to insert.
    """
    try:
        # 1. Read File
        abs_path = resolve_path(file_path)
        if not os.path.exists(abs_path):
            return json.dumps({"error": f"File not found: {file_path}"})
            
        with open(abs_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 2. Verify Search Block
        # Normalize line endings to avoid windows/linux mismatch
        content_norm = content.replace('\r\n', '\n')
        search_norm = search_text.replace('\r\n', '\n')
        
        if search_norm not in content_norm:
            return json.dumps({
                "error": "Search block not found. Please ensure the 'search_text' matches the file content exactly."
            })
            
        # 3. Apply Change in Memory
        new_content = content_norm.replace(search_norm, replace_text, 1)
        
        # 4. Generate Unified Diff
        diff_lines = difflib.unified_diff(
            content_norm.splitlines(keepends=True),
            new_content.splitlines(keepends=True),
            fromfile=f"a/{file_path}",
            tofile=f"b/{file_path}",
            n=3 # Context lines
        )
        diff_text = "".join(diff_lines)
        
        # 5. Return Special JSON for Frontend
        return json.dumps({
            "__axiom_type__": "diff",
            "file": file_path,
            "diff": diff_text,
            "search": search_text,
            "replace": replace_text
        })

    except Exception as e:
        return json.dumps({"error": f"Edit failed: {str(e)}"})

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