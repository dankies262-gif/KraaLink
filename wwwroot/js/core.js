/* KraaLink web client — shared utilities, auth, router, chrome, camera. */

const TOKEN_KEY = 'kraalink.token';

export const state = {
  me: null,
  config: null,
  unread: 0,
  next: null,
  route: null
};

export class ApiError extends Error {
  constructor(message, status, title) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
  }
}

/* ------------------------------------------------------------------ api */

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, { method, headers, body: payload, signal });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) {
    let title = 'Request failed';
    let detail = 'Please try again.';
    if (type.includes('json')) {
      try {
        const data = await res.json();
        title = data.title || title;
        detail = data.detail || data.title || detail;
      } catch { /* keep defaults */ }
    }
    if (res.status === 401 && localStorage.getItem(TOKEN_KEY)) clearSession(false);
    throw new ApiError(detail, res.status, title);
  }
  if (type.includes('application/json')) return res.json();
  return res;
}

export async function apiBlob(path) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch('/api' + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {}
  });
  if (!res.ok) throw new ApiError('That file could not be opened.', res.status, 'File unavailable');
  return res.blob();
}

export async function blobUrl(path) {
  return URL.createObjectURL(await apiBlob(path));
}

/* ------------------------------------------------------------------ session */

export function token() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(nextToken, user) {
  localStorage.setItem(TOKEN_KEY, nextToken);
  state.me = user || null;
}

export function clearSession(notify = true) {
  localStorage.removeItem(TOKEN_KEY);
  state.me = null;
  state.unread = 0;
  if (notify) renderShell();
}

export function logout() {
  clearSession();
  go('/');
  toast('You are signed out.', 'ok');
}

export async function loadMe(force = false) {
  if (!token()) { state.me = null; return null; }
  if (state.me && !force) return state.me;
  try {
    state.me = await api('/me');
    return state.me;
  } catch {
    state.me = null;
    return null;
  }
}

export async function loadConfig() {
  if (!state.config) state.config = await api('/config');
  return state.config;
}

export function isStaff(user = state.me) {
  return !!user && ['agent', 'verifier', 'reviewer', 'admin'].includes(user.role);
}

export function isReviewer(user = state.me) {
  return !!user && ['reviewer', 'admin'].includes(user.role);
}

export async function refreshUnread() {
  if (!state.me) { state.unread = 0; return; }
  try {
    const rows = await api('/me/notifications');
    state.unread = rows.filter(n => !n.readAt).length;
  } catch { /* the badge is non-critical */ }
}

/* ------------------------------------------------------------------ html helpers */

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function avatar(person = {}, cls = '') {
  const name = person.name || person.fullName || person.workerName || '';
  const url = person.faceUrl || person.photoUrl || person.url;
  if (url) return `<span class="avatar ${cls}"><img src="${esc(url)}" alt="${esc(name)}"></span>`;
  return `<span class="avatar ${cls}" aria-hidden="true">${esc(initials(name))}</span>`;
}

export function labelize(value) {
  if (!value) return '';
  return String(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

const BADGE_TONES = {
  green: ['active', 'approved', 'granted', 'verified', 'open', 'confirmed', 'live', 'cleared', 'match_found', 'handover_arranged', 'accepted', 'ok', 'l2'],
  amber: ['pending', 'pending_checkin', 'pending_checkout', 'pending_buyer', 'pending_seller', 'under_review', 'worker_responded', 'held', 'missing', 'claim_pending', 'expired', 'rejected', 'l1'],
  red: ['stolen', 'suspended_police', 'denied', 'revoked', 'disputed', 'removed', 'conflict', 'sold'],
  blue: ['logged', 'claim_approved', 'verified_warning', 'dismissed'],
  grey: ['retired', 'closed', 'cancelled', 'draft']
};

export function badgeTone(status) {
  const key = String(status || '').toLowerCase();
  for (const [tone, list] of Object.entries(BADGE_TONES)) if (list.includes(key)) return tone;
  return 'grey';
}

export function statusBadge(status, label) {
  if (!status) return '';
  return `<span class="badge badge-${badgeTone(status)}">${esc(label || labelize(status))}</span>`;
}

export function levelBadge(level) {
  const n = Number(level);
  const tone = n >= 2 ? 'green' : n === 1 ? 'amber' : 'grey';
  const label = n >= 2 ? 'L2 · Community verified' : n === 1 ? 'L1 · Documented' : 'L0 · Self-declared';
  return `<span class="badge badge-${tone}">${esc(label)}</span>`;
}

export function money(value) {
  const n = Number(value || 0);
  return 'N$ ' + n.toLocaleString('en-ZA', { maximumFractionDigits: n % 1 ? 2 : 0 });
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins + ' min ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hours / 24);
  if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
  return fmtDate(value);
}

export function roleLabel(role) {
  return ({
    worker: 'Worker',
    farmer: 'Farmer',
    finder: 'Community member',
    agent: 'Field agent',
    verifier: 'Verifier',
    reviewer: 'Reviewer',
    admin: 'Administrator'
  })[role] || labelize(role);
}

export function emptyState({ iconName = 'doc', title, body, action = '' }) {
  return `<div class="empty">${icon(iconName)}<h3>${esc(title)}</h3><p>${esc(body || '')}</p>${action}</div>`;
}

export function pageHead(eyebrow, title, lead, actions = '') {
  return `<div class="page-head">
    <div>
      ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
      <h1>${esc(title)}</h1>
      ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
    </div>
    ${actions ? `<div class="row">${actions}</div>` : ''}
  </div>`;
}

export function field(label, input, hint = '') {
  return `<div class="field"><label>${esc(label)}</label>${input}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}

export function skeleton() {
  return `<div class="page-loading"><span class="spinner"></span></div>`;
}

/* ------------------------------------------------------------------ toast */

export function toast(message, tone = 'ok', timeout = 4200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (tone === 'error' ? 'err' : tone);
  const glyph = tone === 'error' ? 'alert' : tone === 'warn' ? 'alert' : 'check';
  el.innerHTML = `${icon(glyph)}<div>${esc(message)}</div>`;
  root.appendChild(el);
  const remove = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  };
  setTimeout(remove, timeout);
  el.addEventListener('click', remove);
}

export function apiToast(err) {
  toast(err instanceof Error ? err.message : String(err), 'error', 6000);
}

/* ------------------------------------------------------------------ modal */

export function modal({ title, sub = '', body = '', footer = '', wide = false, narrow = false, onClose }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}${narrow ? ' narrow' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head">
      <div><h3>${esc(title)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      <button type="button" class="modal-close" data-close aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  root.appendChild(wrap);
  const card = wrap.querySelector('.modal');
  let closed = false;

  function close(result) {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose(result);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  wrap.addEventListener('click', e => {
    if (e.target === wrap) close();
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  const first = card.querySelector('input, select, textarea, button:not(.modal-close)');
  if (first) setTimeout(() => first.focus(), 60);
  return { el: card, wrap, close, setBody: html => { card.querySelector('.modal-body').innerHTML = html; } };
}

export function confirmDialog({ title = 'Please confirm', message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const m = modal({
      title,
      narrow: true,
      body: `<p style="margin:0;color:var(--ink-soft)">${esc(message)}</p>`,
      footer: `<button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
               <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(confirmLabel)}</button>`,
      onClose: result => resolve(result === true)
    });
    m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close(false));
    m.wrap.querySelector('[data-confirm]').addEventListener('click', () => m.close(true));
  });
}

/* ------------------------------------------------------------------ camera */

const CAMERA_ERROR_TEXT = {
  NotAllowedError: 'Camera permission was denied. You can still upload a photo from this phone.',
  NotFoundError: 'No camera was found on this device. Upload a photo instead.',
  NotReadableError: 'The camera is busy in another app. Close it and try again, or upload a photo.',
  OverconstrainedError: 'This camera could not be opened. Try switching camera or upload a photo.'
};

export function openCamera({
  title = 'Take a photo',
  sub = 'The photo is stored privately and never shown publicly.',
  guide = 'face',
  facing = 'user',
  hint = '',
  confirmLabel = 'Use this photo'
} = {}) {
  return new Promise(resolve => {
    const body = `<div class="camera-shell" data-stage>
        <video autoplay playsinline muted data-video></video>
        <div class="camera-guide">${guide === 'face' ? '<div class="oval"></div>' : '<div class="rect"></div>'}</div>
        <div class="camera-hint" data-hint>${esc(hint || (guide === 'face' ? 'Centre the face inside the oval, eyes open, good light.' : 'Lay the document flat and fill the frame.'))}</div>
      </div>
      <div class="camera-status" data-status>Starting camera…</div>
      <div class="camera-controls" data-controls>
        <button type="button" class="btn btn-primary" data-shoot disabled>${icon('camera')} Capture photo</button>
        <button type="button" class="btn btn-ghost" data-switch>Switch camera</button>
        <button type="button" class="btn btn-soft" data-upload>Upload instead</button>
      </div>
      <input type="file" accept="image/*" ${guide === 'face' ? 'capture="user"' : 'capture="environment"'} data-file hidden>
      <div class="shot-preview" data-preview hidden><img alt="Captured photo preview" data-shot></div>
      <div class="camera-controls" data-review hidden>
        <button type="button" class="btn btn-ghost" data-retake>Retake</button>
        <button type="button" class="btn btn-orange" data-accept>${esc(confirmLabel)}</button>
      </div>`;

    let stream = null;
    let dataUrl = null;
    let accepted = false;
    let currentFacing = facing;
    const m = modal({
      title: title,
      sub: sub,
      body: body,
      wide: true,
      onClose: () => {
        stop();
        resolve(accepted ? dataUrl : null);
      }
    });

    const video = m.wrap.querySelector('[data-video]');
    const status = m.wrap.querySelector('[data-status]');
    const shootBtn = m.wrap.querySelector('[data-shoot]');
    const preview = m.wrap.querySelector('[data-preview]');
    const shotImg = m.wrap.querySelector('[data-shot]');
    const review = m.wrap.querySelector('[data-review]');
    const stage = m.wrap.querySelector('[data-stage]');
    const controls = m.wrap.querySelector('[data-controls]');
    const file = m.wrap.querySelector('[data-file]');

    function stop() {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      video.srcObject = null;
    }

    async function start(nextFacing = currentFacing) {
      stop();
      dataUrl = null;
      stage.hidden = false;
      preview.hidden = true;
      review.hidden = true;
      controls.hidden = false;
      shootBtn.disabled = true;
      status.textContent = 'Starting camera…';
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 960 } }
        });
        video.srcObject = stream;
        await video.play().catch(() => {});
        shootBtn.disabled = false;
        status.textContent = 'Camera ready. Fill the frame and capture.';
        m.wrap.querySelector('[data-switch]').hidden = false;
      } catch (err) {
        status.innerHTML = esc(CAMERA_ERROR_TEXT[err.name] || 'The camera could not be opened. Upload a photo instead.');
        m.wrap.querySelector('[data-switch]').hidden = true;
      }
    }

    function capture() {
      if (!video.videoWidth) { status.textContent = 'The camera is not ready yet.'; return; }
      const max = 1280;
      const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (currentFacing === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/jpeg', 0.87);
      shotImg.src = dataUrl;
      stop();
      stage.hidden = true;
      preview.hidden = false;
      controls.hidden = true;
      review.hidden = false;
      status.textContent = 'Check the photo. Retake if it is blurred or the face is not clear.';
    }

    function readFile(f) {
      if (!f) return;
      if (!f.type.startsWith('image/')) { status.textContent = 'Choose an image file.'; return; }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 1280;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/jpeg', 0.87);
          shotImg.src = dataUrl;
          stop();
          stage.hidden = true;
          preview.hidden = false;
          controls.hidden = true;
          review.hidden = false;
          status.textContent = 'Photo loaded. Use it or choose another.';
        };
        img.onerror = () => { status.textContent = 'That image could not be read.'; };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    }

    shootBtn.addEventListener('click', capture);
    m.wrap.querySelector('[data-switch]').addEventListener('click', () => {
      currentFacing = currentFacing === 'user' ? 'environment' : 'user';
      start(currentFacing);
    });
    m.wrap.querySelector('[data-upload]').addEventListener('click', () => file.click());
    file.addEventListener('change', () => readFile(file.files?.[0]));
    m.wrap.querySelector('[data-retake]').addEventListener('click', () => {
      file.value = '';
      accepted = false;
      start();
    });
    m.wrap.querySelector('[data-accept]').addEventListener('click', () => {
      accepted = true;
      m.close();
    });

    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'This browser cannot open the camera. Upload a photo instead.';
      shootBtn.disabled = true;
      m.wrap.querySelector('[data-switch]').hidden = true;
    } else {
      start();
    }
  });
}

/* ------------------------------------------------------------------ router */

const routes = [];

export function route(pattern, handler, options = {}) {
  routes.push({ segments: pattern.split('/').filter(Boolean), handler, ...options });
}

function matchRoute(path) {
  const segments = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.segments.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.segments.length; i++) {
      const part = r.segments[i];
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[i]);
      else if (part !== segments[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

export function currentPath() {
  return (location.hash.replace(/^#/, '') || '/').split('?')[0];
}

export function go(path, replace = false) {
  const hash = '#' + path;
  if (location.hash === hash) { render(); return; }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) render();
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}

async function render() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString));
  state.route = path;
  closeSidebar();

  const found = matchRoute(path);
  const view = document.getElementById('view');

  if (!found) {
    document.title = 'Not found · KraaLink';
    renderShell();
    view.innerHTML = `<div class="page">${emptyState({
      iconName: 'alert',
      title: 'That page does not exist',
      body: 'The link may be old or mistyped. Start again from the home page.',
      action: `<a class="btn btn-primary" href="#/">Go home</a>`
    })}</div>`;
    return;
  }

  const { route: r, params } = found;
  if (r.roles) {
    await loadMe();
    if (!state.me) {
      state.next = path + (queryString ? '?' + queryString : '');
      toast('Sign in to continue.', 'warn');
      location.hash = '#/login';
      return;
    }
    if (!r.roles.includes(state.me.role)) {
      toast('That section is not available for your account.', 'error');
      location.hash = '#/dashboard';
      return;
    }
  }

  renderShell();
  view.innerHTML = skeleton();
  try {
    const result = await r.handler({ params, query, path });
    if (result && typeof result === 'object' && 'html' in result) {
      view.innerHTML = `<div class="page">${result.html}</div>`;
      if (result.after) result.after();
    } else if (typeof result === 'string') {
      view.innerHTML = `<div class="page">${result}</div>`;
    }
    if (r.title) document.title = (typeof r.title === 'function' ? r.title({ params, query }) : r.title) + ' · KraaLink';
    view.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="page">${emptyState({
      iconName: 'alert',
      title: err instanceof ApiError && err.status === 403 ? 'You do not have access' : 'Something went wrong',
      body: err instanceof Error ? err.message : 'Please try again.',
      action: `<a class="btn btn-ghost" href="#/dashboard">Back to dashboard</a>`
    })}</div>`;
  }
}

/* ------------------------------------------------------------------ chrome */

const PUBLIC_NAV = [
  { href: '/market', label: 'Livestock market' },
  { href: '/produce', label: 'Farm produce' },
  { href: '/vet', label: 'VetBot' },
  { href: '/found', label: 'Found livestock' }
];

function displayRole(user) {
  return user?.roleTitle || roleLabel(user?.role);
}

function navGroups(me) {
  if (!me) return [];
  const groups = [{
    label: 'Your workspace',
    links: [{ path: '/dashboard', label: 'Dashboard', icon: 'home' }]
  }];
  if (me.role === 'worker') {
    groups.push({
      label: 'WorkerLink Passport',
      links: [
        { path: '/passport', label: 'My passport', icon: 'id' },
        { path: '/consents', label: 'Consent requests', icon: 'shield', badgeKey: 'pendingConsents' },
        { path: '/jobs', label: 'Jobs & check-outs', icon: 'clock' },
        { path: '/incidents', label: 'Incidents', icon: 'alert' }
      ]
    });
  }
  if (me.role === 'farmer') {
    groups.push({
      label: 'Hiring & work',
      links: [
        { path: '/hiring', label: 'Hiring checks', icon: 'shield' },
        { path: '/jobs', label: 'Employment records', icon: 'users' },
        { path: '/incidents', label: 'Incidents', icon: 'alert' }
      ]
    }, {
      label: 'Marketplace',
      links: [
        { path: '/market', label: 'Buy livestock', icon: 'market' },
        { path: '/produce', label: 'Buy farm produce', icon: 'tag' },
        { path: '/listings', label: 'My listings', icon: 'doc' },
        { path: '/price-board', label: 'Price board', icon: 'search' }
      ]
    }, {
      label: 'Brand & trade tracker',
      links: [
        { path: '/brands', label: 'Brands & ear tags', icon: 'tag' },
        { path: '/missing', label: 'Missing animals', icon: 'pin' },
        { path: '/found-reports', label: 'Found & claims', icon: 'search', badgeKey: 'claims' },
        { path: '/transfers', label: 'Transfers', icon: 'arrow' }
      ]
    }, {
      label: 'Livestock health',
      links: [
        { path: '/herds', label: 'Herds & vaccinations', icon: 'vet' },
        { path: '/vet', label: 'VetBot triage', icon: 'check' }
      ]
    });
  }
  if (me.role === 'finder') {
    groups.push({
      label: 'Marketplace',
      links: [
        { path: '/market', label: 'Buy livestock', icon: 'market' },
        { path: '/produce', label: 'Buy farm produce', icon: 'tag' },
        { path: '/price-board', label: 'Price board', icon: 'search' }
      ]
    }, {
      label: 'Found livestock',
      links: [
        { path: '/report-found', label: 'Report a found animal', icon: 'search' },
        { path: '/my-reports', label: 'My reports', icon: 'doc' }
      ]
    });
  }
  if (me.role === 'agent') {
    groups.push({
      label: 'Field work',
      links: [
        { path: '/register-worker', label: 'Register a worker', icon: 'id' },
        { path: '/workers', label: 'Worker register', icon: 'users' }
      ]
    });
  }
  if (me.role === 'verifier') {
    groups.push({
      label: 'Verification',
      links: [
        { path: '/admin/verification', label: 'Verification queue', icon: 'shield' },
        { path: '/workers', label: 'Worker register', icon: 'users' }
      ]
    });
  }
  if (isReviewer(me)) {
    groups.push({
      label: 'Review & oversight',
      links: [
        { path: '/admin', label: 'Overview', icon: 'home' },
        { path: '/admin/verification', label: 'Verification', icon: 'shield' },
        { path: '/admin/brands', label: 'Brands', icon: 'tag' },
        { path: '/admin/claims', label: 'Ownership claims', icon: 'doc' },
        { path: '/admin/incidents', label: 'Incidents', icon: 'alert' },
        { path: '/admin/listings', label: 'Held listings', icon: 'market' },
        { path: '/admin/found', label: 'Found reports', icon: 'search' },
        { path: '/admin/tags', label: 'Tag conflicts', icon: 'qr' },
        { path: '/admin/police', label: 'Police requests', icon: 'users' },
        { path: '/admin/vet', label: 'Vet content', icon: 'vet' },
        { path: '/admin/outbox', label: 'WhatsApp outbox', icon: 'bell' },
        { path: '/admin/users', label: 'People', icon: 'users' }
      ]
    }, {
      label: 'Governance',
      links: [
        { path: '/admin/settings', label: 'Rules & settings', icon: 'gear' },
        { path: '/admin/audit', label: 'Audit log', icon: 'doc' },
        { path: '/admin/access', label: 'Access log', icon: 'shield' }
      ]
    });
    if (me.role !== 'admin') {
      groups[groups.length - 1].links = groups[groups.length - 1].links.filter(l => l.path !== '/admin/audit' && l.path !== '/admin/settings');
    }
  }
  groups.push({
    label: 'Account',
    links: [
      { path: '/notifications', label: 'Notifications', icon: 'bell', badgeKey: 'unread' },
      { path: '/profile', label: 'My profile', icon: 'id' }
    ]
  });
  return groups;
}

const COLLAPSE_KEY = 'kraalink.navCollapsed';

function collapsedGroups() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch { return new Set(); }
}

function saveCollapsed(set) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch { /* storage is optional */ }
}

export function renderShell() {
  const me = state.me;
  const shell = document.querySelector('.shell');
  const sidebar = document.getElementById('sidebar');
  const sidebarNav = document.getElementById('sidebar-nav');
  const backdrop = document.getElementById('sidebar-backdrop');
  const topnav = document.getElementById('topnav');
  const account = document.getElementById('account');
  const path = currentPath();

  document.body.dataset.route = path;
  document.body.classList.toggle('is-home', path === '/');

  const publicActive = href => path === href || (href !== '/' && path.startsWith(href + '/'));
  topnav.innerHTML = PUBLIC_NAV.map(link =>
    `<a href="#${link.href}" class="${publicActive(link.href) ? 'active' : ''}">${esc(link.label)}</a>`
  ).join('');

  if (!me) {
    shell.classList.add('no-sidebar');
    sidebar.hidden = true;
    sidebar.classList.remove('open');
    sidebarNav.innerHTML = '';
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('nav-open');
    account.innerHTML = `<a class="btn btn-ghost btn-sm" href="#/login">Sign in</a>
      <a class="btn btn-primary btn-sm" href="#/signup">Create account</a>`;
    return;
  }

  shell.classList.remove('no-sidebar');
  sidebar.hidden = false;

  const collapsed = collapsedGroups();
  const groups = navGroups(me);
  const activeGroup = groups.find(g => g.links.some(link => {
    if (link.path === '/admin') return path === '/admin';
    return path === link.path || path.startsWith(link.path + '/');
  }));

  const groupsHtml = groups.map(group => {
    const isCollapsed = collapsed.has(group.label) && group !== activeGroup;
    return `<div class="nav-section${isCollapsed ? ' collapsed' : ''}" data-group="${esc(group.label)}">
      <button type="button" class="nav-group-btn" data-nav-group="${esc(group.label)}" aria-expanded="${String(!isCollapsed)}">
        <span>${esc(group.label)}</span>${icon('chevron')}
      </button>
      <div class="nav-links">
        ${group.links.map(link => {
          const active = link.path === '/admin'
            ? path === '/admin'
            : path === link.path || path.startsWith(link.path + '/');
          const count = link.badgeKey === 'unread' ? state.unread : 0;
          return `<a class="nav-link${active ? ' active' : ''}" href="#${link.path}">
            ${icon(link.icon)}<span>${esc(link.label)}</span>
            ${count > 0 ? `<span class="nav-badge">${count > 9 ? '9+' : count}</span>` : ''}
          </a>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  sidebarNav.innerHTML = `${groupsHtml}
    <div class="nav-foot">
      Signed in as <b>${esc(me.name || '')}</b><br>${esc(displayRole(me))}${me.worker?.shortCode ? ` · ${esc(me.worker.shortCode)}` : ''}
      <button type="button" class="sidebar-signout" id="signout">${icon('logout')} Sign out</button>
    </div>`;

  sidebarNav.querySelectorAll('[data-nav-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.nav-section');
      const isNowCollapsed = section.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', String(!isNowCollapsed));
      const set = collapsedGroups();
      if (isNowCollapsed) set.add(section.dataset.group); else set.delete(section.dataset.group);
      saveCollapsed(set);
    });
  });

  const activeLink = sidebarNav.querySelector('.nav-link.active');
  if (activeLink) {
    const navRect = sidebarNav.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    if (linkRect.top < navRect.top || linkRect.bottom > navRect.bottom) {
      sidebarNav.scrollTop += linkRect.top - navRect.top - sidebarNav.clientHeight / 2;
    }
  }

  account.innerHTML = `<a class="account-chip" href="#/profile" title="Open profile">
      ${avatar({ name: me.name, faceUrl: me.faceUrl || '' })}
      <span class="account-name"><b>${esc(me.name || '')}</b><small>${esc(displayRole(me))}</small></span>
    </a>`;

  sidebarNav.querySelector('#signout').addEventListener('click', logout);
  account.querySelector('a').addEventListener('click', closeSidebar);
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menu-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('nav-open');
}

export function wireChrome() {
  const toggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const closeBtn = document.getElementById('sidebar-close');

  function openSidebar() {
    sidebar.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add('nav-open');
  }

  toggle.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  });
  closeBtn?.addEventListener('click', closeSidebar);
  backdrop?.addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) closeSidebar();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });
  sidebar?.addEventListener('click', e => {
    if (e.target.closest('.nav-link, .sidebar-signout')) closeSidebar();
  });
}

/* ------------------------------------------------------------------ misc */

export function param(name) {
  return new URLSearchParams(location.hash.split('?')[1] || '').get(name) || '';
}

export function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
}

export function copyText(text, message = 'Copied.') {
  navigator.clipboard?.writeText(text).then(
    () => toast(message, 'ok'),
    () => toast('Copy failed — select the text manually.', 'warn')
  );
}

const SPEECH_LANGS = { en: 'en-ZA', osh: 'en-ZA', her: 'en-ZA', af: 'af-ZA', pt: 'pt-PT' };

export function readAloud(text, language = 'en') {
  if (!('speechSynthesis' in window)) {
    toast('This browser cannot read the consent aloud. Read it with the worker instead.', 'warn');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANGS[language] || 'en-ZA';
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
  toast('Reading the consent aloud.', 'ok');
}

export function sortByDate(items, key = 'createdAt') {
  return [...items].sort((a, b) => new Date(b[key] || 0) - new Date(a[key] || 0));
}
