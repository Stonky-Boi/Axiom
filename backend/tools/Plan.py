import json
from typing import List, Dict, Any
from utils.schema_helper import tool

# ---------------------------------------------------------
# GLOBAL STATE (In-Memory)
# ---------------------------------------------------------
# This dictionary persists while the agent script is running.
_PLAN_STATE = {
    "goal": "",
    "tasks": [],  # List[Dict[str, str]] e.g. {"desc": "...", "status": "pending"}
    "current_step": 0
}

def _reset_state():
    global _PLAN_STATE
    _PLAN_STATE.update({"goal": "", "tasks": [], "current_step": 0})

def _get_state_json(message: str, status: str = "success") -> str:
    """Helper to return the full state as JSON."""
    return json.dumps({
        "status": status,
        "output": message,
        "plan": _PLAN_STATE
    })

# ---------------------------------------------------------
# TOOLS
# ---------------------------------------------------------

@tool
def set_plan(goal: str, tasks: List[str]) -> str:
    """
    Creates a new plan, overwriting any existing one.
    Returns JSON with the initialized plan state.
    
    :param goal: The high-level objective (e.g. "Refactor auth.py").
    :param tasks: A list of step-by-step instructions.
    """
    global _PLAN_STATE
    _reset_state()
    
    _PLAN_STATE["goal"] = goal
    # Initialize all tasks as 'pending'
    _PLAN_STATE["tasks"] = [{"desc": t, "status": "pending"} for t in tasks]
    
    # Set first task to 'active'
    if _PLAN_STATE["tasks"]:
        _PLAN_STATE["tasks"][0]["status"] = "active"
        _PLAN_STATE["current_step"] = 0
        
    msg = f"Plan initialized: '{goal}' with {len(tasks)} steps."
    return _get_state_json(msg)

@tool
def update_task_status(step_index: int, status: str) -> str:
    """
    Updates a task's status. Returns JSON with updated plan state.
    
    :param step_index: The index of the task (0-based).
    :param status: 'active', 'completed', 'failed', or 'pending'.
    """
    global _PLAN_STATE
    tasks = _PLAN_STATE["tasks"]
    
    # Validation
    if not tasks:
        return json.dumps({
            "status": "error", 
            "output": "Error: No active plan. Use 'set_plan' first.",
            "plan": None
        })
        
    if step_index < 0 or step_index >= len(tasks):
        return json.dumps({
            "status": "error", 
            "output": f"Error: Step index {step_index} out of range (0-{len(tasks)-1}).",
            "plan": _PLAN_STATE
        })
        
    # Update Status
    tasks[step_index]["status"] = status
    
    msg = f"Task {step_index} updated to '{status}'."

    # Auto-Advance Logic: If marking 'completed', activate the next task
    current = _PLAN_STATE["current_step"]
    if status == "completed" and step_index == current:
        next_idx = current + 1
        if next_idx < len(tasks):
            _PLAN_STATE["current_step"] = next_idx
            tasks[next_idx]["status"] = "active"
            msg += f" Auto-advanced to Task {next_idx}."
            
    return _get_state_json(msg)

@tool
def get_current_plan() -> str:
    """
    Returns the current plan status in JSON format.
    Use this to check your progress.
    """
    global _PLAN_STATE
    if not _PLAN_STATE["goal"]:
        return json.dumps({
            "status": "success",
            "output": "(No active plan)",
            "plan": None
        })
        
    # Construct readable text summary for LLM
    lines = [f"GOAL: {_PLAN_STATE['goal']}"]
    symbols = {
        "pending": "[ ]",
        "active": "[>]",
        "completed": "[x]",
        "failed": "[!]"
    }
    
    for i, task in enumerate(_PLAN_STATE["tasks"]):
        mark = symbols.get(task["status"], "[?]")
        lines.append(f"{i}. {mark} {task['desc']}")
        
    summary_text = "\n".join(lines)
    
    return json.dumps({
        "status": "success",
        "output": summary_text,
        "plan": _PLAN_STATE
    })