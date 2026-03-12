if vim.g.loaded_axiom then return end
vim.g.loaded_axiom = 1

-- Load modules
local axiom = require("axiom")
local ghost = require("axiom.ghost")
local chat = require("axiom.chat")

-- Initialize
axiom.setup({})
ghost.setup()
chat.setup()

-- Test command
vim.api.nvim_create_user_command("AxiomStatus", function()
    axiom.get("/health", function(res)
        -- FastAPI usually returns {"status": "ok"} for health checks
        print("Axiom Status: " .. (res.status or "OK"))
    end)
end, {})