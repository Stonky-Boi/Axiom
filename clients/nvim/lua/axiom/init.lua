local M = {}

M.config = {
    backend_url = "http://127.0.0.1:8000",
}

function M.setup(opts)
    M.config = vim.tbl_deep_extend("force", M.config, opts or {})
end

-- For POST requests (Autocomplete, Chat)
function M.request(endpoint, body, callback)
    local url = M.config.backend_url .. endpoint
    local json_body = vim.fn.json_encode(body)
    
    local tmp_file = os.tmpname()
    local f = io.open(tmp_file, "w")
    if f then
        f:write(json_body)
        f:close()
    end

    local cmd = {
        "curl", "-s", "-X", "POST",
        "-H", "Content-Type: application/json",
        "-d", "@" .. tmp_file,
        url
    }

    vim.fn.jobstart(cmd, {
        on_stdout = function(_, data, _)
            local response = table.concat(data, "")
            if response ~= "" then
                local success, decoded = pcall(vim.fn.json_decode, response)
                if success then
                    callback(decoded)
                end
            end
        end,
        on_exit = function()
            os.remove(tmp_file)
        end
    })
end

-- For GET requests (Health Check)
function M.get(endpoint, callback)
    local url = M.config.backend_url .. endpoint
    local cmd = { "curl", "-s", "-X", "GET", url }

    vim.fn.jobstart(cmd, {
        on_stdout = function(_, data, _)
            local response = table.concat(data, "")
            if response ~= "" then
                local success, decoded = pcall(vim.fn.json_decode, response)
                if success then
                    callback(decoded)
                end
            end
        end
    })
end

return M