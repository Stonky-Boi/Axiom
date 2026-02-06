"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanCompletion = cleanCompletion;
function cleanCompletion(text) {
    return text
        .replace(/^```[\s\S]*?```/, "")
        .trimEnd();
}
//# sourceMappingURL=utils.js.map