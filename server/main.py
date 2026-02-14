from fastapi import FastAPI, HTTPException
from contextlib import asynccontextmanager
from pydantic import BaseModel
from ollama import AsyncClient, ResponseError
import uvicorn
import os
from context_engine import get_workspace_context

inline_model_name = "qwen2.5-coder:1.5b"
chat_model_name = "qwen2.5-coder:3b"

# --- Data Models ---

class AutocompleteRequest(BaseModel):
    file_path: str
    workspace_root: str
    prefix_text: str
    suffix_text: str

class AutocompleteResponse(BaseModel):
    suggestion: str

# --- Server Lifecycle ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    ollama_client = AsyncClient(host="http://localhost:11434")
    
    try:
        for required_model in [inline_model_name, chat_model_name]:
            try:
                await ollama_client.show(required_model)
                print(f"SUCCESS: Model '{required_model}' is available.")
            except ResponseError as error:
                if error.status_code == 404:
                    print(f"WARNING: Model '{required_model}' is missing. Please run 'ollama pull {required_model}'")
                else:
                    raise error
    except Exception as error:
        print(f"CRITICAL ERROR: Cannot connect to Ollama daemon. Details: {str(error)}")
        
    yield
    print("Shutting down Axiom server.")

app = FastAPI(title="Axiom Server", lifespan=lifespan)

# --- Endpoints ---

@app.get("/health")
async def get_health_status():
    ollama_client = AsyncClient(host="http://localhost:11434")
    try:
        await ollama_client.list()
        return {"status": "ok", "message": "Axiom server is running and connected to Ollama."}
    except Exception as error:
        raise HTTPException(
            status_code=503, 
            detail=f"Service Unavailable: Failed to connect to Ollama. Details: {str(error)}"
        )

@app.post("/autocomplete", response_model=AutocompleteResponse)
async def get_autocomplete(request: AutocompleteRequest):
    ollama_client = AsyncClient(host="http://localhost:11434")

    max_context_length = 1500
    truncated_prefix = request.prefix_text[-max_context_length:]
    truncated_suffix = request.suffix_text[:max_context_length]

    # Generate the multi-file skeleton context
    project_context = get_workspace_context(request.workspace_root, request.file_path)

    file_basename = os.path.basename(request.file_path)
    file_name_anchor = f"<|file_sep|>{file_basename}\n"
    
    # Inject the project context BEFORE the file anchor so the model knows the environment
    fim_prompt = f"{project_context}{file_name_anchor}<|fim_prefix|>{truncated_prefix}<|fim_suffix|>{truncated_suffix}<|fim_middle|>"

    try:
        response = await ollama_client.generate(
            model=inline_model_name,
            prompt=fim_prompt,
            raw=True,
            keep_alive=-1, 
            options={
                "temperature": 0.1,
                "num_predict": 64, 
                "stop": [
                    "<|file_sep|>", 
                    "<|fim_pad|>", 
                    "<|endoftext|>", 
                    "<|fim_middle|>", 
                    "<|im_end|>", 
                    "\n\n"
                ]
            }
        )

        suggestion = response["response"]
        
        suggestion = suggestion.replace("<|fim_middle|>", "")
        suggestion = suggestion.replace("<|file_sep|>", "")
        suggestion = suggestion.replace("<|fim_pad|>", "")
        suggestion = suggestion.replace("<|endoftext|>", "")
        suggestion = suggestion.replace("<|im_end|>", "")

        return AutocompleteResponse(suggestion=suggestion)

    except Exception as error:
        print(f"\n[CRITICAL ERROR] Autocomplete inference failed: {str(error)}\n")
        raise HTTPException(
            status_code=500, 
            detail=f"Autocomplete inference failed. Details: {str(error)}"
        )
    
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    workspace_root: str
    active_file_path: str
    active_file_content: str = ""
    selected_text: str

class ChatResponse(BaseModel):
    reply: str

@app.post("/chat", response_model=ChatResponse)
async def process_chat(request: ChatRequest):
    ollama_client = AsyncClient(host="http://localhost:11434")

    # 1. Build the system prompt with context
    system_prompt = (
        "You are Axiom, an expert local AI coding assistant.\n"
        "You have a tool to edit files. You MUST use it when the user asks for code changes.\n"
        "\n"
        "--- CRITICAL TOOL USE INSTRUCTIONS ---\n"
        "When the user asks to refactor, fix, or update code, you MUST output the code wrapped in these specific tags:\n"
        "\n"
        "<<<UPDATE_FILE>>>\n"
        "[Put the full file content here]\n"
        "<<<END_UPDATE>>>\n"
        "\n"
        "Example Response:\n"
        "I have updated the file to include the print statement.\n"
        "<<<UPDATE_FILE>>>\n"
        "#include <iostream>\n"
        "int main() {\n"
        "    std::cout << \"Hello World\";\n"
        "    return 0;\n"
        "}\n"
        "<<<END_UPDATE>>>\n"
        "\n"
        "RULES:\n"
        "1. Do NOT use standard markdown code blocks (```cpp) for file updates. Use the <<<TAGS>>>.\n"
        "2. Provide the COMPLETE file content inside the tags, not just a snippet.\n"
        "3. Use snake_case naming.\n\n"
    )

    if request.active_file_path:
        # Check if we have a workspace root to calculate relative path
        if request.workspace_root and os.path.exists(request.workspace_root):
            try:
                display_path = os.path.relpath(request.active_file_path, request.workspace_root)
            except ValueError:
                display_path = os.path.basename(request.active_file_path)
        else:
            display_path = os.path.basename(request.active_file_path)
            
        system_prompt += f"Active File: {display_path}\n"

    # If the user has highlighted specific code, prioritize that context
    if request.selected_text:
        system_prompt += f"Selected Code:\n```\n{request.selected_text}\n```\n"
    else:
        # Otherwise, grab the multi-file skeleton context
        workspace_context = get_workspace_context(request.workspace_root, request.active_file_path)
        if workspace_context:
            system_prompt += f"Workspace Context:\n{workspace_context}\n"

    if request.active_file_content:
        # If user highlighted text, we focus on that, but we still provide the full file as reference
        if request.selected_text:
            system_prompt += f"\n--- FULL CONTENT OF {display_path} (For Reference) ---\n"
            system_prompt += request.active_file_content
            system_prompt += "\n\n--- USER SELECTED CODE ---\n"
            system_prompt += request.selected_text
        else:
            system_prompt += f"\n--- ACTIVE FILE CONTENT: {display_path} ---\n"
            system_prompt += request.active_file_content
            system_prompt += "\n--------------------------------------------\n"

    # 2. Format messages for the Ollama Chat API
    formatted_messages = [{"role": "system", "content": system_prompt}]
    
    for msg in request.messages:
        content = msg.content
        
        # Forcefully remind the model at the end of every user turn
        if msg.role == "user":
            content += (
                "\n\nIMPORTANT: If you write any code, you MUST wrap it in "
                "<<<UPDATE_FILE>>> and <<<END_UPDATE>>> tags. "
                "Do NOT use standard markdown blocks."
            )
            
        formatted_messages.append({"role": msg.role, "content": content})

    try:
        response = await ollama_client.chat(
            model=chat_model_name,
            messages=formatted_messages,
            keep_alive=-1,
            options={
                "temperature": 0.1, # Lower temperature = stricter adherence to rules
                "num_predict": 1024
            }
        )

        reply_content = response["message"]["content"]
        return ChatResponse(reply=reply_content)

    except Exception as error:
        print(f"\n[CRITICAL ERROR] Chat inference failed: {str(error)}\n")
        raise HTTPException(
            status_code=500, 
            detail=f"Chat inference failed. Details: {str(error)}"
        )

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)