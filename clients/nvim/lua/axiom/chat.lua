local M = {}
local axiom = require("axiom")

local chat_buf = nil
local chat_win = nil

-- Creates a vertical split for the chat output
function M.create_window()
    vim.cmd("botright vsplit")
    chat_win = vim.api.nvim_get_current_win()
    chat_buf = vim.api.nvim_create_buf(false, true)
    
    -- Make it a scratch buffer (not saved to disk)
    vim.api.nvim_buf_set_option(chat_buf, "buftype", "nofile")
    vim.api.nvim_buf_set_option(chat_buf, "filetype", "markdown")
    vim.api.nvim_buf_set_option(chat_buf, "wrap", true)
    
    vim.api.nvim_win_set_buf(chat_win, chat_buf)
    vim.api.nvim_win_set_width(chat_win, 45)
    
    -- Return cursor to the editor window
    vim.cmd("wincmd p")
end

-- Appends text to the chat buffer and scrolls down
local function append_to_chat(lines)
    if not chat_buf or not vim.api.nvim_buf_is_valid(chat_buf) then return end
    vim.api.nvim_buf_set_lines(chat_buf, -1, -1, false, lines)
    if chat_win and vim.api.nvim_win_is_valid(chat_win) then
        local count = vim.api.nvim_buf_line_count(chat_buf)
        vim.api.nvim_win_set_cursor(chat_win, {count, 0})
    end
end

-- Opens vimdiff and sets up Accept/Reject commands
function M.apply_diff(editor_win, editor_buf, new_code)
    local temp_file = os.tmpname()
    local f = io.open(temp_file, "w")
    if f then
        f:write(new_code)
        f:close()
    end

    vim.api.nvim_set_current_win(editor_win)

    -- Open Neovim's native diff split
    vim.cmd("vert diffsplit " .. temp_file)
    local diff_win = vim.api.nvim_get_current_win()

    append_to_chat({
        "",
        "**[Action Required]**",
        "Review changes in diff mode.",
        "Run `:AxiomAccept` to apply, or `:AxiomReject` to discard.",
        "---"
    })

    -- Command to Accept
    vim.api.nvim_create_user_command("AxiomAccept", function()
        local lines = vim.split(new_code, "\n")
        vim.api.nvim_buf_set_lines(editor_buf, 0, -1, false, lines)
        
        -- Cleanup
        pcall(vim.api.nvim_win_close, diff_win, true)
        os.remove(temp_file)
        vim.api.nvim_set_current_win(editor_win)
        vim.cmd("diffoff")
        
        append_to_chat({"*Changes accepted.*"})
        vim.api.nvim_del_user_command("AxiomAccept")
        vim.api.nvim_del_user_command("AxiomReject")
    end, {})

    -- Command to Reject
    vim.api.nvim_create_user_command("AxiomReject", function()
        pcall(vim.api.nvim_win_close, diff_win, true)
        os.remove(temp_file)
        vim.api.nvim_set_current_win(editor_win)
        vim.cmd("diffoff")
        
        append_to_chat({"*Changes rejected.*"})
        vim.api.nvim_del_user_command("AxiomAccept")
        vim.api.nvim_del_user_command("AxiomReject")
    end, {})
end

-- Core Chat Logic
function M.send_message()
    local input = vim.fn.input("Ask Axiom: ")
    if input == "" then return end

    local editor_win = vim.api.nvim_get_current_win()
    local editor_buf = vim.api.nvim_get_current_buf()

    if not chat_win or not vim.api.nvim_win_is_valid(chat_win) then
        M.create_window()
    end

    append_to_chat({"", "---", "**User:** " .. input, "", "**Axiom:**", "*Thinking...*"})

    local content = table.concat(vim.api.nvim_buf_get_lines(editor_buf, 0, -1, false), "\n")
    local path = vim.api.nvim_buf_get_name(editor_buf)
    local workspace = vim.fn.getcwd()

    axiom.request("/chat", {
        messages = {{ role = "user", content = input }},
        workspace_root = workspace,
        active_file_path = path,
        active_file_content = content,
        selected_text = ""
    }, vim.schedule_wrap(function(res)
        if not res or not res.reply then return end

        -- Clear the "*Thinking...*" line
        local line_count = vim.api.nvim_buf_line_count(chat_buf)
        vim.api.nvim_buf_set_lines(chat_buf, line_count - 1, -1, false, {})

        local reply = res.reply
        
        -- In Lua patterns, [%s%S] matches everything including newlines
        local update_match = reply:match("<<<UPDATE_FILE>>>\n*([%s%S]-)\n*<<<END_UPDATE>>>")

        if update_match then
            -- Strip the code block from the chat output so it's not visually overwhelming
            local explanation = reply:gsub("<<<UPDATE_FILE>>>[%s%S]-<<<END_UPDATE>>>", "")
            append_to_chat(vim.split(explanation, "\n"))
            
            -- Trigger the Diff View!
            M.apply_diff(editor_win, editor_buf, update_match)
        else
            -- Standard markdown reply (No file changes)
            append_to_chat(vim.split(reply, "\n"))
        end
    end))
end

function M.setup()
    -- Create the command
    vim.api.nvim_create_user_command("AxiomChat", M.send_message, {})
    
    -- Map <leader>ac to trigger the chat input easily
    vim.keymap.set("n", "<leader>ac", ":AxiomChat<CR>", { silent = true, desc = "Ask Axiom Chat" })
end

return M