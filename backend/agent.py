import os
import time
import logging
import json
import sys
import re
from typing import Generator, Optional, Dict, Any, List
from dataclasses import dataclass
from dotenv import load_dotenv
from openai import OpenAI

# Reuse existing modules
from tool_registry import get_all_tool_schemas, execute_tool_call
from utils.prompts import get_system_prompt
from utils.context import ContextManager

# Setup Logging to STDERR (Safe for JSON-RPC)
logging.basicConfig(
    stream=sys.stderr, 
    level=logging.INFO, 
    format='[Agent] %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

@dataclass(frozen=True)
class Config:
    # Point to local Ollama server
    BASE_URL: str = "http://localhost:11434/v1"
    API_KEY: str = "ollama"
    
    # Models
    # Use "qwen2.5-coder:7b" if your machine can handle it, otherwise "1.5b"
    MODEL_ID: str = "qwen2.5-coder:1.5b"           
    INLINE_MODEL_ID: str = "qwen2.5-coder:0.5b"  
    
    PERSONA: str = "coder"
    MODEL_CONTEXT_LIMIT: int = 32768
    MAX_OUTPUT_TOKENS: int = 4096

class Agent:
    def __init__(self):
        try:
            self.client = OpenAI(
                base_url=Config.BASE_URL,
                api_key=Config.API_KEY
            )
            self.client.models.list()
        except Exception:
            logger.error("Could not connect to Ollama. Is it running?")
            
        self.system_prompt = get_system_prompt(Config.PERSONA)
        self.tools = get_all_tool_schemas()
        
        self.memory = ContextManager(
            system_prompt=self.system_prompt,
            model_limit=Config.MODEL_CONTEXT_LIMIT,
            max_output=Config.MAX_OUTPUT_TOKENS
        )

    def fast_completion(self, code: str, cursor: int, language: str = "python") -> Optional[str]:
        """
        The 'Fast Loop' using local Qwen 0.5B
        """
        lines = code.split('\n')
        prefix = lines[cursor] if 0 <= cursor < len(lines) else ""

        # Simplified Prompt to force raw code
        messages = [
            {
                "role": "system", 
                "content": "Complete the code. Output ONLY the completion code. No markdown. No repetition."
            },
            {
                "role": "user", 
                "content": f"{prefix}"
            }
        ]

        try:
            response = self.client.chat.completions.create(
                model=Config.INLINE_MODEL_ID,
                messages=messages, # type: ignore
                max_tokens=50,
                temperature=0.1,
                stop=["\n"] 
            )
            
            content = response.choices[0].message.content
            if not content: return None

            # 1. Strip Markdown (Common failure in 0.5B)
            # Removes ```python or ``` at start/end
            clean = re.sub(r"^```\w*\s*", "", content).replace("```", "")
            
            # 2. Extract First Line
            completion = clean.split('\n')[0].rstrip()

            # 3. Handle Repetition (Model repeats the prompt)
            if completion.startswith(prefix) and len(completion) > len(prefix):
                completion = completion[len(prefix):]
            elif completion == prefix:
                return None

            logger.info(f"Inline Raw: {content!r} -> Clean: {completion!r}")
            return completion if completion.strip() else None

        except Exception as e:
            logger.error(f"Fast completion failed: {e}")
            return None

    def explain_symbol(self, symbol: str, context: str) -> str:
        """
        The 'Hover Loop'
        """
        messages = [
            {"role": "system", "content": "You are a coding assistant. Explain the symbol in 1 sentence."},
            {"role": "user", "content": f"Symbol: {symbol}\nContext:\n{context}"}
        ]

        try:
            response = self.client.chat.completions.create(
                model=Config.MODEL_ID,
                messages=messages, # type: ignore
                max_tokens=150,
                temperature=0.2
            )
            return response.choices[0].message.content or "No explanation generated."
        except Exception as e:
            logger.error(f"Explanation failed: {e}")
            return "Axiom could not explain this symbol."

    def chat(self, user_input: str) -> Generator[Dict[str, Any], None, None]:
        self.memory.add_message("user", user_input)
        retries = 0
        
        while retries < 3:
            try:
                response = self.client.chat.completions.create(
                    model=Config.MODEL_ID,
                    messages=self.memory.get_messages(), # type: ignore
                    tools=self.tools, # type: ignore
                    tool_choice="auto",
                    max_tokens=Config.MAX_OUTPUT_TOKENS,
                    temperature=0.1
                )
                
                message = response.choices[0].message
                content = message.content or ""
                tool_calls = message.tool_calls

                # [Leak Detector: Recover JSON if model output text instead of tool_call]
                if not tool_calls and content.strip().startswith("{") and "name" in content:
                    try:
                        data = json.loads(content)
                        if "name" in data and "arguments" in data:
                            from openai.types.chat.chat_completion_message_tool_call import ChatCompletionMessageToolCall, Function
                            tool_calls = [
                                ChatCompletionMessageToolCall(
                                    id="call_" + str(int(time.time())),
                                    function=Function(name=data["name"], arguments=json.dumps(data["arguments"])),
                                    type="function"
                                )
                            ]
                            message.content = None # Suppress the raw JSON text
                    except: pass

                if tool_calls:
                    self.memory.add_tool_calls(message)
                    
                    for tool in tool_calls:
                        func_name = tool.function.name # type: ignore
                        call_id = tool.id
                        
                        yield {"type": "info", "content": f"Running tool: {func_name}..."}

                        try:
                            args_raw = tool.function.arguments # type: ignore
                            args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
                            result = execute_tool_call(func_name, args)
                            
                            # --- FIX: PASS UI COMPONENTS TO FRONTEND ---
                            # If the tool returned a special UI packet (like a Diff), yield it now.
                            if "__axiom_type__" in result:
                                try:
                                    # We yield it as a 'component' type so frontend handles it specially
                                    json_res = json.loads(result)
                                    yield {"type": "component", "data": json_res}
                                except: pass
                            # -------------------------------------------

                        except Exception as tool_err:
                            result = f"Tool Error: {str(tool_err)}"

                        self.memory.add_message("tool", result, tool_call_id=call_id)

                else:
                    self.memory.add_message("assistant", content)
                    yield {"type": "answer", "content": content}
                    return

            except Exception as e:
                logger.error(f"Chat error: {e}")
                retries += 1
                time.sleep(1)
        
        yield {"type": "error", "content": "Failed to generate response."}