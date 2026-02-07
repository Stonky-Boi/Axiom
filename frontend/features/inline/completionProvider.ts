import * as vscode from "vscode";
import { Debouncer } from "./debounce";
import { generateCompletion } from "./ollamaClient";
import { cleanCompletion } from "./utils";

interface CompletionCache {
  text: string;
  line: number;
  character: number;
  uri: string;
  timestamp: number;
}

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debouncer = new Debouncer(800); // Faster debounce (800ms)
  private cache: CompletionCache | null = null;
  private isFetching = false;

  constructor() {
    vscode.workspace.onDidChangeTextDocument((e) => this.handleTextChange(e));
  }

  private handleTextChange(e: vscode.TextDocumentChangeEvent) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== e.document.uri.toString()) {return;}

    // Invalidate cache if the user types something that breaks the prefix match
    if (this.cache && e.contentChanges.length > 0) {
      const change = e.contentChanges[0];
      // If adding text, we might still match. If deleting/moving, invalidate.
      if (editor.selection.active.line !== this.cache.line) {
        this.cache = null;
      }
    }

    this.debouncer.run(async () => {
      await this.fetchCompletion(editor.document, editor.selection.active);
    });
  }

  private async fetchCompletion(document: vscode.TextDocument, position: vscode.Position) {
    if (this.isFetching) {return;}

    // 1. Get Context (Last 30 lines is usually enough for local models)
    const startLine = Math.max(0, position.line - 30);
    const prefix = document.getText(new vscode.Range(startLine, 0, position.line, position.character));

    if (prefix.trim().length < 5) {return; }

    try {
      this.isFetching = true;
      console.log(`[Axiom] Fetching...`);

      // 2. Call Ollama
      const raw = await generateCompletion(prefix); // We only send prefix to 0.5b model usually
      
      // 3. Clean it (Minimalist)
      let completion = cleanCompletion(raw);

      // 4. Handle Repetition (Common in small models)
      // If the model output starts with the last few words of our prefix, strip them.
      const lastLine = document.lineAt(position.line).text.substring(0, position.character).trim();
      if (lastLine.length > 0 && completion.trim().startsWith(lastLine)) {
         // This is a naive strip. 
         // Better: check if the completion repeats the *end* of the prompt.
         // For now, let's rely on cleanCompletion logic.
      }
      
      // 5. Safety: If it's empty or just whitespace, drop it
      if (!completion.trim()) {
        this.isFetching = false;
        return;
      }

      console.log(`[Axiom] Cached: ${JSON.stringify(completion)}`);

      this.cache = {
        text: completion,
        line: position.line,
        character: position.character,
        uri: document.uri.toString(),
        timestamp: Date.now()
      };

      this.isFetching = false;
      
      // Force VS Code to ask us for the completion again immediately
      vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");

    } catch (err) {
      console.error("[Axiom] Error:", err);
      this.cache = null;
      this.isFetching = false;
    }
  }

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.InlineCompletionItem[]> {

    if (!this.cache) {return [];}

    // Cache TTL
    if (Date.now() - this.cache.timestamp > 15000) {
      this.cache = null;
      return [];
    }

    // Verify Position (Line must match, Char must be >= cache char)
    if (this.cache.uri !== document.uri.toString() || this.cache.line !== position.line) {
      return [];
    }

    const charDiff = position.character - this.cache.character;
    if (charDiff < 0) {return [];} // Moved backwards

    // Calculate remaining text
    let completionText = this.cache.text;

    // If user typed ahead, check if it matches our ghost text
    if (charDiff > 0) {
      const typed = document.getText(new vscode.Range(position.line, this.cache.character, position.line, position.character));
      
      if (completionText.startsWith(typed)) {
        completionText = completionText.substring(typed.length);
      } else {
        // User went off-script, invalidate
        this.cache = null;
        return [];
      }
    }

    if (!completionText) {return [];}

    return [new vscode.InlineCompletionItem(
      completionText,
      new vscode.Range(position, position)
    )];
  }
}