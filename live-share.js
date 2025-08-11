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
  const startBtn = document.getElementById('start-share-btn');
  const stopBtn = document.getElementById('stop-share-btn');
  const joinBtn = document.getElementById('join-share-btn');
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
    if (!startBtn || !stopBtn) return;
    if (role === 'host') {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-block';
      joinBtn.style.display = 'none';
    } else if (role === 'viewer') {
      startBtn.style.display = 'inline-block';
      stopBtn.style.display = 'none';
      joinBtn.style.display = 'inline-block';
    } else {
      startBtn.style.display = 'inline-block';
      stopBtn.style.display = 'none';
      joinBtn.style.display = 'inline-block';
    }
  }

  function openShareModal(key){
    shareKeyEl.textContent = key;
    const link = `${location.origin}/?share=${encodeURIComponent(key)}`;
    shareLinkEl.value = link;
    shareModal.style.display = 'flex';
  }
  function closeShareModal(){ shareModal.style.display = 'none'; }
  function openJoinModal(){ joinModal.style.display = 'flex'; joinKeyInput.value = ''; joinKeyInput.focus(); }
  function closeJoinModal(){ joinModal.style.display = 'none'; }

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
      // Nudge scroll to reveal top panel on iOS, then back
      window.scrollTo(0, 1);
      setTimeout(() => window.scrollTo(0, 0), 50);
      // Relayout Monaco after viewport changes
      setTimeout(() => { try { ed?.layout?.(); } catch {} }, 80);
    } catch {}
  }

  function connectHost(key, hostToken){
    const url = api.wsUrl(key, 'host', hostToken);
    session.ws = new SafeWebSocket(url);
    session.ws.onopen = () => {
      setLiveIndicator(`LIVE (Host: ${key})`, true);
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
      forceLayoutAndScrollTop();
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
      version += 1;
      const payload = { type: 'state', content, selection: selection ? { start: selection.startColumn, end: selection.endColumn } : { start: 0, end: 0 }, version };
      try { session.ws.send(JSON.stringify(payload)); } catch {}
    }, 60);
  }

  function startLiveShare(){
    api.start(/* optional turnstile token */).then(({ key, hostToken, viewerUrl }) => {
      session = { key, hostToken, role: 'host', ws: null };
      setButtonsForRole('host');
      openShareModal(key);
      connectHost(key, hostToken);
      // Hook editor changes
      const ed = getEditor();
      if (ed) {
        ed.onDidChangeModelContent(() => scheduleSend());
        ed.onDidChangeCursorSelection(() => scheduleSend());
      }
      forceLayoutAndScrollTop();
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
        return;
      }
      if (window.editor && typeof snap.content === 'string') {
        window.editor.setValue(snap.content);
      }
      connectViewer(formatted);
    }).catch(() => alert('Failed to join session'));
  }

  // Wire UI
  if (startBtn) startBtn.addEventListener('click', startLiveShare);
  if (stopBtn) stopBtn.addEventListener('click', stopLiveShare);
  if (joinBtn) joinBtn.addEventListener('click', openJoinModal);
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
  // Auto-format join key input so users can type ABC234 without '-'
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