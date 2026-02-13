import os
import ast
import re

def parse_python_signatures(file_content: str) -> list[str]:
    signatures = []
    try:
        tree = ast.parse(file_content)
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                args = [arg.arg for arg in node.args.args]
                signatures.append(f"def {node.name}({', '.join(args)}): ...")
            elif isinstance(node, ast.ClassDef):
                signatures.append(f"class {node.name}: ...")
    except Exception as error:
        print(f"[Warning] AST failed to parse Python file: {str(error)}")
    return signatures

def parse_cpp_signatures(file_content: str) -> list[str]:
    signatures = []
    
    # Heuristic match for classes and structs
    class_pattern = re.compile(r"^\s*(?:class|struct)\s+([a-zA-Z0-9_]+)", re.MULTILINE)
    for match in class_pattern.finditer(file_content):
        class_name = match.group(1)
        signatures.append(f"class {class_name} {{ ... }};")

    # Heuristic match for functions: return_type function_name(args) { or ;
    # Handles basic modifiers, explicit namespaces, and pointers/references
    func_pattern = re.compile(
        r"^\s*(?:virtual\s+|static\s+|inline\s+|explicit\s+)*" # Modifiers
        r"([a-zA-Z0-9_<>:]+(?:\s*\*|\s*\&)?)\s+"              # Return type
        r"([a-zA-Z0-9_:]+)\s*"                                # Function name
        r"\(([^)]*)\)\s*"                                     # Arguments
        r"(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?"      # Trailing modifiers
        r"(?:\{|;)",                                          # Opening brace or semicolon
        re.MULTILINE
    )
    
    for match in func_pattern.finditer(file_content):
        return_type = match.group(1).strip()
        function_name = match.group(2).strip()
        arguments = match.group(3).strip()
        
        # Skip control flow keywords that look like functions
        if function_name in ["if", "while", "for", "switch", "catch"]:
            continue
            
        signatures.append(f"{return_type} {function_name}({arguments});")

    return signatures

def get_workspace_context(workspace_root: str, current_file_path: str) -> str:
    if not workspace_root or not os.path.exists(workspace_root):
        return ""

    ignored_dirs = {"venv", ".git", "__pycache__", "node_modules", "clients", "build", "target"}
    valid_python_exts = {".py"}
    valid_cpp_exts = {".cpp", ".hpp", ".h", ".cc"}
    
    skeleton_context = []

    for root, dirs, files in os.walk(workspace_root):
        dirs[:] = [d for d in dirs if d not in ignored_dirs]

        for file in files:
            file_extension = os.path.splitext(file)[1].lower()
            
            if file_extension not in valid_python_exts and file_extension not in valid_cpp_exts:
                continue

            file_path = os.path.join(root, file)
            if file_path == current_file_path:
                continue

            try:
                with open(file_path, "r", encoding="utf-8") as file_handle:
                    file_content = file_handle.read()

                file_signatures = []
                if file_extension in valid_python_exts:
                    file_signatures = parse_python_signatures(file_content)
                elif file_extension in valid_cpp_exts:
                    file_signatures = parse_cpp_signatures(file_content)

                if len(file_signatures) > 0:
                    file_basename = os.path.basename(file_path)
                    skeleton_context.append(f"// File: {file_basename}")
                    skeleton_context.extend(file_signatures)

            except Exception as error:
                print(f"[Warning] File read failed for {file_path}: {str(error)}")
                pass

    if len(skeleton_context) == 0:
        return ""

    return "\n".join(skeleton_context) + "\n\n"