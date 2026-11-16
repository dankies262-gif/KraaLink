import {
  api, apiToast, blobUrl, state, go, esc, icon, avatar, money, fmtDate, fmtDateTime, timeAgo,
  statusBadge, levelBadge, toast, modal, confirmDialog, emptyState, labelize, pageHead, copyText
} from '../core.js';

function payloadText(raw) {
  if (!raw) return '';
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${labelize(k)}: ${v}`)
      .join(' · ');
  } catch {
    return String(raw);
  }
}

function passportCardHtml(me, qrUrl) {
  const w = me.worker || {};
  return `<div class="passport-card">
    <div class="passport-top">
      <div class="passport-brand">Kraa<span>Link</span> · WorkerLink Passport</div>
      <span class="badge badge-${Number(w.verificationLevel) >= 2 ? 'green' : 'amber'}">${esc(w.levelLabel || '')}</span>
    </div>
    <div class="passport-body">
      <div class="passport-face">${me.faceUrl ? `<img src="${esc(me.faceUrl)}" alt="Face photo of ${esc(me.name)}">` : `<div class="initial">${esc((me.name || '?')[0])}</div>`}</div>
      <div class="passport-info">
        <h3>${esc(me.name)}</h3>
        <div class="meta">${esc(w.homeVillage || 'Village not recorded')}${w.regionCode ? ' · ' + esc(w.regionCode) : ''}</div>
        <div class="passport-code">${esc(w.shortCode || '—')}</div>
        <div class="tiny" style="color:rgba(244,241,229,.6);margin-top:2px">Worker short code</div>
        <div class="row" style="margin-top:12px">
          <span class="pill on-cream">${icon('shield')} ${esc(w.recordStatus || 'No employment record')}</span>
        </div>
      </div>
      <div class="passport-qr">${qrUrl ? `<img src="${esc(qrUrl)}" alt="QR code for short code ${esc(w.shortCode)}">` : ''}</div>
    </div>
    <div class="passport-foot">
      <span>Scan to check · the worker must approve every view</span>
      <span class="mono">${esc(me.phone || '')}</span>
    </div>
  </div>`;
}

export async function passport() {
  const me = await api('/me');
  if (me.role !== 'worker' || !me.worker) {
    return `${pageHead('WorkerLink Passport', 'No worker passport on this account', 'This account is not registered as a worker.')}
      ${emptyState({ iconName: 'id', title: 'Nothing to show yet', body: 'A worker passport is created when a worker signs up or is registered by a field agent.', action: `<a class="btn btn-primary" href="#/dashboard">Back to dashboard</a>` })}`;
  }
  const worker = await api('/workers/' + encodeURIComponent(me.id));
  const qrUrl = await blobUrl(`/workers/${encodeURIComponent(me.id)}/qrcard`);

  const html = `${pageHead('WorkerLink Passport', 'Your passport, your decision', 'Farmers can only see this after you approve a hiring check. Your ID number, documents and next-of-kin stay private.',
    `<a class="btn btn-ghost" href="#/passport/card">${icon('qr')} Printable card</a>
     <a class="btn btn-primary" href="#/profile">${icon('camera')} Update face photo</a>`)}

    <div class="split">
      <div class="stack">
        ${passportCardHtml(me, qrUrl)}
        <div class="grid cols-3">
          <div class="card stat"><div class="stat-label">Verification</div><div class="stat-value">L${Number(worker.verificationLevel)}</div><div class="stat-hint">${esc(worker.levelLabel)}</div></div>
          <div class="card stat"><div class="stat-label">Record status</div><div class="stat-value" style="font-size:1.15rem;line-height:1.3;margin-top:14px">${esc(worker.recordStatus)}</div><div class="stat-hint">Shown to farmers with consent</div></div>
          <div class="card stat"><div class="stat-label">Consent window</div><div class="stat-value">24h</div><div class="stat-hint">Approval expires automatically</div></div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>${icon('clock')} Verification history</h3><p class="card-sub">How your passport reached its current level.</p></div></div>
          <div class="timeline">
            ${worker.verificationHistory.map(v => `<div class="timeline-item">
              <div class="when">${fmtDateTime(v.createdAt)}</div>
              <b>L${v.level} · ${esc(v.levelLabel)}</b>
              <p>${esc(v.method || '')}${v.by ? ' · ' + esc(v.by) : ''}${v.note ? ' — ' + esc(v.note) : ''}</p>
            </div>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>${icon('users')} Last employers</h3><p class="card-sub">Only the last three are included in a hiring check.</p></div><a class="link-arrow" href="#/jobs">All jobs ${icon('arrow')}</a></div>
          ${worker.employments?.length ? `<div class="list">${worker.employments.map(e => `<div class="list-row">
            <div class="grow"><div class="title">${esc(e.jobTitle || 'Farm work')}</div><div class="sub">${fmtDate(e.startedAt || e.createdAt)}${e.endLabel ? ' · ' + esc(e.endLabel) : ''}</div></div>
            ${statusBadge(e.status)}
          </div>`).join('')}</div>` : `<p class="small muted mb-0">No employment records yet. A farmer records a check-in, then you confirm it.</p>`}
        </div>
      </div>

      <div class="stack">
        <div class="qr-panel">
          <img src="${qrUrl}" alt="Your WorkerLink QR code">
          <div class="tiny muted">Scan to open the check page</div>
          <div class="row center" style="justify-content:center;margin-top:8px">
            <button type="button" class="btn btn-sm btn-ghost" data-copy-code>Copy code ${esc(worker.shortCode)}</button>
            <a class="btn btn-sm btn-soft" href="#/passport/card">Print card</a>
          </div>
        </div>
        <div class="card">
          <h3>Your controls</h3>
          <div class="stack-sm small" style="margin-top:8px">
            <div class="row">${icon('check')} Approve a check for 24 hours</div>
            <div class="row">${icon('check')} Revoke sharing at any time</div>
            <div class="row">${icon('check')} Deny without giving a reason</div>
            <div class="row">${icon('check')} Answer an incident before any decision</div>
          </div>
          <div class="notice mt-2">${icon('shield')} A hiring check never includes your ID number, ID document, face photo file or next-of-kin contacts.</div>
        </div>
        <div class="card">
          <h3>Next of kin</h3>
          <p class="card-sub">Contacted only after 48 hours unreachable during an open job.</p>
          <div class="stack-sm mt-1">
            ${worker.kin.map(k => `<div class="list-row" style="padding:8px 0"><div class="grow"><div class="title" style="font-size:.86rem">${esc(k.name)}</div><div class="sub">${esc(k.relationship || '')}${k.village ? ' · ' + esc(k.village) : ''}</div></div></div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;

  return {
    html,
    after() {
      document.querySelector('[data-copy-code]')?.addEventListener('click', () => copyText(worker.shortCode, 'Short code copied.'));
    }
  };
}

export async function passportCard() {
  const me = await api('/me');
  if (!me.worker) { go('/passport'); return ''; }
  const qrUrl = await blobUrl(`/workers/${encodeURIComponent(me.id)}/qrcard`);
  return {
    html: `<div class="no-print" style="max-width:760px;margin:0 auto 20px">
      ${pageHead('Printable card', 'WorkerLink card', 'Print, fold and keep this with you. Anyone who scans the code must still ask your permission before seeing anything.',
        `<button type="button" class="btn btn-primary" data-print>Print card</button>
         <a class="btn btn-ghost" href="#/passport">Back to passport</a>`)}
    </div>
    <div style="max-width:620px;margin:0 auto">
      <div class="passport-card">
        <div class="passport-top"><div class="passport-brand">Kraa<span>Link</span> · WorkerLink Passport</div><span class="badge badge-${Number(me.worker.verificationLevel) >= 2 ? 'green' : 'amber'}">${esc(me.worker.levelLabel)}</span></div>
        <div class="passport-body">
          <div class="passport-face">${me.faceUrl ? `<img src="${esc(me.faceUrl)}" alt="Face photo of ${esc(me.name)}">` : `<div class="initial">${esc((me.name || '?')[0])}</div>`}</div>
          <div class="passport-info">
            <h3>${esc(me.name)}</h3>
            <div class="meta">${esc(me.worker.homeVillage || '')}</div>
            <div class="passport-code">${esc(me.worker.shortCode || '')}</div>
            <div class="tiny" style="color:rgba(244,241,229,.65)">Keep this code safe. It is not a password.</div>
          </div>
          <div class="passport-qr"><img src="${qrUrl}" alt="QR code"></div>
        </div>
        <div class="passport-foot"><span>Scan to request a consented check</span><span class="mono">${esc(me.phone)}</span></div>
      </div>
      <p class="tiny muted center mt-2 no-print">Tip: in the print dialog choose “Save as PDF” to keep a copy on your phone.</p>
    </div>`,
    after() {
      document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
    }
  };
}

/* ------------------------------------------------------------------ consents */

export async function consents() {
  const rows = await api('/consents/mine');
  const pending = rows.filter(c => c.mayApprove);

  const html = `${pageHead('WorkerLink Passport', 'Consent requests', 'Only you decide who sees your passport. Approvals last 24 hours. Denying or revoking never needs a reason.',
    `<a class="btn btn-ghost" href="#/passport">${icon('id')} My passport</a>`)}

    ${pending.length ? `<div class="notice warn mb-3">${icon('bell')} <span><b>${pending.length} request${pending.length === 1 ? '' : 's'}</b> waiting for your decision. The farmer sees nothing until you approve.</span></div>` : ''}

    ${rows.length ? `<div class="stack">${rows.map(c => `<div class="card">
      <div class="card-head">
        <div class="row" style="align-items:flex-start;gap:14px">
          ${avatar({ name: c.farmerName }, 'avatar-lg')}
          <div><h3 style="margin-bottom:2px">${esc(c.farmerName || 'A farmer')}</h3>
            <div class="card-sub">${esc(c.farmName || 'Farm')}</div>
            <div class="row mt-1">${statusBadge(c.status)} ${c.mayApprove ? '<span class="badge badge-amber">Your decision needed</span>' : ''}</div>
          </div>
        </div>
        <div class="tiny muted">${timeAgo(c.requestedAt)}</div>
      </div>
      <dl class="kv">
        <dt>Purpose</dt><dd>${esc(c.purpose || 'Pre-employment hiring check')}</dd>
        <dt>Requested</dt><dd>${fmtDateTime(c.requestedAt)}</dd>
        <dt>Window</dt><dd>${c.windowHours || 24} hours after approval</dd>
        ${c.expiresAt ? `<dt>Expires</dt><dd>${c.status === 'granted' ? fmtDateTime(c.expiresAt) : '—'}</dd>` : ''}
      </dl>
      <div class="notice mt-2">${icon('shield')} If you approve, they see your photo, name, village, verification level, last three employers and record status. Nothing else.</div>
      <div class="row mt-2">
        ${c.mayApprove ? `<button class="btn btn-primary" data-approve="${esc(c.id)}">${icon('check')} Approve for ${c.windowHours || 24}h</button>
          <button class="btn btn-ghost" data-deny="${esc(c.id)}">Decline</button>` : ''}
        ${c.status === 'granted' ? `<button class="btn btn-danger" data-revoke="${esc(c.id)}">Revoke sharing now</button>` : ''}
        <span class="tiny muted">${c.status === 'granted' ? 'Shared only for the approved fields.' : c.status === 'pending' ? 'No data is visible while pending.' : 'No record data is available.'}</span>
      </div>
    </div>`).join('')}</div>` : emptyState({
      iconName: 'shield',
      title: 'No consent requests yet',
      body: 'When a farmer runs a hiring check with your short code, the request appears here and on WhatsApp.',
      action: `<a class="btn btn-ghost" href="#/passport">See my passport</a>`
    })}`;

  return {
    html,
    after() {
      const act = async (id, path, body, message) => {
        try {
          await api(`/consents/${encodeURIComponent(id)}/${path}`, { method: 'POST', body });
          toast(message, 'ok');
          go('/consents');
        } catch (err) { apiToast(err); }
      };
      document.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => act(b.dataset.approve, 'respond', { approve: true }, 'Approved for 24 hours. The farmer has been notified.')));
      document.querySelectorAll('[data-deny]').forEach(b => b.addEventListener('click', () => act(b.dataset.deny, 'respond', { approve: false }, 'Request declined. No data was shared.')));
      document.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
        if (await confirmDialog({ title: 'Revoke sharing?', message: 'The farmer loses access immediately. Past employment facts remain under the retention schedule.', confirmLabel: 'Revoke', danger: true }))
          act(b.dataset.revoke, 'revoke', {}, 'Sharing revoked.');
      }));
    }
  };
}

/* ------------------------------------------------------------------ jobs */

export async function jobs() {
  const rows = await api('/employments/mine');
  const open = rows.filter(e => ['open', 'pending_checkin', 'pending_checkout', 'disputed'].includes(e.status));
  const past = rows.filter(e => !open.includes(e));

  const row = e => `<div class="card tight">
    <div class="row between">
      <div class="row" style="gap:14px">
        ${avatar({ name: e.counterpart || e.farmName }, 'avatar-lg')}
        <div>
          <h3 style="margin-bottom:2px"><a href="#/jobs/${esc(e.id)}" style="color:inherit">${esc(e.jobTitle || 'Farm work')}</a></h3>
          <div class="card-sub">${state.me.role === 'worker' ? (e.farmName || e.counterpart || 'Farmer') : (e.counterpart || 'Worker')}${e.shortCode && state.me.role !== 'worker' ? ' · ' + esc(e.shortCode) : ''}</div>
          <div class="row mt-1">${statusBadge(e.status)} ${e.noCheckout ? '<span class="badge badge-grey">No check-out recorded</span>' : ''}</div>
        </div>
      </div>
      <div class="end" style="text-align:right">
        <div class="tiny muted">${e.startedAt ? 'Started ' + fmtDate(e.startedAt) : 'Created ' + fmtDate(e.createdAt)}</div>
        ${e.wagesPaid === true ? '<span class="badge badge-green plain">Wages paid</span>' : e.wagesPaid === false ? '<span class="badge badge-amber plain">Wages not paid</span>' : ''}
        <div class="mt-1"><a class="btn btn-sm btn-ghost" href="#/jobs/${esc(e.id)}">Open</a></div>
      </div>
    </div>
  </div>`;

  return {
    html: `${pageHead(state.me.role === 'worker' ? 'Jobs' : 'Employment', 'Employment records',
      'A check-in is recorded by the farmer and confirmed by the worker. Both sides confirm a check-out. If none is recorded, the record says “No check-out recorded” — never that the worker disappeared.',
      state.me.role === 'farmer' ? `<a class="btn btn-primary" href="#/hiring">${icon('shield')} New check-in by code</a>` : '')}
      ${state.me.role === 'farmer' ? `<div class="notice mb-3">${icon('id')} To start a new employment, run a hiring check and record a check-in with the worker's short code. <a href="#/hiring">Go to hiring checks</a>.</div>` : ''}
      ${open.length ? `<h2 class="mb-2">Open</h2><div class="stack">${open.map(row).join('')}</div>` : ''}
      ${past.length ? `<h2 class="mb-2 mt-3">Past records</h2><div class="stack">${past.map(row).join('')}</div>` : ''}
      ${!rows.length ? emptyState({
        iconName: 'users',
        title: 'No employment records',
        body: state.me.role === 'worker' ? 'A farmer records a check-in and asks you to confirm. Only then does the job appear in your history.' : 'Run a hiring check with a worker code, then record a check-in.',
        action: state.me.role === 'farmer' ? `<a class="btn btn-primary" href="#/hiring">Start a hiring check</a>` : ''
      }) : ''}`,
    after() { }
  };
}

export async function jobDetail({ params }) {
  const emp = await api('/employments/' + encodeURIComponent(params.id));
  const isWorker = state.me.id === emp.workerId;
  const events = (emp.events || []).map(e => `<div class="timeline-item">
      <div class="when">${fmtDateTime(e.createdAt)}</div>
      <b>${esc(labelize(e.type))}</b>
      ${e.actor ? `<div class="tiny muted">by ${esc(e.actor)}</div>` : ''}
      ${payloadText(e.payload) ? `<p>${esc(payloadText(e.payload))}</p>` : ''}
    </div>`).join('');

  const actions = [];
  if (isWorker && emp.status === 'pending_checkin') {
    actions.push(`<button class="btn btn-primary" data-action="confirm-checkin">${icon('check')} Confirm check-in</button>`);
  }
  if (emp.status === 'open') {
    actions.push(`<button class="btn btn-primary" data-action="checkout">${icon('clock')} Record check-out</button>`);
    if (!isWorker) actions.push(`<button class="btn btn-ghost" data-action="report-left">Report that the job ended</button>`);
  }
  if (emp.status === 'pending_checkout') {
    actions.push(`<button class="btn btn-primary" data-action="respond-checkout">${icon('check')} Respond to check-out</button>`);
  }
  if (emp.noCheckout && isWorker) actions.push(`<button class="btn btn-ghost" data-action="no-checkout-response">Add my side</button>`);
  if (!isWorker && emp.canRequestKin) actions.push(`<button class="btn btn-danger" data-action="kin">${icon('alert')} Request next-of-kin contact</button>`);

  const html = `${pageHead(isWorker ? 'Job record' : 'Employment record', emp.jobTitle || 'Farm work',
    `${isWorker ? esc(emp.farmerName || 'Farmer') : esc(emp.workerName || 'Worker')}${emp.farmName ? ' · ' + esc(emp.farmName) : ''}`,
    `<a class="btn btn-ghost" href="#/jobs">All records</a>`)}

    <div class="split">
      <div class="stack">
        ${emp.noCheckout ? `<div class="notice warn">${icon('alert')} <span><b>No check-out recorded.</b> This record is neutral: it does not say the worker disappeared or did anything wrong. ${isWorker ? 'You can add your own account below.' : ''}</span></div>` : ''}
        <div class="card">
          <div class="card-head"><div><h3>Summary</h3><p class="card-sub">Record ${esc(emp.id)}</p></div>${statusBadge(emp.status)}</div>
          <dl class="kv">
            <dt>Worker</dt><dd>${esc(emp.workerName || '')}${emp.shortCode ? ` · <span class="mono">${esc(emp.shortCode)}</span>` : ''}</dd>
            <dt>Farmer</dt><dd>${esc(emp.farmerName || '')}</dd>
            <dt>Farm</dt><dd>${esc(emp.farmName || '—')}</dd>
            <dt>Recorded</dt><dd>${fmtDateTime(emp.createdAt)}</dd>
            <dt>Started</dt><dd>${fmtDateTime(emp.startedAt)}</dd>
            <dt>Ended</dt><dd>${fmtDateTime(emp.endedAt)}</dd>
            <dt>End reason</dt><dd>${esc(emp.endLabel || (emp.noCheckout ? 'No check-out recorded' : '—'))}</dd>
            <dt>Wages</dt><dd>${emp.wagesPaid === true ? 'Reported paid' : emp.wagesPaid === false ? 'Reported not paid' : 'Not recorded'}</dd>
          </dl>
          <div class="row mt-2">${actions.join('')}</div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>${icon('clock')} Record history</h3><p class="card-sub">Every step is kept. Nothing is deleted.</p></div></div>
          <div class="timeline">${events || '<p class="small muted mb-0">No events yet.</p>'}</div>
        </div>

        ${emp.incidents?.length ? `<div class="card">
          <div class="card-head"><div><h3>${icon('alert')} Linked incidents</h3></div></div>
          <div class="list">${emp.incidents.map(i => `<div class="list-row"><div class="grow"><div class="title">${esc(i.description || 'Incident')}</div><div class="sub">${fmtDate(i.createdAt)}</div></div>${statusBadge(i.status)}<a class="btn btn-xs btn-ghost" href="#/incidents/${esc(i.id)}">Open</a></div>`).join('')}</div>
        </div>` : ''}
      </div>

      <div class="stack">
        <div class="card">
          <h3>How this record started</h3>
          <p class="small muted">${isWorker ? 'The farmer recorded a check-in with your short code. It only became a job after you confirmed.' : 'You recorded a check-in and the worker confirmed it. Both parties must confirm a check-out.'}</p>
          ${emp.workerUnreachableHours >= 48 && !isWorker ? `<div class="notice warn">${icon('alert')} Worker last active ${emp.workerUnreachableHours} hours ago. Next-of-kin contact may be justified — this is logged.</div>` : ''}
          ${!isWorker && emp.kinRequestCount ? `<p class="tiny muted">Next-of-kin requests on this record: ${emp.kinRequestCount}</p>` : ''}
        </div>
        <div class="card dark">
          <h3>Neutral wording</h3>
          <p class="muted small mb-0">If a check-out is not recorded, KraaLink adds “No check-out recorded”. It does not label the worker as absent, missing or dishonest. The worker may add their side at any time.</p>
        </div>
      </div>
    </div>`;

  return {
    html,
    after() {
      const act = async (path, body, message) => {
        try {
          await api(`/employments/${encodeURIComponent(emp.id)}/${path}`, { method: 'POST', body });
          toast(message, 'ok');
          go('/jobs/' + emp.id);
        } catch (err) { apiToast(err); }
      };
      document.querySelector('[data-action="confirm-checkin"]')?.addEventListener('click', () => act('confirm-checkin', {}, 'Check-in confirmed. The job is now open.'));
      document.querySelector('[data-action="report-left"]')?.addEventListener('click', async () => {
        if (await confirmDialog({ title: 'Report the job ended?', message: 'This adds a neutral note — not an accusation. If no check-out is recorded, the system will add “No check-out recorded” after the configured period.', confirmLabel: 'Report job ended' }))
          act('report-left', {}, 'Recorded. The worker has been notified.');
      });
      document.querySelector('[data-action="checkout"]')?.addEventListener('click', () => openCheckout(emp, act));
      document.querySelector('[data-action="respond-checkout"]')?.addEventListener('click', () => openCheckoutResponse(emp, act));
      document.querySelector('[data-action="kin"]')?.addEventListener('click', () => openKinRequest(emp, act));
      document.querySelector('[data-action="no-checkout-response"]')?.addEventListener('click', () => openNoCheckoutResponse(act));
    }
  };
}

function openCheckout(emp, act) {
  const m = modal({
    title: 'Record a check-out',
    sub: 'Both parties confirm before the record closes.',
    body: `<form data-checkout>
      <div class="field"><label for="co-reason">Why is the job ending?</label>
        <select id="co-reason" name="reason">
          <option value="contract_ended">Contract ended</option>
          <option value="resigned">Worker resigned</option>
          <option value="dismissed">Worker dismissed</option>
          <option value="other">Other</option>
        </select></div>
      <label class="check group"><input type="checkbox" name="wagesPaid" checked><span>Wages have been paid in full</span></label>
      <div class="notice mt-2">${icon('shield')} The other party must confirm. If they disagree, the record becomes disputed — it is not closed.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Send check-out</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const form = m.wrap.querySelector('[data-checkout]');
    await act('checkout', { reason: form.reason.value, wagesPaid: form.wagesPaid.checked }, 'Check-out sent for confirmation.');
    m.close();
  });
}

function openCheckoutResponse(emp, act) {
  const m = modal({
    title: 'Confirm the check-out?',
    sub: 'Only the other party can confirm this record.',
    body: `<p class="small">If the details are correct, the employment closes. If you disagree — for example about unpaid wages — choose <b>Disagree</b> and the record becomes disputed.</p>
      <div class="notice warn">${icon('alert')} Choosing “Disagree” does not close the record. A reviewer can see both sides.</div>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-danger" data-disagree>Disagree</button>
      <button class="btn btn-primary" data-confirm>Confirm check-out</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-confirm]').addEventListener('click', async () => { await act('checkout/respond', { confirm: true }, 'Check-out confirmed. Employment closed.'); m.close(); });
  m.wrap.querySelector('[data-disagree]').addEventListener('click', async () => { await act('checkout/respond', { confirm: false }, 'Record marked disputed. A reviewer can see both sides.'); m.close(); });
}

function openKinRequest(emp, act) {
  const m = modal({
    title: 'Request next-of-kin contact',
    sub: 'Only when the worker has been unreachable for 48 hours.',
    body: `<p class="small">The worker's next-of-kin contacts are private. This request is only available because the employment is open and the worker has not been active for at least 48 hours.</p>
      <div class="field"><label for="kin-reason">Why do you need to contact them?</label>
      <textarea id="kin-reason" placeholder="e.g. The worker has not returned to the farm for three days and I am worried for their safety."></textarea></div>
      <div class="notice danger">${icon('alert')} This reveal is logged against your name and the time. The next of kin must be told why you are calling.</div>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-danger" data-send>Reveal and log</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    try {
      const res = await api(`/employments/${encodeURIComponent(emp.id)}/next-of-kin-requests`, {
        method: 'POST',
        body: { reason: m.wrap.querySelector('#kin-reason').value.trim() || undefined }
      });
      m.close();
      const list = modal({
        title: 'Next-of-kin contacts',
        sub: res.note,
        body: `<div class="stack-sm">${res.kin.map(k => `<div class="card tight"><b>${esc(k.name)}</b><div class="small muted">${esc(k.relationship || '')}${k.village ? ' · ' + esc(k.village) : ''}</div><a href="tel:${esc(k.phone)}">${esc(k.phone)}</a></div>`).join('')}</div>`,
        footer: `<button class="btn btn-primary" data-close>I understand</button>`
      });
      list.wrap.querySelector('[data-close]').addEventListener('click', () => list.close());
    } catch (err) { apiToast(err); }
  });
}

function openNoCheckoutResponse(act) {
  const m = modal({
    title: 'Add your side',
    sub: 'Your account is kept with the record.',
    body: `<form data-no-checkout><div class="field"><label for="ncr">What happened at the end of this job?</label>
      <textarea id="ncr" required placeholder="e.g. I told the farmer on 12 May that I was leaving and returned the keys."></textarea></div></form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Save my side</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const text = m.wrap.querySelector('#ncr').value.trim();
    if (!text) { toast('Write your response first.', 'warn'); return; }
    await act('no-checkout-response', { response: text }, 'Your response was added to the record.');
    m.close();
  });
}

/* ------------------------------------------------------------------ incidents */

export async function incidents() {
  const rows = await api('/incidents/mine');
  const open = rows.filter(i => ['under_review', 'worker_responded'].includes(i.status));
  return `${pageHead('Incidents', state.me.role === 'worker' ? 'Your right to respond' : 'Incidents you filed',
    state.me.role === 'worker'
      ? 'A farmer may file an incident. You always get a chance to answer before a reviewer decides. Without evidence, other farmers do not see it.'
      : 'Incidents are private unless evidence is attached and the worker was notified. A reviewer sees both sides.',
    `<a class="btn btn-ghost" href="#/jobs">${icon('users')} Employment records</a>`)}

    ${open.length ? `<h2 class="mb-2">Open</h2><div class="stack">${open.map(incidentRow).join('')}</div>` : ''}
    ${rows.filter(i => !open.includes(i)).length ? `<h2 class="mb-2 mt-3">Decided</h2><div class="stack">${rows.filter(i => !open.includes(i)).map(incidentRow).join('')}</div>` : ''}
    ${!rows.length ? emptyState({
      iconName: 'alert',
      title: 'No incidents',
      body: state.me.role === 'worker' ? 'Nothing has been filed against you. If one is, you will be notified and can respond.' : 'File an incident from an employment record if something goes wrong.',
      action: `<a class="btn btn-ghost" href="#/jobs">Open employment records</a>`
    }) : ''}`;
}

function incidentRow(i) {
  const who = state.me.role === 'worker' ? (i.reporterName || 'Farmer') : (i.workerName || 'Worker');
  return `<div class="card tight">
    <div class="row between">
      <div class="grow">
        <div class="row mb-1">${statusBadge(i.status)} ${i.evidenceCount ? `<span class="badge badge-grey plain">${i.evidenceCount} evidence file${i.evidenceCount === 1 ? '' : 's'}</span>` : '<span class="badge badge-grey plain">No evidence attached</span>'}</div>
        <div class="title">${esc(i.description || 'Incident record')}</div>
        <div class="small muted">${esc(who)} · filed ${fmtDate(i.createdAt)}${i.valueNad ? ' · ' + money(i.valueNad) : ''}</div>
      </div>
      <a class="btn btn-sm btn-ghost" href="#/incidents/${esc(i.id)}">Open</a>
    </div>
  </div>`;
}

export async function incidentDetail({ params }) {
  const inc = await api('/incidents/' + encodeURIComponent(params.id));
  const isWorker = state.me.id === inc.workerId;
  return {
    html: `${pageHead('Incident', 'Incident record',
      `${esc(inc.workerName || '')}${inc.shortCode ? ' · ' + esc(inc.shortCode) : ''} · filed ${fmtDateTime(inc.createdAt)}`,
      `<a class="btn btn-ghost" href="#/incidents">Back</a>`)}

      <div class="split">
        <div class="stack">
          <div class="card">
            <div class="card-head"><div><h3>What was reported</h3><p class="card-sub">By ${esc(inc.reporterName || 'the farmer')} on ${fmtDate(inc.createdAt)}</p></div>${statusBadge(inc.status)}</div>
            <p style="white-space:pre-wrap">${esc(inc.description || 'This incident is not visible to you.')}</p>
            <dl class="kv mt-2">
              <dt>Occurred on</dt><dd>${esc(inc.occurredOn || '—')}</dd>
              <dt>Value claimed</dt><dd>${inc.valueNad ? money(inc.valueNad) : 'Not stated'}</dd>
              <dt>Police case</dt><dd>${esc(inc.policeCaseNo || '—')}</dd>
              <dt>Response due</dt><dd>${fmtDateTime(inc.responseDueAt)}</dd>
            </dl>
          </div>

          ${inc.evidenceUrls?.length ? `<div class="card">
            <div class="card-head"><div><h3>Evidence</h3><p class="card-sub">Private files. Only the people in this case and reviewers can see them.</p></div></div>
            <div class="thumb-row">${inc.evidenceUrls.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Evidence ${i + 1}"></a>`).join('')}</div>
          </div>` : ''}

          <div class="card">
            <div class="card-head"><div><h3>Worker's response</h3>${inc.respondedAt ? `<p class="card-sub">Answered ${fmtDateTime(inc.respondedAt)}</p>` : ''}</div></div>
            ${inc.workerResponse ? `<p style="white-space:pre-wrap">${esc(inc.workerResponse)}</p>` : isWorker && inc.canRespond ? `
              <form data-incident-response>
                <div class="field"><label for="ir">Your side of what happened</label><textarea id="ir" required placeholder="Tell the reviewer what happened in your words. You may add voice notes through a reviewer."></textarea></div>
                <button class="btn btn-primary" type="submit">Send my response</button>
              </form>` : `<p class="small muted mb-0">No response recorded${isWorker ? '. The response window has closed — contact a reviewer to add information.' : '.'}</p>`}
          </div>

          ${inc.decision ? `<div class="card">
            <div class="card-head"><div><h3>Reviewer decision</h3><p class="card-sub">${fmtDateTime(inc.decidedAt)}</p></div><span class="badge badge-${inc.decision === 'dismissed' ? 'blue' : 'red'}">${esc(labelize(inc.decision))}</span></div>
            <p class="small">${esc(inc.workerResponse ? 'The decision was made after both sides were considered.' : '')}</p>
            ${inc.expiresAt ? `<p class="tiny muted mb-0">Review date: ${fmtDateTime(inc.expiresAt)}</p>` : ''}
          </div>` : ''}
        </div>

        <div class="stack">
          <div class="card dark"><h3>Both sides, then a decision</h3>
            <p class="muted small mb-0">A reviewer sees the report, the evidence and your response. Outcomes are: dismissed, verified warning, or suspended pending police. A warning expires; a suspension is reviewed.</p></div>
          <div class="card"><h3>Privacy</h3>
            <p class="small muted mb-0">Incidents with no evidence are not shown to other farmers. Your response is always kept with the record.</p></div>
          ${inc.employmentId ? `<a class="btn btn-ghost" href="#/jobs/${esc(inc.employmentId)}">Open the employment record</a>` : ''}
        </div>
      </div>`,
    after() {
      const form = document.querySelector('[data-incident-response]');
      form?.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
          await api(`/incidents/${encodeURIComponent(inc.id)}/response`, { method: 'POST', body: { response: form.querySelector('textarea').value.trim() } });
          toast('Your response was sent. A reviewer sees both sides.', 'ok');
          go('/incidents/' + inc.id);
        } catch (err) { apiToast(err); btn.disabled = false; }
      });
    }
  };
}
