import * as vscode from "vscode";
import { AxiomClient } from "../client";

export class HoverFeature implements vscode.HoverProvider {
    constructor(private client: AxiomClient) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        
        // 1. Get the word/symbol under cursor
        const range = document.getWordRangeAtPosition(position);
        if (!range) {
            return null;
        }

        const symbol = document.getText(range);

        // 2. Get a small window of context (e.g., 5 lines up/down)
        const start_line = Math.max(0, position.line - 5);
        const end_line = Math.min(document.lineCount - 1, position.line + 5);
        const context = document.getText(new vscode.Range(start_line, 0, end_line, 0));

        // 3. Request explanation from Backend
        try {
            // Using a timeout race to ensure hover doesn't hang indefinitely
            const response_promise = this.client.sendRequest("hover", {
                symbol: symbol,
                context: context
            });

            const timeout_promise = new Promise<any>((_, reject) => 
                setTimeout(() => reject("Timeout"), 2000)
            );

            const result = await Promise.race([response_promise, timeout_promise]);

            if (result && result.tooltip) {
                const markdown = new vscode.MarkdownString();
                markdown.appendMarkdown(`**Axiom:** ${result.tooltip}`);
                return new vscode.Hover(markdown, range);
            }
        } catch (error) {
            // Hovers should fail silently so they don't annoy the user
            console.error("Hover failed:", error);
        }

        return null;
    }
}