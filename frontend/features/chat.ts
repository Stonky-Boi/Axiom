import * as vscode from "vscode";
import { AxiomClient } from "../client";

export class ChatFeature implements vscode.WebviewViewProvider {
    public static readonly viewType = "axiom.chatView";
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _client: AxiomClient
    ) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === "sendMessage") {
                await this.handleUserMessage(data.value);
            } else if (data.type === "applyEdit") {
                await this.handleApplyEdit(data.file, data.search, data.replace, data.id);
            }
        });
    }

    private async handleUserMessage(prompt: string) {
        if (!this._view) {return;}
        
        try {
            // 1. Request to Backend
            const response = await this._client.sendRequest("chat", { prompt });
            
            // 2. Render Text (if any)
            if (response.response && response.response.trim().length > 0) {
                this._view.webview.postMessage({ 
                    type: "addText", 
                    value: response.response 
                });
            }

            // 3. Render Components (Diffs, etc.)
            if (response.components && Array.isArray(response.components)) {
                for (const component of response.components) {
                    if (component.__axiom_type__ === "diff") {
                        this._view.webview.postMessage({ 
                            type: "addDiff", 
                            value: component 
                        });
                    }
                }
            }

        } catch (e) {
            this._view.webview.postMessage({ type: "addText", value: `Error: ${e}` });
        }
    }

    private async handleApplyEdit(relPath: string, search: string, replace: string, elementId: string) {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {throw new Error("No workspace open");}
            const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, relPath);
            
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();
            const index = text.indexOf(search.replace(/\r\n/g, "\n")); // Normalize

            if (index === -1) {
                vscode.window.showErrorMessage("Could not find original text. File may have changed.");
                this._view?.webview.postMessage({ type: "editFailed", id: elementId });
                return;
            }

            const edit = new vscode.WorkspaceEdit();
            const start = document.positionAt(index);
            const end = document.positionAt(index + search.length);
            edit.replace(uri, new vscode.Range(start, end), replace);
            
            if (await vscode.workspace.applyEdit(edit)) {
                await document.save();
                this._view?.webview.postMessage({ type: "editApplied", id: elementId });
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Edit failed: ${e}`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Simplified HTML with robust script handler
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                /* Reuse your existing CSS styles from the previous upload */
                body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
                .message { padding: 8px; margin-bottom: 8px; border-radius: 4px; white-space: pre-wrap; }
                .user { background: var(--vscode-button-secondaryBackground); align-self: flex-end; }
                .bot { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; }
                .diff-card { border: 1px solid var(--vscode-widget-border); margin-top: 10px; border-radius: 4px; overflow: hidden; }
                .diff-header { padding: 5px; background: var(--vscode-editor-lineHighlightBackground); font-weight: bold; font-size: 0.9em; }
                .diff-content { padding: 10px; font-family: monospace; white-space: pre; overflow-x: auto; font-size: 0.9em; }
                .btn { padding: 5px 10px; cursor: pointer; border: none; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
                
                #chat-container { display: flex; flex-direction: column; height: 90vh; overflow-y: auto; padding-bottom: 20px; }
                #input-area { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-widget-border); display: flex; }
                input { flex: 1; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
            </style>
        </head>
        <body>
            <div id="chat-container"></div>
            <div id="input-area">
                <input id="prompt" type="text" placeholder="Ask Axiom..." />
                <button class="btn" onclick="send()">Send</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const container = document.getElementById('chat-container');
                const prompt = document.getElementById('prompt');

                prompt.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') send();
                });

                function send() {
                    const text = prompt.value;
                    if(!text) return;
                    addMessage(text, 'user');
                    vscode.postMessage({ type: 'sendMessage', value: text });
                    prompt.value = '';
                }

                function addMessage(text, role) {
                    const div = document.createElement('div');
                    div.className = 'message ' + role;
                    div.innerText = text;
                    container.appendChild(div);
                    container.scrollTop = container.scrollHeight;
                }

                function addDiff(data) {
                    const div = document.createElement('div');
                    div.className = 'diff-card';
                    div.innerHTML = \`
                        <div class="diff-header">\${data.file}</div>
                        <div class="diff-content">\${escapeHtml(data.diff)}</div>
                        <div style="padding:5px; text-align:right;">
                            <button class="btn" onclick="applyDiff(this, '\${data.file}', '\${escapeJs(data.search)}', '\${escapeJs(data.replace)}')">Apply Edit</button>
                        </div>
                    \`;
                    container.appendChild(div);
                    container.scrollTop = container.scrollHeight;
                }
                
                function escapeHtml(text) {
                    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                }
                
                function escapeJs(text) {
                     return text.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
                }

                function applyDiff(btn, file, search, replace) {
                    btn.innerText = 'Applying...';
                    const id = 'btn-' + Date.now();
                    vscode.postMessage({ type: 'applyEdit', file, search, replace, id });
                }

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.type === 'addText') addMessage(msg.value, 'bot');
                    if (msg.type === 'addDiff') addDiff(msg.value);
                });
            </script>
        </body>
        </html>`;
    }
}