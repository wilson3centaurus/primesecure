'use strict';
(() => {
  const C = window.RK_CONFIG;
  const $ = (id) => document.getElementById(id);
  const TTL = C.ttlSeconds || 30;
  const IDLE_PAUSE_MS = 5 * 60 * 1000; // stop minting codes after 5 min without a touch
  const CIRC = 2 * Math.PI * 54;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const s = {
    token: null, expiresAt: 0, refresh: null, userId: null, email: '',
    role: null, schools: [], school: null,
    code: null, codeExpires: 0, legacy: false,
    busy: false, lastTouch: Date.now(), paused: false, timer: null,
  };

  // ---- API -------------------------------------------------------------
  async function api(path, opts) {
    const o = opts || {};
    const headers = { apikey: C.anonKey, 'Content-Type': 'application/json' };
    headers.Authorization = 'Bearer ' + (o.auth === false ? C.anonKey : await accessToken());
    const res = await fetch(C.url + path, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { res, data };
  }

  function takeSession(d) {
    s.token = d.access_token;
    s.expiresAt = Date.now() + (d.expires_in || 3600) * 1000;
    s.refresh = d.refresh_token;
    if (d.user) { s.userId = d.user.id; s.email = d.user.email || s.email; }
    if (store.get('rk_keep') === '1') store.set('rk_refresh', s.refresh);
  }

  async function accessToken() {
    if (s.token && Date.now() < s.expiresAt - 60000) return s.token;
    if (!s.refresh) throw new Error('signed-out');
    const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: s.refresh } });
    if (!r.res.ok) { signOut(); throw new Error('signed-out'); }
    takeSession(r.data);
    return s.token;
  }

  async function signIn(email, password, keep) {
    const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
    if (!r.res.ok) {
      const bad = r.res.status === 400 || r.res.status === 401;
      throw new Error(bad ? 'Wrong email or password.' : 'Could not reach the server. Check your connection and try again.');
    }
    if (keep) store.set('rk_keep', '1'); else { store.del('rk_keep'); store.del('rk_refresh'); }
    takeSession(r.data);
  }

  function signOut() {
    stopTimer();
    s.token = null; s.expiresAt = 0; s.refresh = null; s.userId = null; s.role = null;
    s.school = null; s.schools = []; s.code = null;
    store.del('rk_refresh'); store.del('rk_keep');
    show('login');
    $('password').value = '';
  }

  // ---- Profile / school --------------------------------------------------
  async function loadAccess() {
    const p = await api('/rest/v1/profiles?select=role,school_id&id=eq.' + encodeURIComponent(s.userId));
    const prof = Array.isArray(p.data) ? p.data[0] : null;
    if (!prof) return blocked('No access', 'This account is not a staff account. Sign in with your admin dashboard login.');
    if (prof.role !== 'school_admin' && prof.role !== 'super_admin')
      return blocked('Administrators only', 'Only school administrators can issue PrimeBook setup codes.');
    s.role = prof.role;
    const sc = await api('/rest/v1/schools?select=id,name&order=name');
    s.schools = Array.isArray(sc.data) ? sc.data : [];
    const pinned = prof.role === 'school_admin' ? s.schools.find((x) => x.id === prof.school_id) : null;
    const remembered = s.schools.find((x) => x.id === store.get('rk_school'));
    s.school = pinned || remembered || (s.schools.length === 1 ? s.schools[0] : null);
    if (!s.school && !s.schools.length) return blocked('No school found', 'This account is not linked to a school yet.');
    if (!s.school) return showSchools();
    startCodes();
  }

  function blocked(title, msg) {
    stopTimer();
    $('blocked-title').textContent = title;
    $('blocked-msg').textContent = msg;
    show('blocked');
  }

  function showSchools() {
    const ul = $('school-list');
    ul.replaceChildren();
    s.schools.forEach((sc) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'row'; b.textContent = sc.name;
      b.addEventListener('click', () => { s.school = sc; store.set('rk_school', sc.id); startCodes(); });
      li.append(b); ul.append(li);
    });
    show('schools');
  }

  // ---- Codes -------------------------------------------------------------
  async function issue() {
    if (s.busy) return;
    s.busy = true;
    try {
      await accessToken(); // refresh first so the sent-time below excludes token refresh latency
      const sentAt = Date.now();
      let r = await api('/rest/v1/rpc/staff_issue_school_setup_code', { method: 'POST', body: { p_school: s.school.id, p_ttl_seconds: TTL } });
      if (!r.res.ok && ((r.data && r.data.code === 'PGRST202') || r.res.status === 404)) {
        // Server migration not applied yet: older function, 15-minute codes.
        s.legacy = true;
        r = await api('/rest/v1/rpc/staff_issue_school_setup_code', { method: 'POST', body: { p_school: s.school.id } });
      } else if (r.res.ok) s.legacy = false;
      if (!r.res.ok || !r.data || !r.data.code) {
        const m = (r.data && r.data.message) || '';
        if (r.res.status === 403 || /administrator access/i.test(m)) return blocked('Administrators only', 'This account cannot issue setup codes for this school.');
        throw new Error(m || 'Server error ' + r.res.status);
      }
      s.code = String(r.data.code);
      // The server minted the code after we sent the request, so sent-time + TTL is
      // never later than its real expiry (no clock-skew guesswork, errs on the safe side).
      s.codeExpires = sentAt + TTL * 1000;
      $('status').textContent = s.school.name;
      $('warn').hidden = !s.legacy;
      if (s.legacy) $('warn').textContent = 'Server update pending: codes still stay valid on the server for 15 minutes. Apply the setup-code migration to enforce 30 seconds.';
      render();
    } catch (e) {
      if (e.message === 'signed-out') return;
      $('status').textContent = navigator.onLine ? 'Could not get a code. Retrying…' : 'Offline. Reconnect to get a code.';
      s.code = null; s.codeExpires = 0; render();
    } finally { s.busy = false; }
  }

  function remainingMs() { return s.code ? Math.max(0, s.codeExpires - Date.now()) : 0; }

  function render() {
    const ms = remainingMs();
    $('code').textContent = s.code ? s.code.slice(0, 3) + ' ' + s.code.slice(3) : '······';
    $('secs').textContent = s.code ? Math.ceil(ms / 1000) + 's' : '—';
    const frac = s.code ? Math.min(1, ms / (TTL * 1000)) : 0;
    const arc = $('arc');
    arc.setAttribute('stroke-dasharray', String(CIRC));
    arc.setAttribute('stroke-dashoffset', String(CIRC * (1 - frac)));
    $('code-btn').classList.toggle('low', !!s.code && ms <= 8000);
  }

  function tick() {
    if (document.hidden || s.paused) return;
    if (Date.now() - s.lastTouch > IDLE_PAUSE_MS) { pause(); return; }
    render();
    if (!s.busy && remainingMs() <= 0) issue();
  }

  function pause() {
    s.paused = true; s.code = null; render();
    $('status').textContent = 'Paused to keep setup codes private.';
    $('resume').hidden = false;
  }
  function resume() { s.paused = false; s.lastTouch = Date.now(); $('resume').hidden = true; $('status').textContent = 'Getting code…'; issue(); }

  function startCodes() {
    $('school-name').textContent = s.school.name;
    $('user-email').textContent = s.email;
    $('switch-school').hidden = !(s.role === 'super_admin' && s.schools.length > 1);
    s.code = null; s.paused = false; s.lastTouch = Date.now(); $('resume').hidden = true;
    show('code'); render(); issue();
    stopTimer(); s.timer = setInterval(tick, 250);
  }
  function stopTimer() { if (s.timer) { clearInterval(s.timer); s.timer = null; } }

  // ---- UI helpers ----------------------------------------------------------
  function show(name) {
    ['login', 'code', 'schools', 'blocked'].forEach((v) => { $('view-' + v).hidden = v !== name; });
    $('menu').hidden = true;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1600);
  }
  const touch = () => { s.lastTouch = Date.now(); };
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login-btn'), err = $('login-error');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await signIn($('email').value.trim(), $('password').value, $('keep').checked);
      await loadAccess();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });
  $('code-btn').addEventListener('click', async () => {
    if (!s.code) return;
    try { await navigator.clipboard.writeText(s.code); toast('Code copied'); } catch (e) { toast('Select the code to copy'); }
  });
  $('resume').addEventListener('click', resume);
  $('menu-btn').addEventListener('click', () => {
    const m = $('menu'); m.hidden = !m.hidden; $('menu-btn').setAttribute('aria-expanded', String(!m.hidden));
  });
  $('signout').addEventListener('click', signOut);
  $('blocked-out').addEventListener('click', signOut);
  $('switch-school').addEventListener('click', () => { stopTimer(); showSchools(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && s.token && !s.paused && !$('view-code').hidden) { s.lastTouch = Date.now(); if (remainingMs() <= 0) issue(); }
  });
  window.addEventListener('online', () => { if (!$('view-code').hidden && !s.paused) issue(); });

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('install-btn').hidden = false; });
  $('install-btn').addEventListener('click', () => { if (!installEvt) return; installEvt.prompt(); installEvt = null; $('install-btn').hidden = true; $('menu').hidden = true; });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---- Boot ------------------------------------------------------------------
  (async () => {
    const saved = store.get('rk_refresh');
    if (store.get('rk_keep') === '1' && saved) {
      s.refresh = saved;
      try {
        const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: saved } });
        if (r.res.ok) { takeSession(r.data); await loadAccess(); return; }
      } catch (e) { /* fall through to login */ }
      store.del('rk_refresh'); s.refresh = null;
    }
    show('login');
  })();
})();
