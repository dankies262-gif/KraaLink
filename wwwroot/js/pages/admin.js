import {
  api, apiToast, state, go, esc, icon, avatar, money, fmtDate, fmtDateTime, timeAgo,
  statusBadge, levelBadge, toast, modal, confirmDialog, emptyState, pageHead, labelize
} from '../core.js';

/* ------------------------------------------------------------------ helpers */

function tabBar(base, items, active) {
  return `<div class="tabs">${items.map(t =>
    `<a class="tab${t.value === active ? ' active' : ''}" href="#${base}${t.value ? '?status=' + encodeURIComponent(t.value) : ''}">${esc(t.label)}</a>`
  ).join('')}</div>`;
}

function docLink(url, label) {
  if (!url) return `<span class="badge badge-grey">Missing</span>`;
  return `<a class="badge badge-${/\.pdf$/i.test(url) ? 'blue' : 'green'} plain" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

function fmtJson(value) {
  if (!value) return '—';
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return String(value); }
}

function recordBadge(status) {
  const tone = status === 'Good Record' ? 'green'
    : status === 'Suspended - Police Case Open' ? 'red' : 'amber';
  return `<span class="badge badge-${tone}">${esc(status || 'Good Record')}</span>`;
}

function staffFace(person, cls = '') {
  return avatar({ name: person.name, faceUrl: person.faceUrl || person.photoUrl }, cls);
}

async function raiseWorker(w) {
  if (w.verificationLevel >= 2) return;
  const next = w.verificationLevel === 0 ? 1 : 2;
  if (next === 1) {
    const ok = await confirmDialog({
      title: 'Raise to L1 · Documented',
      message: 'Confirm you checked the face photo against the ID document and both belong to this worker.',
      confirmLabel: 'Raise to L1'
    });
    if (!ok) return;
    try {
      await api(`/workers/${encodeURIComponent(w.id)}/verifications`, { method: 'POST', body: { level: 1, method: 'document_check' } });
      toast('Worker raised to L1.', 'ok');
      go('/admin/verification');
    } catch (err) { apiToast(err); }
    return;
  }

  const m = modal({
    title: 'Raise to L2 · Community verified',
    sub: 'An in-person check by a named verifier is required.',
    narrow: true,
    body: `<div class="notice warn mb-2">${icon('alert')} Only raise to L2 after meeting the worker in person and confirming their village and next of kin.</div>
      <div class="field"><label for="av-name">Verifier name and role</label><input id="av-name" placeholder="e.g. Headman Johannes, Oshivelo"></div>
      <div class="field"><label for="av-note">When and where?</label><textarea id="av-note" rows="3" placeholder="In-person check details"></textarea></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-orange" data-go>Raise to L2</button>`
  });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const verifierName = m.wrap.querySelector('#av-name').value.trim();
    if (verifierName.length < 3) { toast('Name the verifier.', 'warn'); return; }
    const btn = m.wrap.querySelector('[data-go]');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      await api(`/workers/${encodeURIComponent(w.id)}/verifications`, {
        method: 'POST',
        body: { level: 2, method: 'in_person', verifierName, note: m.wrap.querySelector('#av-note').value.trim() || undefined }
      });
      m.close();
      toast('Worker raised to L2.', 'ok');
      go('/admin/verification');
    } catch (err) { apiToast(err); btn.disabled = false; btn.textContent = 'Raise to L2'; }
  });
}

/* ================================================================== overview */

export async function adminOverview() {
  const d = await api('/admin/overview');
  const info = [
    ['workers', 'Workers', 'Registered passports'],
    ['workersL2', 'At L2', 'Community verified'],
    ['farmers', 'Farmers', 'Farmer accounts'],
    ['finders', 'Community reporters', 'Finder accounts'],
    ['consentsGranted', 'Consents granted', 'Total approvals'],
    ['accessViews', 'Passport views', 'Logged consented views'],
    ['openIncidents', 'Open incidents', 'Under review or answered'],
    ['activeListings', 'Active listings', 'Visible to buyers'],
    ['heldListings', 'Held listings', 'Awaiting a check'],
    ['foundOpen', 'Found reports open', 'Open or claim pending'],
    ['claimsPending', 'Claims pending', 'Documents to check'],
    ['policePending', 'Police requests', 'Need admin approval'],
    ['tagConflicts', 'Tag conflicts', 'Need a reviewer decision'],
    ['auditRows', 'Audit rows', 'Append-only'],
    ['lookups24h', 'Lookups (24h)', 'Brand and tag queries'],
    ['notifications24h', 'Messages (24h)', 'WhatsApp outbox volume']
  ];
  const cards = info.map(([key, label, hint]) => `<div class="card stat">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${esc(d.metrics[key] ?? 0)}</div>
    <div class="stat-hint">${esc(hint)}</div>
  </div>`).join('');

  const queues = d.queues.map(q => {
    const isConsent = q.href === '#/admin/consents';
    const inner = `<div class="row between">
      <div class="stat-label">${esc(q.label)}</div>
      <div class="stat-value" style="font-size:1.6rem;margin:0">${esc(q.count)}</div>
    </div>
    <div class="stat-hint">${isConsent ? 'Workers decide; reviewers see the count only' : 'Open queue'}</div>`;
    return isConsent
      ? `<div class="card tight">${inner}</div>`
      : `<a class="card tight hover-card" href="${esc(q.href)}" style="text-decoration:none;color:inherit">${inner}</a>`;
  }).join('');

  const audit = d.recentAudit.map(a => `<tr>
    <td class="tiny">${fmtDateTime(a.createdAt)}</td>
    <td><b>${esc(a.action)}</b><div class="tiny muted">${esc(a.details || '')}</div></td>
    <td>${esc(a.actorName || 'System')}<div class="tiny muted">${esc(a.actorRole || '')}</div></td>
    <td class="mono tiny">${esc(a.objectType || '')}<br>${esc(a.recordId || '')}</td>
  </tr>`).join('');

  return {
    html: `${pageHead('Oversight', 'Operations overview',
      'Live counts from this demo environment. Every reviewer action is append-only in the audit log.',
      `${state.me.role === 'admin' ? `<a class="btn btn-ghost" href="#/admin/audit">${icon('doc')} Audit log</a>` : ''}
       <a class="btn btn-ghost" href="#/admin/outbox">${icon('bell')} WhatsApp outbox</a>`)}

    <h2 class="mb-2">Queues</h2>
    <div class="grid cols-4">${queues}</div>

    <h2 class="mt-4 mb-2">Environment</h2>
    <div class="grid cols-4">${cards}</div>

    <h2 class="mt-4 mb-2">Recent audit activity</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Object</th></tr></thead>
    <tbody>${audit || '<tr><td colspan="4">No audit rows yet.</td></tr>'}</tbody></table></div>
    <p class="tiny muted mt-2">Generated ${fmtDateTime(d.generatedAt)}. Audit and access logs are append-only; no hard deletes.</p>`
  };
}

/* ================================================================== verification */

export async function verificationQueue() {
  const rows = await api('/admin/queues/verification');
  const list = rows.length ? `<div class="stack">${rows.map(w => `<div class="card">
    <div class="row between" style="align-items:flex-start">
      <div class="row" style="gap:16px;align-items:flex-start">
        ${w.faceUrl ? `<a href="${esc(w.faceUrl)}" target="_blank" rel="noopener"><img class="staff-face" style="width:104px;height:124px" src="${esc(w.faceUrl)}" alt="${esc(w.name)} face photo"></a>` : `<span class="avatar avatar-xl">${esc(w.name.charAt(0))}</span>`}
        <div>
          <div class="title">${esc(w.name)}</div>
          <div class="small muted"><span class="mono">${esc(w.shortCode)}</span> · ${esc(w.village || '—')}${w.regionName ? `, ${esc(w.regionName)}` : ''}</div>
          <div class="row mt-1">${levelBadge(w.verificationLevel)} ${recordBadge(w.recordStatus)}</div>
          <div class="row mt-2" style="gap:6px">
            ${docLink(w.faceUrl, 'Face photo')}
            ${docLink(w.idDocUrl, 'ID document')}
          </div>
          <div class="tiny muted mt-1">${esc(w.phone || '')} · joined ${fmtDate(w.createdAt)}</div>
        </div>
      </div>
      <div class="end stack-sm" style="align-items:flex-end">
        ${w.verificationLevel < 2 && w.hasFace && w.hasIdDoc ? `<button class="btn btn-sm btn-primary" data-raise="${esc(w.id)}">${icon('shield')} ${w.verificationLevel === 0 ? 'Raise to L1' : 'Raise to L2'}</button>` : ''}
        ${!w.hasFace || !w.hasIdDoc ? `<span class="badge badge-amber">Face and ID needed</span>` : ''}
        <a class="btn btn-sm btn-ghost" href="#/workers/${esc(w.id)}">Profile</a>
      </div>
    </div>
  </div>`).join('')}</div>` : emptyState({
    iconName: 'shield',
    title: 'The verification queue is clear',
    body: 'Workers below L2 appear here. L1 needs a face and ID; L2 needs an in-person check by a named verifier.'
  });

  return {
    html: `${pageHead('Verification', 'Passport verification queue',
      'Workers below L2. Check documents, then raise one level at a time. Every change is appended to the verification history.',
      `<a class="btn btn-ghost" href="#/workers">${icon('users')} Worker register</a>`)}
      <div class="notice info mb-3">${icon('shield')} ID document images are private. Opening one is a logged staff action; never forward or copy them.</div>
      ${list}`,
    after() {
      document.querySelectorAll('[data-raise]').forEach(btn => {
        const w = rows.find(row => row.id === btn.dataset.raise);
        btn.addEventListener('click', () => raiseWorker(w));
      });
    }
  };
}

/* ================================================================== brands */

export async function adminBrands({ query }) {
  const status = query.status || 'pending';
  const rows = await api('/admin/brands?status=' + encodeURIComponent(status));

  const list = rows.length ? `<div class="stack">${rows.map(b => `<div class="card">
    <div class="row between" style="align-items:flex-start">
      <div>
        <div class="title mono" style="font-size:1.2rem">${esc(b.brandMarkText)}</div>
        <div class="small muted">${esc(b.ownerName)} · ${esc(b.ownerPhone)}</div>
        <div class="small muted">${esc(b.registrationNo || 'No registration number')} · ${esc(b.area)} · ${esc(b.regionName || '—')}</div>
        <div class="row mt-1">${statusBadge(b.status)} <span class="tiny muted">Submitted ${fmtDate(b.createdAt)}</span></div>
        <div class="row mt-2">${docLink(b.photoUrl, 'Brand photo')} ${docLink(b.certificateUrl, 'Certificate')}</div>
      </div>
      <div class="end">
        ${b.status === 'pending' ? `<div class="row">
          <button class="btn btn-sm btn-primary" data-verify="${esc(b.id)}">${icon('check')} Verify</button>
          <button class="btn btn-sm btn-danger" data-reject="${esc(b.id)}">Reject</button>
        </div>` : b.verifiedAt ? `<span class="tiny muted">Decided ${fmtDate(b.verifiedAt)}</span>` : ''}
      </div>
    </div>
  </div>`).join('')}</div>` : emptyState({
    iconName: 'tag',
    title: 'No brands in this view',
    body: 'Brands arrive from farmers who register a mark and attach a certificate or registration number.'
  });

  return {
    html: `${pageHead('Brand & Trade Tracker', 'Brand verification',
      'A verified brand makes blind matching possible. Check the certificate or registration number against the declared mark.',
      `<a class="btn btn-ghost" href="#/admin/tags">${icon('qr')} Tag conflicts</a>`)}
      ${tabBar('/admin/brands', [
        { value: 'pending', label: 'Pending' }, { value: 'verified', label: 'Verified' },
        { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }
      ], status)}
      ${list}`,
    after() {
      document.querySelectorAll('[data-verify]').forEach(btn => btn.addEventListener('click', async () => {
        const brand = rows.find(r => r.id === btn.dataset.verify);
        const ok = await confirmDialog({
          title: 'Verify this brand?',
          message: `Verify ${brand.brandMarkText} for ${brand.ownerName}. Matching will re-check open found reports immediately.`,
          confirmLabel: 'Verify brand'
        });
        if (!ok) return;
        try {
          await api(`/admin/brands/${encodeURIComponent(brand.id)}/verification`, {
            method: 'POST', body: { decision: 'verify', reason: 'Certificate or registration number checked against the declared brand.' }
          });
          toast('Brand verified.', 'ok');
          go('/admin/brands?status=' + status);
        } catch (err) { apiToast(err); }
      }));

      document.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', () => {
        const brand = rows.find(r => r.id === btn.dataset.reject);
        const m = modal({
          title: 'Reject brand',
          sub: `${brand.brandMarkText} · ${brand.ownerName}`,
          narrow: true,
          body: `<div class="field"><label for="rej-reason">Reason (sent to the farmer)</label><textarea id="rej-reason" rows="3" placeholder="What was missing or did not match?"></textarea></div>`,
          footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" data-go>Reject brand</button>`
        });
        m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
          const reason = m.wrap.querySelector('#rej-reason').value.trim();
          if (reason.length < 5) { toast('Write a reason.', 'warn'); return; }
          try {
            await api(`/admin/brands/${encodeURIComponent(brand.id)}/verification`, { method: 'POST', body: { decision: 'reject', reason } });
            m.close();
            toast('Brand rejected and farmer notified.', 'ok');
            go('/admin/brands?status=' + status);
          } catch (err) { apiToast(err); }
        });
      }));
    }
  };
}

/* ================================================================== claims */

export async function adminClaims({ query }) {
  const status = query.status || 'pending';
  const rows = await api('/admin/claims?status=' + encodeURIComponent(status));

  const list = rows.length ? `<div class="stack">${rows.map(c => `<div class="card">
    <div class="card-head"><div><h3 class="mono">${esc(c.caseRef)}</h3>
      <p class="card-sub">${esc(c.qty)} × ${esc(c.species)} · ${esc(c.locationText || 'Location not recorded')} · claimant ${esc(c.claimantName)} (${esc(c.claimantPhone)})</p></div>${statusBadge(c.status)}</div>
    <p class="small">${esc(c.statement)}</p>
    <div class="thumb-row mb-2">${(c.documents || []).filter(d => !/\.pdf($|\?)/i.test(d.url)).map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener" title="${esc(labelize(d.docType))}"><img src="${esc(d.url)}" alt="${esc(labelize(d.docType))}"></a>`).join('')}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap">${(c.documents || []).map(d => docLink(d.url, labelize(d.docType))).join('')}</div>
    ${c.reason ? `<div class="notice ${c.status === 'rejected' ? 'warn' : 'ok'} mt-2">${esc(c.reason)}</div>` : ''}
    ${c.handoverMethod ? `<div class="notice info mt-2">${icon('users')} Handover: ${esc(c.handoverMethod.replaceAll('_', ' '))} · ${esc(c.handoverPlace || '')} · ${fmtDateTime(c.handoverAt)}</div>` : ''}
    <div class="row mt-2">
      ${c.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-approve="${esc(c.id)}">${icon('check')} Approve</button>
        <button class="btn btn-sm btn-danger" data-reject="${esc(c.id)}">Reject</button>` : ''}
      ${c.status === 'approved' && !c.handoverMethod ? `<button class="btn btn-sm btn-orange" data-handover="${esc(c.id)}">${icon('users')} Arrange handover</button>` : ''}
    </div>
  </div>`).join('')}</div>` : emptyState({
    iconName: 'doc',
    title: 'No claims in this view',
    body: 'Owners who are blind-matched to a found report can submit a claim with documents. A claim cannot be approved without at least one document.'
  });

  return {
    html: `${pageHead('Brand & Trade Tracker', 'Ownership claims',
      'Check documents against the brand and tag register. The finder never sees the claimant’s identity.',
      `<a class="btn btn-ghost" href="#/admin/found">${icon('search')} Found reports</a>`)}
      ${tabBar('/admin/claims', [
        { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' },
        { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }
      ], status)}
      ${list}`,
    after() {
      document.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => decideClaim(btn.dataset.approve, 'approve', status)));
      document.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', () => decideClaim(btn.dataset.reject, 'reject', status)));
      document.querySelectorAll('[data-handover]').forEach(btn => btn.addEventListener('click', () => arrangeHandover(btn.dataset.handover, status)));
    }
  };
}

function decideClaim(id, decision, status) {
  const m = modal({
    title: decision === 'approve' ? 'Approve ownership claim' : 'Reject ownership claim',
    sub: 'The decision reason is sent to the claimant and recorded in the audit log.',
    narrow: true,
    body: `<div class="field"><label for="claim-reason">Reason</label><textarea id="claim-reason" rows="3" placeholder="${decision === 'approve' ? 'Documents matched the brand and tag register.' : 'Why the documents did not prove ownership.'}"></textarea></div>
      ${decision === 'approve' ? `<div class="notice warn">${icon('alert')} After approval, arrange handover through the police or State Veterinary office unless both parties consent to a direct handover.</div>` : ''}`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn ${decision === 'approve' ? 'btn-primary' : 'btn-danger'}" data-go>${decision === 'approve' ? 'Approve claim' : 'Reject claim'}</button>`
  });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const reason = m.wrap.querySelector('#claim-reason').value.trim();
    if (reason.length < 5) { toast('Write a decision reason.', 'warn'); return; }
    const btn = m.wrap.querySelector('[data-go]');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      await api(`/admin/claims/${encodeURIComponent(id)}/decision`, { method: 'POST', body: { decision, reason } });
      m.close();
      toast(decision === 'approve' ? 'Claim approved.' : 'Claim rejected.', 'ok');
      go('/admin/claims?status=' + status);
    } catch (err) { apiToast(err); btn.disabled = false; btn.textContent = 'Try again'; }
  });
}

function arrangeHandover(claimId, status) {
  const m = modal({
    title: 'Arrange handover',
    sub: 'Only after a claim is approved.',
    narrow: true,
    body: `<div class="field"><label for="ho-method">Handover method</label><select id="ho-method">
        <option value="police_station">At a Namibian Police station</option>
        <option value="state_vet_office">At the State Veterinary office</option>
        <option value="direct_with_consent">Directly, with both parties' consent</option>
      </select></div>
      <div class="field"><label for="ho-place">Place</label><input id="ho-place" placeholder="Station or office"></div>
      <div class="field"><label for="ho-at">When</label><input id="ho-at" type="datetime-local"></div>
      <label class="check" data-consent-row hidden><input type="checkbox" id="ho-consent"> Both parties consented to a direct handover.</label>
      <div class="notice info mt-2">${icon('shield')} The finder is told the place and time, never the claimant's phone number.</div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-orange" data-go>Arrange handover</button>`
  });
  const method = m.wrap.querySelector('#ho-method');
  const consentRow = m.wrap.querySelector('[data-consent-row]');
  method.addEventListener('change', () => { consentRow.hidden = method.value !== 'direct_with_consent'; });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const bothPartiesConsent = m.wrap.querySelector('#ho-consent').checked;
    if (method.value === 'direct_with_consent' && !bothPartiesConsent) {
      toast('Direct handover needs both parties to consent.', 'warn'); return;
    }
    const at = m.wrap.querySelector('#ho-at').value;
    try {
      await api(`/claims/${encodeURIComponent(claimId)}/handover`, {
        method: 'POST',
        body: {
          method: method.value,
          place: m.wrap.querySelector('#ho-place').value.trim() || undefined,
          at: at ? new Date(at).toISOString() : undefined,
          bothPartiesConsent
        }
      });
      m.close();
      toast('Handover arranged and both parties notified.', 'ok');
      go('/admin/claims?status=' + status);
    } catch (err) { apiToast(err); }
  });
}

/* ================================================================== incidents */

export async function adminIncidents() {
  const rows = await api('/admin/queues/incidents');

  const list = rows.length ? `<div class="stack">${rows.map(i => `<div class="card">
    <div class="card-head"><div><h3>${esc(i.workerName || 'Worker')} <span class="mono small muted">${esc(i.shortCode || '')}</span></h3>
      <p class="card-sub">Filed by ${esc(i.reporterName)} · ${esc(i.jobTitle || '')} · ${timeAgo(i.createdAt)}</p></div>${statusBadge(i.status)}</div>
    <p class="small">${esc(i.description || '')}</p>
    <div class="row tiny muted" style="gap:14px">
      <span>Occurred: ${i.occurredOn ? fmtDate(i.occurredOn) : '—'}</span>
      <span>Value: ${i.valueNad ? money(i.valueNad) : '—'}</span>
      <span>Evidence: ${i.evidenceCount}</span>
      ${i.policeCaseNo ? `<span>Police case ${esc(i.policeCaseNo)}</span>` : ''}
    </div>
    ${i.evidenceUrls?.length ? `<div class="thumb-row mt-2">${i.evidenceUrls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Incident evidence"></a>`).join('')}</div>` : `<div class="notice info mt-2">${icon('shield')} No evidence attached. This incident is not visible to other farmers.</div>`}
    ${i.workerResponse ? `<div class="notice ok mt-2"><b>Worker response</b><br>${esc(i.workerResponse)}</div>` : `<div class="notice warn mt-2">${icon('clock')} No worker response yet. Response due ${i.responseDueAt ? fmtDateTime(i.responseDueAt) : '—'}.</div>`}
    <button class="btn btn-primary btn-sm mt-2" data-decide="${esc(i.id)}">${icon('shield')} Record decision</button>
  </div>`).join('')}</div>` : emptyState({
    iconName: 'alert',
    title: 'No incidents under review',
    body: 'Incidents filed by farmers appear here with the worker response and any evidence.'
  });

  return {
    html: `${pageHead('Incidents', 'Incident review',
      'Read both sides before deciding. Only incidents with evidence and a notified worker are visible to other farmers.',
      `<a class="btn btn-ghost" href="#/admin/access">${icon('shield')} Access log</a>`)}
      ${list}`,
    after() {
      document.querySelectorAll('[data-decide]').forEach(btn => {
        const inc = rows.find(r => r.id === btn.dataset.decide);
        btn.addEventListener('click', () => decideIncident(inc));
      });
    }
  };
}

function decideIncident(inc) {
  const m = modal({
    title: 'Record incident decision',
    sub: `${inc.workerName || 'Worker'} · filed by ${inc.reporterName || 'farmer'}`,
    wide: true,
    body: `<div class="grid cols-3 mb-2">
      <div class="card tight" style="box-shadow:none"><div class="stat-label">Farmer's account</div><p class="small mb-0">${esc(inc.description || '')}</p></div>
      <div class="card tight" style="box-shadow:none"><div class="stat-label">Worker response</div><p class="small mb-0">${esc(inc.workerResponse || 'No response recorded.')}</p></div>
      <div class="card tight" style="box-shadow:none"><div class="stat-label">Evidence</div><p class="small mb-0">${inc.evidenceCount} file(s). ${inc.policeCaseNo ? 'Police case ' + esc(inc.policeCaseNo) : 'No police case recorded.'}</p></div>
    </div>
    <div class="field"><label for="dec-outcome">Outcome</label><select id="dec-outcome">
      <option value="dismissed">Dismissed — hidden from farmers</option>
      <option value="verified_warning">Verified with warning — shows until expiry</option>
      <option value="suspended_police">Suspended — police case open</option>
    </select></div>
    <div class="field"><label for="dec-reason">Reason (sent to both sides)</label><textarea id="dec-reason" rows="3" required placeholder="What did you find after reading both sides and the evidence?"></textarea></div>
    <div class="field" data-police hidden><label for="dec-case">Police case number</label><input id="dec-case" value="${esc(inc.policeCaseNo || '')}" placeholder="Required for suspension"></div>
    <div class="notice warn">${icon('alert')} A warning expires automatically. Suspension needs an open police case and is reviewed monthly.</div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-go>Record decision</button>`
  });
  const outcome = m.wrap.querySelector('#dec-outcome');
  const police = m.wrap.querySelector('[data-police]');
  outcome.addEventListener('change', () => { police.hidden = outcome.value !== 'suspended_police'; });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const reason = m.wrap.querySelector('#dec-reason').value.trim();
    const policeCaseNo = m.wrap.querySelector('#dec-case').value.trim();
    if (reason.length < 5) { toast('Write a decision reason.', 'warn'); return; }
    if (outcome.value === 'suspended_police' && !policeCaseNo) { toast('Capture the police case number.', 'warn'); return; }
    const btn = m.wrap.querySelector('[data-go]');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      await api(`/incidents/${encodeURIComponent(inc.id)}/decision`, {
        method: 'POST', body: { outcome: outcome.value, reason, policeCaseNo: policeCaseNo || undefined }
      });
      m.close();
      toast('Decision recorded and both sides notified.', 'ok');
      go('/admin/incidents');
    } catch (err) { apiToast(err); btn.disabled = false; btn.textContent = 'Record decision'; }
  });
}

/* ================================================================== listings */

export async function adminListings({ query }) {
  const status = query.status || 'held';
  const rows = await api('/admin/listings?status=' + encodeURIComponent(status));

  const list = rows.length ? `<div class="grid cols-2">${rows.map(({ view: l, status: s, holdReason, reports }) => `<div class="card">
    ${l.photoUrl ? `<div class="listing-photo" style="border-radius:12px;overflow:hidden;margin-bottom:12px"><img src="${esc(l.photoUrl)}" alt="${esc(l.species)} listing"></div>` : ''}
    <div class="row between"><div class="title">${esc(l.qty)}${l.unit ? ' ' + esc(l.unit) : ''} × ${esc(l.species)}</div>${statusBadge(s)}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">
      <span class="badge badge-grey plain">${l.kind === 'produce' ? 'Farm produce' : 'Livestock'}</span>
      ${l.kind === 'produce' && l.category ? `<span class="badge badge-olive plain">${esc(l.category)}</span>` : ''}
    </div>
    <div class="small muted">${esc(l.sellerName)} · ${esc(l.sellerPhone || '')} · ${esc(l.village || l.regionName || '')}</div>
    <div class="row mt-1"><span class="listing-price">${money(l.priceNad)}${l.unit ? ` <span class="tiny muted">/ ${esc(l.unit)}</span>` : ''}</span></div>
    <div class="row mt-1" style="gap:6px;flex-wrap:wrap">
      ${l.brandText ? `<span class="badge badge-grey plain">Brand ${esc(l.brandText)}</span>` : ''}
      ${(l.tagNumbers || []).map(t => `<span class="badge badge-grey plain mono">${esc(t)}</span>`).join('')}
    </div>
    ${holdReason ? `<div class="notice warn mt-2">${icon('alert')} Held: ${esc(holdReason)}</div>` : ''}
    ${reports?.length ? `<div class="stack-sm mt-2">${reports.map(r => `<div class="tiny muted">Reported ${timeAgo(r.createdAt)}: ${esc(r.reason)}</div>`).join('')}</div>` : ''}
    ${s === 'held' || s === 'active' ? `<div class="row mt-2">
      ${s === 'held' ? `<button class="btn btn-sm btn-primary" data-clear="${esc(l.id)}">Clear listing</button>
        <button class="btn btn-sm btn-danger" data-remove="${esc(l.id)}">Remove</button>` : ''}
    </div>` : ''}
  </div>`).join('')}</div>` : emptyState({
    iconName: 'market',
    title: 'No listings in this view',
    body: 'Listings carrying a tag on a missing or stolen report are held automatically before buyers see them.'
  });

  return {
    html: `${pageHead('Marketplace', 'Listing moderation',
      'Held listings are blocked from buyers until a reviewer checks the tag register and any reports.',
      `<a class="btn btn-ghost" href="#/market">${icon('market')} Public marketplace</a>`)}
      ${tabBar('/admin/listings', [
        { value: 'held', label: 'Held' }, { value: 'active', label: 'Active' },
        { value: 'removed', label: 'Removed' }, { value: 'all', label: 'All' }
      ], status)}
      ${list}`,
    after() {
      document.querySelectorAll('[data-clear]').forEach(btn => btn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Clear this listing?',
          message: 'The listing becomes visible to buyers again and open reports are marked cleared.',
          confirmLabel: 'Clear listing'
        });
        if (!ok) return;
        try {
          await api(`/admin/listings/${encodeURIComponent(btn.dataset.clear)}/moderate`, { method: 'POST', body: { action: 'clear' } });
          toast('Listing cleared.', 'ok');
          go('/admin/listings?status=' + status);
        } catch (err) { apiToast(err); }
      }));

      document.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
        const m = modal({
          title: 'Remove listing',
          narrow: true,
          body: `<div class="field"><label for="rem-reason">Reason (sent to the seller)</label><textarea id="rem-reason" rows="3" placeholder="Why the listing is being removed"></textarea></div>`,
          footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" data-go>Remove listing</button>`
        });
        m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
          const reason = m.wrap.querySelector('#rem-reason').value.trim();
          if (reason.length < 5) { toast('Write a reason.', 'warn'); return; }
          try {
            await api(`/admin/listings/${encodeURIComponent(btn.dataset.remove)}/moderate`, { method: 'POST', body: { action: 'remove', reason } });
            m.close();
            toast('Listing removed.', 'ok');
            go('/admin/listings?status=' + status);
          } catch (err) { apiToast(err); }
        });
      }));
    }
  };
}

/* ================================================================== found reports */

export async function adminFound({ query }) {
  const status = query.status || 'all';
  const rows = await api('/admin/found-reports?status=' + encodeURIComponent(status));

  const table = rows.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>Case</th><th>Found</th><th>Finder</th><th>Match</th><th>Status</th><th>Expires</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><a href="#/found-report/${esc(r.caseRef)}"><b class="mono">${esc(r.caseRef)}</b></a><div class="tiny muted">${fmtDate(r.createdAt)}</div></td>
      <td>${esc(r.qty)} × ${esc(r.species)}<div class="tiny muted">${esc(r.locationText || '—')}${r.brandText ? ' · brand ' + esc(r.brandText) : ''}${r.tags?.length ? ' · ' + r.tags.map(t => esc(t)).join(', ') : ''}</div></td>
      <td>${esc(r.finderName || '—')}<div class="tiny muted">${esc(r.finderPhone || '')}</div></td>
      <td>${r.matchedOwnerName ? esc(r.matchedOwnerName) : '<span class="tiny muted">No match</span>'}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="tiny">${r.expiresAt ? fmtDate(r.expiresAt) : '—'}</td>
    </tr>`).join('')}</tbody></table></div>` : emptyState({
    iconName: 'search',
    title: 'No found reports in this view',
    body: 'Finders log a brand, tag or photo. Blind matching alerts a registered owner without sharing identities.'
  });

  return {
    html: `${pageHead('Brand & Trade Tracker', 'Found reports',
      'Reviewer view. The finder never sees the owner; the owner never sees the finder.',
      `<a class="btn btn-ghost" href="#/admin/claims">${icon('doc')} Ownership claims</a>`)}
      ${tabBar('/admin/found', [
        { value: 'open', label: 'Open' }, { value: 'match_found', label: 'Matched' },
        { value: 'claim_pending', label: 'Claim pending' }, { value: 'claim_approved', label: 'Approved' },
        { value: 'handover_arranged', label: 'Handover' }, { value: 'all', label: 'All' }
      ], status)}
      ${table}`
  };
}

/* ================================================================== tag conflicts */

export async function tagConflicts() {
  const rows = await api('/admin/tag-conflicts');

  const list = rows.length ? `<div class="stack">${rows.map(t => `<div class="card">
    <div class="row between" style="align-items:flex-start">
      <div>
        <div class="title mono" style="font-size:1.2rem">${esc(t.tagNumber)}</div>
        <div class="small muted">Second registration by ${esc(t.claimantName)} (${esc(t.claimantPhone)}) · ${fmtDate(t.createdAt)}</div>
      </div>
      <span class="badge badge-red">Conflict</span>
    </div>
    <div class="grid cols-2 mt-2">
      <div class="card tight" style="box-shadow:none"><div class="stat-label">Existing live owner</div>
        <div class="small mt-1"><b>${esc(t.liveOwner?.ownerName || '—')}</b><br>${esc(t.liveOwner?.ownerPhone || '')}<br>${statusBadge(t.liveOwner?.status)}</div></div>
      <div class="card tight" style="box-shadow:none"><div class="stat-label">Second registration</div>
        <div class="small mt-1"><b>${esc(t.claimantName)}</b><br>${esc(t.claimantPhone)}<br><span class="tiny muted">Refused and routed to review</span></div></div>
    </div>
    <div class="row mt-2">
      <button class="btn btn-sm btn-primary" data-keep="${esc(t.id)}">Keep existing owner</button>
      <button class="btn btn-sm btn-orange" data-accept="${esc(t.id)}">Accept second registration</button>
    </div>
  </div>`).join('')}</div>` : emptyState({
    iconName: 'qr',
    title: 'No tag conflicts',
    body: 'A second live registration of the same ear tag is refused and routed here for a reviewer decision.'
  });

  return {
    html: `${pageHead('Brand & Trade Tracker', 'Tag conflicts',
      'One live tag can belong to one owner. Decide with the documents in front of you; both parties are notified.',
      `<a class="btn btn-ghost" href="#/admin/brands">${icon('tag')} Brands</a>`)}
      ${list}`,
    after() {
      document.querySelectorAll('[data-keep]').forEach(btn => btn.addEventListener('click', () => resolveConflict(btn.dataset.keep, 'retain_owner')));
      document.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', () => resolveConflict(btn.dataset.accept, 'accept_new')));
    }
  };
}

function resolveConflict(id, decision) {
  const m = modal({
    title: decision === 'retain_owner' ? 'Keep the existing owner' : 'Transfer the tag',
    sub: 'Both owners receive the decision and reason.',
    narrow: true,
    body: `<div class="field"><label for="tc-reason">Reason</label><textarea id="tc-reason" rows="3" placeholder="${decision === 'retain_owner' ? 'Existing owner confirmed against the register.' : 'Documents supported the second registration.'}"></textarea></div>
      ${decision === 'accept_new' ? `<div class="notice warn">${icon('alert')} This retires the existing owner’s tag and makes the second registration live.</div>` : ''}`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${decision === 'accept_new' ? 'btn-orange' : 'btn-primary'}" data-go>Record decision</button>`
  });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const reason = m.wrap.querySelector('#tc-reason').value.trim();
    if (reason.length < 5) { toast('Write a reason.', 'warn'); return; }
    try {
      await api(`/admin/tag-conflicts/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { decision, reason } });
      m.close();
      toast('Tag conflict resolved.', 'ok');
      go('/admin/tags');
    } catch (err) { apiToast(err); }
  });
}

/* ================================================================== police requests */

export async function policeRequests({ query }) {
  const status = query.status || 'all';
  const isAdmin = state.me.role === 'admin';
  const rows = await api('/admin/police-requests?status=' + encodeURIComponent(status));

  const table = rows.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>Requester</th><th>Case</th><th>Worker</th><th>Justification</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(p => `<tr>
      <td><b>${esc(p.requesterName)}</b><div class="tiny muted">${fmtDate(p.createdAt)}</div></td>
      <td class="mono">${esc(p.caseNo)}</td>
      <td>${esc(p.workerName || '—')}<div class="tiny muted mono">${esc(p.shortCode || '')}</div></td>
      <td class="small">${esc(p.justification)}</td>
      <td>${statusBadge(p.status)}${p.approvedBy ? `<div class="tiny muted">${esc(p.approvedBy)}</div>` : ''}</td>
      <td class="actions">
        ${isAdmin && p.status === 'pending' ? `<button class="btn btn-xs btn-primary" data-approve="${esc(p.id)}">Approve</button>
          <button class="btn btn-xs btn-danger" data-reject="${esc(p.id)}">Reject</button>` : ''}
        ${p.status === 'approved' ? `<button class="btn btn-xs btn-ghost" data-passport="${esc(p.id)}">Open view</button>` : ''}
      </td>
    </tr>`).join('')}</tbody></table></div>` : emptyState({
    iconName: 'users',
    title: 'No police requests',
    body: 'A police request needs a case number and a justification. An admin must approve before any worker record is shown, and the view is logged.'
  });

  return {
    html: `${pageHead('Police access', 'Police requests',
      'Next-of-kin and ID document images are never included. Each approved view writes an access-log row.',
      `<button class="btn btn-primary" data-new>${icon('plus')} Log a request</button>`)}

      ${tabBar('/admin/police', [
        { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' },
        { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }
      ], status)}
      ${table}

      <div class="card mt-3">
        <h3>${icon('alert')} Rules</h3>
        <p class="small muted mb-0">Only an administrator approves a request. Approval opens one worker view for the case, records who looked, and shows a masked ID number. Approved views are not a general search tool.</p>
      </div>`,
    after() {
      document.querySelector('[data-new]').addEventListener('click', () => newPoliceRequest(status));
      document.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => decidePolice(btn.dataset.approve, 'approve', status)));
      document.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', () => decidePolice(btn.dataset.reject, 'reject', status)));
      document.querySelectorAll('[data-passport]').forEach(btn => btn.addEventListener('click', () => openPolicePassport(btn.dataset.passport)));
    }
  };
}

function newPoliceRequest(status) {
  const m = modal({
    title: 'Log a police request',
    sub: 'A case number and justification are required.',
    narrow: true,
    body: `<div class="field"><label for="pr-name">Requester name and station</label><input id="pr-name" placeholder="e.g. Sgt Amutenya, Oshakati"></div>
      <div class="field"><label for="pr-case">Police case number</label><input id="pr-case" placeholder="CR 12/03/2026"></div>
      <div class="field"><label for="pr-code">Worker short code</label><input id="pr-code" class="mono" placeholder="e.g. K7M2QP" style="text-transform:uppercase"></div>
      <div class="field"><label for="pr-why">Justification</label><textarea id="pr-why" rows="3" placeholder="Why is this worker's record relevant to the case?"></textarea></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-go>Submit for approval</button>`
  });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const body = {
      requesterName: m.wrap.querySelector('#pr-name').value.trim(),
      caseNo: m.wrap.querySelector('#pr-case').value.trim(),
      workerCode: m.wrap.querySelector('#pr-code').value.trim().toUpperCase(),
      justification: m.wrap.querySelector('#pr-why').value.trim()
    };
    if (!body.requesterName || !body.caseNo || !body.workerCode) { toast('Complete the requester, case and code.', 'warn'); return; }
    if (body.justification.length < 10) { toast('Write a justification.', 'warn'); return; }
    try {
      await api('/admin/police-requests', { method: 'POST', body });
      m.close();
      toast('Request logged. An admin must approve it.', 'ok');
      go('/admin/police?status=' + status);
    } catch (err) { apiToast(err); }
  });
}

function decidePolice(id, decision, status) {
  const m = modal({
    title: decision === 'approve' ? 'Approve police request' : 'Reject police request',
    sub: decision === 'approve' ? 'The view will be logged against this case.' : 'The requester is told it was not approved.',
    narrow: true,
    body: `<div class="field"><label for="pd-reason">Reason</label><textarea id="pd-reason" rows="3" placeholder="${decision === 'approve' ? 'Case number and justification verified.' : 'Why the request does not meet the threshold.'}"></textarea></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${decision === 'approve' ? 'btn-primary' : 'btn-danger'}" data-go>${decision === 'approve' ? 'Approve' : 'Reject'}</button>`
  });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const reason = m.wrap.querySelector('#pd-reason').value.trim();
    if (decision === 'reject' && reason.length < 5) { toast('Write a reason.', 'warn'); return; }
    try {
      await api(`/admin/police-requests/${encodeURIComponent(id)}/decision`, { method: 'POST', body: { decision, reason: reason || undefined } });
      m.close();
      toast(decision === 'approve' ? 'Request approved.' : 'Request rejected.', 'ok');
      go('/admin/police?status=' + status);
    } catch (err) { apiToast(err); }
  });
}

async function openPolicePassport(id) {
  try {
    const d = await api(`/admin/police-requests/${encodeURIComponent(id)}/passport`);
    const w = d.worker;
    modal({
      title: 'Approved police view',
      sub: `Case ${d.request.caseNo} · approved by ${d.request.approvedBy || 'admin'}`,
      wide: true,
      body: `<div class="notice warn mb-2">${icon('shield')} This view is in the access log. ID number is masked; next-of-kin contacts and ID document images are excluded.</div>
        <div class="row" style="gap:16px;align-items:flex-start">
          ${w.faceUrl ? `<img class="staff-face" style="width:120px;height:144px" src="${esc(w.faceUrl)}" alt="${esc(w.name)} face photo">` : `<span class="avatar avatar-xl">${esc(w.name.charAt(0))}</span>`}
          <div style="flex:1">
            <h3 style="margin-bottom:2px">${esc(w.name)}</h3>
            <div class="small muted mono">${esc(w.shortCode)}</div>
            <div class="row mt-1">${levelBadge(w.verificationLevel)} ${recordBadge(w.recordStatus)}</div>
            <dl class="kv mt-2">
              <dt>Date of birth</dt><dd>${w.dob ? fmtDate(w.dob) : '—'}</dd>
              <dt>ID document</dt><dd>${esc(w.idDocType ? labelize(w.idDocType) : '—')} ${esc(w.idDocNumberMasked || '')}</dd>
              <dt>Home</dt><dd>${esc(w.village || '—')}${w.regionName ? `, ${esc(w.regionName)}` : ''}</dd>
            </dl>
          </div>
        </div>
        <h4 class="mt-2">Last employers</h4>
        ${(d.employments || []).length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Employer</th><th>Job</th><th>Period</th><th>End</th></tr></thead><tbody>
          ${d.employments.map(e => `<tr><td>${esc(e.employer || '')}</td><td>${esc(e.jobTitle || '')}</td><td>${fmtDate(e.startedAt)} – ${e.endedAt ? fmtDate(e.endedAt) : 'open'}</td><td>${esc(e.endLabel || e.status || '')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="small muted">No employment records.</p>'}
        <p class="tiny muted mt-2 mb-0">${esc(d.note || '')}</p>`,
      footer: `<button class="btn btn-primary" data-close>Close</button>`
    });
  } catch (err) { apiToast(err); }
}

/* ================================================================== vet content */

export async function vetContent() {
  const rows = await api('/admin/vet-conditions');

  const table = rows.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>Condition</th><th>Species</th><th>Symptoms</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(c => `<tr>
      <td><b>${esc(c.name)}</b><div class="tiny muted">${c.notifiable ? 'Notifiable — escalation required' : 'Not notifiable'}</div></td>
      <td>${esc(c.species)}</td>
      <td class="small">${(c.symptoms || []).map(s => esc(s)).join(', ')}</td>
      <td>${statusBadge(c.reviewStatus)}${c.approvedBy ? `<div class="tiny muted">${esc(c.approvedBy)} · ${fmtDate(c.approvedAt)}</div>` : ''}</td>
      <td class="actions">${c.reviewStatus !== 'approved' ? `<button class="btn btn-xs btn-primary" data-approve="${esc(c.id)}">Vet approve</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>` : emptyState({
    iconName: 'vet',
    title: 'No VetBot content',
    body: 'Only vet-approved conditions are ever shown to farmers. Add content first, then record the registered vet who approved it.'
  });

  return {
    html: `${pageHead('VetBot-lite', 'Vet content',
      'No condition appears in triage until a registered vet or animal health technician is named as the approver.',
      `<button class="btn btn-primary" data-new>${icon('plus')} Add condition</button>`)}
      <div class="notice warn mb-3">${icon('alert')} VetBot gives information, not a diagnosis. Notifiable diseases must show the isolate / do not move / contact State Vet escalation.</div>
      ${table}`,
    after() {
      document.querySelector('[data-new]').addEventListener('click', newVetCondition);
      document.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => approveVet(btn.dataset.approve)));
    }
  };
}

function newVetCondition() {
  const m = modal({
    title: 'Add VetBot content',
    sub: 'Saved as pending until a vet is named.',
    wide: true,
    body: `<div class="form-grid">
      <div class="field"><label for="vc-name">Condition name</label><input id="vc-name" placeholder="e.g. Lumpy skin disease"></div>
      <div class="field"><label for="vc-species">Species</label><input id="vc-species" value="Cattle" placeholder="Cattle, Goats…"></div>
      <div class="field span-2"><label for="vc-symptoms">Symptoms (comma separated)</label><input id="vc-symptoms" placeholder="Fever, skin nodules, swollen lymph nodes"></div>
      <div class="field span-2"><label for="vc-advice">Advice</label><textarea id="vc-advice" rows="4" placeholder="Neutral, vet-reviewed guidance. Never include medicine doses."></textarea></div>
    </div>
    <label class="check"><input type="checkbox" id="vc-notifiable"> This is a notifiable disease and must trigger the isolate / do not move / contact State Vet escalation.</label>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-go>Save as pending</button>`
  });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const name = m.wrap.querySelector('#vc-name').value.trim();
    const advice = m.wrap.querySelector('#vc-advice').value.trim();
    const symptoms = m.wrap.querySelector('#vc-symptoms').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!name || !advice || symptoms.length === 0) { toast('Name, at least one symptom and advice are required.', 'warn'); return; }
    try {
      await api('/admin/vet-conditions', {
        method: 'POST',
        body: { name, species: m.wrap.querySelector('#vc-species').value.trim() || 'Cattle', symptoms, advice, notifiable: m.wrap.querySelector('#vc-notifiable').checked }
      });
      m.close();
      toast('Content saved as pending vet review.', 'ok');
      go('/admin/vet');
    } catch (err) { apiToast(err); }
  });
}

function approveVet(id) {
  const m = modal({
    title: 'Record vet approval',
    sub: 'Only a registered vet or animal health technician can approve triage content.',
    narrow: true,
    body: `<div class="field"><label for="vet-name">Approver name and registration</label><input id="vet-name" placeholder="e.g. Dr N. Shikongo, VET-1234"></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-go>Approve content</button>`
  });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const vetName = m.wrap.querySelector('#vet-name').value.trim();
    if (vetName.length < 3) { toast('Name the approving vet.', 'warn'); return; }
    try {
      await api(`/admin/vet-conditions/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { vetName } });
      m.close();
      toast('Content approved and live in VetBot.', 'ok');
      go('/admin/vet');
    } catch (err) { apiToast(err); }
  });
}

/* ================================================================== outbox */

export async function outbox({ query }) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.channel) params.set('channel', query.channel);
  const d = await api('/admin/outbox' + (params.toString() ? '?' + params : ''));

  const messages = d.messages.map(n => {
    const out = n.direction === 'outbound' || n.direction === 'out';
    return `<div class="chat-bubble${out ? ' out' : ''}">
      <div><b>${esc(n.title)}</b></div>
      <div>${esc(n.body)}</div>
      <div class="meta">${esc(n.userName || '')} · ${esc(n.phone || '')} · ${esc(labelize(n.channel))} · ${esc(labelize(n.language))} · ${fmtDateTime(n.createdAt)}</div>
    </div>`;
  }).join('');

  return {
    html: `${pageHead('WhatsApp outbox', 'Message simulator',
      'In production this adapter calls the WhatsApp Cloud API. Messages never contain ID numbers, document images or next-of-kin phone numbers.',
      `<a class="btn btn-ghost" href="#/admin">${icon('arrow')} Overview</a>`)}

      <form class="card tight mb-3" data-outbox-filter>
        <div class="filters">
          <div class="field grow"><label for="oq">Search</label><input id="oq" name="q" type="search" placeholder="Person, title or text" value="${esc(query.q || '')}"></div>
          <div class="field"><label for="oc">Channel</label><select id="oc" name="channel"><option value="">All</option>
            <option value="whatsapp"${query.channel === 'whatsapp' ? ' selected' : ''}>WhatsApp</option>
            <option value="in_app"${query.channel === 'in_app' ? ' selected' : ''}>In-app</option>
          </select></div>
          <button class="btn btn-primary" type="submit">${icon('search')} Filter</button>
          <a class="btn btn-ghost" href="#/admin/outbox">Clear</a>
        </div>
      </form>

      <div class="row between mb-2"><p class="small muted mb-0"><b>${d.messages.length}</b> message${d.messages.length === 1 ? '' : 's'} shown</p><span class="tiny muted">${esc(d.label)}</span></div>
      ${messages ? `<div class="chat">${messages}</div>` : emptyState({ iconName: 'bell', title: 'No messages', body: 'Notifications sent by the demo appear here.' })}`,
    after() {
      document.querySelector('[data-outbox-filter]').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target;
        const p = new URLSearchParams();
        if (f.q.value.trim()) p.set('q', f.q.value.trim());
        if (f.channel.value) p.set('channel', f.channel.value);
        go('/admin/outbox' + (p.toString() ? '?' + p : ''));
      });
    }
  };
}

/* ================================================================== people */

export async function adminUsers({ query }) {
  const params = new URLSearchParams();
  if (query.role) params.set('role', query.role);
  if (query.q) params.set('q', query.q);
  const rows = await api('/admin/users' + (params.toString() ? '?' + params : ''));
  const isAdmin = state.me?.role === 'admin';
  const roles = ['worker', 'farmer', 'finder', 'agent', 'verifier', 'reviewer', 'admin'];

  const table = rows.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>Person</th><th>Role</th><th>Phone</th><th>Worker</th><th>Joined</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.map(u => `<tr>
      <td><div class="row" style="gap:10px">${staffFace(u)}<div><b>${esc(u.name || '—')}</b>${u.farmName ? `<div class="tiny muted">${esc(u.farmName)}</div>` : ''}</div></div></td>
      <td>${esc(labelize(u.role))}</td>
      <td class="mono small">${esc(u.phone || '—')}</td>
      <td>${u.shortCode ? `<span class="mono small">${esc(u.shortCode)}</span> ${u.verificationLevel !== null ? levelBadge(u.verificationLevel) : ''}` : '<span class="tiny muted">—</span>'}</td>
      <td class="tiny">${fmtDate(u.createdAt)}</td>
      ${isAdmin ? `<td class="end">${u.id === state.me?.id ? '' : `<button class="btn btn-sm btn-ghost" data-role="${esc(u.id)}">Change role</button>`}</td>` : ''}
    </tr>`).join('')}</tbody></table></div>` : emptyState({ iconName: 'users', title: 'No people match', body: 'Try another role or search term.' });

  return {
    html: `${pageHead('People', 'Accounts',
      'One account per phone number. Roles control the portal; they do not grant access to another person’s private records.',
      '')}
      <form class="card tight mb-3" data-people-filter>
        <div class="filters">
          <div class="field grow"><label for="pq">Search</label><input id="pq" name="q" type="search" placeholder="Name or phone" value="${esc(query.q || '')}"></div>
          <div class="field"><label for="pr">Role</label><select id="pr" name="role"><option value="">All roles</option>
            ${['worker', 'farmer', 'finder', 'agent', 'verifier', 'reviewer', 'admin'].map(r => `<option value="${r}"${query.role === r ? ' selected' : ''}>${esc(labelize(r))}</option>`).join('')}
          </select></div>
          <button class="btn btn-primary" type="submit">${icon('search')} Filter</button>
          <a class="btn btn-ghost" href="#/admin/users">Clear</a>
        </div>
      </form>
      ${table}`,
    after() {
      document.querySelector('[data-people-filter]').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target;
        const p = new URLSearchParams();
        if (f.q.value.trim()) p.set('q', f.q.value.trim());
        if (f.role.value) p.set('role', f.role.value);
        go('/admin/users' + (p.toString() ? '?' + p : ''));
      });

      document.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', () => {
        const user = rows.find(r => r.id === btn.dataset.role);
        if (!user) return;
        const m = modal({
          title: 'Change account role',
          sub: `${user.name || 'This account'} · ${user.phone || ''}`,
          narrow: true,
          body: `<div class="notice warn mb-2">${icon('alert')} Roles control which portal a person can open. The change is recorded in the audit log.</div>
            <div class="field"><label for="role-choice">New role</label><select id="role-choice">
              ${roles.map(r => `<option value="${r}"${r === user.role ? ' selected' : ''}>${esc(labelize(r))}</option>`).join('')}
            </select></div>
            <p class="tiny muted mb-0">A worker role needs an existing WorkerLink Passport. At least one administrator must remain.</p>`,
          footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-save>Save role</button>`
        });
        m.wrap.querySelector('[data-save]').addEventListener('click', async () => {
          const role = m.wrap.querySelector('#role-choice').value;
          const save = m.wrap.querySelector('[data-save]');
          save.disabled = true; save.textContent = 'Saving…';
          try {
            await api(`/admin/users/${encodeURIComponent(user.id)}/role`, { method: 'POST', body: { role } });
            m.close();
            toast('Account role updated.', 'ok');
            go('/admin/users');
          } catch (err) { apiToast(err); save.disabled = false; save.textContent = 'Save role'; }
        });
      }));
    }
  };
}

/* ================================================================== settings */

export async function settings() {
  const rows = await api('/admin/settings');

  return {
    html: `${pageHead('Governance', 'Rules & settings',
      'These values drive consent windows, reminder timing, retention and escalation. Changes are audited with old and new values.',
      `<a class="btn btn-ghost" href="#/admin/audit">${icon('doc')} Audit log</a>`)}
      <form class="card" data-settings-form>
        <div class="form-grid">
          ${rows.map(s => `<div class="field">
            <label for="set-${esc(s.key)}">${esc(labelize(s.key))}</label>
            <input id="set-${esc(s.key)}" name="${esc(s.key)}" value="${esc(s.value)}">
            <div class="hint">${esc(s.description || '')}</div>
          </div>`).join('')}
        </div>
        <div class="row mt-2"><button class="btn btn-primary" type="submit">${icon('check')} Save settings</button></div>
      </form>
      <div class="notice info mt-3">${icon('alert')} Expiry checks run in the background service. Changing a window affects new records; existing dates are not rewritten.</div>`,
    after() {
      const form = document.querySelector('[data-settings-form]');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = 'Saving…';
        const settings = {};
        rows.forEach(s => { settings[s.key] = form.querySelector(`[name="${CSS.escape(s.key)}"]`).value.trim(); });
        try {
          await api('/admin/settings', { method: 'PUT', body: { settings } });
          toast('Settings saved.', 'ok');
          go('/admin/settings');
        } catch (err) {
          apiToast(err);
          btn.disabled = false; btn.innerHTML = `${icon('check')} Save settings`;
        }
      });
    }
  };
}

/* ================================================================== audit */

export async function auditLog({ query }) {
  const params = new URLSearchParams();
  ['q', 'action', 'object', 'table', 'recordId', 'actorId'].forEach(k => { if (query[k]) params.set(k, query[k]); });
  const rows = await api('/admin/audit-log' + (params.toString() ? '?' + params : ''));

  const table = rows.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Object</th><th>Changed</th><th></th></tr></thead>
    <tbody>${rows.map((a, i) => `<tr>
      <td class="tiny">${fmtDateTime(a.createdAt)}<div class="tiny muted">${esc(a.clientIp || '')}</div></td>
      <td><b>${esc(a.action)}</b><div class="tiny muted">${esc(a.details || '')}</div></td>
      <td>${esc(a.actorName || 'System')}<div class="tiny muted">${esc(a.actorRole || '')}</div></td>
      <td class="mono tiny">${esc(a.objectType || '')}<br>${esc(a.recordId || '')}</td>
      <td class="tiny">${esc(a.changedFields || '—')}</td>
      <td class="actions"><button class="btn btn-xs btn-ghost" data-row="${i}">View</button></td>
    </tr>`).join('')}</tbody></table></div>` : emptyState({ iconName: 'doc', title: 'No audit rows match', body: 'Try a broader search or clear the filters.' });

  return {
    html: `${pageHead('Governance', 'Audit log',
      'Append-only. Nothing here can be edited or deleted through the portal.',
      `<span class="badge badge-grey">${rows.length} rows</span>`)}

      <form class="card tight mb-3" data-audit-filter>
        <div class="filters">
          <div class="field grow"><label for="aq">Search</label><input id="aq" name="q" type="search" placeholder="Action, object, details or record" value="${esc(query.q || '')}"></div>
          <div class="field"><label for="aa">Action starts with</label><input id="aa" name="action" placeholder="e.g. incident." value="${esc(query.action || '')}"></div>
          <div class="field"><label for="ao">Object type</label><input id="ao" name="object" placeholder="e.g. incident" value="${esc(query.object || '')}"></div>
          <div class="field"><label for="at">Table</label><input id="at" name="table" placeholder="e.g. incidents" value="${esc(query.table || '')}"></div>
          <div class="field"><label for="ar">Record id</label><input id="ar" name="recordId" placeholder="Record id" value="${esc(query.recordId || '')}"></div>
          <button class="btn btn-primary" type="submit">${icon('search')} Filter</button>
          <a class="btn btn-ghost" href="#/admin/audit">Clear</a>
        </div>
      </form>
      ${table}`,
    after() {
      document.querySelector('[data-audit-filter]').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target;
        const p = new URLSearchParams();
        ['q', 'action', 'object', 'table', 'recordId'].forEach(k => { if (f[k].value.trim()) p.set(k, f[k].value.trim()); });
        go('/admin/audit' + (p.toString() ? '?' + p : ''));
      });
      document.querySelectorAll('[data-row]').forEach(btn => btn.addEventListener('click', () => {
        const a = rows[Number(btn.dataset.row)];
        modal({
          title: 'Audit entry',
          sub: `${a.action} · ${fmtDateTime(a.createdAt)}`,
          wide: true,
          body: `<dl class="kv">
            <dt>Actor</dt><dd>${esc(a.actorName || 'System')} (${esc(a.actorRole || 'system')})</dd>
            <dt>Object</dt><dd class="mono">${esc(a.objectType || '')} / ${esc(a.recordId || '')}</dd>
            <dt>Table</dt><dd class="mono">${esc(a.table || '—')}</dd>
            <dt>Changed fields</dt><dd>${esc(a.changedFields || '—')}</dd>
            <dt>Request</dt><dd class="mono tiny">${esc(a.requestId || '—')}</dd>
            <dt>IP</dt><dd class="mono">${esc(a.clientIp || '—')}</dd>
          </dl>
          ${a.details ? `<div class="notice info mt-2">${esc(a.details)}</div>` : ''}
          <div class="grid cols-2 mt-2">
            <div><div class="stat-label">Old data</div><pre class="code-block">${esc(fmtJson(a.oldData))}</pre></div>
            <div><div class="stat-label">New data</div><pre class="code-block">${esc(fmtJson(a.newData))}</pre></div>
          </div>`,
          footer: `<button class="btn btn-primary" data-close>Close</button>`
        });
      }));
    }
  };
}

/* ================================================================== access log */

export async function accessLog({ query }) {
  const params = new URLSearchParams();
  ['workerId', 'viewerId', 'purpose'].forEach(k => { if (query[k]) params.set(k, query[k]); });
  const rows = await api('/admin/access-log' + (params.toString() ? '?' + params : ''));

  const table = rows.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>When</th><th>Who looked</th><th>Worker</th><th>Purpose</th><th>Fields</th><th>IP</th></tr></thead>
    <tbody>${rows.map(a => `<tr>
      <td class="tiny">${fmtDateTime(a.createdAt)}</td>
      <td>${esc(a.viewerName || a.viewerRole || '—')}<div class="tiny muted">${esc(a.viewerRole || '')}</div></td>
      <td>${esc(a.workerName || '—')}<div class="tiny muted mono">${esc(a.shortCode || '')}</div></td>
      <td class="small">${esc(a.purpose || '—')}<div class="tiny muted">${a.consentId ? 'Consent ' + esc(a.consentId) : 'No consent reference'}</div></td>
      <td class="tiny">${esc(a.fieldsViewed || '—')}</td>
      <td class="mono tiny">${esc(a.clientIp || '—')}</td>
    </tr>`).join('')}</tbody></table></div>` : emptyState({ iconName: 'shield', title: 'No access rows match', body: 'Consented passport views and approved police views are recorded here.' });

  return {
    html: `${pageHead('Governance', 'Access log',
      'Who viewed a worker’s passport, for what purpose and which fields. This log is append-only.',
      `<span class="badge badge-grey">${rows.length} rows</span>`)}

      <form class="card tight mb-3" data-access-filter>
        <div class="filters">
          <div class="field grow"><label for="ac-purpose">Purpose contains</label><input id="ac-purpose" name="purpose" placeholder="e.g. hiring" value="${esc(query.purpose || '')}"></div>
          <div class="field"><label for="ac-worker">Worker id</label><input id="ac-worker" name="workerId" placeholder="usr_…" value="${esc(query.workerId || '')}"></div>
          <div class="field"><label for="ac-viewer">Viewer id</label><input id="ac-viewer" name="viewerId" placeholder="usr_…" value="${esc(query.viewerId || '')}"></div>
          <button class="btn btn-primary" type="submit">${icon('search')} Filter</button>
          <a class="btn btn-ghost" href="#/admin/access">Clear</a>
        </div>
      </form>
      ${table}`,
    after() {
      document.querySelector('[data-access-filter]').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target;
        const p = new URLSearchParams();
        ['workerId', 'viewerId', 'purpose'].forEach(k => { if (f[k].value.trim()) p.set(k, f[k].value.trim()); });
        go('/admin/access' + (p.toString() ? '?' + p : ''));
      });
    }
  };
}
