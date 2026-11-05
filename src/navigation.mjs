export class Navigation {
  constructor(config) {
    if (!Array.isArray(config.pages) || !config.pages.length) throw new Error('At least one display page is required');
    if (new Set(config.pages).size !== config.pages.length) throw new Error('Display page names must be unique');
    this.pages = [...config.pages];
    this.pageIndex = Math.max(0, this.pages.indexOf(config.defaultPage));
    this.timeout = config.adjustmentTimeoutMs;
    if (!Number.isFinite(this.timeout) || this.timeout < 500) throw new Error('Adjustment timeout must be at least 500 ms');
    this.mode = 7;
    this.lastAction = 0;
  }
  get page() { return this.pages[this.pageIndex]; }
  get browsing() { return this.mode === 7; }
  button(mode, now = Date.now()) {
    this.mode = mode;
    this.lastAction = now;
    return { kind: this.browsing ? 'display' : 'control', page: this.page, mode };
  }
  lever(direction, now = Date.now()) {
    this.lastAction = now;
    if (!this.browsing) return { kind: 'native-control', mode: this.mode };
    if (direction === 'up') this.pageIndex = (this.pageIndex - 1 + this.pages.length) % this.pages.length;
    if (direction === 'down') this.pageIndex = (this.pageIndex + 1) % this.pages.length;
    return { kind: 'display', page: this.page };
  }
  needsReturn(now = Date.now()) { return !this.browsing && now - this.lastAction >= this.timeout; }
}
