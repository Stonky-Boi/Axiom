import * as vscode from "vscode";
import { AxiomClient } from "./client";
import { InlineCompletionFeature } from "./features/inline";
import { HoverFeature } from "./features/hover";
import { ChatFeature } from "./features/chat";

const LANGUAGE_SELECTOR = [
    { language: "python", scheme: "file" },
    { language: "c", scheme: "file" },
    { language: "cpp", scheme: "file" }
];

export function activate(context: vscode.ExtensionContext) {
    console.log("Axiom (Refactored) Activated");

    try {
        // 1. Initialize Client (Starts Python Server)
        const client = new AxiomClient(context);
        context.subscriptions.push(vscode.Disposable.from(client));

        // 2. Register Inline Completion (Fast Loop)
        const inline_provider = new InlineCompletionFeature(client);
        context.subscriptions.push(
            vscode.languages.registerInlineCompletionItemProvider(
                LANGUAGE_SELECTOR,
                inline_provider
            )
        );

        // 3. Register Hover Provider (Explanation Loop)
        const hover_provider = new HoverFeature(client);
        context.subscriptions.push(
            vscode.languages.registerHoverProvider(
                LANGUAGE_SELECTOR,
                hover_provider
            )
        );

        // 4. Register Chat Commands (Reasoning Loop)
        new ChatFeature(context, client);

    } catch (error) {
        console.error("Failed to activate Axiom:", error);
        vscode.window.showErrorMessage("Axiom failed to start. Check the output console.");
    }
}

export function deactivate() {}