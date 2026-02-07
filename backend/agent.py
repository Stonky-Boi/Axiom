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
        """
        Rewritten Chat Loop:
        - Yields {"type": "text", "content": "..."} for LLM speech.
        - Yields {"type": "component", "data": {...}} for UI widgets (Diffs).
        """
        self.memory.add_message("user", user_input)
        
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

            # 1. Handle Normal Text Response
            if content:
                self.memory.add_message("assistant", content)
                yield {"type": "text", "content": content}

            # 2. Handle Tool Calls
            if tool_calls:
                self.memory.add_tool_calls(message)
                
                for tool in tool_calls:
                    func_name = tool.function.name #type: ignore
                    call_id = tool.id
                    args_str = tool.function.arguments #type: ignore

                    # Yield 'info' to show spinner/status on frontend
                    yield {"type": "info", "content": f"Running {func_name}..."}

                    try:
                        # Parse Arguments
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                        
                        # Execute Tool
                        raw_result = execute_tool_call(func_name, args)
                        
                        # --- INTERCEPTION LAYER ---
                        # Check if tool returned a UI Component (e.g. Diff)
                        is_component = False
                        if "__axiom_type__" in raw_result:
                            try:
                                component_data = json.loads(raw_result)
                                if component_data.get("__axiom_type__") == "diff":
                                    # A. Send Component to Frontend
                                    yield {"type": "component", "data": component_data}
                                    
                                    # B. sanitize Memory (CRITICAL FIX)
                                    # Do NOT save the huge JSON to memory. The LLM will just repeat it.
                                    # Save a summary instead.
                                    self.memory.add_message("tool", "Diff generated and displayed to user.", tool_call_id=call_id)
                                    is_component = True
                            except:
                                pass # parsing failed, treat as normal text

                        # If it wasn't a special component, save raw result
                        if not is_component:
                            self.memory.add_message("tool", raw_result, tool_call_id=call_id)
                            
                    except Exception as e:
                        error_msg = f"Tool Execution Error: {str(e)}"
                        self.memory.add_message("tool", error_msg, tool_call_id=call_id)

        except Exception as e:
            logger.error(f"Chat Loop Error: {e}")
            yield {"type": "error", "content": str(e)}