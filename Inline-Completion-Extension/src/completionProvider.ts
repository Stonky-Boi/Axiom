import * as vscode from "vscode";
import { Debouncer } from "./debounce";
import { buildPrompt } from "./prompt";
import { generateCompletion } from "./ollamaClient";
import { cleanCompletion } from "./utils";

interface CompletionCache {
  text: string;
  line: number;
  character: number;
  uri: string;
  timestamp: number;
}

export class InlineCompletionProvider
  implements vscode.InlineCompletionItemProvider {

  private debouncer = new Debouncer(2000);
  private cache: CompletionCache | null = null;
  private isFetching = false;

  constructor() {
    console.log("InlineCompletionProvider activated");

    vscode.workspace.onDidChangeTextDocument((e) => {
      this.handleTextChange(e);
    });
  }

  private handleTextChange(e: vscode.TextDocumentChangeEvent) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (editor.document.uri.toString() !== e.document.uri.toString()) return;

    if (this.cache && e.contentChanges.length > 0) {
      const pos = editor.selection.active;
      if (pos.line !== this.cache.line) {
        this.cache = null;
      }
    }

    const document = editor.document;
    const position = editor.selection.active;

    this.debouncer.run(async () => {
      console.log("⏱User stopped typing for 2 seconds - fetching...");
      await this.fetchCompletion(document, position);
    });
  }

  private async fetchCompletion(
    document: vscode.TextDocument,
    position: vscode.Position
  ) {
    if (this.isFetching) {
      console.log("Already fetching");
      return;
    }

    const startLine = Math.max(0, position.line - 10);
    const endLine = Math.min(document.lineCount, position.line + 5);

    const prefix = document.getText(
      new vscode.Range(startLine, 0, position.line, position.character)
    );

    const suffix = document.getText(
      new vscode.Range(position.line, position.character, endLine, 0)
    );

    if (prefix.trim().length < 2) {
      console.log("Prefix too short");
      return;
    }

    const prompt = buildPrompt(document.languageId, prefix, suffix);

    try {
      this.isFetching = true;
      console.log("Calling Ollama...");

      const raw = await generateCompletion(prompt);
      console.log("Raw response:", JSON.stringify(raw.substring(0, 100)));

      let completion = cleanCompletion(raw);

      if (!completion) {
        console.log("Empty completion after cleanCompletion");
        this.isFetching = false;
        return;
      }

      completion = this.cleanupCompletion(completion, document, position);

      if (!completion) {
        console.log("Empty after cleanup");
        this.isFetching = false;
        return;
      }

      const currentLine = document.lineAt(position.line).text;
      const textBeforeCursor = currentLine.substring(0, position.character);
      const MIN_OVERLAP = 8;

      if (textBeforeCursor.length >= MIN_OVERLAP) {
        for (let i = Math.min(textBeforeCursor.length, completion.length); i >= MIN_OVERLAP; i--) {
          const tail = textBeforeCursor.substring(textBeforeCursor.length - i);
          if (completion.startsWith(tail)) {
            completion = completion.substring(i);
            console.log(`Stripped ${i} chars of echo: "${tail}"`);
            break;
          }
        }
      }

      if (!completion.trim()) {
        console.log("Empty after echo strip");
        this.isFetching = false;
        return;
      }

      const editor = vscode.window.activeTextEditor;
      const actualPosition = editor ? editor.selection.active : position;

      this.cache = {
        text: completion,
        line: actualPosition.line,
        character: actualPosition.character,
        uri: document.uri.toString(),
        timestamp: Date.now()
      };

      console.log("Cached at L" + actualPosition.line + ":" + actualPosition.character);
      console.log("Cached text:", JSON.stringify(completion.substring(0, 60)));

      this.isFetching = false;

      await this.showCompletion();

    } catch (err) {
      console.error("Error:", err);
      this.cache = null;
      this.isFetching = false;
    }
  }

  private async showCompletion() {
    console.log("Triggering inline suggest...");

    try {
      await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
      console.log("Triggered inline suggest");
    } catch (err) {
      console.error("Failed to trigger inline suggest:", err);
    }
  }

  private cleanupCompletion(
    completion: string,
    document: vscode.TextDocument,
    position: vscode.Position
  ): string {
    completion = completion.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    completion = completion
      .replace(/^```[\w]*\n?/g, "")
      .replace(/\n?```$/g, "")
      .trim();

    const lang = document.languageId;
    const cursorLine = document.lineAt(position.line).text.trim();
    const cursorIsBlankOrComment =
      cursorLine === "" ||
      cursorLine.startsWith("//") ||
      cursorLine.startsWith("#") ||
      cursorLine.startsWith("/*") ||
      cursorLine.startsWith("*");

    const prevLineText = position.line > 0
      ? document.lineAt(position.line - 1).text.trim()
      : "";
    const prevIsBlankOrComment =
      prevLineText === "" ||
      prevLineText.startsWith("//") ||
      prevLineText.startsWith("#") ||
      prevLineText.startsWith("/*") ||
      prevLineText.startsWith("*");

    if (!cursorIsBlankOrComment) {
      if (lang === "python") {
        completion = completion.replace(/^(def|class)\s+\w+[^:]*:\s*\n/s, "");
      } else if (lang === "javascript" || lang === "typescript") {
        completion = completion.replace(/^(export\s+)?(default\s+)?(async\s+)?(function\s*\*?\s+\w+|const|let|var)\s+[^\n]*\n/s, "");
      } else if (lang === "cpp" || lang === "c" || lang === "java" || lang === "csharp") {
        completion = completion.replace(
          /^(template\s*<[^>]*>\s*\n)?(public|private|protected|static|virtual|override|inline|extern|const|constexpr|friend|explicit|noexcept|\s)*[\w:<>\[\]\*&\s]+\w+\s*\([^)]*\)\s*(const\s*)?(override\s*)?(\{|->[\w:<>\[\]\*&\s]+\{)\s*\n?/s,
          ""
        );
      }
    }

    const currentLine = document.lineAt(position.line).text;
    const textAfterCursor = currentLine.substring(position.character).trim();

    if (textAfterCursor && completion.trimStart().startsWith(textAfterCursor)) {
      completion = completion.trimStart().substring(textAfterCursor.length);
    }

    if (!completion.trim()) return "";

    const lines = completion.split('\n');

    let modelBaseIndent = "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        modelBaseIndent = line.match(/^(\s*)/)?.[1] || "";
        break;
      }
    }

    const targetIndent = currentLine.match(/^(\s*)/)?.[1] || "";

    const rebased = lines.map((line, idx) => {
      if (line.trim() === "") return ""; 
      let stripped = line;
      if (line.startsWith(modelBaseIndent)) {
        stripped = line.substring(modelBaseIndent.length);
      }

      if (idx === 0) {
        return stripped.trimStart();
      }
      return targetIndent + stripped;
    });

    return rebased.join('\n');
  }

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {

    console.log("PROVIDER CALLED | L" + position.line + ":" + position.character +
      " | cache:", !!this.cache + " | triggerKind:", context.triggerKind);

    if (!this.cache) {
      console.log("No cache");
      return [];
    }

    // Cache TTL: 10 seconds
    const age = Date.now() - this.cache.timestamp;
    if (age > 10000) {
      console.log("Cache expired (" + age + "ms)");
      this.cache = null;
      return [];
    }

    if (this.cache.uri !== document.uri.toString()) {
      console.log("Wrong document");
      this.cache = null;
      return [];
    }

    if (this.cache.line !== position.line) {
      console.log("Different line (cache:" + this.cache.line + " pos:" + position.line + ")");
      this.cache = null;
      return [];
    }

    const charDiff = position.character - this.cache.character;

    if (charDiff < 0) {
      console.log("Cursor moved back");
      this.cache = null;
      return [];
    }

    if (charDiff > this.cache.text.length) {
      console.log("Cursor moved beyond completion length");
      this.cache = null;
      return [];
    }

    let completionText = this.cache.text;

    if (charDiff > 0) {
      const currentLine = document.lineAt(position.line).text;
      const typed = currentLine.substring(this.cache.character, position.character);

      if (completionText.startsWith(typed)) {
        completionText = completionText.substring(typed.length);
        console.log("User typed " + charDiff + " chars that matched, serving rest");
      } else if (charDiff <= 2 && typed.trim() === "") {
        console.log("Ignoring whitespace drift of " + charDiff + " chars");
      } else {
        console.log("Typed text doesn't match. typed='" + typed + "' completion starts with '" + completionText.substring(0, typed.length) + "'");
        this.cache = null;
        return [];
      }
    }

    if (!completionText) {
      console.log("Nothing left to show");
      this.cache = null;
      return [];
    }

    console.log("RETURNING completion:", JSON.stringify(completionText.substring(0, 60)));

    const item = new vscode.InlineCompletionItem(
      completionText,
      new vscode.Range(position, position)
    );

    return [item];
  }
}