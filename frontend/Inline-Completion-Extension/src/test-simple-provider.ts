import * as vscode from "vscode";

export class TestProvider implements vscode.InlineCompletionItemProvider {
  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
    
    console.log("TEST PROVIDER CALLED");
    
    return [
      new vscode.InlineCompletionItem(
        "// TEST GHOST TEXT",
        new vscode.Range(position, position)
      )
    ];
  }
}