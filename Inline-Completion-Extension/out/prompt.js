"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrompt = buildPrompt;
function buildPrompt(language, prefix, suffix) {
    return `
You are an expert software engineer.

Rules:
- Continue the code naturally
- Do NOT repeat existing code
- Do NOT explain anything
- Output only valid code

Language: ${language}

<PREVIOUS_CODE>
${prefix}
</PREVIOUS_CODE>

<CURSOR_POSITION />

<NEXT_CODE>
${suffix}
</NEXT_CODE>

Continue:
`;
}
//# sourceMappingURL=prompt.js.map