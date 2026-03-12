# Axiom

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Python FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Neovim](https://img.shields.io/badge/Client-Neovim-57A143?style=for-the-badge&logo=neovim)](https://neovim.io/)
[![VS Code](https://img.shields.io/badge/Client-VS_Code-007ACC?style=for-the-badge&logo=visualstudiocode)](https://code.visualstudio.com/)

Axiom is a blazingly fast, privacy-first, and completely local AI coding assistant. Built to run on local hardware without cloud subscriptions, it provides contextual autocomplete and agentic refactoring for both VS Code and Neovim. 

## Features

* **100% Local Compute:** Powered by [Ollama](https://ollama.com/), ensuring zero telemetry and maximum privacy. Your code never leaves your machine.
* **Dual-Model Architecture:**
    * `qwen2.5-coder:1.5b` handles sub-second, debounced inline ghost text.
    * `qwen2.5-coder:3b` acts as the reasoning engine for complex refactoring and chat.
* **Multi-File Context Engine:** A lightweight, AST/Regex-powered symbol indexer that extracts function and class signatures across your Python and C++ workspace, giving the model project-wide awareness without heavy vector databases.
* **Agentic File Updates:** The chat model utilizes `<<<UPDATE_FILE>>>` tool tags to trigger native visual diffs (`vimdiff` in Neovim, Compare View in VS Code), allowing you to review additions and deletions before accepting them.
* **Multi-Editor Native:** A TypeScript client for VS Code and a pure Lua, zero-dependency plugin for Neovim.

## Architecture

```text
Axiom/
├── server/                 # Python FastAPI Backend
│   ├── main.py             # Chat & Autocomplete endpoints
│   └── context_engine.py   # Multi-file AST & Regex signature extractor
├── clients/
│   ├── vscode/             # TypeScript VS Code Extension
│   │   ├── src/extension.ts        # Ghost text provider
│   │   └── src/SidebarProvider.ts  # Webview chat & Diff integration
│   └── nvim/               # Pure Lua Neovim Plugin
│       ├── lua/axiom/      # Core logic, Ghost text, Chat buffer, vimdiff
│       └── plugin/         # Plugin entry point
```

## Getting Started

### 1. Prerequisites

* **Ollama** installed and running.
* **Python 3.10+**
* **Node.js & npm** (for the VS Code client)
* **Neovim 0.9+** (for the Neovim client)

### 2. Model Setup

Pull the required local models via Ollama:

```bash
ollama run qwen2.5-coder:1.5b
ollama run qwen2.5-coder:3b
```

### 3. Backend Setup

Start the FastAPI context engine:

```bash
cd server
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install fastapi uvicorn pydantic ollama
python main.py
```

*The server will run on `http://127.0.0.1:8000`.*

## Client Installation

### Visual Studio Code

1. Navigate to the extension directory:

```bash
cd clients/vscode
npm install
```

2. Open the `clients/vscode` folder in VS Code.
3. Press `F5` to compile the TypeScript and launch the Extension Development Host.
4. *To package for daily use:* Run `npx vsce package` to generate a `.vsix` file and install it manually via the extensions pane.

### Neovim

Axiom requires zero external plugin dependencies. Add the local path directly to your `rtp` in your `init.lua`:

```lua
-- Add Axiom to your runtime path
vim.opt.rtp:append("/path/to/Axiom/clients/nvim")

-- Ensure updatetime is low enough for responsive Ghost Text
vim.opt.updatetime = 400

-- Map the chat window
vim.keymap.set("n", "<leader>ac", ":AxiomChat<CR>", { silent = true, desc = "Ask Axiom" })
```

*(Alternatively, load it via `lazy.nvim` pointing to the local directory).*

## Usage

* **Inline Autocomplete:** Just start typing. Axiom will pause for your `updatetime` (Neovim) or debounce threshold (VS Code) and inject grey ghost text. Press `Tab` to accept.
* **Chat & Refactor:** Open the Axiom Sidebar (VS Code) or press `<leader>ac` (Neovim). Ask Axiom to refactor the active file.
* **Diff View:** When Axiom writes code, it triggers a native Diff view. Review the changes, then use the "Accept" button (VS Code) or `:AxiomAccept` command (Neovim) to overwrite the file.

> Built with raw compute and zero bloat.