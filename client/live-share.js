(function(){
  // Preserve original network constructors before app.js overrides
  const OriginalFetch = window.__origFetch || window.fetch?.bind(window);
  const OriginalWebSocket = window.__origWebSocket || window.WebSocket;

  // If app.js already blocked, try to recover via iframe trick (best effort)
  let safeFetch = OriginalFetch;
  let SafeWebSocket = OriginalWebSocket;
  if (!safeFetch || typeof safeFetch !== 'function') {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.documentElement.appendChild(iframe);
      safeFetch = iframe.contentWindow.fetch.bind(iframe.contentWindow);
      SafeWebSocket = iframe.contentWindow.WebSocket;
      // expose for future
      window.__origFetch = safeFetch;
      window.__origWebSocket = SafeWebSocket;
    } catch (e) {
      console.warn('Live share: unable to restore fetch/WebSocket');
    }
  }

  const configuredBase = window.LIVE_SHARE_BASE || document.querySelector('meta[name="live-share-base"]')?.content;
  const workerBase = (configuredBase || location.origin || '').replace(/\/?$/, '');
  const api = {
    async start(turnstileToken) {
      const res = await safeFetch(workerBase + '/api/share/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'editor' },
        body: JSON.stringify({ turnstileToken: turnstileToken || null })
      });
      if (!res.ok) throw new Error('Failed to start share');
      return res.json();
    },
    async stop(key, hostToken) {
      const res = await safeFetch(workerBase + '/api/share/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'editor' },
        body: JSON.stringify({ key, hostToken })
      });
      if (!res.ok) throw new Error('Failed to stop');
      return res.json();
    },
    async snapshot(key) {
      const res = await safeFetch(workerBase + '/api/share/snapshot/' + encodeURIComponent(key));
      if (!res.ok) throw new Error('Failed to fetch snapshot');
      return res.json();
    },
    wsUrl(key, role, token) {
      const base = new URL(workerBase || location.origin);
      const proto = base.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = base.host;
      const qs = new URLSearchParams({ role, ...(token ? { token } : {}) }).toString();
      return `${proto}//${host}/ws/${encodeURIComponent(key)}?${qs}`;
    }
  };

  // UI elements
  const liveMenuBtn = document.getElementById('live-share-menu-btn');
  const liveEl = document.getElementById('live-indicator');
  const shareModal = document.getElementById('share-modal');
  const shareKeyEl = document.getElementById('share-key');
  const shareLinkEl = document.getElementById('share-link');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const joinModal = document.getElementById('join-modal');
  const joinKeyInput = document.getElementById('join-key-input');
  const joinConfirmBtn = document.getElementById('join-confirm-btn');
  const joinCancelBtn = document.getElementById('join-cancel-btn');

  let session = { key: null, hostToken: null, role: 'idle', ws: null };
  let version = 0;
  let sendTimer = null;
  let liveMenuEl = null;

  // Normalize a user-entered key: allow ABC234 and convert to ABC-234
  function normalizeKey(raw){
    const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length >= 3) {
      const head = s.slice(0, 3).replace(/[IO]/g, '');
      const tail = s.slice(3).replace(/[^2-9]/g, ''); // digits 2-9 only
      const merged = (head + tail).slice(0, 6);
      if (merged.length === 6) return merged.slice(0,3) + '-' + merged.slice(3);
      if (merged.length > 3) return merged.slice(0,3) + '-' + merged.slice(3);
      return merged;
    }
    return s;
  }

  function validateKey(key){
    const formatted = normalizeKey(key);
    return /^[A-HJ-NP-Z]{3}-[2-9]{3}$/.test((formatted||'').trim());
  }

  function setLiveIndicator(text, show){
    if (!liveEl) return;
    liveEl.textContent = text || '';
    liveEl.style.display = show ? 'block' : 'none';
  }

  function setButtonsForRole(role){
    // Hide toolbar buttons when viewing; show otherwise (except language select)
    const hide = role === 'viewer';
    const idsToToggle = [
      'open-file-btn',
      'format-btn',
      'file-path',
      'file-input'
    ];
    idsToToggle.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = hide ? 'none' : '';
    });
    
    // Handle language dropdown - show but disable for viewers
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
      langSelect.style.display = '';  // Always show
      langSelect.disabled = hide;     // Disable for viewers
    }
    
    // Set global role for app.js to check
    window.liveShareRole = role;
  }

  function openShareModal(key){
    shareKeyEl.textContent = key;
    const link = `${location.origin}/?share=${encodeURIComponent(key)}`;
    shareLinkEl.value = link;
    shareModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function closeShareModal(){
    shareModal.style.display = 'none';
    document.body.style.overflow = '';
    focusEditorSoon();
  }
  function openJoinModal(){
    joinModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    joinKeyInput.value = '';
    setTimeout(() => joinKeyInput.focus(), 0);
  }
  function closeJoinModal(){
    joinModal.style.display = 'none';
    document.body.style.overflow = '';
    focusEditorSoon();
  }

  function getEditor(){
    try { return (typeof editor !== 'undefined') ? editor : window.editor; } catch(_) { return window.editor; }
  }

  function disableEditing(disabled){
    const ed = getEditor();
    if (!ed) return;
    ed.updateOptions({ readOnly: disabled });
  }

  function forceLayoutAndScrollTop(){
    try {
      const ed = getEditor();
      window.scrollTo(0, 1);
      setTimeout(() => window.scrollTo(0, 0), 50);
      setTimeout(() => { try { ed?.layout?.(); } catch {} }, 80);
    } catch {}
  }

  function focusEditorSoon(){
    const ed = getEditor();
    setTimeout(() => {
      try { ed?.focus?.(); } catch {}
      forceLayoutAndScrollTop();
    }, 30);
  }

  function connectHost(key, hostToken){
    const url = api.wsUrl(key, 'host', hostToken);
    session.ws = new SafeWebSocket(url);
    session.ws.onopen = () => {
      setLiveIndicator(`LIVE (Host: ${key})`, true);
      setButtonsForRole('host');
    };
    session.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'error') {
        console.warn('host error', msg.reason);
      }
    };
    session.ws.onclose = () => {
      setLiveIndicator('', false);
    };
  }

  function connectViewer(key){
    const url = api.wsUrl(key, 'viewer');
    session.ws = new SafeWebSocket(url);
    session.ws.onopen = () => {
      setLiveIndicator(`LIVE (Viewing: ${key})`, true);
      disableEditing(true);
      setButtonsForRole('viewer');
      forceLayoutAndScrollTop();
      focusEditorSoon();
    };
    session.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        const ed = getEditor();
        if (ed) {
          const current = ed.getValue();
          if (current !== msg.content) {
            const pos = ed.getScrollTop();
            ed.setValue(msg.content);
            ed.setScrollTop(pos);
          }
          // Update language if it changed
          if (msg.language && ed.getModel().getLanguageId() !== msg.language) {
            monaco.editor.setModelLanguage(ed.getModel(), msg.language);
            // Update the dropdown to reflect the new language
            const langSelect = document.getElementById('language-select');
            if (langSelect) {
              langSelect.value = msg.language;
            }
          }
        }
        version = msg.version || version + 1;
      }
      if (msg.type === 'ended') {
        setLiveIndicator('Session ended', true);
        setTimeout(() => setLiveIndicator('', false), 2000);
        disableEditing(false);
        if (session.ws) try { session.ws.close(); } catch {}
        session = { key: null, hostToken: null, role: 'idle', ws: null };
        setButtonsForRole('idle');
        forceLayoutAndScrollTop();
        focusEditorSoon();
      }
    };
    session.ws.onclose = () => {};
  }

  function scheduleSend(){
    if (sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      const ed = getEditor();
      if (!session.ws || session.role !== 'host' || !ed) return;
      const content = ed.getValue();
      const selection = ed.getSelection();
      const language = ed.getModel().getLanguageId();
      version += 1;
      const payload = { type: 'state', content, selection: selection ? { start: selection.startColumn, end: selection.endColumn } : { start: 0, end: 0 }, language, version };
      try { session.ws.send(JSON.stringify(payload)); } catch {}
    }, 60);
  }

  // Expose scheduleSend globally for app.js
  window.liveShareScheduleSend = scheduleSend;

  function startLiveShare(){
    if (session.role === 'viewer') { alert('Viewers cannot start a new live share.'); return; }
    api.start(/* optional turnstile token */).then(({ key, hostToken, viewerUrl }) => {
      session = { key, hostToken, role: 'host', ws: null };
      openShareModal(key);
      connectHost(key, hostToken);
      const ed = getEditor();
      if (ed) {
        ed.onDidChangeModelContent(() => scheduleSend());
        ed.onDidChangeCursorSelection(() => scheduleSend());
        ed.onDidChangeModelLanguage(() => scheduleSend());
      }
      setButtonsForRole('host');
      forceLayoutAndScrollTop();
      focusEditorSoon();
    }).catch((e) => alert(e.message || 'Failed to start live share'));
  }

  function stopLiveShare(){
    if (!session.key || session.role !== 'host') return;
    api.stop(session.key, session.hostToken).finally(() => {
      if (session.ws) try { session.ws.close(); } catch {}
      session = { key: null, hostToken: null, role: 'idle', ws: null };
      setLiveIndicator('', false);
      setButtonsForRole('idle');
      forceLayoutAndScrollTop();
      focusEditorSoon();
    });
  }

  function joinByKey(key){
    const formatted = normalizeKey(key);
    if (!validateKey(formatted)) { alert('Invalid key. Use format ABC234 or ABC-234'); return; }
    session = { key: formatted, hostToken: null, role: 'viewer', ws: null };
    setButtonsForRole('viewer');
    api.snapshot(formatted).then((snap) => {
      if (!snap.active) {
        alert('Session not active');
        session = { key: null, hostToken: null, role: 'idle', ws: null };
        setButtonsForRole('idle');
        return;
      }
      if (window.editor && typeof snap.content === 'string') {
        window.editor.setValue(snap.content);
      }
      connectViewer(formatted);
    }).catch(() => {
      alert('Failed to join session');
      session = { key: null, hostToken: null, role: 'idle', ws: null };
      setButtonsForRole('idle');
    });
  }

  function openLiveMenu(){
    closeLiveMenu();
    const menu = document.createElement('div');
    menu.className = 'live-menu';
    if (session.role === 'host') {
      menu.innerHTML = `
        <button type="button" data-action="stop"><i class="fas fa-stop-circle"></i> Stop Live Share</button>
        <div class="sep"></div>
        <button type="button" data-action="copy"><i class="fas fa-link"></i> Copy Share Link</button>
      `;
    } else if (session.role === 'viewer') {
      menu.innerHTML = `
        <button type="button" data-action="join"><i class="fas fa-link"></i> Join Session</button>
      `;
    } else {
      menu.innerHTML = `
        <button type="button" data-action="start"><i class="fas fa-play"></i> Start Live Share</button>
        <button type="button" data-action="join"><i class="fas fa-link"></i> Join Session</button>
      `;
    }
    document.body.appendChild(menu);
    const rect = liveMenuBtn.getBoundingClientRect();
    menu.style.top = Math.round(rect.bottom + window.scrollY + 8) + 'px';
    menu.style.right = Math.max(8, Math.round(window.innerWidth - rect.right)) + 'px';
    liveMenuEl = menu;

    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'start') startLiveShare();
      if (action === 'join') openJoinModal();
      if (action === 'stop') stopLiveShare();
      if (action === 'copy') { try { navigator.clipboard.writeText(shareLinkEl.value); } catch {} }
      closeLiveMenu();
    });

    setTimeout(() => {
      function outside(e){
        if (!menu.contains(e.target) && e.target !== liveMenuBtn) {
          closeLiveMenu();
          document.removeEventListener('click', outside, true);
        }
      }
      document.addEventListener('click', outside, true);
    }, 0);
  }

  function closeLiveMenu(){
    if (liveMenuEl && liveMenuEl.parentNode) liveMenuEl.parentNode.removeChild(liveMenuEl);
    liveMenuEl = null;
  }

  // Wire UI
  function toggleLiveMenu(e){
    if (e) e.stopPropagation();
    if (liveMenuEl) closeLiveMenu(); else openLiveMenu();
  }
  if (liveMenuBtn) {
    liveMenuBtn.addEventListener('click', toggleLiveMenu);
    liveMenuBtn.addEventListener('touchend', (e) => { e.preventDefault(); toggleLiveMenu(e); }, { passive: false });
    liveMenuBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggleLiveMenu(e); });
  }
  // Fallback for legacy buttons if present (cached HTML)
  const legacyStartBtn = document.getElementById('start-share-btn');
  const legacyJoinBtn = document.getElementById('join-share-btn');
  const legacyStopBtn = document.getElementById('stop-share-btn');
  if (legacyStartBtn) legacyStartBtn.addEventListener('click', () => { openLiveMenu(); });
  if (legacyJoinBtn) legacyJoinBtn.addEventListener('click', () => { openLiveMenu(); });
  if (legacyStopBtn) legacyStopBtn.addEventListener('click', () => { stopLiveShare(); });
  if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLinkEl.value).then(() => {
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => (copyLinkBtn.textContent = 'Copy Link'), 1200);
    });
  });
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeShareModal);
  if (joinCancelBtn) joinCancelBtn.addEventListener('click', closeJoinModal);
  if (joinConfirmBtn) joinConfirmBtn.addEventListener('click', () => { const k = joinKeyInput.value; closeJoinModal(); joinByKey(k); });
  joinKeyInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); joinConfirmBtn.click(); }});
  joinKeyInput?.addEventListener('input', () => {
    const raw = joinKeyInput.value || '';
    const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const head = up.slice(0,3).replace(/[IO]/g, '');
    const tail = up.slice(3,6).replace(/[^2-9]/g, '');
    const merged = (head + tail).slice(0,6);
    if (merged.length <= 3) {
      joinKeyInput.value = merged;
    } else {
      joinKeyInput.value = merged.slice(0,3) + '-' + merged.slice(3);
    }
  });

  // Auto-join if URL has ?share=KEY
  const urlParams = new URLSearchParams(location.search);
  const initialKey = urlParams.get('share');
  const normalizedInitial = normalizeKey(initialKey);
  if (validateKey(normalizedInitial)) {
    joinByKey(normalizedInitial);
  }
})(); 