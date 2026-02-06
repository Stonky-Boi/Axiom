"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InlineCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const debounce_1 = require("./debounce");
const prompt_1 = require("./prompt");
const ollamaClient_1 = require("./ollamaClient");
const utils_1 = require("./utils");
class InlineCompletionProvider {
    debouncer = new debounce_1.Debouncer();
    lastResult = "";
    async provideInlineCompletionItems(document, position) {
        return new Promise((resolve) => {
            this.debouncer.run(async () => {
                const startLine = Math.max(0, position.line - 200);
                const endLine = Math.min(document.lineCount, position.line + 50);
                const prefix = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
                const suffix = document.getText(new vscode.Range(position.line, position.character, endLine, 0));
                if (prefix.trim().length < 10) {
                    resolve([]);
                    return;
                }
                const prompt = (0, prompt_1.buildPrompt)(document.languageId, prefix, suffix);
                try {
                    const result = await (0, ollamaClient_1.generateCompletion)(prompt);
                    const cleaned = (0, utils_1.cleanCompletion)(result);
                    if (!cleaned || cleaned === this.lastResult) {
                        resolve([]);
                        return;
                    }
                    this.lastResult = cleaned;
                    resolve([
                        new vscode.InlineCompletionItem(cleaned, new vscode.Range(position, position))
                    ]);
                }
                catch (err) {
                    console.error(err);
                    resolve([]);
                }
            });
        });
    }
}
exports.InlineCompletionProvider = InlineCompletionProvider;
//# sourceMappingURL=completionProvider.js.map