(function(){
  // Preserve original network constructors before app.js overrides
  const OriginalFetch = window.__origFetch || window.fetch?.bind(window);
  const OriginalWebSocket = window.__origWebSocket || window.WebSocket;

  // --- Encrypted Live Share: E2E encryption utilities ---
  const cryptoApi = typeof LiveShareCrypto !== 'undefined' ? LiveShareCrypto : (function () {
    const ENC_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const PBKDF2_ITERATIONS = 100000;
    const SALT_LEN = 16;
    const IV_LEN = 12;
    return {
      generateEncryptionKey: () => Array.from({ length: 6 }, () => ENC_CHARS[Math.floor(Math.random() * ENC_CHARS.length)]).join(''),
      normalizeEncryptionKey: (raw) => String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6),
      validateEncryptionKey: (key) => (String(key || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)).length === 6,
      encrypt: async (plaintext, passphrase) => {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, keyMaterial, 256);
        const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
        const combined = new Uint8Array(salt.length + iv.length + ct.byteLength);
        combined.set(salt, 0); combined.set(iv, salt.length); combined.set(new Uint8Array(ct), salt.length + iv.length);
        return btoa(String.fromCharCode(...combined));
      },
      decrypt: async (base64Cipher, passphrase) => {
        const raw = Uint8Array.from(atob(base64Cipher), c => c.charCodeAt(0));
        const salt = raw.slice(0, SALT_LEN);
        const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
        const ciphertext = raw.slice(SALT_LEN + IV_LEN);
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, keyMaterial, 256);
        const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
        return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
      }
    };
  })();
  const generateEncryptionKey = cryptoApi.generateEncryptionKey;
  const normalizeEncryptionKey = cryptoApi.normalizeEncryptionKey;
  const validateEncryptionKey = cryptoApi.validateEncryptionKey;
  const encrypt = cryptoApi.encrypt;
  const decrypt = cryptoApi.decrypt;

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
  const joinEncryptedCheck = document.getElementById('join-encrypted-checkbox');
  const joinEncRow = document.getElementById('join-encryption-row');
  const joinEncInput = document.getElementById('join-encryption-key-input');

  let session = { key: null, hostToken: null, role: 'idle', ws: null, encrypted: false, encryptionKey: null };
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

  function openShareModal(key, encrypted, encryptionKey){
    shareKeyEl.textContent = key;
    // Generate share link using current page's base path
    const currentUrl = new URL(location.href);
    const basePath = currentUrl.pathname.replace(/\/[^\/]*$/, '/'); // Remove filename, keep directory
    const link = encrypted ? `${currentUrl.origin}${basePath}?share=${encodeURIComponent(key)}&e=1` : `${currentUrl.origin}${basePath}?share=${encodeURIComponent(key)}`;
    shareLinkEl.value = link;
    const encKeyEl = document.getElementById('share-encryption-key');
    const encKeyRow = document.getElementById('share-encryption-row');
    if (encKeyRow) encKeyRow.style.display = encrypted ? 'block' : 'none';
    if (encKeyEl) encKeyEl.textContent = encryptionKey || '';
    const copyEncKeyBtn = document.getElementById('copy-encryption-key-btn');
    if (copyEncKeyBtn) copyEncKeyBtn.style.display = encrypted ? 'inline-block' : 'none';
    shareModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function closeShareModal(){
    shareModal.style.display = 'none';
    document.body.style.overflow = '';
    focusEditorSoon();
  }
  function openJoinModal(preset){
    joinModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    joinKeyInput.value = preset?.key ?? '';
    const encCheck = document.getElementById('join-encrypted-checkbox');
    const encRow = document.getElementById('join-encryption-row');
    const encInput = document.getElementById('join-encryption-key-input');
    if (encCheck && encRow) {
      encCheck.checked = !!preset?.encrypted;
      encRow.style.display = encCheck.checked ? 'block' : 'none';
    }
    if (encInput) encInput.value = '';
    setTimeout(() => ((preset?.encrypted && encInput) ? encInput : joinKeyInput)?.focus(), 0);
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

  async function sendStatePayload(payload) {
    if (!session.ws) return;
    if (session.encrypted && session.encryptionKey) {
      try {
        const plain = JSON.stringify(payload);
        const cipher = await encrypt(plain, session.encryptionKey);
        session.ws.send(JSON.stringify({ type: 'state', content: cipher, encrypted: true }));
      } catch (e) { console.warn('Encryption failed', e); }
    } else {
      try { session.ws.send(JSON.stringify(payload)); } catch {}
    }
  }

  function connectHost(key, hostToken){
    const url = api.wsUrl(key, 'host', hostToken);
    session.ws = new SafeWebSocket(url);
    session.ws.onopen = () => {
      setLiveIndicator(session.encrypted ? `LIVE (Host: ${key}) [Encrypted]` : `LIVE (Host: ${key})`, true);
      setButtonsForRole('host');
      // Send initial state immediately so viewers joining get current content and language
      const ed = getEditor();
      if (ed) {
        const content = ed.getValue();
        const selection = ed.getSelection();
        const language = ed.getModel().getLanguageId();
        version += 1;
        const payload = { type: 'state', content, selection: selection ? { start: selection.startColumn, end: selection.endColumn } : { start: 0, end: 0 }, language, version };
        sendStatePayload(payload);
      }
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

  async function applyStateMessage(msg) {
    let content = msg.content;
    let selection = msg.selection;
    let language = msg.language;
    let ver = msg.version;
    if (session.encrypted && session.encryptionKey) {
      try {
        const decrypted = JSON.parse(await decrypt(content, session.encryptionKey));
        content = decrypted.content;
        selection = decrypted.selection;
        language = decrypted.language;
        ver = decrypted.version;
      } catch (e) {
        console.warn('Decryption failed', e);
        return;
      }
    }
    const ed = getEditor();
    if (ed) {
      const current = ed.getValue();
      if (current !== content) {
        const pos = ed.getScrollTop();
        ed.setValue(content);
        ed.setScrollTop(pos);
      }
      if (language && ed.getModel().getLanguageId() !== language) {
        monaco.editor.setModelLanguage(ed.getModel(), language);
        const langSelect = document.getElementById('language-select');
        if (langSelect) langSelect.value = language;
      }
    }
    version = ver || version + 1;
  }

  function connectViewer(key){
    const url = api.wsUrl(key, 'viewer');
    session.ws = new SafeWebSocket(url);
    session.ws.onopen = () => {
      setLiveIndicator(session.encrypted ? `LIVE (Viewing: ${key}) [Encrypted]` : `LIVE (Viewing: ${key})`, true);
      disableEditing(true);
      setButtonsForRole('viewer');
      forceLayoutAndScrollTop();
      focusEditorSoon();
    };
    session.ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        await applyStateMessage(msg);
      }
      if (msg.type === 'ended') {
        setLiveIndicator('Session ended', true);
        setTimeout(() => setLiveIndicator('', false), 2000);
        disableEditing(false);
        if (session.ws) try { session.ws.close(); } catch {}
        session = { key: null, hostToken: null, role: 'idle', ws: null, encrypted: false, encryptionKey: null };
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
      sendStatePayload(payload);
    }, 60);
  }

  // Expose scheduleSend globally for app.js
  window.liveShareScheduleSend = scheduleSend;

  function startLiveShare(){
    if (session.role === 'viewer') { alert('Viewers cannot start a new live share.'); return; }
    api.start(/* optional turnstile token */).then(({ key, hostToken, viewerUrl }) => {
      session = { key, hostToken, role: 'host', ws: null, encrypted: false, encryptionKey: null };
      openShareModal(key, false);
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

  function startEncryptedLiveShare(){
    if (session.role === 'viewer') { alert('Viewers cannot start a new live share.'); return; }
    api.start(/* optional turnstile token */).then(({ key, hostToken, viewerUrl }) => {
      const encKey = generateEncryptionKey();
      session = { key, hostToken, role: 'host', ws: null, encrypted: true, encryptionKey: encKey };
      openShareModal(key, true, encKey);
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
      session = { key: null, hostToken: null, role: 'idle', ws: null, encrypted: false, encryptionKey: null };
      setLiveIndicator('', false);
      setButtonsForRole('idle');
      forceLayoutAndScrollTop();
      focusEditorSoon();
    });
  }

  async function applySnapshot(snap) {
    let content = snap.content;
    let language = snap.language;
    if (session.encrypted && session.encryptionKey && content) {
      try {
        const decrypted = JSON.parse(await decrypt(String(content), session.encryptionKey));
        content = decrypted.content;
        language = decrypted.language;
      } catch (e) {
        alert('Invalid encryption key or corrupted data.');
        session = { key: null, hostToken: null, role: 'idle', ws: null, encrypted: false, encryptionKey: null };
        setButtonsForRole('idle');
        return false;
      }
    }
    if (window.editor && typeof content === 'string') {
      window.editor.setValue(content);
      if (language && window.editor.getModel().getLanguageId() !== language) {
        monaco.editor.setModelLanguage(window.editor.getModel(), language);
        const langSelect = document.getElementById('language-select');
        if (langSelect) langSelect.value = language;
      }
    }
    return true;
  }

  function joinByKey(key, encryptionKey){
    const formatted = normalizeKey(key);
    if (!validateKey(formatted)) { alert('Invalid key. Use format ABC234 or ABC-234'); return; }
    const encKey = encryptionKey ? normalizeEncryptionKey(encryptionKey) : null;
    const isEncrypted = encKey && validateEncryptionKey(encKey);
    session = { key: formatted, hostToken: null, role: 'viewer', ws: null, encrypted: isEncrypted, encryptionKey: isEncrypted ? encKey : null };
    setButtonsForRole('viewer');
    api.snapshot(formatted).then(async (snap) => {
      if (!snap.active) {
        alert('Session not active');
        session = { key: null, hostToken: null, role: 'idle', ws: null, encrypted: false, encryptionKey: null };
        setButtonsForRole('idle');
        return;
      }
      const ok = await applySnapshot(snap);
      if (ok) connectViewer(formatted);
    }).catch(() => {
      alert('Failed to join session');
      session = { key: null, hostToken: null, role: 'idle', ws: null, encrypted: false, encryptionKey: null };
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
        <button type="button" data-action="show"><i class="fas fa-eye"></i> Show Live Share</button>
      `;
    } else if (session.role === 'viewer') {
      menu.innerHTML = `
        <button type="button" data-action="join"><i class="fas fa-link"></i> Join Session</button>
      `;
    } else {
      menu.innerHTML = `
        <button type="button" data-action="start"><i class="fas fa-play"></i> Start Live Share</button>
        <button type="button" data-action="start-encrypted"><i class="fas fa-lock"></i> Start Encrypted Live Share</button>
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
      if (action === 'start-encrypted') startEncryptedLiveShare();
      if (action === 'join') openJoinModal();
      if (action === 'stop') stopLiveShare();
      if (action === 'show') { openShareModal(session.key, session.encrypted, session.encryptionKey); }
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
  const copyEncKeyBtn = document.getElementById('copy-encryption-key-btn');
  if (copyEncKeyBtn) copyEncKeyBtn.addEventListener('click', () => {
    const encKey = document.getElementById('share-encryption-key')?.textContent;
    if (encKey) {
      navigator.clipboard.writeText(encKey).then(() => {
        copyEncKeyBtn.textContent = 'Copied!';
        setTimeout(() => (copyEncKeyBtn.textContent = 'Copy Encryption Key'), 1200);
      });
    }
  });
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeShareModal);
  if (joinCancelBtn) joinCancelBtn.addEventListener('click', closeJoinModal);
  if (joinConfirmBtn) joinConfirmBtn.addEventListener('click', () => {
    const k = joinKeyInput.value;
    const encChecked = document.getElementById('join-encrypted-checkbox')?.checked;
    const encK = document.getElementById('join-encryption-key-input')?.value?.trim() || '';
    if (encChecked && !validateEncryptionKey(encK)) {
      alert('Please enter the 6-character encryption key from the host.');
      return;
    }
    closeJoinModal();
    joinByKey(k, encChecked ? encK : undefined);
  });
  const submitJoin = () => { joinConfirmBtn?.click(); };
  joinKeyInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitJoin(); }});
  joinEncInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitJoin(); }});
  if (joinEncryptedCheck && joinEncRow) {
    joinEncryptedCheck.addEventListener('change', () => {
      joinEncRow.style.display = joinEncryptedCheck.checked ? 'block' : 'none';
    });
  }
  if (joinEncInput) {
    joinEncInput.addEventListener('input', () => {
      joinEncInput.value = joinEncInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
    });
  }
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

  // Auto-join if URL has ?share=KEY (or open join modal for encrypted ?share=KEY&e=1)
  // Encrypted links: show join modal immediately (checkbox + encryption key input)
  // Non-encrypted: defer until editor is ready so snapshot content can be applied
  const urlParams = new URLSearchParams(location.search);
  const initialKey = urlParams.get('share');
  const isEncryptedLink = urlParams.get('e') === '1';
  const normalizedInitial = normalizeKey(initialKey);
  if (validateKey(normalizedInitial)) {
    if (isEncryptedLink) {
      openJoinModal({ key: normalizedInitial, encrypted: true });
    } else {
      const doJoin = () => {
        joinByKey(normalizedInitial);
      };
      if (getEditor()) {
        doJoin();
      } else {
        let attempts = 0;
        const maxAttempts = 300; // ~5s at 60fps
        const checkEditor = () => {
          if (getEditor()) {
            doJoin();
            return;
          }
          if (++attempts < maxAttempts) {
            requestAnimationFrame(checkEditor);
          }
        };
        if (document.readyState === 'complete') {
          checkEditor();
        } else {
          window.addEventListener('load', () => setTimeout(checkEditor, 50));
        }
      }
    }
  }
})(); 