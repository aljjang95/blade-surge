/** One visible combat notice; waiting notices receive their full display time. */
export class CombatNoticeQueue {
  constructor({ show, schedule = (fn, delay) => setTimeout(fn, delay), cancel = (timer) => clearTimeout(timer), duration = 2200, limit = 4 }) {
    this.show = show; this.schedule = schedule; this.cancel = cancel;
    this.duration = duration; this.limit = limit;
    this.pending = []; this.current = null; this.timer = null; this.remove = null; this.revision = 0;
  }
  push(message, tone = '') {
    const duplicate = (notice) => notice?.message === message && notice.tone === tone;
    if (duplicate(this.current) || this.pending.some(duplicate)) return false;
    const notice = { message, tone, urgent: tone.split(/\s+/).includes('red') };
    // A danger cue must be visible immediately; interrupted information resumes afterward.
    if (notice.urgent && this.current && !this.current.urgent) {
      const interrupted = this.current;
      this.stop(); this.pending.unshift(interrupted);
    }
    this.pending.push(notice);
    this.pending.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    // Keep fresh information under bursts instead of displaying an unbounded stale backlog.
    while (this.pending.length > this.limit) {
      const routine = this.pending.findIndex((item) => !item.urgent);
      this.pending.splice(routine < 0 ? 0 : routine, 1);
    }
    if (!this.current) this.next();
    return true;
  }
  next() {
    const notice = this.pending.shift();
    if (!notice) return;
    this.current = notice;
    this.remove = this.show(notice);
    const revision = ++this.revision;
    this.timer = this.schedule(() => {
      if (revision !== this.revision) return;
      this.stop(); this.next();
    }, this.duration);
  }
  stop() {
    this.revision++;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null; this.remove?.(); this.remove = null; this.current = null;
  }
  clear() { this.pending.length = 0; this.stop(); }
}
