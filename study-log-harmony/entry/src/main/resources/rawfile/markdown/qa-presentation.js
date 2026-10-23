// Presentation-only counterpart of use-smooth-rag-answer.ts: 250ms bounded
// fragment deadlines, 50ms Markdown commits, grapheme-safe boundaries.
// Canonical task text, copy/save/retry and execution state never enter this clock.
(function (scope) {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  function graphemeIndex(ends, offset, roundUp = false) {
    let low = 0, high = ends.length;
    while (low < high) { const middle = (low + high) >>> 1; if (ends[middle] <= offset) low = middle + 1; else high = middle; }
    return roundUp && low < ends.length && ends[low - 1] !== offset ? low + 1 : low;
  }
  class QaPresentation {
    constructor() { this.reset(); }
    reset() { this.key = ''; this.text = ''; this.target = ''; this.eligible = false; this.ends = []; this.parts = []; this.cursor = 0; this.time = 0; }
    update(key, content, status, now, motion = true) {
      if (this.key !== key) {
        this.reset(); this.key = key; this.eligible = status === 'streaming';
        this.text = this.eligible ? '' : content; this.target = this.text;
      }
      if (!this.eligible || !segmenter || !motion || status === 'error' || status === 'stopped' || !content.startsWith(this.text)) {
        this.text = this.target = content; this.parts = []; this.ends = []; this.cursor = 0;
        this.eligible = status === 'streaming' && motion && !!segmenter; return;
      }
      if (this.target !== content) {
        const append = content.startsWith(this.target), keep = append ? Math.max(0, this.ends.length - 1) : 0;
        const start = this.ends[keep - 1] || 0;
        if (!append) this.parts = [];
        this.target = content;
        this.ends.length = keep;
        for (const part of segmenter.segment(content.slice(start))) {
          const end = start + part.index + part.segment.length, last = content.charCodeAt(end - 1);
          if (status === 'streaming' && end === content.length && (last >= 0xd800 && last <= 0xdbff || last === 0x200d)) break;
          this.ends.push(end);
        }
        const available = this.ends.at(-1) || 0;
        this.parts = this.parts.filter(part => part.end > this.text.length && part.end <= available);
        if (available > (this.parts.at(-1)?.end || this.text.length)) this.parts.push({ end: available, deadline: now + 250 });
        this.cursor = graphemeIndex(this.ends, this.text.length); this.time = now;
      }
      if (this.text === content && status !== 'streaming') this.eligible = false;
    }
    advance(now) {
      let budget = Math.max(0, now - this.time), time = this.time;
      for (const part of this.parts) {
        const goal = graphemeIndex(this.ends, part.end, true);
        if (this.cursor >= goal) continue;
        const remaining = goal - this.cursor, rate = Math.max(1 / 5, remaining / Math.max(1, part.deadline - time));
        const spent = Math.min(budget, remaining / rate);
        this.cursor = Math.min(goal, this.cursor + rate * spent); time += spent; budget -= spent;
        if (now >= part.deadline) this.cursor = Math.max(this.cursor, goal);
        if (budget <= 0) break;
      }
      this.time = now;
      const end = Math.max(this.text.length, this.ends[Math.floor(this.cursor) - 1] || 0);
      this.text = this.target.slice(0, end); this.parts = this.parts.filter(part => part.end > end);
      return this.text;
    }
    get pending() { return this.eligible && this.text !== this.target; }
  }
  scope.QaPresentation = QaPresentation;
})(globalThis);
