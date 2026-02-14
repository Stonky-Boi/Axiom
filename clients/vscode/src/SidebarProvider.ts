import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export class SidebarProvider implements vscode.WebviewViewProvider {
	_view?: vscode.WebviewView;
	// Keep track of the pending proposal so we can accept/reject it
	private _pendingCode: string = "";
	private _tempUri: vscode.Uri | undefined;

	constructor(private readonly _extensionUri: vscode.Uri) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

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

				// --- 1. Show the Diff (Visual Compare) ---
				case "review_changes": {
					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						vscode.window.showErrorMessage(
							"No active editor found.",
						);
						return;
					}

					// Save the proposed code to a temporary file
					this._pendingCode = data.value;
					const tempDir = os.tmpdir();
					const tempFilePath = path.join(
						tempDir,
						"axiom_proposal" +
							path.extname(editor.document.fileName),
					);
					fs.writeFileSync(tempFilePath, this._pendingCode);

					this._tempUri = vscode.Uri.file(tempFilePath);
					const currentUri = editor.document.uri;

					// Open VS Code's Native Diff Editor
					await vscode.commands.executeCommand(
						"vscode.diff",
						currentUri,
						this._tempUri,
						"Current File ↔ Axiom Proposal",
					);
					break;
				}

				// --- 2. Accept Changes (Overwrite File) ---
				case "accept_changes": {
					const editor = vscode.window.activeTextEditor;
					// We might be focused on the Diff editor, so find the original document
					const originalDoc = vscode.workspace.textDocuments.find(
						(doc) =>
							doc.uri.scheme === "file" &&
							doc.fileName !== this._tempUri?.fsPath,
					);

					if (!originalDoc || !this._pendingCode) {
						vscode.window.showErrorMessage(
							"Could not apply changes. Session lost.",
						);
						return;
					}

					// Write to the actual file
					const fullRange = new vscode.Range(
						originalDoc.positionAt(0),
						originalDoc.positionAt(originalDoc.getText().length),
					);

					const edit = new vscode.WorkspaceEdit();
					edit.replace(originalDoc.uri, fullRange, this._pendingCode);
					await vscode.workspace.applyEdit(edit);

					// Clean up: Close the diff view and info message
					vscode.commands.executeCommand(
						"workbench.action.closeActiveEditor",
					);
					vscode.window.showInformationMessage(
						"Changes applied successfully!",
					);

					// Send message back to UI to hide buttons
					webviewView.webview.postMessage({
						type: "changes_applied",
					});
					break;
				}

				// --- 3. Reject Changes ---
				case "reject_changes": {
					// Just close the Diff view
					vscode.commands.executeCommand(
						"workbench.action.closeActiveEditor",
					);
					this._pendingCode = "";
					webviewView.webview.postMessage({
						type: "changes_rejected",
					});
					break;
				}

				// --- Standard Chat Logic ---
				case "ask_axiom": {
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

					if (vscode.workspace.workspaceFolders) {
						workspace_root =
							vscode.workspace.workspaceFolders[0].uri.fsPath;
					}

					if (editor) {
						active_file_path = editor.document.fileName;
						active_file_content = editor.document.getText();
					}

					try {
						const response = await fetch(
							"http://127.0.0.1:8000/chat",
							{
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({
									messages: [
										{ role: "user", content: data.value },
									],
									workspace_root: workspace_root,
									active_file_path: active_file_path,
									active_file_content: active_file_content,
									selected_text: "", // Simplified for full-file mode
								}),
							},
						);

						if (!response.ok) {
							throw new Error(`HTTP Error: ${response.status}`);
						}
						const result = (await response.json()) as {
							reply: string;
						};

						// Parse for <<<UPDATE_FILE>>>
						const agentRegex =
							/<<<UPDATE_FILE>>>\s*([\s\S]*?)\s*<<<END_UPDATE>>>/;
						const match = agentRegex.exec(result.reply);

						if (match) {
							const cleanCode = match[1];
							// Remove the code block from the explanation text to avoid clutter
							const explanation = result.reply
								.replace(agentRegex, "")
								.trim();

							webviewView.webview.postMessage({
								type: "propose_changes",
								explanation:
									explanation ||
									"I have generated a new version of this file.",
								code: cleanCode,
							});
						} else {
							const fallbackRegex = /```[\s\S]*?\n([\s\S]*?)```/;
							const fallbackMatch = fallbackRegex.exec(
								result.reply,
							);

							if (fallbackMatch) {
								// FIX: Added 'const' here
								const cleanCode = fallbackMatch[1];
								webviewView.webview.postMessage({
									type: "propose_changes", // FORCE the Diff UI even for markdown
									explanation: result.reply
										.replace(fallbackRegex, "")
										.trim(),
									code: cleanCode,
								});
							} else {
								// Only strictly text responses go here
								webviewView.webview.postMessage({
									type: "add_response",
									value: result.reply,
								});
							}
						}
					} catch (error: any) {
						webviewView.webview.postMessage({
							type: "add_response",
							value: `Error: ${error.message}`,
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
        .axiom-msg { align-self: flex-start; background: var(--vscode-editor-inactiveSelectionBackground); padding: 8px; border-radius: 5px; max-width: 90%; white-space: pre-wrap; }
        
        .action-container { 
            display: flex; gap: 10px; margin-top: 5px; 
            background: rgba(0,0,0,0.2); padding: 10px; border-radius: 5px;
        }
        button {
            border: none; padding: 6px 12px; cursor: pointer; border-radius: 3px; font-weight: bold;
        }
        .btn-review { background: #007acc; color: white; }
        .btn-accept { background: #28a745; color: white; }
        .btn-reject { background: #dc3545; color: white; }
        
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

        function appendMessage(text, isUser) {
            const div = document.createElement('div');
            div.className = isUser ? 'user-msg' : 'axiom-msg';
            div.innerText = text;
            chatBox.appendChild(div);
        }

        // Render the Review/Accept/Reject Controls
        function renderProposal(explanation, code) {
            appendMessage(explanation, false); // Show text first
            
            const container = document.createElement('div');
            container.className = 'action-container';
            
            const btnReview = document.createElement('button');
            btnReview.className = 'btn-review';
            btnReview.innerText = 'Review Changes';
            btnReview.onclick = () => {
                vscode.postMessage({ type: 'review_changes', value: code });
            };

            const btnAccept = document.createElement('button');
            btnAccept.className = 'btn-accept';
            btnAccept.innerText = '✓ Accept';
            btnAccept.onclick = () => {
                vscode.postMessage({ type: 'accept_changes' });
                container.innerHTML = "<em>Changes Accepted</em>";
            };

            const btnReject = document.createElement('button');
            btnReject.className = 'btn-reject';
            btnReject.innerText = '✕ Reject';
            btnReject.onclick = () => {
                vscode.postMessage({ type: 'reject_changes' });
                container.innerHTML = "<em>Changes Rejected</em>";
            };

            container.appendChild(btnReview);
            container.appendChild(btnAccept);
            container.appendChild(btnReject);
            chatBox.appendChild(container);
            
            // Automatically trigger the Diff view for better UX
            vscode.postMessage({ type: 'review_changes', value: code });
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value) {
                const text = input.value;
                input.value = '';
                appendMessage(text, true);
                vscode.postMessage({ type: 'ask_axiom', value: text });
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'add_response':
                    appendMessage(message.value, false);
                    break;
                case 'propose_changes':
                    renderProposal(message.explanation, message.code);
                    break;
            }
        });
      </script>
    </body>
    </html>`;
	}
}
