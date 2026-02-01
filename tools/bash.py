import subprocess
import os
import json
from typing import Optional
from utils.schema_helper import tool
from utils.secure_fs import resolve_path, SecurityError

@tool
def bash_tool(command: str, workdir: Optional[str] = None, timeout: int = 30000) -> str:
    """
    Executes a bash command. Returns a JSON string with stdout, stderr, and exit_code.
    
    :param command: The bash command string to execute.
    :param workdir: Optional relative path to the working directory.
    :param timeout: Timeout in milliseconds (default 30000).
    """
    # 1. Prepare the structure
    result = {
        "stdout": "",
        "stderr": "",
        "exit_code": -1,
        "error": None
    }

    # 2. Security & Path Resolution
    try:
        target_dir = resolve_path(workdir) if workdir else resolve_path(".")
        if not os.path.exists(target_dir):
            result["error"] = f"Directory not found: {workdir or '.'}"
            return json.dumps(result)
    except SecurityError as e:
        result["error"] = f"Security Violation: {str(e)}"
        return json.dumps(result)

    # 3. Execution
    timeout_sec = timeout / 1000.0
    try:
        process = subprocess.run(
            command,
            shell=True,
            cwd=target_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_sec,
            executable="/bin/bash" if os.name != 'nt' else None
        )
        
        result["stdout"] = process.stdout.strip() if process.stdout else ""
        result["stderr"] = process.stderr.strip() if process.stderr else ""
        result["exit_code"] = process.returncode

    except subprocess.TimeoutExpired:
        result["error"] = "Command timed out"
        result["stderr"] = f"Execution exceeded {timeout}ms"
        
    except Exception as e:
        result["error"] = str(e)

    # 4. Return JSON String
    return json.dumps(result)