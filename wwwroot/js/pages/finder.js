import {
  api, apiToast, loadConfig, esc, icon, fmtDate, timeAgo, statusBadge,
  modal, openCamera, emptyState, pageHead, copyText
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

function reportStatusNote(status) {
  return ({
    open: 'Logged. No brand or tag matched yet. The report stays open and is re-checked automatically.',
    match_found: 'A register match was found. The owner has been alerted. A reviewer checks any claim before ownership is confirmed.',
    claim_pending: 'The matched owner submitted a claim. A reviewer is checking the documents.',
    claim_approved: 'A reviewer approved an ownership claim. Handover is arranged through the police, the State Veterinary office, or directly if both sides consent.',
    handover_arranged: 'Handover has been arranged. Bring the animals to the agreed place. Never pay a reward under pressure.',
    closed: 'This case is closed.',
    expired: 'No match was confirmed within the retention window. The report is now closed.'
  })[status] || 'Status recorded.';
}

/* ================================================================== report found */

export async function reportFound() {
  const cfg = await loadConfig();
  let photo = null;

  const html = `${pageHead('Brand & Trade Tracker', 'Report found livestock',
    'You will never see the owner’s name, phone number or farm. The register matches a brand or tag and alerts the owner privately.',
    `<a class="btn btn-ghost" href="#/my-reports">${icon('doc')} My reports</a>`)}

    <div class="split">
      <form class="card" data-found-form>
        <div class="card-head"><div><h3>${icon('search')} What did you find?</h3><p class="card-sub">A brand mark, one ear-tag number or a clear photo is enough to log a report.</p></div></div>
        <div class="form-grid">
          <div class="field"><label for="fd-species">Species</label><select id="fd-species" name="species" required>${speciesOptions(cfg.species, 'Cattle')}</select></div>
          <div class="field"><label for="fd-qty">How many animals?</label><input id="fd-qty" name="qty" type="number" min="1" value="1" required></div>
          <div class="field"><label for="fd-brand">Brand mark</label><input id="fd-brand" name="brandText" placeholder="e.g. JA7"><div class="hint">Copy the mark exactly as it appears on the animal.</div></div>
          <div class="field"><label for="fd-tags">Ear-tag numbers</label><input id="fd-tags" name="tags" placeholder="NA12345, NA12346"><div class="hint">Separate with commas if you can read more than one.</div></div>
          <div class="field span-2"><label for="fd-location">Where did you find them?</label><input id="fd-location" name="locationText" required placeholder="Village, road or water point"><div class="hint">A place description helps a reviewer and the owner’s case, but your contact details stay private.</div></div>
          <div class="field span-2">
            <label>Photo of the animals</label>
            <div class="photo-field">
              <span class="photo-thumb" data-found-photo>${icon('camera')}</span>
              <div class="meta">Show the animals and, if visible, the brand or ear tag. Do not photograph people.</div>
              <button type="button" class="btn btn-soft" data-take-photo>${icon('camera')} Take photo</button>
            </div>
          </div>
        </div>
        <div class="notice info mb-2">${icon('shield')} Your name is not shown to the owner. Handover is arranged through the police or the State Veterinary office unless both sides consent to meet directly.</div>
        <div class="notice warn mb-2">${icon('alert')} Never confront a suspected owner or pay to get animals back. Report extortion to the Namibian Police.</div>
        <button class="btn btn-orange" type="submit">${icon('search')} Log found report</button>
      </form>

      <div class="stack">
        <div class="card dark">
          <h3>How matching works</h3>
          <div class="stack-sm small" style="color:rgba(244,241,229,.82)">
            <div class="row">${icon('check')} The live brand and ear-tag register is checked once.</div>
            <div class="row">${icon('check')} If there is a match, the owner is alerted on WhatsApp.</div>
            <div class="row">${icon('check')} A reviewer checks documents before any handover.</div>
            <div class="row">${icon('check')} You receive a case reference and status only.</div>
          </div>
          <div class="divider" style="background:rgba(255,255,255,.15)"></div>
          <p class="tiny mb-0" style="color:rgba(244,241,229,.62)">A match is a lead, not proof of ownership. Brand marks can be copied and tags can be moved.</p>
        </div>
        <div class="card">
          <h3>${icon('clock')} Lookup limits</h3>
          <p class="small muted mb-0">Repeated lookups are limited to prevent someone using the register to trace animals. If you reach the daily limit, reviewers are alerted and further lookups are refused.</p>
        </div>
        <div class="card">
          <h3>${icon('pin')} Keep the animals safe</h3>
          <p class="small muted mb-0">If the animals are in danger or blocking a road, contact the police. The police can hold them until a claim is decided.</p>
        </div>
      </div>
    </div>`;

  return {
    html,
    after() {
      const form = document.querySelector('[data-found-form]');
      form.querySelector('[data-take-photo]').addEventListener('click', async () => {
        const shot = await openCamera({
          title: 'Photo of the found animals',
          guide: 'doc',
          facing: 'environment',
          hint: 'Show the animals, brand or ear tag. Avoid people and number plates.',
          confirmLabel: 'Use this photo'
        });
        if (shot) {
          photo = shot;
          form.querySelector('[data-found-photo]').innerHTML = `<img src="${shot}" alt="Found animals preview">`;
        }
      });

      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = 'Logging…';
        try {
          const res = await api('/found-reports', {
            method: 'POST',
            body: {
              species: form.species.value,
              qty: Number(form.qty.value),
              brandText: form.brandText.value.trim() || undefined,
              tagNumbers: splitList(form.tags.value),
              locationText: form.locationText.value.trim(),
              photo: photo || undefined
            }
          });
          const m = modal({
            title: 'Report logged',
            narrow: true,
            body: `<div class="notice ok mb-2">${icon('check')} ${esc(res.message)}</div>
              <div class="case-ref" style="font-family:var(--mono);font-size:1.6rem;letter-spacing:.16em;text-align:center;padding:14px;border:1px dashed var(--line);border-radius:12px">${esc(res.caseRef)}</div>
              <p class="small muted mt-2 mb-0">Keep this reference. Anyone who asks for money to “release” the animals is not acting for KraaLink. Contact the police.</p>`,
            footer: `<button type="button" class="btn btn-ghost" data-copy>${icon('doc')} Copy reference</button>
              <a class="btn btn-primary" href="#/found-report/${esc(res.caseRef)}" data-close>Open case record</a>`
          });
          m.wrap.querySelector('[data-copy]').addEventListener('click', () => copyText(res.caseRef, 'Case reference copied.'));
          photo = null;
          form.reset();
          form.querySelector('[data-found-photo]').innerHTML = icon('camera');
          btn.disabled = false; btn.innerHTML = `${icon('search')} Log found report`;
        } catch (err) {
          apiToast(err);
          btn.disabled = false; btn.innerHTML = `${icon('search')} Log found report`;
        }
      });
    }
  };
}

/* ================================================================== my reports */

export async function myReports() {
  const rows = await api('/found-reports/mine');

  const list = rows.length ? `<div class="stack">${rows.map(r => `<a class="card tight hover-card" href="#/found-report/${esc(r.caseRef)}" style="text-decoration:none;color:inherit">
    <div class="row between">
      <div class="row" style="gap:14px">
        <span class="avatar avatar-lg" aria-hidden="true">${icon('search')}</span>
        <div>
          <div class="title mono">${esc(r.caseRef)}</div>
          <div class="small muted">${esc(r.qty)} × ${esc(r.species)} · ${esc(r.locationText || 'Location not recorded')}</div>
          <div class="row mt-1">${statusBadge(r.status)} <span class="tiny muted">${timeAgo(r.createdAt)}</span></div>
        </div>
      </div>
      <div class="end" style="text-align:right">
        ${r.matched ? `<span class="badge badge-green">Register match</span><div class="tiny muted mt-1">Owner alerted</div>` : `<span class="tiny muted">Re-checked automatically</span>`}
      </div>
    </div>
    <div class="notice info mt-2 mb-0" style="font-size:.85rem">${icon('shield')} ${esc(reportStatusNote(r.status))}</div>
  </a>`).join('')}</div>` : emptyState({
    iconName: 'search',
    title: 'No found reports yet',
    body: 'Found animals with a brand or ear tag can be matched back to a registered owner without either side seeing the other’s details.',
    action: `<a class="btn btn-primary" href="#/report-found">Report found livestock</a>`
  });

  return {
    html: `${pageHead('Brand & Trade Tracker', 'My found reports',
      'Your reports, their status and the case reference. Owner identities are hidden from you by design.',
      `<a class="btn btn-orange" href="#/report-found">${icon('plus')} New report</a>`)}
      ${list}`,
    after() { /* cards link to the case record */ }
  };
}

/* ================================================================== case record */

export async function foundReportDetail({ params }) {
  const data = await api('/found-reports/' + encodeURIComponent(params.caseRef));
  const v = data.view;
  const claim = data.claim;
  const isFinder = data.viewer === 'finder';
  const isOwner = data.viewer === 'owner' || data.viewer === 'claimant';

  const timeline = [
    { label: 'Report logged', at: v.createdAt, done: true },
    { label: 'Brand / tag checked', at: v.createdAt, done: true },
    { label: v.matched ? 'Registered owner alerted' : 'No match yet — kept open', at: v.matched ? v.createdAt : null, done: v.matched },
    { label: 'Reviewer decision', at: claim?.status === 'approved' || claim?.status === 'rejected' ? null : null, done: claim?.status === 'approved' },
    { label: 'Handover arranged', at: claim?.handoverAt || null, done: !!claim?.handoverAt }
  ];

  return {
    html: `<p class="small muted"><a href="${isFinder ? '#/my-reports' : isOwner ? '#/found-reports' : '#/admin/found'}">${isFinder ? 'My reports' : isOwner ? 'Found & claims' : 'Found reports'}</a> / ${esc(v.caseRef)}</p>

    ${pageHead('Found report', v.caseRef,
      isFinder ? 'This is your record. No owner details are included, even when a match is found.'
        : isOwner ? 'You were identified by a blind match. A reviewer checks your documents before any handover.'
        : 'Reviewer view. The finder never sees the owner identity.',
      isFinder ? `<a class="btn btn-ghost" href="#/report-found">${icon('plus')} Report another</a>`
        : isOwner ? `<a class="btn btn-ghost" href="#/found-reports">${icon('doc')} My claims</a>` : '')}

    <div class="split">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><h3>${icon('search')} ${esc(v.species)} · ${esc(v.qty)} animal${v.qty === 1 ? '' : 's'}</h3>
            <p class="card-sub">Logged ${fmtDate(v.createdAt)} · ${esc(v.locationText || 'Location not recorded')}</p></div>${statusBadge(v.status)}</div>
          ${v.photoUrl ? `<div class="thumb-row"><a href="${esc(v.photoUrl)}" target="_blank" rel="noopener"><img src="${esc(v.photoUrl)}" alt="Found animals photo"></a></div>` : ''}
          <dl class="kv mt-2">
            <dt>Brand mark</dt><dd class="mono">${esc(v.brandText || '—')}</dd>
            <dt>Ear tags</dt><dd class="mono">${v.tagNumbers?.length ? v.tagNumbers.map(t => esc(t)).join(', ') : '—'}</dd>
            <dt>Retention</dt><dd>${v.expiresAt ? fmtDate(v.expiresAt) : '—'}</dd>
            <dt>Register match</dt><dd>${v.matched ? 'Yes — owner alerted' : 'No match yet'}</dd>
          </dl>
          <div class="notice info mt-2 mb-0">${icon('shield')} ${esc(v.note)}</div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>${icon('clock')} Case progress</h3><p class="card-sub">A match is a lead. Ownership is only confirmed after a reviewer checks documents.</p></div></div>
          <div class="timeline">${timeline.map(t => `<div class="timeline-item">
            <b>${esc(t.label)}</b>
            <div class="when">${t.at ? fmtDate(t.at) : 'Waiting'}</div>
          </div>`).join('')}</div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h3>${icon('shield')} Privacy on this case</h3>
          <p class="small muted">The finder sees a case reference and status. The owner sees the match. Neither side receives the other’s phone number.</p>
          <div class="divider"></div>
          <p class="tiny muted mb-0">Handover happens at a police station or State Veterinary office, or directly only when both sides consent. Every claim document is private and time-limited.</p>
        </div>

        ${claim ? `<div class="card">
          <div class="card-head"><div><h3>${icon('doc')} Ownership claim</h3><p class="card-sub">Submitted ${fmtDate(claim.createdAt || v.createdAt)}</p></div>${statusBadge(claim.status)}</div>
          ${claim.reason ? `<p class="small">${esc(claim.reason)}</p>` : ''}
          ${claim.handoverMethod ? `<dl class="kv"><dt>Handover</dt><dd>${esc(claim.handoverMethod.replaceAll('_', ' '))}</dd>
            <dt>Place</dt><dd>${esc(claim.handoverPlace || '—')}</dd>
            <dt>When</dt><dd>${claim.handoverAt ? fmtDate(claim.handoverAt) : '—'}</dd></dl>` : ''}
          ${isOwner && claim.status === 'approved' && !claim.handoverMethod ? `<a class="btn btn-orange btn-block mt-2" href="#/found-reports">${icon('users')} Arrange handover</a>` : ''}
        </div>` : (isOwner ? `<div class="card"><h3>${icon('doc')} Claim these animals</h3>
          <p class="small muted">Open your matched reports to claim with a brand certificate, registration card or tag record.</p>
          <a class="btn btn-primary btn-block" href="#/found-reports">Open matched reports</a></div>` : '')}

        ${isFinder ? `<div class="card">
          <h3>${icon('alert')} Safety</h3>
          <p class="small muted mb-0">Do not hand animals over to someone who arrives without a reviewer-approved arrangement. Call the Namibian Police on 10111 if you feel unsafe or someone demands payment.</p>
        </div>` : ''}
      </div>
    </div>`
  };
}
