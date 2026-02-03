import * as vscode from "vscode";
import { AxiomClient } from "../client";

export class InlineCompletionFeature implements vscode.InlineCompletionItemProvider {
    private debounceTimer: NodeJS.Timeout | undefined;

    constructor(private client: AxiomClient) {}

    provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
        
        return new Promise((resolve) => {
            // Debounce to avoid flooding the backend on every keystroke
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    return resolve([]);
                }

                // Gather context: Current line + window around cursor
                const contextRange = new vscode.Range(
                    Math.max(0, position.line - 10), 0,
                    Math.min(document.lineCount - 1, position.line + 5), 0
                );
                
                try {
                    const result = await this.client.sendRequest("inline_completion", {
                        code: document.getText(contextRange),
                        cursor_line: position.line,
                        language: document.languageId
                    });

                    if (result.completion) {
                        resolve([
                            new vscode.InlineCompletionItem(
                                result.completion,
                                new vscode.Range(position, position)
                            )
                        ]);
                    } else {
                        resolve([]);
                    }
                } catch (e) {
                    resolve([]); // Fail silently for inline completions
                }
            }, 300); // 300ms wait
        });
    }
}