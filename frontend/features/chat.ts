import * as vscode from "vscode";
import { AxiomClient } from "../client";

export class ChatFeature {
    constructor(
        private context: vscode.ExtensionContext, 
        private client: AxiomClient
    ) {
        this.register_commands();
    }

    private register_commands() {
        this.context.subscriptions.push(
            vscode.commands.registerCommand("axiom.chat", async () => {
                await this.handle_chat_command();
            })
        );
    }

    private async handle_chat_command() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("Open a file to chat with Axiom.");
            return;
        }

        // 1. Get User Prompt
        const prompt = await vscode.window.showInputBox({
            placeHolder: "Ask Axiom to refactor or explain...",
            prompt: "Axiom Code Assistant"
        });

        if (!prompt) {
            return;
        }

        // 2. Show Progress Indicator
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Axiom is thinking...",
            cancellable: false
        }, async (progress) => {
            
            try {
                // 3. Send to Backend
                const result = await this.client.sendRequest("chat", {
                    prompt: prompt
                });

                if (result.response) {
                    // 4. Output Result (For now, write to a new file or output channel)
                    // In the full version, this would be the Diff View.
                    const doc = await vscode.workspace.openTextDocument({
                        content: `// Axiom Response\n// Prompt: ${prompt}\n\n${result.response}`,
                        language: "markdown"
                    });
                    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Axiom Error: ${error}`);
            }
        });
    }
}