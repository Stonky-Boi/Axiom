from typing import List, Dict, Any, Optional

class ContextManager:
    def __init__(self, system_prompt: Dict[str, str], model_limit: int = 131072, max_output: int = 8192):
        """
        Args:
            system_prompt: The persona definition.
            model_limit: Hard limit of the model (Default 128k for modern large-context models).
            max_output: Tokens reserved for reply (Default 8192 to support 'Thinking' models).
        """
        self.system_prompt = system_prompt
        # We cap the history at (Model Limit - Output Reserve - 5% Safety Buffer)
        self.safe_token_limit = int((model_limit - max_output) * 0.95)
        self.messages: List[Dict[str, Any]] = [system_prompt]

    def add_message(self, role: str, content: str, tool_call_id: Optional[str] = None):
        msg = {"role": role, "content": str(content)}
        if tool_call_id:
            msg["tool_call_id"] = tool_call_id
        self.messages.append(msg)

    def add_tool_calls(self, message_object: Any):
        self.messages.append(message_object)

    def _estimate_tokens(self, text: str) -> int:
        return len(text) // 4

    def get_messages(self) -> List[Dict[str, Any]]:
        """
        Returns history that fits safely within the context window.
        """
        # Start with the mandatory system prompt
        current_tokens = self._estimate_tokens(self.system_prompt.get("content", ""))
        refined_history = []
        
        # Iterate backwards (Newest -> Oldest) to keep the most relevant context
        # Skipping index 0 (System Prompt)
        for msg in reversed(self.messages[1:]):
            content = msg.get("content", "") if isinstance(msg, dict) else str(msg)
            msg_tokens = self._estimate_tokens(str(content))
            
            if current_tokens + msg_tokens <= self.safe_token_limit:
                current_tokens += msg_tokens
                refined_history.append(msg)
            else:
                break # Stop if we are full

        # Reverse back to chronological order (Oldest -> Newest)
        # Result: [System Prompt] + [Oldest that fit] ... [Newest]
        return [self.system_prompt] + list(reversed(refined_history))

    def clear(self):
        self.messages = [self.system_prompt]