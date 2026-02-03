import os
import sys
import json
import logging
from typing import Dict, Any

# Ensure agent can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from agent import Agent 
from utils.secure_fs import set_workspace_root

# Logging to stderr so we don't break JSON stdout
logging.basicConfig(stream=sys.stderr, level=logging.INFO)
logger = logging.getLogger(__name__)

class AxiomServer:
    def __init__(self):
        self.agent = Agent()
        
    def run(self):
        logger.info("Axiom Server Ready")
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                
                request = json.loads(line)
                response = self.handle_request(request)
                
                # Critical: Write JSON line and flush immediately
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
            except Exception as e:
                logger.error(f"Server Error: {e}")
                # Send error as JSON so client doesn't hang
                sys.stdout.write(json.dumps({"error": str(e)}) + "\n")
                sys.stdout.flush()

    def handle_request(self, req: Dict[str, Any]) -> Dict[str, Any]:
        command = req.get("command")
        data = req.get("data", {})

        if command == "initialize":
            root = data.get("root")
            if root:
                set_workspace_root(root)
                return {"status": "ok", "root": root}

        elif command == "inline_completion":
            return {
                "completion": self.agent.fast_completion(
                    code=data.get("code"),
                    cursor=data.get("cursor_line"),
                    language=data.get("language", "python")
                )
            }
        
        elif command == "chat":
            response_gen = self.agent.chat(data.get("prompt"))
            full_response = ""
            for event in response_gen:
                if event["type"] == "answer":
                    full_response += event["content"]
            return {"response": full_response}

        elif command == "hover":
            return {
                "tooltip": self.agent.explain_symbol(
                    symbol=data.get("symbol"),
                    context=data.get("context")
                )
            }

        return {"error": "Unknown command"}

if __name__ == "__main__":
    import os
    server = AxiomServer()
    server.run()