import os
import mimetypes
import json
from typing import Optional
from utils.schema_helper import tool
from utils.secure_fs import resolve_path, SecurityError

# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------
DEFAULT_READ_LIMIT = 2000
MAX_LINE_LENGTH = 2000
MAX_BYTES = 50 * 1024  # 50KB soft limit per read

# ---------------------------------------------------------
# HELPERS
# ---------------------------------------------------------

def _is_binary_file(filepath: str) -> bool:
    """Check if file is binary based on extension and content sampling."""
    _, ext = os.path.splitext(filepath)
    if ext.lower() in {
        ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", 
        ".war", ".7z", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", 
        ".odt", ".ods", ".odp", ".bin", ".dat", ".obj", ".o", ".a", ".lib", 
        ".wasm", ".pyc", ".pyo"
    }:
        return True

    try:
        if os.path.getsize(filepath) == 0: return False
        with open(filepath, 'rb') as f:
            chunk = f.read(4096)
            if not chunk: return False
            if b'\0' in chunk: return True
            non_printable = sum(1 for b in chunk if b < 9 or (13 < b < 32))
            return (non_printable / len(chunk)) > 0.3
    except Exception:
        return False

# ---------------------------------------------------------
# TOOL
# ---------------------------------------------------------

@tool
def read_file(file_path: str, offset: int = 0, limit: int = DEFAULT_READ_LIMIT) -> str:
    """
    Reads a file from the local filesystem. Returns structured JSON.
    
    :param file_path: Relative path to the file.
    :param offset: Line number to start reading from (0-indexed).
    :param limit: Max number of lines to read.
    """
    result = {
        "status": "failed",
        "output": "",           
        "raw_content": "",      
        "file_path": file_path,
        "total_lines": 0,
        "read_lines": 0,
        "is_truncated": False,
        "error": None
    }

    # 1. Path Resolution & Security
    try:
        resolved_path = resolve_path(file_path)
    except SecurityError as e:
        result["error"] = f"Security Error: {e}"
        result["output"] = result["error"]
        return json.dumps(result)

    # 2. Existence Check & Fuzzy Suggestion
    if not os.path.exists(resolved_path):
        result["error"] = f"File not found: {file_path}"
        
        dirname = os.path.dirname(resolved_path)
        basename = os.path.basename(resolved_path)
        suggestions = []
        if os.path.exists(dirname) and os.path.isdir(dirname):
            try:
                for entry in os.listdir(dirname):
                    if basename.lower() in entry.lower() or entry.lower() in basename.lower():
                        suggestions.append(entry)
            except: pass
        
        if suggestions:
            result["error"] += f"\nDid you mean: {', '.join(suggestions[:3])}?"
        
        result["output"] = result["error"]
        return json.dumps(result)

    # 3. Type/Binary Checks
    mime_type, _ = mimetypes.guess_type(resolved_path)
    if _is_binary_file(resolved_path) or (mime_type and mime_type.startswith("image/")):
        result["error"] = f"Binary file detected ({mime_type or 'unknown'}). Cannot read as text."
        result["output"] = result["error"]
        return json.dumps(result)

    # 4. Read & Format Content
    try:
        with open(resolved_path, 'r', encoding='utf-8', errors='replace') as f:
            all_lines = f.readlines()

        result["total_lines"] = len(all_lines)
        
        # Calculate Slice
        start_idx = max(0, offset)
        end_idx = min(len(all_lines), start_idx + limit)
        target_lines = all_lines[start_idx:end_idx]
        
        formatted_lines = []
        raw_lines = []
        bytes_count = 0
        
        for i, line in enumerate(target_lines):
            clean_line = line.rstrip('\n')
            
            if len(clean_line) > MAX_LINE_LENGTH:
                clean_line = clean_line[:MAX_LINE_LENGTH] + "...[line truncated]"
            
            line_cost = len(clean_line) + 1
            if bytes_count + line_cost > MAX_BYTES:
                result["is_truncated"] = True
                break
            
            bytes_count += line_cost
            raw_lines.append(clean_line)
            
            line_num = start_idx + i + 1
            formatted_lines.append(f"{line_num:05d}| {clean_line}")

        result["read_lines"] = len(formatted_lines)
        result["raw_content"] = "\n".join(raw_lines)
        result["status"] = "success"

        # 5. Construct LLM Output
        llm_output = f"<file path='{file_path}'>\n" + "\n".join(formatted_lines) + "\n</file>"
        
        if result["is_truncated"]:
            llm_output += f"\n(Truncated at {MAX_BYTES} bytes. Use offset={start_idx + len(formatted_lines)} to read more)"
        elif end_idx < result["total_lines"]:
            # FIX: Changed 'end_index' (typo) to 'end_idx'
            llm_output += f"\n(More content available. Use offset={end_idx} to read next chunk)"
        
        result["output"] = llm_output

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        result["output"] = f"System Error reading file: {str(e)}"

    return json.dumps(result)