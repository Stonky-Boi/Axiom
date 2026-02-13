import * as vscode from 'vscode';

// Global variables to track the active timer and network request
let debounce_timer: NodeJS.Timeout | null = null;
let current_abort_controller: AbortController | null = null;

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage("Axiom is now active and listening.");

    const inline_completion_provider = {
        provideInlineCompletionItems: async function(
            document: vscode.TextDocument,
            position: vscode.Position,
            inline_context: vscode.InlineCompletionContext,
            token: vscode.CancellationToken
        ): Promise<vscode.InlineCompletionItem[] | undefined> {

            // 1. Clear previous timer if the user is still typing
            if (debounce_timer) {
                clearTimeout(debounce_timer);
            }

            // 2. Abort any active HTTP request to Ollama
            if (current_abort_controller) {
                current_abort_controller.abort();
            }

            return new Promise((resolve) => {
                // Wait 400ms after the last keystroke before hitting the backend
                debounce_timer = setTimeout(async () => {
                    
                    if (token.isCancellationRequested) {
                        return resolve(undefined);
                    }

                    current_abort_controller = new AbortController();
                    const fetch_signal = current_abort_controller.signal;

                    const prefix_range = new vscode.Range(new vscode.Position(0, 0), position);
                    const prefix_text = document.getText(prefix_range);

                    const suffix_range = new vscode.Range(position, new vscode.Position(document.lineCount, 0));
                    const suffix_text = document.getText(suffix_range);

                    // Get the root directory of the currently open workspace
                    const workspace_folders = vscode.workspace.workspaceFolders;
                    const workspace_root = workspace_folders ? workspace_folders[0].uri.fsPath : "";

                    const request_body = {
                        file_path: document.fileName,
                        workspace_root: workspace_root,
                        prefix_text: prefix_text,
                        suffix_text: suffix_text
                    };

                    try {
                        const response = await fetch("http://127.0.0.1:8000/autocomplete", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(request_body),
                            signal: fetch_signal // Tie the abort controller to this fetch
                        });

                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }

                        if (token.isCancellationRequested) {
                            return resolve(undefined);
                        }

                        const response_data = await response.json() as { suggestion: string };

                        if (response_data.suggestion && response_data.suggestion.trim().length > 0) {
                            // Print to the debug console so we can see what Ollama actually returned
                            console.log(`[Axiom Debug] Model returned: ${response_data.suggestion}`);
                            return resolve([new vscode.InlineCompletionItem(response_data.suggestion)]);
                        }

                        return resolve(undefined);

                    } catch (error: any) {
                        // Ignore expected abort errors, explicitly alert for everything else
                        if (error.name === 'AbortError') {
                            return resolve(undefined); 
                        }
                        vscode.window.showErrorMessage(`Axiom Inference Error: ${error.message}`);
                        resolve(undefined);
                    }
                }, 400); // 400 milliseconds debounce
            });
        }
    };

    const provider_registration = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' }, 
        inline_completion_provider
    );

    context.subscriptions.push(provider_registration);
}

export function deactivate() {}