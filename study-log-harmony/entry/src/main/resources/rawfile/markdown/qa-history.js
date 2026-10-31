/* Recent question navigation. The controller owns versioned, contiguous history reads. */
(() => {
  let state = {}, entries = [], pending = null, anchor = null, frame = 0, ready = false, readingIntent = false;
  const rail = document.createElement('nav');
  rail.className = 'qa-history-rail'; rail.setAttribute('aria-label', '本次对话快速跳转');
  const peek = document.createElement('div'); peek.className = 'qa-history-peek'; peek.setAttribute('role', 'tooltip');
  const reader = () => document.getElementById('reader');
  const nodes = () => Array.from(reader()?.querySelectorAll('[data-rag-message-id]') || []);
  const find = id => nodes().find(node => node.dataset.ragMessageId === id);
  const snippet = (text, n) => String(text || '').slice(0, n * 6).replace(/<[^>]*>/g, ' ').replace(/[`*_#>\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const position = () => { const node = nodes().find(node => node.getBoundingClientRect().bottom > 8); return node ? { id: node.dataset.ragMessageId, top: node.getBoundingClientRect().top } : null; };
  const bottom = () => scrollY + innerHeight >= document.documentElement.scrollHeight - 32;
  let hovered = '';
  const hidePeek = () => { hovered = ''; peek.remove(); };
  const placePeek = () => {
    if (!peek.isConnected) return;
    const top = rail.getBoundingClientRect().top, half = peek.offsetHeight / 2;
    const center = top + entries.findIndex(item => item.questionId === hovered) * 12 + 14;
    peek.style.top = `${Math.max(half + 8, Math.min(innerHeight - half - 8, center)) - top}px`;
  };
  const showPeek = entry => {
    if (!entry) return;
    hovered = entry.questionId; peek.replaceChildren();
    const title = document.createElement('strong'), preview = document.createElement('p');
    title.textContent = entry.question; preview.textContent = entry.preview;
    peek.append(title, preview); rail.appendChild(peek); placePeek();
  };
  const jump = id => {
    const node = find(id); if (!node) return;
    const target = node.querySelector(':scope > .qa-message-time, :scope > p, :scope > .qa-question-editor') || node;
    window.detachQaFollow?.();
    scrollTo({ top: scrollY + target.getBoundingClientRect().top - 16, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  const load = (target = '') => {
    if (target && find(target)) { jump(target); return; }
    if (pending) { if (target) pending.target = target; return; }
    if (state.loading || !state.window?.start) return;
    window.detachQaFollow?.(); readingIntent = false; pending = { key: state.key, target, first: state.window.firstQuestionId }; anchor = position();
    window.location.href = `study-log://qa-history?key=${encodeURIComponent(state.key)}&target=${encodeURIComponent(target)}`;
  };
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const root = reader(); if (!root || !state.key) { rail.remove(); return; }
      const first = nodes()[0]?.getBoundingClientRect();
      const questions = nodes().filter(node => node.classList.contains('qa-message-user'));
      const active = [...questions].reverse().find(node => node.getBoundingClientRect().top <= innerHeight * .35) || questions[0];
      rail.querySelectorAll('.qa-history-tick').forEach(button => {
        const current = button.dataset.id === active?.dataset.ragMessageId;
        button.classList.toggle('is-current', current);
        if (current) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
      });
      // The rail occupies existing reader whitespace, never the message's hit area.
      const content = questions[0]?.getBoundingClientRect();
      const left = 12;
      const room = content && content.left - left >= 28;
      rail.style.visibility = room && state.hover ? 'visible' : 'hidden';
      rail.style.left = `${left}px`; rail.style.top = `${Math.max(24, innerHeight / 2 - Math.min(entries.length * 6, 180))}px`; placePeek();
      if (ready && readingIntent && state.window?.start && !state.error && first && !bottom() && first.top >= -innerHeight * .75) load();
    });
  };
  window.setQaHistory = payload => {
    let next = {}; try { next = JSON.parse(payload || '{}'); } catch (_) { /* non-QA reader */ }
    if (next.key !== state.key) { ready = false; pending = null; anchor = null; hidePeek(); rail.remove(); }
    if (state.loading && !next.loading && pending?.first === next.window?.firstQuestionId) { pending = null; anchor = null; }
    state = next;
    if (state.error) { pending = null; anchor = null; }
    document.documentElement.classList.toggle('qa-history-pointer', !!state.hover);
  };
  window.qaHistoryReady = () => { ready = true; update(); };
  window.qaHistoryBeforeRender = () => {
    if (!pending || pending.key !== state.key) return;
    // Sampling just before replacement also works while the user scrolls during the read.
    anchor = position();
  };
  window.qaHistoryAfterRender = messages => {
    const map = new Map((state.window?.outline || []).map(entry => [entry.questionId, entry]));
    for (let i = 0; i < messages.length; i++) if (messages[i].role === 'user') {
      map.set(messages[i].id, { questionId: messages[i].id, question: snippet(messages[i].content, 160),
        preview: messages[i + 1]?.role === 'assistant' ? snippet(messages[i + 1].content, 180) : '' });
    }
    const outline = state.window?.outline || [], loadedIds = messages.filter(message => message.role === 'user').map(message => message.id);
    const known = new Set(outline.map(entry => entry.questionId)), lastKnown = loadedIds.findLastIndex(id => known.has(id));
    entries = (outline.length ? [...outline.map(entry => map.get(entry.questionId)), ...loadedIds.slice(lastKnown + 1).filter(id => !known.has(id)).map(id => map.get(id))] : [...map.values()]).slice(-30);
    const previous = new Map(Array.from(rail.querySelectorAll('.qa-history-tick')).map(button => [button.dataset.id, button]));
    const buttons = entries.map(entry => {
      let button = previous.get(entry.questionId);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1; button.className = 'qa-history-tick';
        button.dataset.id = entry.questionId; button.appendChild(document.createElement('span'));
        const preview = () => showPeek(entries.find(item => item.questionId === entry.questionId));
        button.addEventListener('mouseenter', preview);
        button.addEventListener('click', () => load(entry.questionId));
      }
      button.setAttribute('aria-label', entry.question); return button;
    });
    previous.forEach(button => { if (!buttons.includes(button)) button.remove(); });
    buttons.forEach((button, index) => { if (rail.children[index] !== button) rail.insertBefore(button, rail.children[index] || null); });
    if (hovered) { const entry = entries.find(item => item.questionId === hovered); if (entry) showPeek(entry); else hidePeek(); }
    if (entries.length > 1) { if (!rail.isConnected) document.body.appendChild(rail); } else rail.remove();
    if (state.window?.start) {
      const control = document.createElement('div'); control.className = 'qa-history-load'; control.setAttribute('role', 'status');
      if (state.error) { const error = document.createElement('span'); error.textContent = state.error; control.appendChild(error); }
      const button = document.createElement('button'); button.type = 'button'; button.disabled = !!state.loading;
      button.textContent = state.loading ? '正在加载更早消息…' : state.error ? '重试' : '加载更早消息';
      button.addEventListener('click', () => load()); control.appendChild(button); reader().prepend(control);
    }
    if (pending && pending.key === state.key && state.window?.firstQuestionId !== pending.first) {
      const target = pending.target, savedAnchor = anchor, key = state.key;
      pending = null; anchor = null;
      requestAnimationFrame(() => {
        if (key !== state.key) return;
        if (target) { if (find(target)) jump(target); else load(target); }
        else { const node = savedAnchor && find(savedAnchor.id); if (node) scrollBy({ top: node.getBoundingClientRect().top - savedAnchor.top, behavior: 'instant' }); }
      });
    }
    update();
  };
  rail.addEventListener('mouseleave', hidePeek);
  addEventListener('wheel', event => { if (event.deltaY < 0) { readingIntent = true; update(); } }, { passive: true });
  addEventListener('touchmove', () => { readingIntent = true; update(); }, { passive: true });
  addEventListener('keydown', event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { readingIntent = true; update(); } });
  addEventListener('scroll', update, { passive: true }); addEventListener('resize', update);
})();
