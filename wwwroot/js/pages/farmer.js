import {
  api, apiToast, loadConfig, state, go, esc, icon, avatar, money, fmtDate, fmtDateTime, timeAgo,
  statusBadge, levelBadge, toast, modal, confirmDialog, openCamera, emptyState, labelize, pageHead
} from '../core.js';

function options(list, selected) {
  return list.map(item => `<option value="${esc(item.code)}"${item.code === selected ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
}
function speciesOptions(species, selected) {
  return species.map(s => `<option${s === selected ? ' selected' : ''}>${esc(s)}</option>`).join('');
}
function splitList(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function hiringProblem(err, code) {
  if (err?.status === 404) {
    return `<div class="notice warn mt-2">${icon('alert')} <span><b>No passport uses ${esc(code)} yet.</b> A field agent must register the worker in person before any check. Ask KraaLink to send an agent: <a href="mailto:atustokacc@gmail.com?subject=Field%20agent%20registration">atustokacc@gmail.com</a>.</span></div>`;
  }
  if (err?.status === 409) {
    return `<div class="notice warn mt-2">${icon('alert')} <span><b>This worker is not documented yet (below L1).</b> A field agent can complete registration with a face photo and ID in person.</span></div>`;
  }
  return `<div class="notice danger mt-2">${icon('alert')} <span>${esc(err?.message || 'The request could not be completed.')}</span></div>`;
}

/* ================================================================== hiring */

export async function hiring({ query }) {
  const rows = await api('/hiring-checks/mine');
  const pending = rows.filter(c => c.status === 'pending').length;

  const list = rows.length ? `<div class="stack">${rows.map(c => `<div class="card tight">
    <div class="row between">
      <div class="row" style="gap:14px">
        ${c.status === 'granted' ? avatar({ name: c.workerName }) : `<span class="avatar avatar-lg" aria-hidden="true">${icon('shield')}</span>`}
        <div>
          <div class="title">${c.status === 'granted' ? esc(c.workerName || 'Worker') : c.status === 'pending' ? 'Worker identity withheld until approval' : 'Worker'}</div>
          <div class="small muted">${esc(c.purpose)}${c.shortCode ? ` · <span class="mono">${esc(c.shortCode)}</span>` : ''}</div>
          <div class="row mt-1">${statusBadge(c.status)} ${c.verificationLevel ? levelBadge(c.verificationLevel) : ''}</div>
        </div>
      </div>
      <div class="end" style="text-align:right">
        <div class="tiny muted">Requested ${timeAgo(c.requestedAt)}</div>
        <div class="row mt-1">
          ${c.canView ? `<a class="btn btn-sm btn-primary" href="#/hiring/${esc(c.id)}">Open passport</a>` : `<a class="btn btn-sm btn-ghost" href="#/hiring/${esc(c.id)}">Details</a>`}
        </div>
      </div>
    </div>
  </div>`).join('')}</div>` : emptyState({
    iconName: 'shield',
    title: 'No hiring checks yet',
    body: 'Enter a worker short code. They receive a WhatsApp request and decide whether to share their passport. Nothing is shown before approval.',
    action: `<a class="btn btn-primary" href="#/hiring">Start a hiring check</a>`
  });

  return {
    html: `${pageHead('WorkerLink Passport', 'Hiring checks',
      'A code is not access. You request, the worker approves for 24 hours, and you see only the agreed fields. Every view is logged.',
      `<a class="btn btn-ghost" href="#/jobs">${icon('users')} Employment records</a>`)}

    <div class="split">
      <div>
        ${pending ? `<div class="notice warn mb-3">${icon('clock')} ${pending} request${pending === 1 ? '' : 's'} waiting for the worker. No passport data is visible while pending.</div>` : ''}
        <h2 class="mb-2">Your checks</h2>
        ${list}
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>${icon('search')} New hiring check</h3><p class="card-sub">Use the short code on the worker's card.</p></div></div>
          <form data-hiring-form>
            <div class="field"><label for="hire-code">Worker short code</label>
              <input id="hire-code" name="code" required placeholder="e.g. K7M2QP" style="text-transform:uppercase;letter-spacing:.16em;font-family:var(--mono)" value="${esc(query.code || '')}">
              <div class="hint" data-code-hint>Enter the 6 characters from the worker's card, or scan the QR and it will arrive here.</div>
            </div>
            <div class="field"><label for="hire-purpose">Purpose</label>
              <select id="hire-purpose" name="purpose">
                <option value="Pre-employment hiring check">Pre-employment hiring check</option>
                <option value="Confirm identity before seasonal work">Confirm identity before seasonal work</option>
                <option value="Check an existing worker">Check an existing worker</option>
              </select></div>
            <label class="check"><input type="checkbox" name="noSmartphone" data-no-smart>
              <span>The worker has no smartphone — send an approval code to their phone.</span>
            </label>
            <div data-otp-box hidden>
              <button type="button" class="btn btn-soft btn-block mt-2" data-otp-send>${icon('shield')} Send approval code to worker</button>
              <div class="field mt-2"><label for="hire-otp">Worker's approval code</label>
                <input id="hire-otp" name="otpCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 digits">
                <div class="hint" data-otp-hint>Only enter the code the worker reads to you. If they do not agree, they keep the code.</div>
              </div>
            </div>
            <button class="btn btn-primary btn-block" type="submit">${icon('shield')} Request with consent</button>
            <div data-hire-error></div>
          </form>
          <p class="tiny muted mt-2 mb-0">The worker's WhatsApp is used to ask. If they decline or do not answer, you see nothing.</p>
        </div>
        <div class="card dark">
          <h3>What you will see</h3>
          <div class="stack-sm small" style="color:rgba(244,241,229,.8)">
            <div class="row">${icon('check')} Photo, name and home village</div>
            <div class="row">${icon('check')} Verification level and record status</div>
            <div class="row">${icon('check')} Last three employers</div>
          </div>
          <div class="divider" style="background:rgba(255,255,255,.15)"></div>
          <p class="tiny mb-0" style="color:rgba(244,241,229,.6)">Never: ID number, ID document, next-of-kin contacts or an unapproved face photo.</p>
        </div>
        <div class="card">
          <h3>Why include the code?</h3>
          <p class="small muted mb-0">The short code identifies the passport without exposing the worker's phone number. Never share a code on a public group — anyone with it can request a check, though only the worker can approve.</p>
        </div>
      </div>
    </div>`,
    after() {
      const form = document.querySelector('[data-hiring-form]');
      const hint = form.querySelector('[data-code-hint]');
      const otpBox = form.querySelector('[data-otp-box]');
      const otpHint = form.querySelector('[data-otp-hint]');
      const errorBox = form.querySelector('[data-hire-error]');
      let lookupTimer;

      form.code.addEventListener('input', () => {
        const code = form.code.value.trim().toUpperCase();
        form.code.value = code;
        clearTimeout(lookupTimer);
        if (code.length !== 6) {
          hint.textContent = 'Enter the 6 characters from the worker\'s card, or scan the QR and it will arrive here.';
          return;
        }
        lookupTimer = setTimeout(async () => {
          try {
            const res = await api('/worker-check/' + encodeURIComponent(code));
            hint.innerHTML = !res.found
              ? 'No passport uses this code yet. A field agent must register the worker first.'
              : !res.canRequest
                ? `${esc(res.levelLabel)} — not documented yet. A field agent can complete the registration.`
                : `${esc(res.levelLabel)}${res.verified ? ' · Verified badge' : ''} — you can request a consented check.`;
          } catch { hint.textContent = ''; }
        }, 350);
      });

      form.querySelector('[data-no-smart]').addEventListener('change', e => {
        otpBox.hidden = !e.target.checked;
        if (e.target.checked) form.otpCode.focus();
      });

      form.querySelector('[data-otp-send]').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const code = form.code.value.trim().toUpperCase();
        if (code.length !== 6) { toast('Enter the worker short code first.', 'warn'); form.code.focus(); return; }
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const res = await api('/hiring-checks/otp', { method: 'POST', body: { code } });
          otpHint.innerHTML = res.demoCode
            ? `Demo code: <b class="mono">${esc(res.demoCode)}</b>. In production it goes only to the worker's phone.`
            : 'Code sent to the worker. Ask them to read it to you only if they agree.';
          toast(res.message || 'Approval code sent to the worker.', 'ok');
          form.otpCode.focus();
        } catch (err) {
          errorBox.innerHTML = hiringProblem(err, code);
        }
        btn.disabled = false; btn.innerHTML = `${icon('shield')} Send approval code to worker`;
      });

      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        errorBox.innerHTML = '';
        const code = form.code.value.trim().toUpperCase();
        const otpCode = form.otpCode?.value.trim();
        try {
          const res = await api('/hiring-checks', {
            method: 'POST',
            body: { code, purpose: form.purpose.value, otpCode: otpCode || undefined }
          });
          localStorage.setItem('kraalink.hiring.' + res.id + '.code', code);
          toast(res.message || 'Request sent to the worker.', 'ok', 6000);
          go('/hiring/' + res.id);
        } catch (err) {
          errorBox.innerHTML = hiringProblem(err, code);
          btn.disabled = false;
        }
      });
    }
  };
}

export async function hiringDetail({ params }) {
  const check = await api('/hiring-checks/' + encodeURIComponent(params.id));
  let passport = null;
  if (check.canView) {
    try { passport = (await api(`/hiring-checks/${encodeURIComponent(params.id)}/passport`)).passport; } catch { passport = null; }
  }
  const code = localStorage.getItem('kraalink.hiring.' + check.id + '.code') || '';

  const statusPanel = {
    pending: { tone: 'warn', title: 'Waiting for the worker', body: 'The worker has been asked on WhatsApp. You cannot see the passport until they approve. This is their decision.' },
    granted: { tone: 'ok', title: 'Consent granted', body: 'The agreed fields are shown below for the approved window. The view is logged.' },
    denied: { tone: 'danger', title: 'The worker declined', body: 'No passport data is available. You can send a new request later.' },
    revoked: { tone: 'danger', title: 'Sharing revoked', body: 'The worker revoked access. Nothing more is shown. Past employment facts remain under the retention schedule.' },
    expired: { tone: 'warn', title: 'Consent expired', body: 'The window has closed. Start a new hiring check if you still need to verify the worker.' }
  }[check.status] || { tone: 'info', title: labelize(check.status), body: '' };

  const html = `${pageHead('Hiring check', `Check ${check.id}`, check.purpose, `<a class="btn btn-ghost" href="#/hiring">All checks</a>`)}
    <div class="split">
      <div class="stack">
        <div class="notice ${statusPanel.tone}">${icon(check.status === 'granted' ? 'check' : 'alert')} <span><b>${esc(statusPanel.title)}.</b> ${esc(statusPanel.body)}</span></div>

        ${passport ? `<div class="card">
          <div class="card-head">
            <div class="row" style="gap:14px">
              ${passport.photoUrl ? `<img src="${esc(passport.photoUrl)}" alt="Worker face" style="width:92px;height:108px;border-radius:12px;object-fit:cover">` : `<span class="avatar avatar-xl">${icon('id')}</span>`}
              <div><h2 style="margin-bottom:2px">${esc(passport.name)}</h2>
                <div class="card-sub">${esc(passport.homeVillage || '')}${passport.regionCode ? ' · ' + esc(passport.regionCode) : ''}</div>
                <div class="row mt-1">${levelBadge(passport.verificationLevel)} ${passport.verified ? '<span class="badge badge-green">Verified</span>' : ''}</div>
              </div>
            </div>
            <span class="badge badge-blue">Consented view</span>
          </div>
          <dl class="kv">
            <dt>Record status</dt><dd>${esc(passport.recordStatus)}</dd>
            <dt>Verification</dt><dd>${esc(passport.levelLabel)}</dd>
            <dt>View expires</dt><dd>${fmtDateTime(check.expiresAt)}</dd>
          </dl>
          <div class="divider"></div>
          <h4 style="font-family:var(--sans);font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)">Last employers</h4>
          ${passport.lastEmployers?.length ? `<div class="list">${passport.lastEmployers.map(e => `<div class="list-row">
            <div class="grow"><div class="title">${esc(e.jobTitle || 'Farm work')} · ${esc(e.employer || '')}</div><div class="sub">${fmtDate(e.startedAt)}${e.endLabel ? ' · ' + esc(e.endLabel) : ''}</div></div>
            <span class="badge badge-grey plain">${esc(e.status)}</span>
          </div>`).join('')}</div>` : '<p class="small muted">No completed employment records.</p>'}
          <div class="notice mt-2">${icon('shield')} ${esc(passport.note)}</div>
          <div class="row mt-2">
            <button class="btn btn-primary" data-checkin>${icon('check')} Record a check-in for this worker</button>
            <a class="btn btn-ghost" href="#/jobs">Employment records</a>
          </div>
        </div>` : check.canView ? `<div class="card">${emptyState({ iconName: 'shield', title: 'Passport data unavailable', body: 'Consent is granted but the view could not be loaded. It may have just expired.' })}</div>` : `<div class="card">
          <div class="card-head"><div><h3>Worker details are hidden</h3><p class="card-sub">Consent status: ${esc(check.status)}</p></div>${statusBadge(check.status)}</div>
          <p class="small muted">${esc(check.message || 'No passport data is available for this check.')}</p>
          <a class="btn btn-ghost" href="#/hiring">Start a new check</a>
        </div>`}

        <div class="card">
          <div class="card-head"><div><h3>${icon('clock')} Request timeline</h3></div></div>
          <div class="timeline">
            <div class="timeline-item"><div class="when">${fmtDateTime(check.requestedAt)}</div><b>Requested</b><p>You asked for a consented hiring check: ${esc(check.purpose)}.</p></div>
            ${check.grantedAt ? `<div class="timeline-item"><div class="when">${fmtDateTime(check.grantedAt)}</div><b>Worker approved</b><p>The agreed fields became visible for the consent window.</p></div>` : ''}
            ${check.expiresAt ? `<div class="timeline-item"><div class="when">${fmtDateTime(check.expiresAt)}</div><b>Window closes</b><p>Access ends automatically. A new request is needed after that.</p></div>` : ''}
            <div class="timeline-item"><div class="when">Now</div><b>${esc(statusPanel.title)}</b><p>Every view is recorded in the access log.</p></div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h3>Consent summary</h3>
          <dl class="kv">
            <dt>Status</dt><dd>${statusBadge(check.status)}</dd>
            <dt>Purpose</dt><dd>${esc(check.purpose)}</dd>
            <dt>Requested</dt><dd>${fmtDateTime(check.requestedAt)}</dd>
            <dt>Granted</dt><dd>${fmtDateTime(check.grantedAt)}</dd>
            <dt>Expires</dt><dd>${fmtDateTime(check.expiresAt)}</dd>
          </dl>
        </div>
        <div class="card dark"><h3>Worker rights</h3><p class="muted small mb-0">The worker can deny or revoke at any time. Revoking ends future access, but does not erase employment facts both parties already recorded.</p></div>
        ${check.canView ? `<a class="btn btn-orange" href="#/jobs">${icon('users')} Open employment records</a>` : ''}
      </div>
    </div>`;

  return {
    html,
    after() {
      document.querySelector('[data-checkin]')?.addEventListener('click', () => openCheckin(check, code));
    }
  };
}

function openCheckin(check, rememberedCode) {
  const m = modal({
    title: 'Record a check-in',
    sub: 'The worker must confirm before the job opens.',
    body: `<form data-checkin-form>
      <div class="field"><label for="ci-code">Worker short code</label>
        <input id="ci-code" name="code" required value="${esc(rememberedCode)}" style="text-transform:uppercase;font-family:var(--mono);letter-spacing:.15em" placeholder="K7M2QP"></div>
      <div class="field"><label for="ci-title">Job title</label>
        <input id="ci-title" name="jobTitle" placeholder="Herder, general farm worker, tractor driver"></div>
      <div class="notice">${icon('shield')} Only workers at L1 or above with approved consent can be checked in. The job appears in the worker's history only after they confirm.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Send check-in request</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const form = m.wrap.querySelector('[data-checkin-form]');
    const code = form.code.value.trim().toUpperCase();
    if (!code) { toast('Enter the worker code.', 'warn'); return; }
    try {
      const res = await api('/employments', { method: 'POST', body: { code, jobTitle: form.jobTitle.value.trim() || 'Farm worker' } });
      m.close();
      toast('Check-in recorded. Waiting for the worker to confirm.', 'ok');
      go('/jobs/' + res.id);
    } catch (err) { apiToast(err); }
  });
}

/* ================================================================== listings */

export async function listings() {
  const rows = await api('/listings/mine');
  return `${pageHead('Marketplace', 'My listings',
    'Livestock and farm produce appear publicly immediately unless an ear tag is reported missing, stolen or owned by someone else — then a reviewer checks it first.',
    `<a class="btn btn-orange" href="#/listings/new">${icon('plus')} New livestock</a>
     <a class="btn btn-ghost" href="#/listings/new?kind=produce">${icon('tag')} New produce</a>`)}

    ${rows.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Listing</th><th>Price</th><th>Location</th><th>Status</th><th>Reports</th><th></th></tr></thead>
      <tbody>${rows.map(r => {
        const l = r.view;
        const isProduce = l.kind === 'produce';
        return `<tr>
          <td><div class="row">${l.photoUrl ? `<img class="media-thumb" src="${esc(l.photoUrl)}" alt="">` : `<span class="media-thumb" style="display:grid;place-items:center;background:var(--olive-soft);color:var(--olive)">${icon(isProduce ? 'tag' : 'market')}</span>`}
            <div><b>${esc(l.species)}</b><div class="tiny muted">${isProduce
              ? `${esc(l.qty)} ${esc(l.unit || '')} · ${esc(l.category || 'Produce')}`
              : `${esc(l.qty)} animals${l.ageText ? ' · ' + esc(l.ageText) : ''}${l.sex ? ' · ' + esc(l.sex) : ''}`}</div></div>
            <span class="badge ${isProduce ? 'badge-olive' : 'badge-grey'}">${isProduce ? 'Produce' : 'Livestock'}</span></div></td>
          <td><b>${money(l.priceNad)}</b></td>
          <td>${esc(l.village || l.regionName || '')}</td>
          <td>${statusBadge(r.status)}${r.holdReason ? `<div class="tiny muted" style="max-width:220px">${esc(r.holdReason)}</div>` : ''}</td>
          <td>${r.reports ? `<span class="badge badge-red">${r.reports} open</span>` : '<span class="muted tiny">None</span>'}</td>
          <td><a class="btn btn-xs btn-ghost" href="#/market/${esc(l.id)}">View</a></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>` : emptyState({
      iconName: 'market',
      title: 'No listings yet',
      body: 'Add livestock or farm produce with a photo, a unit and an asking price. Buyers contact you on WhatsApp.',
      action: `<a class="btn btn-primary" href="#/listings/new">Create a listing</a>`
    })}`;
}

export async function listingNew({ query = {} } = {}) {
  const cfg = await loadConfig();
  let brands = [];
  try { brands = await api('/brands/mine'); } catch { brands = []; }
  const startKind = query.kind === 'produce' ? 'produce' : 'livestock';
  let photo = null;

  const html = `${pageHead('Marketplace', startKind === 'produce' ? 'List farm produce' : 'List livestock',
      'A clear photo and honest details sell faster. Listing a tag or produce does not transfer ownership.',
      `<a class="btn btn-ghost" href="#/listings">My listings</a>`)}

    <div class="split">
      <form class="card" data-listing-form>
        <input type="hidden" name="kind" value="${startKind}">
        <div class="market-tabs">
          <button type="button" class="market-tab${startKind === 'livestock' ? ' active' : ''}" data-kind="livestock">${icon('market')} Livestock</button>
          <button type="button" class="market-tab${startKind === 'produce' ? ' active' : ''}" data-kind="produce">${icon('tag')} Farm produce</button>
        </div>

        <div class="form-grid" data-group="livestock">
          <div class="field"><label for="l-species">Species</label><select id="l-species" name="species" required>${speciesOptions(cfg.species, 'Cattle')}</select></div>
          <div class="field"><label for="l-qty">Number of animals</label><input id="l-qty" name="qty" type="number" min="1" value="1" required></div>
          <div class="field"><label for="l-age">Age</label><input id="l-age" name="ageText" placeholder="e.g. 3 years, 8 months"></div>
          <div class="field"><label for="l-sex">Sex</label><select id="l-sex" name="sex"><option value="">Not stated</option><option>Female</option><option>Male</option><option>Mixed</option></select></div>
          <div class="field"><label for="l-price">Asking price (N$)</label><input id="l-price" name="priceNad" type="number" min="1" step="1" required placeholder="e.g. 6500"></div>
          <div class="field"><label for="l-brand">Brand mark</label><input id="l-brand" name="brandText" placeholder="e.g. JA7"></div>
          <div class="field span-2"><label for="l-tags">Ear tag numbers</label><input id="l-tags" name="tags" placeholder="NA12345, NA12346"><div class="hint">Separate with commas. Every tag is checked against the live register before the listing appears.</div></div>
        </div>

        <div class="form-grid" data-group="produce" hidden>
          <div class="field"><label for="p-species">What are you selling?</label><input id="p-species" name="pSpecies" placeholder="e.g. Free-range eggs, white maize, tomatoes" maxlength="60" required></div>
          <div class="field"><label for="p-category">Category</label><select id="p-category" name="pCategory">${cfg.produceCategories.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
          <div class="field"><label for="p-price">Price per unit (N$)</label><input id="p-price" name="pPrice" type="number" min="1" step="0.5" required placeholder="e.g. 65"></div>
          <div class="field"><label for="p-qty">Quantity available</label><input id="p-qty" name="pQty" type="number" min="1" value="1" required></div>
          <div class="field"><label for="p-unit">Sold per</label><select id="p-unit" name="pUnit">${cfg.produceUnits.map(u => `<option>${esc(u)}</option>`).join('')}</select></div>
          <div class="field"><label for="p-available">Available from</label><input id="p-available" name="pAvailable" placeholder="e.g. this week, every Friday" maxlength="60"></div>
          <div class="field span-2"><div class="notice">${icon('tag')} Produce listings show your product, category, quantity, unit and price. Add a real photo of what you are selling.</div></div>
        </div>

        <div class="form-grid">
          <div class="field"><label for="l-region">Region</label><select id="l-region" name="regionCode" required>${options(cfg.regions, state.me?.farmer?.regionCode || '')}</select></div>
          <div class="field"><label for="l-village">Village or area</label><input id="l-village" name="village" placeholder="e.g. Oshivelo"></div>
          <div class="field span-2">
            <label>Photo</label>
            <div class="photo-field">
              <span class="photo-thumb" data-listing-photo>${icon('camera')}</span>
              <div class="meta">A real photo of the animals or the produce. Well-lit photos sell faster.</div>
              <button type="button" class="btn btn-soft" data-take-photo>${icon('camera')} Take photo</button>
              <button type="button" class="btn btn-ghost" data-upload-photo>${icon('plus')} Upload photo</button>
              <input type="file" accept="image/*" data-photo-file hidden>
            </div>
          </div>
        </div>

        <div class="notice warn mb-2" data-livestock-only>${icon('alert')} Do not list animals that are stolen or reported missing. The tag register will hold the listing and notify a reviewer.</div>
        <button class="btn btn-orange" type="submit">${icon('market')} Publish listing</button>
      </form>

      <div class="stack">
        <div class="card"><h3>What buyers see</h3><p class="small muted">The product or animal, quantity, price, region and village. Your phone number is only used to open a WhatsApp chat.</p></div>
        <div class="card" data-livestock-only><h3>Your brands</h3>${brands.length ? `<div class="stack-sm">${brands.map(b => `<div class="row between small"><span>${esc(b.brandMarkText)}</span>${statusBadge(b.status)}</div>`).join('')}</div>` : `<p class="small muted mb-0">No brands registered. <a href="#/brands">Register a brand</a> to make found-animal matching possible.</p>`}</div>
        <div class="card dark"><h3>Fair selling</h3><p class="muted small mb-0">Be honest about quantity and condition. A written record and a clear unit price protect both sides.</p></div>
      </div>
    </div>`;

  return {
    html,
    after() {
      const form = document.querySelector('[data-listing-form]');
      const title = document.querySelector('.page-head h1');

      function setKind(next) {
        form.kind.value = next;
        form.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('active', b.dataset.kind === next));
        form.querySelectorAll('[data-group]').forEach(g => { g.hidden = g.dataset.group !== next; });
        document.querySelectorAll('[data-livestock-only]').forEach(el => { el.hidden = next !== 'livestock'; });
        title.textContent = next === 'produce' ? 'List farm produce' : 'List livestock';
      }
      form.querySelectorAll('[data-kind]').forEach(btn => btn.addEventListener('click', () => setKind(btn.dataset.kind)));
      setKind(startKind);

      function showPreview(dataUrl) {
        photo = dataUrl;
        form.querySelector('[data-listing-photo]').innerHTML = `<img src="${dataUrl}" alt="Listing preview">`;
      }

      form.querySelector('[data-take-photo]').addEventListener('click', async () => {
        const shot = await openCamera({
          title: form.kind.value === 'produce' ? 'Photo of the produce' : 'Photo of the animals',
          guide: 'doc',
          facing: 'environment',
          hint: 'Show the animals or produce clearly. Avoid photos of people or documents.',
          confirmLabel: 'Use this photo'
        });
        if (shot) showPreview(shot);
      });

      const fileInput = form.querySelector('[data-photo-file]');
      form.querySelector('[data-upload-photo]').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast('Choose an image file.', 'warn'); return; }
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
            showPreview(canvas.toDataURL('image/jpeg', 0.87));
            toast('Photo added to your listing.', 'ok');
          };
          img.onerror = () => toast('That image could not be read.', 'warn');
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });

      form.addEventListener('submit', async e => {
        e.preventDefault();
        const kind = form.kind.value;
        const btn = form.querySelector('button[type=submit]');
        if (!photo) { toast('Add a photo of what you are selling.', 'warn'); return; }
        btn.disabled = true; btn.textContent = 'Publishing…';
        try {
          const body = {
            kind,
            qty: Number(kind === 'produce' ? form.pQty.value : form.qty.value),
            priceNad: Number(kind === 'produce' ? form.pPrice.value : form.priceNad.value),
            regionCode: form.regionCode.value,
            village: form.village.value.trim() || undefined,
            photo: photo || undefined
          };
          if (kind === 'produce') {
            body.species = form.pSpecies.value.trim();
            body.category = form.pCategory.value;
            body.unit = form.pUnit.value;
            body.ageText = form.pAvailable.value.trim() || undefined;
          } else {
            body.species = form.species.value;
            body.ageText = form.ageText.value.trim() || undefined;
            body.sex = form.sex.value || undefined;
            body.brandText = form.brandText.value.trim() || undefined;
            body.tagNumbers = splitList(form.tags.value);
          }
          const res = await api('/listings', { method: 'POST', body });
          toast(res.message, res.held ? 'warn' : 'ok', 7000);
          go('/listings');
        } catch (err) {
          apiToast(err);
          btn.disabled = false; btn.innerHTML = `${icon('market')} Publish listing`;
        }
      });
    }
  };
}

/* ================================================================== brands, tags, missing */

export async function brands() {
  const cfg = await loadConfig();
  const [brandRows, tagRows, missingRows] = await Promise.all([
    api('/brands/mine').catch(() => []),
    api('/tags/mine').catch(() => []),
    api('/missing-reports/mine').catch(() => [])
  ]);
  const brandOptions = brandRows.map(b => `<option value="${esc(b.id)}">${esc(b.brandMarkText)}${b.status !== 'verified' ? ' (pending)' : ''}</option>`).join('');

  return {
    html: `${pageHead('Brand & Trade Tracker', 'Brands & ear tags',
      'A verified brand and a live tag register are what let a found animal find its way home — without the finder ever seeing your name.',
      `<button class="btn btn-primary" data-new-brand>${icon('plus')} Register brand</button>
       <button class="btn btn-ghost" data-new-tag>${icon('tag')} Register ear tag</button>`)}

      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><div><h3>${icon('tag')} Brands</h3><p class="card-sub">Reviewers verify the certificate or registration number.</p></div><span class="badge badge-grey">${brandRows.length}</span></div>
          ${brandRows.length ? `<div class="stack">${brandRows.map(b => `<div class="card tight" style="box-shadow:none">
            <div class="row between">
              <div><div class="title mono" style="font-size:1.05rem">${esc(b.brandMarkText)}</div>
                <div class="small muted">${esc(b.registrationNo || 'No registration number')} · ${esc(b.area)} · ${esc(b.regionName || '')}</div>
                <div class="row mt-1">${statusBadge(b.status)} <span class="tiny muted">${b.tags?.length || 0} tag${b.tags?.length === 1 ? '' : 's'}</span></div>
              </div>
              <div class="row">
                ${b.photoUrl ? `<a class="btn btn-xs btn-ghost" href="${esc(b.photoUrl)}" target="_blank" rel="noopener">Photo</a>` : ''}
                ${b.certificateUrl ? `<a class="btn btn-xs btn-ghost" href="${esc(b.certificateUrl)}" target="_blank" rel="noopener">Certificate</a>` : ''}
              </div>
            </div>
            ${b.tags?.length ? `<div class="row mt-1" style="gap:6px">${b.tags.map(t => `<span class="badge badge-${t.status === 'live' ? 'green' : t.status === 'missing' ? 'amber' : 'grey'} plain mono">${esc(t.tagNumber)}</span>`).join('')}</div>` : ''}
          </div>`).join('')}</div>` : `<p class="small muted mb-0">No brands yet. Register the mark used on your animals.</p>`}
        </div>

        <div class="card">
          <div class="card-head"><div><h3>${icon('qr')} Ear tags</h3><p class="card-sub">One live owner per tag. Duplicates are routed to a reviewer.</p></div><span class="badge badge-grey">${tagRows.length}</span></div>
          ${tagRows.length ? `<div class="table-wrap" style="border:0"><table class="table" style="min-width:0">
            <thead><tr><th>Tag</th><th>Species</th><th>Brand</th><th>Status</th><th></th></tr></thead>
            <tbody>${tagRows.map(t => `<tr>
              <td class="mono"><b>${esc(t.view.tagNumber)}</b></td>
              <td>${esc(t.view.species)}${t.view.herdName ? `<div class="tiny muted">${esc(t.view.herdName)}</div>` : ''}</td>
              <td>${esc(t.brandMark || '—')}</td>
              <td>${statusBadge(t.view.status)}${t.missingReportId ? '<div class="tiny muted">Missing report open</div>' : ''}</td>
              <td><button class="btn btn-xs btn-ghost" data-tag-history="${esc(t.view.id)}">History</button></td>
            </tr>`).join('')}</tbody>
          </table></div>` : `<p class="small muted mb-0">No ear tags registered.</p>`}
        </div>
      </div>

      <div class="card mt-3">
        <div class="card-head"><div><h3>${icon('pin')} Missing animals</h3><p class="card-sub">Reporting missing animals also holds any marketplace listing that carries their tags.</p></div>
          <button class="btn btn-sm btn-danger" data-new-missing>${icon('alert')} Report missing</button></div>
        ${missingRows.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Tags</th><th>Species</th><th>Last seen</th><th>Police case</th><th>Status</th><th></th></tr></thead>
          <tbody>${missingRows.map(m => `<tr>
            <td class="mono">${m.tags.map(t => esc(t)).join(', ')}</td>
            <td>${esc(m.qty)} × ${esc(m.species)}</td>
            <td>${esc(m.lastSeenPlace || '—')}<div class="tiny muted">${m.lastSeenAt ? fmtDate(m.lastSeenAt) : ''}</div></td>
            <td>${esc(m.policeCaseNo || '—')}</td>
            <td>${statusBadge(m.status)}</td>
            <td class="tiny muted">${timeAgo(m.createdAt)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<p class="small muted mb-0">No open missing-animal reports.</p>`}
      </div>

      <div class="notice info mt-3">${icon('shield')} Brands, tag cards and certificates are private files. They are shared with reviewers and, for a claim, with the people in that case.</div>`,
    after() {
      document.querySelector('[data-new-brand]').addEventListener('click', () => openBrandForm(cfg));
      document.querySelector('[data-new-tag]').addEventListener('click', () => openTagForm(cfg, brandOptions));
      document.querySelector('[data-new-missing]').addEventListener('click', () => openMissingForm(cfg, brandOptions));
      document.querySelectorAll('[data-tag-history]').forEach(b => b.addEventListener('click', () => openTagHistory(b.dataset.tagHistory)));
    }
  };
}

function openBrandForm(cfg) {
  const photos = { photo: null, certificate: null };
  const m = modal({
    title: 'Register a brand mark',
    sub: 'A reviewer checks the certificate before it can match found animals.',
    wide: true,
    body: `<form data-brand-form>
      <div class="form-grid">
        <div class="field"><label for="b-mark">Brand mark</label><input id="b-mark" name="brandMarkText" required placeholder="e.g. JA7"><div class="hint">Letters and numbers as they appear on the animal.</div></div>
        <div class="field"><label for="b-reg">Registration number</label><input id="b-reg" name="brandRegistrationNo" placeholder="Brand registration number"></div>
        <div class="field"><label for="b-area">Area type</label><select id="b-area" name="brandArea"><option value="communal">Communal</option><option value="commercial">Commercial</option></select></div>
        <div class="field"><label for="b-region">Region</label><select id="b-region" name="regionCode">${options(cfg.regions, state.me?.farmer?.regionCode || '')}</select></div>
        <div class="field"><label>Brand photo</label><div class="photo-field"><span class="photo-thumb doc" data-b-photo>${icon('camera')}</span><button type="button" class="btn btn-sm btn-soft" data-b-photo-btn>Capture</button></div></div>
        <div class="field"><label>Certificate</label><div class="photo-field"><span class="photo-thumb doc" data-b-cert>${icon('doc')}</span><button type="button" class="btn btn-sm btn-soft" data-b-cert-btn>Capture</button></div></div>
      </div>
      <div class="notice">${icon('shield')} Without a certificate or registration number a reviewer cannot verify the brand.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Submit for verification</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-b-photo-btn]').addEventListener('click', async () => {
    const shot = await openCamera({ title: 'Brand photo', guide: 'doc', facing: 'environment', confirmLabel: 'Use photo' });
    if (shot) { photos.photo = shot; m.wrap.querySelector('[data-b-photo]').innerHTML = `<img src="${shot}" alt="">`; }
  });
  m.wrap.querySelector('[data-b-cert-btn]').addEventListener('click', async () => {
    const shot = await openCamera({ title: 'Brand certificate', guide: 'doc', facing: 'environment', confirmLabel: 'Use certificate' });
    if (shot) { photos.certificate = shot; m.wrap.querySelector('[data-b-cert]').innerHTML = `<img src="${shot}" alt="">`; }
  });
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const form = m.wrap.querySelector('[data-brand-form]');
    try {
      await api('/brands', {
        method: 'POST',
        body: {
          brandMarkText: form.brandMarkText.value.trim(),
          brandRegistrationNo: form.brandRegistrationNo.value.trim() || undefined,
          brandArea: form.brandArea.value,
          regionCode: form.regionCode.value || undefined,
          photo: photos.photo || undefined,
          certificate: photos.certificate || undefined
        }
      });
      m.close();
      toast('Brand submitted. A reviewer checks it before it can match found animals.', 'ok');
      go('/brands');
    } catch (err) { apiToast(err); }
  });
}

function openTagForm(cfg, brandOptions) {
  const card = { image: null };
  const m = modal({
    title: 'Register an ear tag',
    sub: 'One live owner per tag number.',
    wide: true,
    body: `<form data-tag-form>
      <div class="form-grid">
        <div class="field"><label for="t-number">Tag number</label><input id="t-number" name="tagNumber" required placeholder="e.g. NA12345" style="font-family:var(--mono);letter-spacing:.08em"></div>
        <div class="field"><label for="t-species">Species</label><select id="t-species" name="species">${speciesOptions(cfg.species, 'Cattle')}</select></div>
        <div class="field"><label for="t-brand">Brand</label><select id="t-brand" name="brandId"><option value="">No brand</option>${brandOptions}</select></div>
        <div class="field"><label for="t-herd">Herd name</label><input id="t-herd" name="herdName" placeholder="e.g. North camp"></div>
        <div class="field span-2"><label class="check group"><input type="checkbox" name="namlitsRegistered"><span>Registered with NamLITS</span></label></div>
        <div class="field span-2"><label>Tag card</label><div class="photo-field"><span class="photo-thumb doc" data-t-card>${icon('doc')}</span><button type="button" class="btn btn-sm btn-soft" data-t-card-btn>Capture card</button></div></div>
      </div>
      <div class="notice warn">${icon('alert')} If this tag is already live for another owner, your registration is refused and sent to a reviewer. That is how theft is caught.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Register tag</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-t-card-btn]').addEventListener('click', async () => {
    const shot = await openCamera({ title: 'Tag registration card', guide: 'doc', facing: 'environment', confirmLabel: 'Use card' });
    if (shot) { card.image = shot; m.wrap.querySelector('[data-t-card]').innerHTML = `<img src="${shot}" alt="">`; }
  });
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const form = m.wrap.querySelector('[data-tag-form]');
    try {
      await api('/tags', {
        method: 'POST',
        body: {
          tagNumber: form.tagNumber.value.trim(),
          species: form.species.value,
          brandId: form.brandId.value || undefined,
          herdName: form.herdName.value.trim() || undefined,
          namlitsRegistered: form.namlitsRegistered.checked,
          card: card.image || undefined
        }
      });
      m.close();
      toast('Ear tag registered.', 'ok');
      go('/brands');
    } catch (err) { apiToast(err); }
  });
}

async function openTagHistory(id) {
  try {
    const data = await api('/tags/' + encodeURIComponent(id) + '/history');
    const m = modal({
      title: 'Tag history',
      sub: `${data.tag.tagNumber} · ${data.tag.species}`,
      wide: true,
      body: `<div class="row mb-2">${statusBadge(data.tag.status)} ${data.tag.namlitsRegistered ? '<span class="badge badge-blue">NamLITS</span>' : ''}</div>
        <h4 style="font-family:var(--sans);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Transfers</h4>
        ${data.transfers.length ? `<div class="list">${data.transfers.map(t => `<div class="list-row"><div class="grow"><div class="title">Transfer ${esc(t.status)}</div><div class="sub">${fmtDate(t.createdAt)}${t.movementPermitNo ? ' · permit ' + esc(t.movementPermitNo) : ''}</div></div></div>`).join('')}</div>` : '<p class="small muted">No transfers recorded.</p>'}
        <div class="divider"></div>
        <h4 style="font-family:var(--sans);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Missing reports</h4>
        ${data.missingReports.length ? `<div class="list">${data.missingReports.map(r => `<div class="list-row"><div class="grow"><div class="title">${esc(r.status)}</div><div class="sub">${fmtDate(r.created_at || r.createdAt)}</div></div></div>`).join('')}</div>` : '<p class="small muted mb-0">No missing reports for this tag.</p>'}`,
      footer: `<button class="btn btn-primary" data-close>Close</button>`
    });
    m.wrap.querySelector('[data-close]').addEventListener('click', () => m.close());
  } catch (err) { apiToast(err); }
}

function openMissingForm(cfg, brandOptions) {
  const m = modal({
    title: 'Report missing animals',
    sub: 'This marks the tags as missing and holds matching marketplace listings.',
    wide: true,
    body: `<form data-missing-form>
      <div class="form-grid">
        <div class="field span-2"><label for="m-tags">Ear tag numbers</label><input id="m-tags" name="tags" required placeholder="NA12345, NA12346" style="font-family:var(--mono)"><div class="hint">Separate with commas.</div></div>
        <div class="field"><label for="m-species">Species</label><select id="m-species" name="species">${speciesOptions(cfg.species, 'Cattle')}</select></div>
        <div class="field"><label for="m-qty">Number missing</label><input id="m-qty" name="qty" type="number" min="1" value="1"></div>
        <div class="field"><label for="m-brand">Brand</label><select id="m-brand" name="brandId"><option value="">No brand</option>${brandOptions}</select></div>
        <div class="field"><label for="m-police">Police case number</label><input id="m-police" name="policeCaseNo" placeholder="If reported to the police"></div>
        <div class="field"><label for="m-place">Last seen place</label><input id="m-place" name="lastSeenPlace" placeholder="Village, camp or water point"></div>
        <div class="field"><label for="m-seen">Last seen date</label><input id="m-seen" name="lastSeenAt" type="date"></div>
      </div>
      <div class="notice">${icon('shield')} If someone logs a found animal with your brand or tags, you are alerted. You will never receive the finder's details.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-danger" data-send>Report missing</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const form = m.wrap.querySelector('[data-missing-form]');
    try {
      await api('/missing-reports', {
        method: 'POST',
        body: {
          tagNumbers: splitList(form.tags.value),
          species: form.species.value,
          qty: Number(form.qty.value),
          brandId: form.brandId.value || undefined,
          policeCaseNo: form.policeCaseNo.value.trim() || undefined,
          lastSeenPlace: form.lastSeenPlace.value.trim() || undefined,
          lastSeenAt: form.lastSeenAt.value || undefined
        }
      });
      m.close();
      toast('Missing-animal report opened. Matching listings are held.', 'ok');
      go('/brands');
    } catch (err) { apiToast(err); }
  });
}

/* ================================================================== found reports & claims */

export async function foundReports() {
  const [rows, claims] = await Promise.all([
    api('/found-reports/matched-to-me').catch(() => []),
    api('/claims/mine').catch(() => [])
  ]);
  const docTypes = ['brand_certificate', 'registration_card', 'tag_record', 'namlits_record', 'other'];

  return {
    html: `${pageHead('Brand & Trade Tracker', 'Found reports & claims',
      'A match is a lead, not proof. Only the owner identified by the blind match can claim, and a claim needs documents.',
      `<a class="btn btn-ghost" href="#/brands">${icon('tag')} Brands & tags</a>`)}

      ${rows.length ? `<div class="stack">${rows.map(r => {
        const v = r.view;
        return `<div class="card">
          <div class="card-head">
            <div class="row" style="gap:14px">
              ${v.photoUrl ? `<img src="${esc(v.photoUrl)}" alt="" style="width:84px;height:64px;border-radius:10px;object-fit:cover">` : `<span class="avatar avatar-lg">${icon('search')}</span>`}
              <div><h3 style="margin-bottom:2px">${esc(v.qty)} × ${esc(v.species)} found</h3>
                <div class="card-sub">Case <span class="mono">${esc(v.caseRef)}</span> · ${esc(v.locationText || 'Location not stated')}</div>
                <div class="row mt-1">${statusBadge(v.status)} ${r.claim ? statusBadge(r.claim.status, 'Claim ' + labelize(r.claim.status)) : ''}</div>
              </div>
            </div>
            <span class="tiny muted">${timeAgo(v.createdAt)}</span>
          </div>
          <dl class="kv">
            <dt>Brand reported</dt><dd>${esc(v.brandText || '—')}</dd>
            <dt>Tags</dt><dd>${v.tagNumbers?.length ? v.tagNumbers.map(t => `<span class="badge badge-grey plain mono">${esc(t)}</span>`).join(' ') : '—'}</dd>
            <dt>Expires</dt><dd>${fmtDateTime(v.expiresAt)}</dd>
            ${r.claim?.handoverMethod ? `<dt>Handover</dt><dd>${esc(labelize(r.claim.handoverMethod))} · ${fmtDateTime(r.claim.handoverAt)} · ${esc(r.claim.handoverPlace || '')}</dd>` : ''}
            ${r.claim?.reason ? `<dt>Decision note</dt><dd>${esc(r.claim.reason)}</dd>` : ''}
          </dl>
          <div class="row mt-2">
            ${r.canClaim && !r.claim ? `<button class="btn btn-primary" data-claim="${esc(v.caseRef)}">${icon('doc')} Claim these animals</button>` : ''}
            ${r.claim?.status === 'pending' ? '<span class="badge badge-amber">Claim waiting for reviewer</span>' : ''}
            ${r.claim?.status === 'approved' && !r.claim.handoverMethod ? `<button class="btn btn-orange" data-handover="${esc(r.claim.id)}">Arrange handover</button>` : ''}
            ${r.claim?.status === 'approved' && r.claim.handoverMethod ? '<span class="badge badge-green">Handover arranged</span>' : ''}
            ${r.claim?.status === 'rejected' ? `<span class="badge badge-red">Claim not approved</span>` : ''}
            <span class="tiny muted">Finders never see your details. You never see theirs.</span>
          </div>
        </div>`;
      }).join('')}</div>` : emptyState({
        iconName: 'search',
        title: 'No found animals matched to you',
        body: 'When someone reports a found animal carrying your verified brand or a live tag from your register, it appears here with a case reference.',
        action: `<a class="btn btn-ghost" href="#/brands">Check my brand register</a>`
      })}

      ${claims.length ? `<h2 class="mb-2 mt-3">My claims</h2><div class="table-wrap"><table class="table">
        <thead><tr><th>Case</th><th>Animals</th><th>Status</th><th>Handover</th><th>Decision note</th></tr></thead>
        <tbody>${claims.map(c => `<tr>
          <td class="mono">${esc(c.caseRef)}</td>
          <td>${esc(c.qty)} × ${esc(c.species)}<div class="tiny muted">${esc(c.locationText || '')}</div></td>
          <td>${statusBadge(c.status)}<div class="tiny muted">Report: ${esc(labelize(c.reportStatus))}</div></td>
          <td>${c.handoverMethod ? `${esc(labelize(c.handoverMethod))}<div class="tiny muted">${fmtDateTime(c.handoverAt)} · ${esc(c.handoverPlace || '')}</div>` : '—'}</td>
          <td class="small">${esc(c.reason || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : ''}`,
    after() {
      document.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => openClaimForm(b.dataset.claim, docTypes)));
      document.querySelectorAll('[data-handover]').forEach(b => b.addEventListener('click', () => openHandover(b.dataset.handover)));
    }
  };
}

function openClaimForm(caseRef, docTypes) {
  const docs = [];
  const m = modal({
    title: 'Claim found animals',
    sub: `Case ${caseRef}`,
    wide: true,
    body: `<form data-claim-form>
      <div class="field"><label for="c-statement">How do you prove ownership?</label>
        <textarea id="c-statement" required minlength="20" placeholder="Describe the brand, the animals, where they were last seen, and the documents you can provide."></textarea></div>
      <div class="field"><label>Supporting documents</label><div data-docs class="stack-sm"></div>
        <button type="button" class="btn btn-sm btn-soft mt-1" data-add-doc>${icon('plus')} Add document</button>
        <div class="hint">At least one brand certificate, registration card or tag record is required.</div></div>
      <div class="notice">${icon('shield')} Your documents are visible to the reviewer and the finder only as status. Finders never see your name or documents.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Submit claim</button>`
  });

  function addDocRow() {
    const idx = docs.length;
    const row = document.createElement('div');
    row.className = 'form-grid';
    row.style.cssText = 'border:1px solid var(--line);border-radius:12px;padding:12px 14px 0;margin-bottom:8px';
    row.innerHTML = `<div class="field"><label>Document type</label><select data-doctype>${docTypes.map(t => `<option value="${t}">${labelize(t)}</option>`).join('')}</select></div>
      <div class="field"><label>Photo or PDF scan</label><div class="photo-field"><span class="photo-thumb doc" data-doc-preview>${icon('doc')}</span><button type="button" class="btn btn-xs btn-soft" data-doc-btn>Capture</button></div></div>`;
    docs.push(null);
    row.querySelector('[data-doc-btn]').addEventListener('click', async () => {
      const shot = await openCamera({ title: 'Document photo', guide: 'doc', facing: 'environment', confirmLabel: 'Use document' });
      if (shot) {
        docs[idx] = shot;
        row.querySelector('[data-doc-preview]').innerHTML = `<img src="${shot}" alt="">`;
      }
    });
    m.wrap.querySelector('[data-docs]').appendChild(row);
  }
  addDocRow();
  m.wrap.querySelector('[data-add-doc]').addEventListener('click', addDocRow);
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const form = m.wrap.querySelector('[data-claim-form]');
    const statement = form.querySelector('#c-statement').value.trim();
    const rows = [...m.wrap.querySelectorAll('[data-docs] > div')];
    const documents = rows.map((row, i) => ({ docType: row.querySelector('[data-doctype]').value, image: docs[i] })).filter(d => d.image);
    if (statement.length < 20) { toast('Explain how you prove ownership (at least 20 characters).', 'warn'); return; }
    if (!documents.length) { toast('Attach at least one document.', 'warn'); return; }
    try {
      await api(`/found-reports/${encodeURIComponent(caseRef)}/claims`, { method: 'POST', body: { statement, documents } });
      m.close();
      toast('Claim submitted. A reviewer checks the documents.', 'ok');
      go('/found-reports');
    } catch (err) { apiToast(err); }
  });
}

function openHandover(claimId) {
  const m = modal({
    title: 'Arrange the handover',
    sub: 'Only after a claim is approved.',
    body: `<form data-handover-form>
      <div class="field"><label for="h-method">Method</label>
        <select id="h-method" name="method">
          <option value="police_station">At a Namibian Police station</option>
          <option value="state_vet_office">At the State Veterinary office</option>
          <option value="direct_with_consent">Directly, with both parties' consent</option>
        </select></div>
      <div class="field"><label for="h-place">Place</label><input id="h-place" name="place" placeholder="Station or office"></div>
      <div class="field"><label for="h-at">Date</label><input id="h-at" name="at" type="date"></div>
      <label class="check group" data-consent-box hidden><input type="checkbox" name="bothPartiesConsent"><span>Both the finder and I agree to a direct handover.</span></label>
      <div class="notice warn">${icon('alert')} Never pay a reward under pressure. The police or State Veterinary office can hold the animals until the handover.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Arrange handover</button>`
  });
  const method = m.wrap.querySelector('#h-method');
  method.addEventListener('change', () => { m.wrap.querySelector('[data-consent-box]').hidden = method.value !== 'direct_with_consent'; });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const form = m.wrap.querySelector('[data-handover-form]');
    try {
      await api(`/claims/${encodeURIComponent(claimId)}/handover`, {
        method: 'POST',
        body: {
          method: form.method.value,
          place: form.place.value.trim() || undefined,
          at: form.at.value || undefined,
          bothPartiesConsent: form.bothPartiesConsent?.checked || false
        }
      });
      m.close();
      toast('Handover arranged. Both parties have been notified.', 'ok');
      go('/found-reports');
    } catch (err) { apiToast(err); }
  });
}

/* ================================================================== transfers */

export async function transfers() {
  const rows = await api('/transfers/mine');
  const isBuyerPending = rows.some(r => r.canConfirm);
  return {
    html: `${pageHead('Brand & Trade Tracker', 'Livestock transfers',
      'A transfer changes the owner on the tag register only after both the seller and the buyer confirm.',
      `<button class="btn btn-primary" data-new-transfer>${icon('plus')} New transfer</button>`)}

      ${isBuyerPending ? `<div class="notice warn mb-3">${icon('bell')} A transfer is waiting for your confirmation. Confirm only after you have seen the animals and tags.</div>` : ''}
      ${rows.length ? `<div class="stack">${rows.map(t => `<div class="card tight">
        <div class="row between">
          <div>
            <div class="row mb-1">${statusBadge(t.status)} ${t.movementPermitNo ? `<span class="badge badge-blue plain">Permit ${esc(t.movementPermitNo)}</span>` : ''}</div>
            <div class="title">${esc(t.sellerName)} → ${esc(t.buyerName)}</div>
            <div class="small muted">${t.items.map(i => `${esc(i.qty)} × ${esc(i.species)} (${esc(i.tagNumber || 'tag')})`).join(', ')}</div>
            <div class="tiny muted">Created ${fmtDateTime(t.createdAt)}${t.sellerConfirmedAt ? ' · seller confirmed ' + fmtDate(t.sellerConfirmedAt) : ''}${t.buyerConfirmedAt ? ' · buyer confirmed ' + fmtDate(t.buyerConfirmedAt) : ''}</div>
          </div>
          <div class="row">
            ${t.canConfirm ? `<button class="btn btn-sm btn-primary" data-confirm-transfer="${esc(t.id)}">${icon('check')} Confirm</button>` : ''}
            ${t.status !== 'confirmed' && t.status !== 'cancelled' ? `<button class="btn btn-sm btn-ghost" data-cancel-transfer="${esc(t.id)}">Cancel</button>` : ''}
          </div>
        </div>
      </div>`).join('')}</div>` : emptyState({
        iconName: 'arrow',
        title: 'No transfers',
        body: 'Record a sale with the buyer\'s phone number and the ear tags. Both parties confirm before the register changes.',
        action: `<button class="btn btn-primary" data-new-transfer>Start a transfer</button>`
      })}`,
    after() {
      document.querySelectorAll('[data-new-transfer]').forEach(b => b.addEventListener('click', openTransferForm));
      document.querySelectorAll('[data-confirm-transfer]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmDialog({ title: 'Confirm this transfer?', message: 'Only confirm after the animals and tags are in front of you. When both parties confirm, the register changes owner.', confirmLabel: 'Confirm transfer' })) return;
        try {
          await api(`/transfers/${encodeURIComponent(b.dataset.confirmTransfer)}/confirm`, { method: 'POST' });
          toast('Transfer confirmed.', 'ok');
          go('/transfers');
        } catch (err) { apiToast(err); }
      }));
      document.querySelectorAll('[data-cancel-transfer]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmDialog({ title: 'Cancel this transfer?', message: 'The tag register will not change. The other party is notified.', confirmLabel: 'Cancel transfer', danger: true })) return;
        try {
          await api(`/transfers/${encodeURIComponent(b.dataset.cancelTransfer)}/cancel`, { method: 'POST' });
          toast('Transfer cancelled.', 'ok');
          go('/transfers');
        } catch (err) { apiToast(err); }
      }));
    }
  };
}

function openTransferForm() {
  const m = modal({
    title: 'New livestock transfer',
    sub: 'Both parties must confirm before the register changes.',
    body: `<form data-transfer-form>
      <div class="field"><label for="tr-phone">Buyer phone number</label><input id="tr-phone" name="buyerPhone" type="tel" required placeholder="+264 81 …"><div class="hint">The buyer must already have a KraaLink account.</div></div>
      <div class="field"><label for="tr-tags">Ear tag numbers</label><input id="tr-tags" name="tags" required style="font-family:var(--mono)" placeholder="NA12345, NA12346"></div>
      <div class="field"><label for="tr-permit">Movement permit number</label><input id="tr-permit" name="movementPermitNo" placeholder="If required for this movement"></div>
      <div class="notice">${icon('shield')} The buyer receives a WhatsApp message and confirms separately. Neither party can change the register alone.</div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Send to buyer</button>`
  });
  m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
  m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
    const form = m.wrap.querySelector('[data-transfer-form]');
    try {
      await api('/transfers', {
        method: 'POST',
        body: {
          buyerPhone: form.buyerPhone.value.trim(),
          tagNumbers: splitList(form.tags.value),
          movementPermitNo: form.permit.value.trim() || undefined
        }
      });
      m.close();
      toast('Transfer sent. The buyer has been notified on WhatsApp.', 'ok');
      go('/transfers');
    } catch (err) { apiToast(err); }
  });
}

/* ================================================================== herds */

export async function herds() {
  const rows = await api('/herds');
  return `${pageHead('Livestock health', 'Herds & vaccinations',
    'Keep a simple herd register and upcoming vaccination dates. Reminders are sent on WhatsApp.',
    `<button class="btn btn-primary" data-new-herd>${icon('plus')} Add herd</button>
     <a class="btn btn-ghost" href="#/vet">${icon('vet')} VetBot triage</a>`)}

    ${rows.length ? `<div class="grid cols-2">${rows.map(h => `<div class="card">
      <div class="card-head"><div><h3>${esc(h.species)} herd</h3><p class="card-sub">${esc(h.headCount)} head</p></div><span class="badge badge-green plain">${h.schedules.length} schedule${h.schedules.length === 1 ? '' : 's'}</span></div>
      ${h.schedules.length ? `<div class="list">${h.schedules.map(s => `<div class="list-row">
        <div class="grow"><div class="title">${esc(s.vaccine)}</div><div class="sub">Next due ${fmtDate(s.nextDue)}${s.dueSoon ? ' · due soon' : ''}</div></div>
        ${s.dueSoon ? '<span class="badge badge-amber">Due</span>' : '<span class="badge badge-green">Scheduled</span>'}
      </div>`).join('')}</div>` : '<p class="small muted">No vaccination dates yet.</p>'}
      <button class="btn btn-soft btn-sm mt-2" data-add-vaccination="${esc(h.id)}">${icon('plus')} Add vaccination</button>
    </div>`).join('')}</div>` : emptyState({
      iconName: 'vet',
      title: 'No herds yet',
      body: 'Add the species and number of animals. You can then keep vaccination dates and get a reminder before they are due.',
      action: `<button class="btn btn-primary" data-new-herd>Add your first herd</button>`
    })}

    <div class="notice mt-3">${icon('alert')} Vaccination reminders are administrative. They do not replace advice from a vet or animal health technician.</div>`;
}

export function wireHerds() {
  document.querySelectorAll('[data-new-herd]').forEach(b => b.addEventListener('click', () => {
    const m = modal({
      title: 'Add a herd',
      body: `<form data-herd-form>
        <div class="field"><label for="h-species">Species</label><select id="h-species" name="species"><option>Cattle</option><option>Goats</option><option>Sheep</option><option>Pigs</option><option>Donkeys</option><option>Horses</option></select></div>
        <div class="field"><label for="h-head">Number of animals</label><input id="h-head" name="headCount" type="number" min="1" value="1" required></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Add herd</button>`
    });
    m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
    m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
      const form = m.wrap.querySelector('[data-herd-form]');
      try {
        await api('/herds', { method: 'POST', body: { species: form.species.value, headCount: Number(form.headCount.value) } });
        m.close(); toast('Herd added.', 'ok'); go('/herds');
      } catch (err) { apiToast(err); }
    });
  }));
  document.querySelectorAll('[data-add-vaccination]').forEach(b => b.addEventListener('click', () => {
    const m = modal({
      title: 'Add a vaccination',
      body: `<form data-vac-form>
        <div class="field"><label for="v-vaccine">Vaccine</label><input id="v-vaccine" name="vaccine" required placeholder="e.g. Anthrax, Brucellosis"></div>
        <div class="field"><label for="v-last">Last done</label><input id="v-last" name="lastDone" type="date"></div>
        <div class="field"><label for="v-next">Next due</label><input id="v-next" name="nextDue" type="date" required></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-send>Save</button>`
    });
    m.wrap.querySelector('[data-cancel]').addEventListener('click', () => m.close());
    m.wrap.querySelector('[data-send]').addEventListener('click', async () => {
      const form = m.wrap.querySelector('[data-vac-form]');
      try {
        await api(`/herds/${encodeURIComponent(b.dataset.addVaccination)}/vaccinations`, {
          method: 'POST',
          body: { vaccine: form.vaccine.value.trim(), lastDone: form.lastDone.value || undefined, nextDue: form.nextDue.value }
        });
        m.close(); toast('Vaccination saved.', 'ok'); go('/herds');
      } catch (err) { apiToast(err); }
    });
  }));
}
