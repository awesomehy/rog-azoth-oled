// Cache completed requests independently of the periodic polling schedule.
export class RefreshCache {
  constructor(load, { maxAgeMs, now = Date.now }) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 1000) throw new Error('Cache duration must be at least one second');
    this.load = load; this.maxAgeMs = maxAgeMs; this.now = now;
    this.completedAt = null; this.value = null; this.error = null; this.pending = null;
  }
  get fresh() { return this.completedAt !== null && this.now() - this.completedAt < this.maxAgeMs; }
  read({ refresh = false } = {}) {
    if (this.pending) return this.pending;
    if (!refresh && this.fresh) return this.error ? Promise.reject(this.error) : Promise.resolve(this.value);
    this.pending = Promise.resolve().then(this.load).then(value => {
      this.value = value; this.error = null; return value;
    }, error => { this.error = error; throw error; }).finally(() => {
      this.completedAt = this.now(); this.pending = null;
    });
    return this.pending;
  }
}
