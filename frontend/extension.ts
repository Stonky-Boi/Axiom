import * as vscode from "vscode";
import { AxiomClient } from "./client";
import { HoverFeature } from "./features/hover";
import { ChatFeature } from "./features/chat";
import { InlineCompletionProvider } from "./features/inline/completionProvider";

const LANGUAGE_SELECTOR = [
    { language: "python", scheme: "file" },
    { language: "c", scheme: "file" },
    { language: "cpp", scheme: "file" },
    { language: "javascript", scheme: "file" },
    { language: "typescript", scheme: "file" }
];

export function activate(context: vscode.ExtensionContext) {
    console.log("Axiom Activated");

    const client = new AxiomClient(context);
    context.subscriptions.push(vscode.Disposable.from(client));

    // Inline
    const inlineProvider = new InlineCompletionProvider();
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { pattern: "**" }, 
            inlineProvider
        )
    );

    // Sidebar Chat
    const chatProvider = new ChatFeature(context.extensionUri, client);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatFeature.viewType, chatProvider)
    );

    // Hover
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(LANGUAGE_SELECTOR, new HoverFeature(client))
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('axiom.focusChat', () => {
             vscode.commands.executeCommand('axiom.chatView.focus');
        })
    );
}

export function deactivate() {}