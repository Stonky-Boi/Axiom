import os
import importlib
import inspect
import sys
import logging
from typing import List, Dict, Callable, Any

logger = logging.getLogger(__name__)

# Dynamically find the 'tools' directory relative to this file
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_DIR = os.path.join(CURRENT_DIR, "tools")

_TOOL_CACHE = {
    "schemas": [],
    "map": {},
    "is_loaded": False
}

def _scan_and_load_tools(force_reload: bool = False):
    global _TOOL_CACHE

    if _TOOL_CACHE["is_loaded"] and not force_reload:
        return

    temp_map = {}
    temp_schemas = []
    
    # Ensure the backend directory is in sys.path so we can import 'tools.xxx'
    if CURRENT_DIR not in sys.path:
        sys.path.append(CURRENT_DIR)

    if not os.path.exists(TOOLS_DIR):
        logger.error(f"Tools directory not found at {TOOLS_DIR}")
        return

    for root, _, files in os.walk(TOOLS_DIR):
        for file in files:
            if file.endswith(".py") and not file.startswith("__"):
                # Construct module path (e.g. "tools.read")
                # We assume tools are flat or direct children of backend/tools
                module_name = f"tools.{file[:-3]}"

                try:
                    if module_name in sys.modules and force_reload:
                        module = importlib.reload(sys.modules[module_name])
                    else:
                        module = importlib.import_module(module_name)

                    for _, obj in inspect.getmembers(module):
                        if inspect.isfunction(obj) and hasattr(obj, "schema"):
                            schema = getattr(obj, "schema", {})
                            func_name = schema.get("function", {}).get("name")
                            if func_name:
                                temp_map[func_name] = obj
                                schema = getattr(obj, "schema", None)
                                if schema is not None:
                                    temp_schemas.append(schema)
                                
                except Exception as e:
                    logger.error(f"Failed to load tool '{module_name}': {e}")

    _TOOL_CACHE["map"] = temp_map
    _TOOL_CACHE["schemas"] = temp_schemas
    _TOOL_CACHE["is_loaded"] = True
    logger.info(f"Tool Registry loaded {len(temp_schemas)} tools.")

# ... (rest of the file: get_all_tool_schemas, get_tool_map, execute_tool_call remain the same) ...
# Copy the existing implementation for those functions here.
def get_all_tool_schemas(refresh: bool = False) -> List[Dict[str, Any]]:
    _scan_and_load_tools(force_reload=refresh)
    return _TOOL_CACHE["schemas"]

def get_tool_map(refresh: bool = False) -> Dict[str, Callable]:
    _scan_and_load_tools(force_reload=refresh)
    return _TOOL_CACHE["map"]

def execute_tool_call(tool_name: str, tool_args: dict) -> str:
    tool_map = get_tool_map()
    if tool_name not in tool_map:
        return f"Error: Tool '{tool_name}' not found."
    
    func = tool_map[tool_name]
    try:
        # Just cast args roughly to string for logging
        logger.info(f"Executing {tool_name}...")
        result = func(**tool_args)
        return str(result)
    except TypeError as e:
        return f"Error executing '{tool_name}': {e}"
    except Exception as e:
        return f"Error inside tool '{tool_name}': {e}"