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
            // Note: In a real implementation with streaming, we would subscribe to events.
            // Since client.ts (current version) awaits the full response, 
            // we rely on the backend formatting the response string or us updating client.ts.
            // However, with the new agent yielding 'component', the client needs to return it.
            
            // Assume client.ts returns the last message or an array of messages.
            // For now, let's catch the JSON if it appears in the text response as a fallback.
            
            const response = await this._client.sendRequest("chat", { prompt });
            
            // Check if response contains our component data (Client modification needed ideally, 
            // but we can pass it via the text field if the client just concatenates)
            
            if (response.response) {
                this._view.webview.postMessage({ type: "addResponse", value: response.response });
            }
        } catch (e) {
            this._view.webview.postMessage({ type: "addResponse", value: `Error: ${e}` });
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
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                :root {
                    --bg: var(--vscode-editor-background);
                    --fg: var(--vscode-editor-foreground);
                    --input-bg: var(--vscode-input-background);
                    --border: var(--vscode-widget-border);
                    --accent: var(--vscode-button-background);
                    --accent-fg: var(--vscode-button-foreground);
                }
                body {
                    font-family: var(--vscode-font-family);
                    background: var(--bg); color: var(--fg);
                    margin: 0; padding: 0;
                    display: flex; flex-direction: column; height: 100vh;
                }
                #chat {
                    flex: 1; overflow-y: auto; padding: 15px;
                    display: flex; flex-direction: column; gap: 15px;
                }
                .message {
                    max-width: 90%;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 13px;
                    line-height: 1.4;
                    word-wrap: break-word;
                }
                .user {
                    align-self: flex-end;
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                .bot {
                    align-self: flex-start;
                    background: var(--vscode-editor-lineHighlightBackground);
                }
                
                /* DIFF CARD STYLE */
                .diff-card {
                    background: var(--bg);
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    margin-top: 10px; overflow: hidden;
                    width: 100%;
                }
                .diff-header {
                    padding: 6px 10px; background: var(--vscode-editor-lineHighlightBackground);
                    font-weight: bold; border-bottom: 1px solid var(--border);
                    font-size: 11px;
                }
                .diff-content {
                    padding: 10px; font-family: 'Courier New', monospace; font-size: 11px;
                    white-space: pre-wrap; overflow-x: auto;
                    background: var(--bg);
                }
                .ln-add { background: rgba(78, 201, 176, 0.15); display: block; }
                .ln-rem { background: rgba(241, 76, 76, 0.15); display: block; }
                
                .diff-actions {
                    padding: 8px; display: flex; justify-content: flex-end; gap: 8px;
                    border-top: 1px solid var(--border); background: var(--vscode-editor-lineHighlightBackground);
                }
                .btn {
                    border: none; padding: 4px 10px; border-radius: 2px; cursor: pointer; font-size: 11px;
                }
                .btn-accept { background: var(--accent); color: var(--accent-fg); }
                .btn-reject { background: var(--vscode-errorForeground); color: white; }

                /* INPUT AREA */
                .input-container {
                    padding: 15px; border-top: 1px solid var(--border);
                    display: flex; flex-direction: column; gap: 8px;
                }
                textarea {
                    width: 100%; background: var(--input-bg); color: var(--fg);
                    border: 1px solid var(--border); border-radius: 4px;
                    padding: 8px; font-family: inherit; resize: none;
                    box-sizing: border-box; outline: none;
                }
                textarea:focus { border-color: var(--vscode-focusBorder); }
                #sendBtn {
                    align-self: flex-end;
                    background: var(--accent); color: var(--accent-fg);
                    border: none; padding: 6px 14px; border-radius: 2px; cursor: pointer;
                }
                #sendBtn:hover { opacity: 0.9; }
            </style>
        </head>
        <body>
            <div id="chat"></div>
            <div class="input-container">
                <textarea id="promptInput" rows="2" placeholder="Ask Axiom... (Shift+Enter for newline)"></textarea>
                <button id="sendBtn">Send</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const chat = document.getElementById('chat');
                const input = document.getElementById('promptInput');
                const btn = document.getElementById('sendBtn');

                // Auto-resize
                input.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
                });

                // Shift+Enter Logic
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                    }
                });

                btn.addEventListener('click', sendMessage);

                function sendMessage() {
                    const text = input.value.trim();
                    if (!text) return;
                    
                    addMessage(text, 'user');
                    vscode.postMessage({ type: 'sendMessage', value: text });
                    input.value = '';
                    input.style.height = 'auto';
                }

                function addMessage(text, sender) {
                    const div = document.createElement('div');
                    div.className = 'message ' + sender;
                    div.innerText = text;
                    chat.appendChild(div);
                    chat.scrollTop = chat.scrollHeight;
                }

                function addDiff(data) {
                    const id = 'diff-' + Date.now();
                    const div = document.createElement('div');
                    div.className = 'diff-card';
                    
                    let linesHtml = '';
                    data.diff.split('\\n').forEach(line => {
                        if(line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) return;
                        let cls = '';
                        if(line.startsWith('+')) cls = 'ln-add';
                        if(line.startsWith('-')) cls = 'ln-rem';
                        linesHtml += '<span class="'+cls+'">' + escapeHtml(line) + '</span>';
                    });

                    div.innerHTML = \`
                        <div class="diff-header">\${data.file}</div>
                        <div class="diff-content">\${linesHtml}</div>
                        <div class="diff-actions">
                            <button class="btn btn-reject" onclick="this.closest('.diff-card').remove()">Reject</button>
                            <button class="btn btn-accept" id="\${id}">Accept</button>
                        </div>
                    \`;
                    
                    chat.appendChild(div);
                    chat.scrollTop = chat.scrollHeight;

                    document.getElementById(id).onclick = function() {
                        this.innerText = 'Applying...';
                        this.disabled = true;
                        vscode.postMessage({
                            type: 'applyEdit',
                            file: data.file,
                            search: data.search,
                            replace: data.replace,
                            id: id
                        });
                    };
                }

                function escapeHtml(text) {
                    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                }

                window.addEventListener('message', event => {
                    const msg = event.data;
                    
                    if (msg.type === 'addResponse') {
                        // 1. Try to find the JSON blob in the text (Leak Fix)
                        const jsonMatch = msg.value.match(/\\{.*"__axiom_type__":\\s*"diff".*\\}/s);
                        
                        if (jsonMatch) {
                            try {
                                const json = JSON.parse(jsonMatch[0]);
                                addDiff(json);
                                // Don't show the raw JSON text
                                return;
                            } catch(e) { console.error(e); }
                        }

                        // 2. Normal Text
                        addMessage(msg.value, 'bot');
                    }
                    
                    if (msg.type === 'editApplied') {
                        const btn = document.getElementById(msg.id);
                        if (btn) {
                            btn.innerText = 'Applied';
                            btn.style.opacity = '0.7';
                        }
                    }
                });
            </script>
        </body>
        </html>`;
    }
}