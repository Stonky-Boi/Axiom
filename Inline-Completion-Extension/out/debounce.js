"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Debouncer = void 0;
class Debouncer {
    timer;
    run(callback, delay = 2500) {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = setTimeout(callback, delay);
    }
}
exports.Debouncer = Debouncer;
//# sourceMappingURL=debounce.js.map