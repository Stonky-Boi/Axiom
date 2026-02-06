"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCompletion = generateCompletion;
async function generateCompletion(prompt) {
    const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "qwen2.5-coder:1.5b",
            prompt,
            stream: false,
            options: {
                temperature: 0.2,
                top_p: 0.95,
                num_predict: 120
            }
        })
    });
    const json = await response.json();
    return json.response;
}
//# sourceMappingURL=ollamaClient.js.map