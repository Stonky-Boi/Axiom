export class Debouncer {
  private timer?: NodeJS.Timeout;

  constructor(private delay: number = 250) {}

  /**
   * Run function after delay. Cancels any previous pending execution.
   * @param fn 
   */
  run(fn: () => void | Promise<void>) {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Start new timer
    this.timer = setTimeout(() => {
      fn();
      this.timer = undefined;
    }, this.delay);
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  isPending(): boolean {
    return this.timer !== undefined;
  }
}