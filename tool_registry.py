import os
import importlib
import inspect
import sys
import logging
from typing import List, Dict, Callable, Any

logger = logging.getLogger(__name__)

TOOLS_DIR = "tools"

_TOOL_CACHE = {
    "schemas": [],      # List of JSON schemas
    "map": {},          # Dict of {name: function}
    "is_loaded": False  # Flag to prevent re-loading
}

def _scan_and_load_tools(force_reload: bool = False):
    """
    Internal Helper:
    1. Walks the tools directory.
    2. Imports/Reloads modules.
    3. Extracts functions with @tool decorators (or .schema attributes).
    4. Populates the global cache in a single pass.
    """
    global _TOOL_CACHE

    # 1. Return immediately if already loaded and no refresh requested
    if _TOOL_CACHE["is_loaded"] and not force_reload:
        return

    # 2. Reset Cache (not loaded/refresh case)
    temp_map = {}
    temp_schemas = []
    
    # Check root path is in sys.path to allow 'tools.module' imports
    if os.getcwd() not in sys.path:
        sys.path.append(os.getcwd())

    # 3. Walk the tools directory only once
    for root, _, files in os.walk(TOOLS_DIR):
        for file in files:
            if file.endswith(".py") and not file.startswith("__"):
                # Calculate module path (e.g., "tools.file_ops")
                rel_path = os.path.relpath(os.path.join(root, file), os.getcwd())
                module_path = rel_path.replace(os.sep, ".").replace(".py", "")

                try:
                    # Import or Reload logic
                    if module_path in sys.modules and force_reload:
                        module = importlib.reload(sys.modules[module_path])
                    else:
                        module = importlib.import_module(module_path)

                    # 4. Inspect Module (Memory Operation)
                    for _, obj in inspect.getmembers(module):
                        if inspect.isfunction(obj) and hasattr(obj, "schema"):
                            # Validate schema has a name
                            func_name = obj.schema.get("function", {}).get("name")
                            if func_name:
                                temp_map[func_name] = obj
                                temp_schemas.append(obj.schema)
                                
                except Exception as e:
                    logger.error(f"Failed to load tool '{module_path}': {e}")

    # 5. Update State
    _TOOL_CACHE["map"] = temp_map
    _TOOL_CACHE["schemas"] = temp_schemas
    _TOOL_CACHE["is_loaded"] = True
    logger.info(f"Tool Registry loaded {len(temp_schemas)} tools.")

def get_all_tool_schemas(refresh: bool = False) -> List[Dict[str, Any]]:
    """
    Returns a list of JSON schemas for the LLM.
    Use refresh=True to force a disk re-scan (useful in dev).
    """
    _scan_and_load_tools(force_reload=refresh)
    return _TOOL_CACHE["schemas"]

def get_tool_map(refresh: bool = False) -> Dict[str, Callable]:
    """
    Returns a dict { 'func_name': python_function } for execution.
    """
    _scan_and_load_tools(force_reload=refresh)
    return _TOOL_CACHE["map"]

def execute_tool_call(tool_name: str, tool_args: dict) -> str:
    """
    Safely executes a tool by name with the provided arguments.
    Handles 'Tool Not Found' and internal tool errors gracefully.
    
    Returns:
        str: The output of the tool, or an error message context for the LLM.
    """
    # 1. Load the map (uses cache)
    tool_map = get_tool_map()
    
    # 2. Check if tool exists
    if tool_name not in tool_map:
        return f"Error: Tool '{tool_name}' not found. Please use one of the provided tools."
    
    # 3. Get the function
    func = tool_map[tool_name]
    
    # 4. Safe Execution
    try:
        # Convert args to string for logging (truncate if too long)
        arg_preview = str(tool_args)[:100]
        logger.info(f"Executing {tool_name} with args: {arg_preview}...")
        
        # Execute
        result = func(**tool_args)
        
        return str(result)
        
    except TypeError as e:
        # Catch argument mismatches (e.g., missing required args)
        return f"Error executing '{tool_name}': Invalid arguments provided. Details: {e}"
    except Exception as e:
        # Catch internal tool logic errors
        return f"Error inside tool '{tool_name}': {e}"