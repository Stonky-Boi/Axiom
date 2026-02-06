import * as vscode from "vscode";
import { InlineCompletionProvider } from "./completionProvider";

export function activate(context: vscode.ExtensionContext) {
  console.log("Extension activating...");

  const config = vscode.workspace.getConfiguration('editor');
  const inlineSuggestEnabled = config.get('inlineSuggest.enabled');
  
  console.log("Inline suggest enabled:", inlineSuggestEnabled);
  
  if (!inlineSuggestEnabled) {
    vscode.window.showWarningMessage(
      'Ollama Completions: Please enable "editor.inlineSuggest.enabled" in settings'
    );
  }

  const provider = new InlineCompletionProvider();

  const registration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    provider
  );

  context.subscriptions.push(registration);

  console.log("Ollama Inline Completion activated");
  console.log("Provider registered for all files");

  const manualTriggerCommand = vscode.commands.registerCommand(
    'ollama-completion.trigger',
    async () => {
      console.log("Manual trigger requested");
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }
  );

  context.subscriptions.push(manualTriggerCommand);
  
  console.log("Manual trigger command: ollama-completion.trigger");
}

export function deactivate() {
  console.log("Extension deactivating");
}