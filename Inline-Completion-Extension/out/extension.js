"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/completionProvider.ts
var vscode = __toESM(require("vscode"));

// src/debounce.ts
var Debouncer = class {
  constructor(delay = 250) {
    this.delay = delay;
  }
  timer;
  /**
   * Run function after delay. Cancels any previous pending execution.
   * @param fn Function to run after delay
   */
  run(fn) {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      fn();
      this.timer = void 0;
    }, this.delay);
  }
  /**
   * Cancel any pending execution
   */
  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = void 0;
    }
  }
  /**
   * Check if there's a pending execution
   */
  isPending() {
    return this.timer !== void 0;
  }
};

// src/prompt.ts
function buildPrompt(language, prefix, suffix) {
  return prefix;
}

// src/ollamaClient.ts
async function generateCompletion(prompt) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5-coder:1.5b",
      prompt,
      stream: false,
      raw: true,
      // Bypass chat template
      options: {
        temperature: 0.2,
        num_predict: 150,
        // Longer to get full function
        repeat_penalty: 1.1,
        // CRITICAL: Stop before test code
        stop: [
          "\n# Test",
          // "# Test the function"
          "\nprint(",
          // Test print statements
          "\n# Example",
          // Example comments
          "\nif __name__",
          // Main block
          "\n\ndef ",
          // Next function definition
          "\n\nclass ",
          // Next class definition
          "\n\n\n"
          // Triple newline
        ]
      }
    })
  });
  const json = await res.json();
  return json.response ?? "";
}

// src/utils.ts
function cleanCompletion(text) {
  if (!text)
    return "";
  let cleaned = text;
  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  cleaned = cleaned.replace(/^```[\w]*\n?/g, "").replace(/\n?```$/g, "").replace(/```/g, "");
  const conversationalPrefixes = [
    /^(Sure|Certainly|Here'?s?|Below is|This is|The code|I'll|Let me).*?\n/i,
    /^.*?:\s*\n/
    // Lines ending with colon that look like explanations
  ];
  for (const pattern of conversationalPrefixes) {
    cleaned = cleaned.replace(pattern, "");
  }
  const lines = cleaned.split("\n");
  const resultLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") && (trimmed.includes("Test") || trimmed.includes("Example") || trimmed.includes("Output"))) {
      break;
    }
    if (trimmed.startsWith("print("))
      break;
    if (trimmed.includes("__name__") && trimmed.includes("__main__"))
      break;
    if (/^\/\/\s*(Test|Example|Output|Usage|Main)/i.test(trimmed))
      break;
    if (/^\/\*\s*(Test|Example|Output|Usage|Main)/i.test(trimmed))
      break;
    if (/^(public\s+static\s+)?(void\s+)?main\s*\(/.test(trimmed))
      break;
    if (trimmed === "@Test" || trimmed.startsWith("@Test("))
      break;
    if (trimmed.startsWith("cout <<") || trimmed.startsWith("System.out.println"))
      break;
    if (resultLines.length > 0 && trimmed.length > 20) {
      const hasSyntax = /[;{}()\[\]=<>]/.test(trimmed);
      const startsWithCapital = /^[A-Z]/.test(trimmed);
      const looksLikeProse = startsWithCapital && !hasSyntax;
      if (looksLikeProse) {
        console.log("\u{1F6AB} Stopped at prose line: " + trimmed.substring(0, 40));
        break;
      }
    }
    resultLines.push(line);
  }
  cleaned = resultLines.join("\n").trimEnd();
  const finalLines = cleaned.split("\n");
  const codeLines = [];
  for (const line of finalLines) {
    const trimmed = line.trim();
    if (codeLines.length > 0) {
      const lastCodeLine = codeLines[codeLines.length - 1].trim();
      const isComment = trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("/*");
      const lastWasCode = lastCodeLine && !lastCodeLine.startsWith("#") && !lastCodeLine.startsWith("//");
      if (isComment && lastWasCode) {
        break;
      }
    }
    codeLines.push(line);
  }
  return codeLines.join("\n").trimEnd();
}

// src/completionProvider.ts
var InlineCompletionProvider = class {
  debouncer = new Debouncer(2e3);
  cache = null;
  isFetching = false;
  constructor() {
    console.log("\u{1F680} InlineCompletionProvider activated");
    vscode.workspace.onDidChangeTextDocument((e) => {
      this.handleTextChange(e);
    });
  }
  handleTextChange(e) {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
      return;
    if (editor.document.uri.toString() !== e.document.uri.toString())
      return;
    if (this.cache && e.contentChanges.length > 0) {
      const pos = editor.selection.active;
      if (pos.line !== this.cache.line) {
        this.cache = null;
      }
    }
    const document = editor.document;
    const position = editor.selection.active;
    this.debouncer.run(async () => {
      console.log("\u23F1\uFE0F User stopped typing for 2 seconds - fetching...");
      await this.fetchCompletion(document, position);
    });
  }
  async fetchCompletion(document, position) {
    if (this.isFetching) {
      console.log("\u23F3 Already fetching");
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
      console.log("\u26A0\uFE0F Prefix too short");
      return;
    }
    const prompt = buildPrompt(document.languageId, prefix, suffix);
    try {
      this.isFetching = true;
      console.log("\u{1F310} Calling Ollama...");
      const raw = await generateCompletion(prompt);
      console.log("Raw response:", JSON.stringify(raw.substring(0, 100)));
      let completion = cleanCompletion(raw);
      if (!completion) {
        console.log("\u26A0\uFE0F Empty completion after cleanCompletion");
        this.isFetching = false;
        return;
      }
      completion = this.cleanupCompletion(completion, document, position);
      if (!completion) {
        console.log("\u26A0\uFE0F Empty after cleanup");
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
            console.log(`\u2702\uFE0F Stripped ${i} chars of echo: "${tail}"`);
            break;
          }
        }
      }
      if (!completion.trim()) {
        console.log("\u26A0\uFE0F Empty after echo strip");
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
      console.log("\u2705 Cached at L" + actualPosition.line + ":" + actualPosition.character);
      console.log("\u{1F4DD} Cached text:", JSON.stringify(completion.substring(0, 60)));
      this.isFetching = false;
      await this.showCompletion();
    } catch (err) {
      console.error("\u274C Error:", err);
      this.cache = null;
      this.isFetching = false;
    }
  }
  async showCompletion() {
    console.log("\u{1F3AF} Triggering inline suggest...");
    try {
      await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
      console.log("\u2705 Triggered inline suggest");
    } catch (err) {
      console.error("\u274C Failed to trigger inline suggest:", err);
    }
  }
  cleanupCompletion(completion, document, position) {
    completion = completion.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    completion = completion.replace(/^```[\w]*\n?/g, "").replace(/\n?```$/g, "").trim();
    const lang = document.languageId;
    const cursorLine = document.lineAt(position.line).text.trim();
    const cursorIsBlankOrComment = cursorLine === "" || cursorLine.startsWith("//") || cursorLine.startsWith("#") || cursorLine.startsWith("/*") || cursorLine.startsWith("*");
    const prevLineText = position.line > 0 ? document.lineAt(position.line - 1).text.trim() : "";
    const prevIsBlankOrComment = prevLineText === "" || prevLineText.startsWith("//") || prevLineText.startsWith("#") || prevLineText.startsWith("/*") || prevLineText.startsWith("*");
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
    if (!completion.trim())
      return "";
    const lines = completion.split("\n");
    let modelBaseIndent = "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        modelBaseIndent = line.match(/^(\s*)/)?.[1] || "";
        break;
      }
    }
    const targetIndent = currentLine.match(/^(\s*)/)?.[1] || "";
    const rebased = lines.map((line, idx) => {
      if (line.trim() === "")
        return "";
      let stripped = line;
      if (line.startsWith(modelBaseIndent)) {
        stripped = line.substring(modelBaseIndent.length);
      }
      if (idx === 0) {
        return stripped.trimStart();
      }
      return targetIndent + stripped;
    });
    return rebased.join("\n");
  }
  provideInlineCompletionItems(document, position, context, token) {
    console.log("\u{1F50D} PROVIDER CALLED | L" + position.line + ":" + position.character + " | cache:", !!this.cache + " | triggerKind:", context.triggerKind);
    if (!this.cache) {
      console.log("\u274C No cache");
      return [];
    }
    const age = Date.now() - this.cache.timestamp;
    if (age > 1e4) {
      console.log("\u274C Cache expired (" + age + "ms)");
      this.cache = null;
      return [];
    }
    if (this.cache.uri !== document.uri.toString()) {
      console.log("\u274C Wrong document");
      this.cache = null;
      return [];
    }
    if (this.cache.line !== position.line) {
      console.log("\u274C Different line (cache:" + this.cache.line + " pos:" + position.line + ")");
      this.cache = null;
      return [];
    }
    const charDiff = position.character - this.cache.character;
    if (charDiff < 0) {
      console.log("\u274C Cursor moved back");
      this.cache = null;
      return [];
    }
    if (charDiff > this.cache.text.length) {
      console.log("\u274C Cursor moved beyond completion length");
      this.cache = null;
      return [];
    }
    let completionText = this.cache.text;
    if (charDiff > 0) {
      const currentLine = document.lineAt(position.line).text;
      const typed = currentLine.substring(this.cache.character, position.character);
      if (completionText.startsWith(typed)) {
        completionText = completionText.substring(typed.length);
        console.log("\u2702\uFE0F User typed " + charDiff + " chars that matched, serving rest");
      } else if (charDiff <= 2 && typed.trim() === "") {
        console.log("\u26A0\uFE0F Ignoring whitespace drift of " + charDiff + " chars");
      } else {
        console.log("\u274C Typed text doesn't match. typed='" + typed + "' completion starts with '" + completionText.substring(0, typed.length) + "'");
        this.cache = null;
        return [];
      }
    }
    if (!completionText) {
      console.log("\u274C Nothing left to show");
      this.cache = null;
      return [];
    }
    console.log("\u2705 RETURNING completion:", JSON.stringify(completionText.substring(0, 60)));
    const item = new vscode.InlineCompletionItem(
      completionText,
      new vscode.Range(position, position)
    );
    return [item];
  }
};

// src/extension.ts
function activate(context) {
  console.log("\u{1F3AF} Extension activating...");
  const config = vscode2.workspace.getConfiguration("editor");
  const inlineSuggestEnabled = config.get("inlineSuggest.enabled");
  console.log("\u{1F4CB} Inline suggest enabled:", inlineSuggestEnabled);
  if (!inlineSuggestEnabled) {
    vscode2.window.showWarningMessage(
      'Ollama Completions: Please enable "editor.inlineSuggest.enabled" in settings'
    );
  }
  const provider = new InlineCompletionProvider();
  const registration = vscode2.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    // Match all files instead of just { scheme: "file" }
    provider
  );
  context.subscriptions.push(registration);
  console.log("\u2705 Ollama Inline Completion activated");
  console.log("\u{1F4DD} Provider registered for all files");
  const manualTriggerCommand = vscode2.commands.registerCommand(
    "ollama-completion.trigger",
    async () => {
      console.log("\u{1F3AF} Manual trigger requested");
      await vscode2.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }
  );
  context.subscriptions.push(manualTriggerCommand);
  console.log("\u{1F4DD} Manual trigger command: ollama-completion.trigger");
}
function deactivate() {
  console.log("\u{1F44B} Extension deactivating");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
