import inspect
import typing
import re

def _py_type_to_json(py_type):
    """
    Maps Python types to JSON Schema types.
    """
    origin = getattr(py_type, "__origin__", None)
    
    if origin is typing.Literal:
        return {
            "type": "string",
            "enum": list(py_type.__args__)
        }
    
    if origin is list or origin is typing.List:
        item_type = py_type.__args__[0] if py_type.__args__ else str
        return {
            "type": "array",
            "items": _py_type_to_json(item_type)
        }

    type_map = {
        int: "integer",
        str: "string",
        bool: "boolean",
        float: "number",
        dict: "object",
        list: "array",
        type(None): "null"
    }
    return {"type": type_map.get(py_type, "string")}

def _parse_param_descriptions(docstring):
    """
    Parses :param name: description from docstrings.
    """
    if not docstring:
        return {}
    
    params = {}
    matches = re.findall(r':param\s+(\w+):\s*(.+)', docstring)
    for name, desc in matches:
        params[name] = desc.strip()
    return params

def tool(func):
    """
    Decorator that generates a JSON schema and attaches it to the function as .schema.
    """
    doc = inspect.getdoc(func) or ""
    func_desc = doc.split(":param")[0].strip() if doc else "No description."
    param_docs = _parse_param_descriptions(doc)

    try:
        type_hints = typing.get_type_hints(func)
    except Exception:
        type_hints = {}

    sig = inspect.signature(func)
    properties = {}
    required = []

    for name, param in sig.parameters.items():
        if name == "self": continue

        annotation = type_hints.get(name, param.annotation)
        if annotation == inspect.Parameter.empty:
            annotation = str

        field_schema = _py_type_to_json(annotation)
        
        if name in param_docs:
            field_schema["description"] = param_docs[name]

        properties[name] = field_schema

        if param.default == inspect.Parameter.empty:
            required.append(name)

    func.schema = {
        "type": "function",
        "function": {
            "name": func.__name__,
            "description": func_desc,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            }
        }
    }
    
    return func