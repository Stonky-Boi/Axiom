import * as vscode from "vscode";
import * as ChangeDiff from "diff";

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen for messages from the UI
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "onInfo": {
          if (!data.value) {
            return;
          }
          vscode.window.showInformationMessage(data.value);
          break;
        }
        case "onError": {
          if (!data.value) {
            return;
          }
          vscode.window.showErrorMessage(data.value);
          break;
        }
        // Case 1: Simple Insertion
        case "insert_code": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage("No active editor found.");
                return;
            }
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, data.value);
            });
            break;
        }
        // Case 2: Full File Update (Agentic Diff)
        case "update_file": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage("No active editor found.");
                return;
            }
            const fullRange = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length)
            );
            editor.edit(editBuilder => {
                editBuilder.replace(fullRange, data.value);
            });
            break;
        }
        case "ask_axiom": {
            // 1. Gather Context
            let editor = vscode.window.activeTextEditor;
            if (!editor) {
                const visible = vscode.window.visibleTextEditors;
                if (visible.length > 0) {
                    editor = visible[0];
                }
            }

            let workspace_root = "";
            let active_file_path = "";
            let active_file_content = "";
            let selected_text = "";

            if (vscode.workspace.workspaceFolders) {
                workspace_root = vscode.workspace.workspaceFolders[0].uri.fsPath;
            }

            if (editor) {
                active_file_path = editor.document.fileName;
                active_file_content = editor.document.getText();
                if (!editor.selection.isEmpty) {
                    selected_text = editor.document.getText(editor.selection);
                }
            }

            // 2. Send to Python Backend
            try {
                const response = await fetch("http://127.0.0.1:8000/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        messages: [{ role: "user", content: data.value }],
                        workspace_root: workspace_root,
                        active_file_path: active_file_path,
                        active_file_content: active_file_content,
                        selected_text: selected_text
                    }),
                });

                if (!response.ok) {
                    throw new Error(`HTTP Error: ${response.status}`);
                }

                const result = await response.json() as { reply: string };
                
                // 3. Process Response for Agentic Tools
                const agentRegex = /<<<UPDATE_FILE>>>\s*([\s\S]*?)\s*<<<END_UPDATE>>>/;
                const match = agentRegex.exec(result.reply);
                
                let diffHtml = "";
                let cleanCode = "";

                if (match) {
                    cleanCode = match[1];
                    if (active_file_content) {
                        const diff = ChangeDiff.diffLines(active_file_content, cleanCode);
                        
                        diff.forEach((part: ChangeDiff.Change) => {
                            const color = part.added ? 'rgba(40, 167, 69, 0.2)' :
                                          part.removed ? 'rgba(220, 53, 69, 0.2)' : 'transparent';
                            const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
                            
                            const escapedValue = part.value
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;");
                            
                            diffHtml += `<span style="background-color: ${color}; display: block; white-space: pre-wrap;">${prefix}${escapedValue}</span>`;
                        });
                    }
                } 
                else {
                    const fallbackRegex = /```[\s\S]*?\n([\s\S]*?)```/;
                    const fallbackMatch = fallbackRegex.exec(result.reply);
                    if (fallbackMatch) {
                        cleanCode = fallbackMatch[1];
                    }
                }

                // 4. Send Result + Diff to UI
                webviewView.webview.postMessage({
                    type: "add_response",
                    value: result.reply,
                    diff: diffHtml,
                    code: cleanCode
                });

            } catch (error: any) {
                webviewView.webview.postMessage({
                    type: "add_response",
                    value: `Error connecting to Axiom: ${error.message}`,
                });
            }
            break;
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-editor-foreground); }
        .chat-box { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
        .user-msg { align-self: flex-end; background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 8px; border-radius: 5px; max-width: 80%; }
        .axiom-msg { align-self: flex-start; background: var(--vscode-editor-inactiveSelectionBackground); padding: 8px; border-radius: 5px; max-width: 90%; white-space: pre-wrap; overflow-x: auto;}
        
        pre { background: #1e1e1e; padding: 10px; border-radius: 4px; position: relative; }
        code { font-family: 'Courier New', Courier, monospace; }
        
        .apply-btn {
            display: block;
            margin-top: 5px;
            padding: 6px 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            cursor: pointer;
            font-size: 0.9em;
            border-radius: 3px;
            font-weight: bold;
        }
        .apply-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
        
        input { width: 100%; padding: 10px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
      </style>
    </head>
    <body>
      <div class="chat-box" id="chat-box"></div>
      <input type="text" id="prompt-input" placeholder="Ask Axiom..." />

      <script>
        const vscode = acquireVsCodeApi();
        const chatBox = document.getElementById('chat-box');
        const input = document.getElementById('prompt-input');

        function formatResponse(text) {
            const div = document.createElement('div');
            div.className = 'axiom-msg';
            
            const codeBlockRegex = /\`\`\`([\\s\\S]*?)\`\`\`/g;
            let lastIndex = 0;
            let match;
            
            while ((match = codeBlockRegex.exec(text)) !== null) {
                const beforeCode = text.substring(lastIndex, match.index);
                if (beforeCode) div.appendChild(document.createTextNode(beforeCode));
                
                let codeContent = match[1];
                if (codeContent.includes('\\n')) {
                    codeContent = codeContent.substring(codeContent.indexOf('\\n') + 1);
                }

                const pre = document.createElement('pre');
                pre.textContent = codeContent;
                
                const btn = document.createElement('button');
                btn.className = 'apply-btn';
                btn.innerText = 'Insert at Cursor';
                (function(capturedCode) {
                    btn.onclick = () => {
                        vscode.postMessage({ type: 'insert_code', value: capturedCode });
                    };
                })(codeContent);
                
                div.appendChild(pre);
                div.appendChild(btn);
                lastIndex = match.index + match[0].length;
            }
            
            const remaining = text.substring(lastIndex);
            if (remaining) div.appendChild(document.createTextNode(remaining));
            return div;
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value) {
                const text = input.value;
                input.value = '';
                const userDiv = document.createElement('div');
                userDiv.className = 'user-msg';
                userDiv.innerText = text;
                chatBox.appendChild(userDiv);
                vscode.postMessage({ type: 'ask_axiom', value: text });
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'add_response':
                    if (message.diff) {
                        const div = document.createElement('div');
                        div.className = 'axiom-msg';
                        
                        const header = document.createElement('div');
                        header.innerHTML = "<strong>Proposed Changes:</strong>";
                        header.style.marginBottom = "5px";
                        div.appendChild(header);

                        const pre = document.createElement('pre');
                        pre.innerHTML = message.diff; 
                        div.appendChild(pre);
                        
                        const btn = document.createElement('button');
                        btn.className = 'apply-btn';
                        btn.innerText = 'Accept Changes';
                        btn.onclick = () => {
                            vscode.postMessage({ type: 'update_file', value: message.code });
                        };
                        div.appendChild(btn);
                        
                        chatBox.appendChild(div);
                    } else {
                        const msgDiv = formatResponse(message.value);
                        chatBox.appendChild(msgDiv);
                    }
                    break;
            }
        });
      </script>
    </body>
    </html>`;
  }
}