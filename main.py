import os
import json
import time
from dataclasses import dataclass
from typing import Any, Generator, Optional, Dict, List

from dotenv import load_dotenv
from huggingface_hub import InferenceClient
from huggingface_hub.utils import HfHubHTTPError

# Import Core Modules
from tool_registry import get_all_tool_schemas, execute_tool_call
from utils.prompts import get_system_prompt
from utils.context import ContextManager

# Configuration
@dataclass(frozen=True)
class Config:
    # Note: If Anyone is chnaging the model pls also update the appropriate configs related to it
    HF_TOKEN: str = os.getenv("HF_TOKEN", "")
    MODEL_ID: str = "Qwen/Qwen3-Coder-480B-A35B-Instruct" 
    PERSONA: str = "coder"
    MODEL_CONTEXT_LIMIT: int = 131072
    MAX_OUTPUT_TOKENS: int = 8192
    MAX_RETRIES: int = 3
    RETRY_DELAY: int = 2

@dataclass
class AgentEvent:
    """
    Structured event payload for frontend consumption.
    types: 'tool_call', 'tool_result', 'answer', 'error', 'info'
    """
    type: str
    content: Any
    tool_name: Optional[str] = None
    tool_id: Optional[str] = None
    tool_args: Optional[Dict] = None

class Agent:
    def __init__(self, hf_token: Optional[str] = None):
        """
        Initialize the agent with authentication and context management.
        """
        load_dotenv()
        self.token = hf_token or Config.HF_TOKEN
        
        if not self.token:
            raise ValueError("HF_TOKEN not found. Please set it in .env or pass it to the constructor.")

        self.client = InferenceClient(api_key=self.token)
        self.system_prompt = get_system_prompt(Config.PERSONA)
        
        self.memory = ContextManager(
            system_prompt=self.system_prompt,
            model_limit=Config.MODEL_CONTEXT_LIMIT,
            max_output=Config.MAX_OUTPUT_TOKENS
        )
        self.tools = get_all_tool_schemas()

    def _call_llm_with_retry(self) -> Any:
        """
        Internal method to handle API calls with exponential backoff.
        """
        retries = 0
        while retries <= Config.MAX_RETRIES:
            try:
                return self.client.chat_completion(
                    model=Config.MODEL_ID,
                    messages=self.memory.get_messages(),
                    tools=self.tools,
                    tool_choice="auto",
                    max_tokens=Config.MAX_OUTPUT_TOKENS,
                    temperature=0.1
                )
            except (HfHubHTTPError, Exception) as e:
                retries += 1
                if retries > Config.MAX_RETRIES:
                    raise e
                time.sleep(Config.RETRY_DELAY * retries)

    def chat(self, user_input: str) -> Generator[AgentEvent, None, None]:
        """
        Process a user message and yield events for the frontend.
        """
        self.memory.add_message("user", user_input)

        while True:
            try:
                response = self._call_llm_with_retry()
            except Exception as e:
                yield AgentEvent(type="error", content=f"Critical API Failure: {str(e)}")
                break

            message = response.choices[0].message

            # Case 1: Tool Calls
            if message.tool_calls:
                self.memory.add_tool_calls(message)
                
                for tool in message.tool_calls:
                    func_name = tool.function.name
                    call_id = tool.id
                    args_str = tool.function.arguments
                    
                    try:
                        args = json.loads(args_str)
                    except json.JSONDecodeError:
                        args = {} 
                    
                    # Notifying Tool is about to run
                    yield AgentEvent(
                        type="tool_call",
                        content="Executing tool...",
                        tool_name=func_name,
                        tool_id=call_id,
                        tool_args=args
                    )

                    # Execute Tool
                    result = execute_tool_call(func_name, args)

                    # Notify Frontend: Tool finished
                    yield AgentEvent(
                        type="tool_result",
                        content=result,
                        tool_name=func_name,
                        tool_id=call_id
                    )

                    self.memory.add_message("tool", result, tool_call_id=call_id)

            # Case 2: Final Answer
            else:
                answer = message.content
                self.memory.add_message("assistant", answer)
                
                yield AgentEvent(type="answer", content=answer)
                break 

    def clear_memory(self):
        self.memory.clear()