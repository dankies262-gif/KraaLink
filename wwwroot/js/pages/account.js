import {
  api, apiToast, loadConfig, loadMe, state, go, esc, icon, avatar, fmtDate, fmtDateTime, timeAgo,
  statusBadge, levelBadge, roleLabel, toast, openCamera, emptyState, pageHead, labelize,
  renderShell, refreshUnread, logout
} from '../core.js';

/* ================================================================== notifications */

function notificationLink(n) {
  let meta = {};
  try { meta = n.meta ? JSON.parse(n.meta) : {}; } catch { meta = {}; }
  const role = state.me?.role;
  if (meta.caseRef && role !== 'reviewer' && role !== 'admin') return '#/found-report/' + encodeURIComponent(meta.caseRef);
  if (meta.caseRef && (role === 'reviewer' || role === 'admin')) return '#/admin/found';
  if (meta.incidentId) return (role === 'reviewer' || role === 'admin') ? '#/admin/incidents' : '#/incidents';
  if (meta.claimId) return (role === 'reviewer' || role === 'admin') ? '#/admin/claims' : '#/found-reports';
  if (meta.transferId) return '#/transfers';
  if (meta.listingId) return (role === 'reviewer' || role === 'admin') ? '#/admin/listings' : '#/listings';
  if (meta.tagId) return (role === 'reviewer' || role === 'admin') ? '#/admin/tags' : '#/brands';
  if (meta.brandId) return (role === 'reviewer' || role === 'admin') ? '#/admin/brands' : '#/brands';
  if (meta.missingReportId) return '#/missing';
  if (meta.policeRequestId) return '#/admin/police';
  if (meta.workerId) return '#/workers/' + encodeURIComponent(meta.workerId);
  if (meta.href) return meta.href;
  return null;
}

export async function notifications() {
  const rows = await api('/me/notifications');
  const unread = rows.filter(n => !n.readAt).length;

  const item = n => {
    const link = notificationLink(n);
    const inner = `<div class="row between" style="align-items:flex-start">
      <div class="row" style="gap:12px;align-items:flex-start">
        <span class="avatar" aria-hidden="true">${icon(n.channel === 'whatsapp' ? 'bell' : 'doc')}</span>
        <div>
          <div class="title">${esc(n.title)}</div>
          <p class="small muted" style="margin:4px 0 0">${esc(n.body)}</p>
          <div class="tiny muted mt-1">${esc(labelize(n.channel))} · ${esc(labelize(n.language))} · ${timeAgo(n.createdAt)}</div>
        </div>
      </div>
      ${!n.readAt ? '<span class="badge badge-amber">Unread</span>' : ''}
    </div>`;
    return link
      ? `<a class="card tight notification${n.readAt ? '' : ' unread'}" href="${esc(link)}" data-notification="${esc(n.id)}" style="text-decoration:none;color:inherit">${inner}</a>`
      : `<div class="card tight notification${n.readAt ? '' : ' unread'}">${inner}</div>`;
  };

  const unreadList = rows.filter(n => !n.readAt).map(item).join('');
  const readList = rows.filter(n => n.readAt).map(item).join('');

  return {
    html: `${pageHead('Account', 'Notifications',
      'KraaLink sends the same message on WhatsApp and keeps a copy here. Private documents and ID numbers are never sent in a notification.',
      unread ? `<button class="btn btn-ghost" data-mark-all>${icon('check')} Mark all read</button>` : '')}

      ${unread.length ? `<h2 class="mb-2">Needs your attention</h2><div class="stack mb-3">${unreadList}</div>` : ''}
      <h2 class="mb-2">Earlier</h2>
      ${readList ? `<div class="stack">${readList}</div>` : (unread.length ? '' : emptyState({
        iconName: 'bell',
        title: 'No notifications yet',
        body: 'Consent requests, incident responses, matches and reviewer decisions appear here.',
        action: `<a class="btn btn-ghost" href="#/dashboard">Back to dashboard</a>`
      }))}`,
    after() {
      const markAll = document.querySelector('[data-mark-all]');
      markAll?.addEventListener('click', async () => {
        markAll.disabled = true;
        try {
          await api('/me/notifications/read', { method: 'POST', body: {} });
          await refreshUnread();
          renderShell();
          toast('All notifications marked read.', 'ok');
          go('/notifications');
        } catch (err) { apiToast(err); markAll.disabled = false; }
      });

      document.querySelectorAll('[data-notification]').forEach(link => {
        link.addEventListener('click', () => {
          api('/me/notifications/read', { method: 'POST', body: { id: link.dataset.notification } })
            .then(() => refreshUnread())
            .catch(() => {});
        });
      });
    }
  };
}

/* ================================================================== profile */

export async function profile() {
  const cfg = await loadConfig();
  const me = await loadMe(true);

  const worker = me.worker;
  const farmer = me.farmer;

  return {
    html: `${pageHead('Account', 'My profile',
      'Your phone number is your sign-in. KraaLink never uses a password.',
      `<button class="btn btn-ghost" data-signout>${icon('logout')} Sign out</button>`)}

    <div class="split">
      <div class="stack">
        <div class="card">
          <div class="row" style="gap:18px;align-items:flex-start">
            <span class="profile-face" data-profile-face>${me.faceUrl ? `<img src="${esc(me.faceUrl)}" alt="My face photo">` : avatar({ name: me.name }, 'avatar-xl')}</span>
            <div style="flex:1">
              <h3 style="margin-bottom:2px">${esc(me.name)}</h3>
              <div class="small muted">${esc(roleLabel(me.role))} · ${esc(me.phone)}</div>
              <div class="row mt-2">${me.faceUrl ? '<span class="badge badge-green">Face photo on file</span>' : '<span class="badge badge-amber">No face photo</span>'}
                ${worker ? levelBadge(worker.verificationLevel) : ''}</div>
              <div class="row mt-2">
                <button class="btn btn-sm btn-soft" data-retake-face>${icon('camera')} ${me.faceUrl ? 'Retake face photo' : 'Add face photo'}</button>
              </div>
              <p class="tiny muted mt-2 mb-0">Your face photo is stored privately. KraaLink does not create face templates or run automated face matching. Farmers see it only with your consent.</p>
            </div>
          </div>
        </div>

        ${worker ? `<div class="card">
          <div class="card-head"><div><h3>${icon('id')} WorkerLink Passport</h3><p class="card-sub">Your passport details.</p></div>
            <a class="btn btn-sm btn-ghost" href="#/passport">Open passport</a></div>
          <dl class="kv">
            <dt>Short code</dt><dd class="mono">${esc(worker.shortCode)}</dd>
            <dt>Verification</dt><dd>${esc(worker.levelLabel)}</dd>
            <dt>Record status</dt><dd>${esc(worker.recordStatus)}</dd>
            <dt>Home village</dt><dd>${esc(worker.homeVillage || '—')}</dd>
          </dl>
        </div>` : ''}

        ${farmer ? `<div class="card">
          <div class="card-head"><div><h3>${icon('pin')} Farm</h3><p class="card-sub">Shown on your listings and hiring checks.</p></div></div>
          <dl class="kv"><dt>Farm name</dt><dd>${esc(farmer.farmName || '—')}</dd><dt>Region</dt><dd>${esc(cfg.regions.find(r => r.code === farmer.regionCode)?.name || farmer.regionCode || '—')}</dd></dl>
        </div>` : ''}

        <form class="card" data-profile-form>
          <div class="card-head"><div><h3>${icon('gear')} Account details</h3><p class="card-sub">Used on your WhatsApp messages and in the portal.</p></div></div>
          <div class="form-grid">
            <div class="field span-2"><label for="p-name">Full name</label><input id="p-name" name="name" required minlength="3" value="${esc(me.name)}"></div>
            <div class="field"><label for="p-lang">Language</label><select id="p-lang" name="language">${cfg.languages.map(l => `<option value="${esc(l.code)}"${l.code === me.language ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Phone number</label><input value="${esc(me.phone)}" disabled><div class="hint">Contact support to change the number.</div></div>
          </div>
          <button class="btn btn-primary" type="submit">${icon('check')} Save changes</button>
        </form>
      </div>

      <div class="stack">
        <div class="card dark">
          <h3>Privacy in plain language</h3>
          <div class="stack-sm small" style="color:rgba(244,241,229,.82)">
            <div class="row">${icon('check')} Your phone number is never published.</div>
            <div class="row">${icon('check')} Hiring checks need your approval each time.</div>
            <div class="row">${icon('check')} You can revoke sharing while it is active.</div>
            <div class="row">${icon('check')} ID numbers are encrypted; ID photos are private.</div>
            <div class="row">${icon('check')} Every staff view of your record is logged.</div>
          </div>
        </div>
        <div class="card">
          <h3>${icon('shield')} Your rights</h3>
          <p class="small muted">You can ask what was shared, with whom and for what purpose. Your next-of-kin contacts are only contacted after the configured unreachable period, and a reviewer records why.</p>
          <a class="btn btn-ghost btn-block" href="#/notifications">${icon('bell')} Open notifications</a>
        </div>
      </div>
    </div>`,
    after() {
      document.querySelector('[data-signout]').addEventListener('click', logout);

      document.querySelector('[data-retake-face]').addEventListener('click', async () => {
        const shot = await openCamera({
          title: me.faceUrl ? 'Retake your face photo' : 'Add your face photo',
          guide: 'face',
          facing: 'user',
          hint: 'Centre your face in the oval, eyes open, good light.',
          confirmLabel: 'Save face photo'
        });
        if (!shot) return;
        try {
          const res = await api('/me/face', { method: 'PATCH', body: { faceImage: shot } });
          await loadMe(true);
          renderShell();
          const holder = document.querySelector('[data-profile-face]');
          if (holder) holder.innerHTML = `<img src="${esc(res.faceUrl)}" alt="My face photo">`;
          const retake = document.querySelector('[data-retake-face]');
          if (retake) retake.innerHTML = `${icon('camera')} Retake face photo`;
          toast('Face photo updated. The previous photo is kept for audit.', 'ok');
        } catch (err) { apiToast(err); }
      });

      const form = document.querySelector('[data-profile-form]');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await api('/me', { method: 'PATCH', body: { name: form.name.value.trim(), language: form.language.value } });
          await loadMe(true);
          renderShell();
          toast('Profile updated.', 'ok');
        } catch (err) {
          apiToast(err);
          btn.disabled = false; btn.innerHTML = `${icon('check')} Save changes`;
        }
      });
    }
  };
}

/* ================================================================== dashboard */

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function resolveRoute(key, label) {
  const role = state.me?.role;
  const byLabel = {
    'Active listings': '/listings',
    'Held listings': '/listings',
    'Ownership claims': '/found-reports',
    'Consent requests': '/consents',
    'Open jobs': '/jobs',
    'Employment records': '/jobs',
    'Incidents to answer': '/incidents',
    'Verification queue': '/admin/verification',
    'Claims to review': '/admin/claims',
    'Brand checks': '/admin/brands',
    'Incidents under review': '/admin/incidents',
    'Found reports': role === 'finder' ? '/my-reports' : '/found-reports',
    'Matches found': '/my-reports'
  };
  if (byLabel[label]) return byLabel[label];
  const map = {
    passport: '/passport',
    consents: '/consents',
    employment: '/jobs',
    incidents: '/incidents',
    marketplace: '/market',
    brand: '/brands',
    hiring: '/hiring',
    found: role === 'finder' ? '/my-reports' : role === 'farmer' ? '/found-reports' : '/report-found',
    workers: '/workers',
    'register-worker': '/register-worker',
    admin: '/admin'
  };
  return map[key] || '/dashboard';
}

function resolveActionRoute(route) {
  const role = state.me?.role;
  if (route === 'found') return role === 'finder' || role === 'farmer' ? '/report-found' : '/found';
  return resolveRoute(route, '');
}

function cardIcon(label) {
  const key = String(label || '').toLowerCase();
  if (key.includes('verification')) return 'shield';
  if (key.includes('record')) return 'id';
  if (key.includes('consent')) return 'shield';
  if (key.includes('incident')) return 'alert';
  if (key.includes('listing') || key.includes('market')) return 'market';
  if (key.includes('claim') || key.includes('brand')) return 'doc';
  if (key.includes('job') || key.includes('employment')) return 'clock';
  if (key.includes('worker')) return 'users';
  if (key.includes('found') || key.includes('match')) return 'search';
  return 'home';
}

export async function dashboard() {
  const d = await api('/dashboard');
  const me = state.me;

  const cards = d.cards.map(c => {
    const href = resolveRoute(c.route, c.label);
    return `<a class="card stat hover-card" href="#${esc(href)}" style="text-decoration:none;color:inherit">
      <div class="row between"><div class="stat-label">${esc(c.label)}</div><span class="stat-ico">${icon(cardIcon(c.label))}</span></div>
      <div class="stat-value">${esc(c.value)}</div>
      <div class="stat-hint">${esc(c.hint)}</div>
    </a>`;
  }).join('');

  const actions = d.actions.map(a => `<a class="card tight hover-card" href="#${esc(resolveActionRoute(a.route))}" style="text-decoration:none;color:inherit">
    <div class="row between"><div><div class="title">${esc(a.title)}</div><p class="small muted" style="margin:4px 0 0">${esc(a.body)}</p></div><span class="stat-ico">${icon('arrow')}</span></div>
  </a>`).join('');

  const activity = d.activity.map(n => {
    const link = notificationLink(n);
    const body = `<div class="row" style="gap:12px;align-items:flex-start">
      <span class="avatar" aria-hidden="true">${icon(n.channel === 'whatsapp' ? 'bell' : 'doc')}</span>
      <div><b class="small">${esc(n.title)}</b><p class="small muted" style="margin:3px 0 0">${esc(n.body)}</p>
        <div class="tiny muted mt-1">${timeAgo(n.createdAt)}${n.readAt ? '' : ' · unread'}</div></div>
    </div>`;
    return link
      ? `<a class="list-row" href="${esc(link)}" style="text-decoration:none;color:inherit">${body}</a>`
      : `<div class="list-row">${body}</div>`;
  }).join('');

  const hero = me.role === 'worker'
    ? `<div class="panel-dark dash-hero">
        <div>
          <div class="eyebrow" style="color:var(--orange)">Your WorkerLink Passport</div>
          <h2>${esc(me.name)}</h2>
          <p class="small" style="color:rgba(244,241,229,.8)">Short code <b class="mono" style="color:var(--orange)">${esc(me.worker?.shortCode || '—')}</b> · ${esc(me.worker?.levelLabel || '')}</p>
        </div>
        <div class="row">
          <a class="btn btn-orange btn-sm" href="#/passport">${icon('id')} Open passport</a>
          <a class="btn btn-ghost btn-sm" style="color:#f6f1e4;border-color:rgba(255,255,255,.3)" href="#/consents">${icon('shield')} Consent requests</a>
        </div>
      </div>`
    : me.role === 'farmer'
      ? `<div class="panel-dark dash-hero">
        <div>
          <div class="eyebrow" style="color:var(--orange)">${esc(me.farmer?.farmName || 'Your farm')}</div>
          <h2>${esc(me.name)}</h2>
          <p class="small" style="color:rgba(244,241,229,.8)">Hire with consent, sell with a verifiable tag register, and protect animals that go missing.</p>
        </div>
        <div class="row">
          <a class="btn btn-orange btn-sm" href="#/hiring">${icon('shield')} Hiring check</a>
          <a class="btn btn-ghost btn-sm" style="color:#f6f1e4;border-color:rgba(255,255,255,.3)" href="#/listings/new">${icon('plus')} List livestock</a>
        </div>
      </div>`
      : me.role === 'agent'
        ? `<div class="panel-dark dash-hero">
          <div><div class="eyebrow" style="color:var(--orange)">Field agent</div><h2>${esc(me.name)}</h2>
          <p class="small" style="color:rgba(244,241,229,.8)">Capture face and ID in person. A clean L1 record is the start of a passport a worker can trust.</p></div>
          <div class="row"><a class="btn btn-orange btn-sm" href="#/register-worker">${icon('id')} Register a worker</a></div>
        </div>`
        : me.role === 'finder'
          ? `<div class="panel-dark dash-hero">
            <div><div class="eyebrow" style="color:var(--orange)">Community</div><h2>${esc(me.name)}</h2>
            <p class="small" style="color:rgba(244,241,229,.8)">A brand or ear tag is enough to start a blind match. The owner is alerted without either side seeing the other’s details.</p></div>
            <div class="row"><a class="btn btn-orange btn-sm" href="#/report-found">${icon('search')} Report found livestock</a></div>
          </div>`
          : `<div class="panel-dark dash-hero">
            <div><div class="eyebrow" style="color:var(--orange)">Operations</div><h2>${esc(me.name)}</h2>
            <p class="small" style="color:rgba(244,241,229,.8)">Work the queues. Every decision is recorded, and every view of a private record is logged.</p></div>
            <div class="row"><a class="btn btn-orange btn-sm" href="#/admin">${icon('shield')} Open overview</a><a class="btn btn-ghost btn-sm" style="color:#f6f1e4;border-color:rgba(255,255,255,.3)" href="#/admin/outbox">${icon('bell')} WhatsApp outbox</a></div>
          </div>`;

  return {
    html: `${pageHead(greeting(), 'Dashboard', `Signed in as ${roleLabel(me.role)}${me.worker?.shortCode ? ` · ${me.worker.shortCode}` : ''}.`)}

      ${hero}

      <h2 class="mt-4 mb-2">At a glance</h2>
      <div class="grid cols-4">${cards}</div>

      ${actions ? `<h2 class="mt-4 mb-2">Next steps</h2><div class="grid cols-2">${actions}</div>` : ''}

      <div class="split mt-4">
        <div>
          <div class="row between mb-2"><h2>Recent activity</h2><a class="small" href="#/notifications">All notifications</a></div>
          ${activity ? `<div class="card tight" style="padding:0">${activity}</div>` : emptyState({
            iconName: 'bell',
            title: 'Nothing yet',
            body: 'Consent requests, matches and decisions will appear here.'
          })}
        </div>
        <div class="stack">
          <div class="card">
            <h3>${icon('shield')} Privacy by default</h3>
            <p class="small muted mb-0">Private documents open only through short-lived links. ID numbers are encrypted. Nobody can browse worker records — a worker must approve each hiring check.</p>
          </div>
          <div class="card">
            <h3>${icon('alert')} Notifiable disease</h3>
            <p class="small muted">If you suspect a notifiable disease: isolate the animals, do not move, sell or slaughter them, and contact the State Veterinary office.</p>
            <a class="btn btn-ghost btn-block" href="#/vet">${icon('vet')} Open VetBot</a>
          </div>
        </div>
      </div>`
  };
}
