local M = {}
local axiom = require("axiom")

local ns_id = vim.api.nvim_create_namespace("AxiomGhost")
local suggestion_text = ""

local function clear()
    vim.api.nvim_buf_clear_namespace(0, ns_id, 0, -1)
    suggestion_text = ""
end

function M.fetch()
    local bufnr = vim.api.nvim_get_current_buf()
    local cursor = vim.api.nvim_win_get_cursor(0)
    local row, col = cursor[1] - 1, cursor[2]
    
    local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
    local prefix = table.concat(vim.api.nvim_buf_get_lines(bufnr, 0, row, false), "\n") .. "\n"
    prefix = prefix .. string.sub(lines[row + 1] or "", 1, col)
    
    local suffix = string.sub(lines[row + 1] or "", col + 1) .. "\n"
    suffix = suffix .. table.concat(vim.api.nvim_buf_get_lines(bufnr, row + 1, -1, false), "\n")

    axiom.request("/autocomplete", {
        file_path = vim.api.nvim_buf_get_name(bufnr),
        workspace_root = vim.fn.getcwd(),
        prefix_text = prefix,
        suffix_text = suffix
    }, vim.schedule_wrap(function(res)
        if res and res.suggestion and res.suggestion ~= "" then
            suggestion_text = res.suggestion
            local virt_lines = vim.split(suggestion_text, "\n")
            
            vim.api.nvim_buf_set_extmark(bufnr, ns_id, row, col, {
                virt_text = {{ virt_lines[1], "Comment" }},
                virt_text_pos = "overlay",
            })
        end
    end))
end

function M.accept()
    if suggestion_text ~= "" then
        local cursor = vim.api.nvim_win_get_cursor(0)
        local row, col = cursor[1], cursor[2]
        vim.api.nvim_put(vim.split(suggestion_text, "\n"), "c", true, true)
        clear()
        return true
    end
    return false
end

function M.setup()
    local group = vim.api.nvim_create_augroup("AxiomGhost", { clear = true })
    
    vim.api.nvim_create_autocmd("CursorHoldI", {
        group = group,
        callback = M.fetch
    })
    
    vim.api.nvim_create_autocmd({"TextChangedI", "CursorMovedI"}, {
        group = group,
        callback = clear
    })

    -- Map Tab to accept if suggestion exists
    vim.keymap.set("i", "<Tab>", function()
        if not M.accept() then
            return vim.api.nvim_replace_termcodes("<Tab>", true, true, true)
        end
    end, { expr = true })
end

return M