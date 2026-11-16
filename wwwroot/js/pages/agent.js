import {
  api, apiToast, loadConfig, state, go, esc, icon, avatar, fmtDate, timeAgo,
  statusBadge, levelBadge, toast, modal, openCamera, emptyState, pageHead, labelize, copyText, readAloud
} from '../core.js';

const CONSENT_TEXTS = {
  en: 'I agree that KraaLink may store my name, face photo, identity document and contact details to create my WorkerLink Passport. I decide every time a farmer asks to see my passport. I can say no or stop sharing at any time. My next of kin and identity document are never shown to a farmer.',
  af: 'Ek stem in dat KraaLink my naam, gesigfoto, identiteitsdokument en kontakbesonderhede mag stoor om my WorkerLink-paspoort te skep. Ek besluit elke keer wanneer ’n boer my paspoort wil sien. Ek kan enige tyd nee sê of ophou deel. My naasbestaandes en identiteitsdokument word nooit aan ’n boer gewys nie.',
  pt: 'Concordo que a KraaLink guarde o meu nome, fotografia do rosto, documento de identidade e contactos para criar o meu Passaporte WorkerLink. Decido sempre que um agricultor pede para ver o passaporte. Posso recusar ou parar de partilhar a qualquer momento. Os meus familiares e o documento de identidade nunca são mostrados ao agricultor.'
};

function options(list, selected) {
  return list.map(item => `<option value="${esc(item.code)}"${item.code === selected ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
}

function kinRow(index) {
  return `<div class="form-grid kin-row" data-kin>
    <input type="hidden" name="kinIndex" value="${index}">
    <div class="field"><label>Full name</label><input name="kinName" required placeholder="Next of kin"></div>
    <div class="field"><label>Relationship</label><input name="kinRelationship" required placeholder="e.g. Mother, uncle"></div>
    <div class="field"><label>Phone</label><input name="kinPhone" required inputmode="tel" placeholder="+264 81 ..."></div>
    <div class="field"><label>Village</label><input name="kinVillage" placeholder="Village"></div>
  </div>`;
}

function recordBadge(status) {
  const tone = status === 'Good Record' ? 'green'
    : status === 'Suspended - Police Case Open' ? 'red' : 'amber';
  return `<span class="badge badge-${tone}">${esc(status || 'Good Record')}</span>`;
}

function refRow(index) {
  return `<div class="form-grid ref-row" data-ref>
    <div class="field"><label>Reference name</label><input name="refName" required placeholder="Someone who can vouch for the worker"></div>
    <div class="field"><label>Their role</label><input name="refRole" placeholder="e.g. Headman, former employer"></div>
    <div class="field"><label>Phone</label><input name="refPhone" required inputmode="tel" placeholder="+264 81 ..."></div>
  </div>`;
}

/* ================================================================== register a worker */

export async function registerWorker() {
  const cfg = await loadConfig();
  let face = null;
  let idDoc = null;

  const html = `${pageHead('WorkerLink Passport', 'Register a worker',
    'Capture the face and ID in person. The worker’s ID number is encrypted and their next-of-kin contacts are never shown to farmers.',
    `<a class="btn btn-ghost" href="#/workers">${icon('users')} Worker register</a>`)}

    <form class="stack" data-register-form>
      <div class="card">
        <div class="card-head"><div><h3>${icon('id')} Identity</h3><p class="card-sub">Use the name exactly as it appears on the ID document.</p></div><span class="badge badge-amber">L1 after capture</span></div>
        <div class="form-grid">
          <div class="field span-2"><label for="w-name">Full name</label><input id="w-name" name="fullName" required minlength="3" placeholder="First name and surname"></div>
          <div class="field"><label for="w-phone">Phone number</label>
            <div class="row" style="gap:8px;align-items:flex-end">
              <input id="w-phone" name="phone" required inputmode="tel" placeholder="+264 81 ..." style="flex:1;min-width:0">
              <button type="button" class="btn btn-soft" data-otp-send>Send code</button>
            </div>
            <div class="hint" data-otp-hint>Used for OTP and WhatsApp. Send the code only while the worker is with you.</div>
          </div>
          <div class="field"><label for="w-otp">Worker's one-time code</label><input id="w-otp" name="otpCode" required inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 digits"><div class="hint">Ask the worker to read the code from their phone. It expires in 10 minutes.</div></div>
          <div class="field"><label for="w-lang">Preferred language</label><select id="w-lang" name="language">${options(cfg.languages, 'en')}</select></div>
          <div class="field"><label for="w-dob">Date of birth</label><input id="w-dob" name="dob" type="date" required><div class="hint">Workers must be at least 16.</div></div>
          <div class="field"><label for="w-other">Alternate phone</label><input id="w-other" name="otherPhone" inputmode="tel" placeholder="Optional"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>${icon('shield')} Face and ID capture</h3><p class="card-sub">Both photos are required for L1. They are stored privately with short-lived access links.</p></div></div>
        <div class="grid cols-2">
          <div class="photo-field card tight" style="box-shadow:none">
            <span class="photo-thumb photo-face" data-face-thumb>${icon('camera')}</span>
            <div>
              <div class="title">Face photo</div>
              <div class="meta">Face the camera, eyes open, no hat or sunglasses. This is stored for identity checks only — KraaLink does not run face matching.</div>
            </div>
            <button type="button" class="btn btn-soft" data-face-btn>${icon('camera')} Capture face</button>
          </div>
          <div class="photo-field card tight" style="box-shadow:none">
            <span class="photo-thumb photo-doc" data-id-thumb>${icon('doc')}</span>
            <div>
              <div class="title">ID document</div>
              <div class="meta">Lay the document flat. Only the photo is stored; the ID number is encrypted separately.</div>
            </div>
            <button type="button" class="btn btn-soft" data-id-btn>${icon('camera')} Capture ID</button>
          </div>
        </div>
        <div class="form-grid mt-2">
          <div class="field"><label for="w-idtype">Document type</label><select id="w-idtype" name="idDocType" required>
            <option value="namibian_id">Namibian ID</option>
            <option value="angolan_passport">Angolan passport</option>
            <option value="angolan_id">Angolan ID</option>
            <option value="birth_certificate">Birth certificate</option>
          </select></div>
          <div class="field"><label for="w-idnumber">ID or passport number</label><input id="w-idnumber" name="idDocNumber" required autocomplete="off" placeholder="Encrypted at rest"><div class="hint">Only masked values are shown to staff. The worker sees their own number.</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>${icon('pin')} Home area and skills</h3><p class="card-sub">The village helps farmers recognise a worker and helps a verifier do the L2 check in person.</p></div></div>
        <div class="form-grid">
          <div class="field"><label for="w-village">Home village</label><input id="w-village" name="village" required placeholder="Village"></div>
          <div class="field"><label for="w-constituency">Constituency / commune</label><input id="w-constituency" name="constituency" required placeholder="Constituency in Namibia, commune in Angola"></div>
          <div class="field"><label for="w-region">Region</label><select id="w-region" name="regionCode" required>${options(cfg.regions, '')}</select></div>
          <div class="field"><label for="w-skills">Skills</label><input id="w-skills" name="skills" placeholder="e.g. Cattle herding, fencing, tractor"><div class="hint">Separate with commas.</div></div>
          <div class="field span-2"><label>Languages spoken</label>
            <div class="chip-row">${cfg.languages.map(l => `<label class="chip-check"><input type="checkbox" name="languages" value="${esc(l.code)}"${l.code === 'en' ? ' checked' : ''}><span>${esc(l.name)}</span></label>`).join('')}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>${icon('users')} Next of kin</h3><p class="card-sub">At least two contacts. They are only used after a worker cannot be reached for the configured period, and every release is logged.</p></div>
          <button type="button" class="btn btn-sm btn-ghost" data-add-kin>${icon('plus')} Add contact</button></div>
        <div class="stack" data-kin-list>${kinRow(0)}${kinRow(1)}</div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>${icon('check')} Reference person</h3><p class="card-sub">At least one person who can confirm the worker’s identity and work history.</p></div>
          <button type="button" class="btn btn-sm btn-ghost" data-add-ref>${icon('plus')} Add reference</button></div>
        <div class="stack" data-ref-list>${refRow(0)}</div>
      </div>

      <div class="card">
        <label class="check"><input type="checkbox" name="consentAccepted" required>
          <span>The worker has read and agrees to the WorkerLink Passport consent. Their photo and ID are stored privately; the kind of information shared with a farmer requires their approval each time.</span>
        </label>
        <div class="row mt-2">
          <button type="button" class="btn btn-sm btn-ghost" data-read-consent>${icon('bell')} Read the consent aloud</button>
          <span class="tiny muted">Plays in the worker's chosen language where the device supports it.</span>
        </div>
        <label class="check mt-2"><input type="checkbox" name="agentConfirm" required>
          <span>I captured these photos in person and the phone number was confirmed with the worker.</span>
        </label>
        <div class="row mt-3">
          <button class="btn btn-orange" type="submit">${icon('id')} Register worker at L1</button>
          <a class="btn btn-ghost" href="#/workers">Cancel</a>
        </div>
        <p class="tiny muted mt-2 mb-0">An agent registration starts at L1. Only a verifier can raise it to L2 after an in-person check.</p>
      </div>
    </form>`;

  return {
    html,
    after() {
      const form = document.querySelector('[data-register-form]');
      const faceThumb = form.querySelector('[data-face-thumb]');
      const idThumb = form.querySelector('[data-id-thumb]');

      form.querySelector('[data-face-btn]').addEventListener('click', async () => {
        const shot = await openCamera({
          title: 'Worker face photo',
          guide: 'face',
          facing: 'user',
          hint: 'Centre the face in the oval. The worker must agree to this photo being stored.',
          confirmLabel: 'Use face photo'
        });
        if (shot) {
          face = shot;
          faceThumb.innerHTML = `<img src="${shot}" alt="Worker face preview">`;
          faceThumb.classList.add('has-photo');
        }
      });

      form.querySelector('[data-id-btn]').addEventListener('click', async () => {
        const shot = await openCamera({
          title: 'ID document photo',
          guide: 'doc',
          facing: 'environment',
          hint: 'Lay the ID flat, fill the frame and avoid glare.',
          confirmLabel: 'Use ID photo'
        });
        if (shot) {
          idDoc = shot;
          idThumb.innerHTML = `<img src="${shot}" alt="ID document preview">`;
          idThumb.classList.add('has-photo');
        }
      });

      form.querySelector('[data-otp-send]').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const phone = form.phone.value.trim();
        if (!phone) { toast('Enter the worker phone number first.', 'warn'); form.phone.focus(); return; }
        const hint = form.querySelector('[data-otp-hint]');
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const res = await api('/workers/otp', { method: 'POST', body: { phone } });
          hint.innerHTML = res.demoCode
            ? `Demo code: <b class="mono">${esc(res.demoCode)}</b> — read it to the worker or let them confirm it.`
            : 'Code sent to the worker by SMS/WhatsApp. Ask them to read it to you.';
          toast('One-time code sent to the worker.', 'ok');
          form.otpCode.focus();
        } catch (err) { apiToast(err); }
        btn.disabled = false; btn.textContent = 'Send code';
      });

      form.querySelector('[data-read-consent]').addEventListener('click', () => {
        const language = form.language.value;
        readAloud(CONSENT_TEXTS[language] || CONSENT_TEXTS.en, language);
      });

      form.querySelector('[data-add-kin]').addEventListener('click', () => {
        const list = form.querySelector('[data-kin-list]');
        list.insertAdjacentHTML('beforeend', kinRow(list.querySelectorAll('[data-kin]').length));
        list.lastElementChild.querySelector('input').focus();
      });
      form.querySelector('[data-add-ref]').addEventListener('click', () => {
        const list = form.querySelector('[data-ref-list]');
        list.insertAdjacentHTML('beforeend', refRow(list.querySelectorAll('[data-ref]').length));
        list.lastElementChild.querySelector('input').focus();
      });

      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!face) { toast('Capture the worker’s face photo first.', 'warn'); return; }
        if (!idDoc) { toast('Capture the ID document photo.', 'warn'); return; }
        const otpCode = form.otpCode.value.trim();
        if (!otpCode) { toast('Send a code to the worker and enter the six digits.', 'warn'); form.otpCode.focus(); return; }
        const kin = [...form.querySelectorAll('[data-kin]')].map(row => ({
          name: row.querySelector('[name=kinName]').value.trim(),
          relationship: row.querySelector('[name=kinRelationship]').value.trim(),
          phone: row.querySelector('[name=kinPhone]').value.trim(),
          village: row.querySelector('[name=kinVillage]').value.trim() || undefined
        })).filter(k => k.name && k.phone);
        const refs = [...form.querySelectorAll('[data-ref]')].map(row => ({
          name: row.querySelector('[name=refName]').value.trim(),
          role: row.querySelector('[name=refRole]').value.trim() || undefined,
          phone: row.querySelector('[name=refPhone]').value.trim()
        })).filter(r => r.name && r.phone);
        if (kin.length < 2) { toast('Add two next-of-kin contacts.', 'warn'); return; }
        if (refs.length < 1) { toast('Add at least one reference person.', 'warn'); return; }

        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = 'Registering…';
        try {
          const res = await api('/workers', {
            method: 'POST',
            body: {
              fullName: form.fullName.value.trim(),
              phone: form.phone.value.trim(),
              otpCode,
              language: form.language.value,
              dob: form.dob.value,
              otherPhone: form.otherPhone.value.trim() || undefined,
              faceImage: face,
              idDocImage: idDoc,
              idDocType: form.idDocType.value,
              idDocNumber: form.idDocNumber.value.trim(),
              village: form.village.value.trim(),
              constituency: form.constituency.value.trim() || undefined,
              regionCode: form.regionCode.value,
              skills: form.skills.value.split(',').map(s => s.trim()).filter(Boolean),
              languages: [...form.querySelectorAll('input[name=languages]:checked')].map(i => i.value),
              nextOfKin: kin,
              references: refs,
              consentAccepted: form.consentAccepted.checked,
              consentVersion: 'consent-v1'
            }
          });
          const m = modal({
            title: 'Worker registered',
            narrow: true,
            body: `<div class="notice ok mb-2">${icon('check')} The passport is active at L1. The worker was sent a WhatsApp message with their short code.</div>
              <div style="font-family:var(--mono);font-size:2rem;letter-spacing:.2em;text-align:center;padding:16px;border:1px dashed var(--line);border-radius:12px">${esc(res.shortCode)}</div>
              <p class="small muted mt-2 mb-0">Write this code on the worker’s card. A verifier can raise it to L2 in person.</p>`,
            footer: `<button type="button" class="btn btn-ghost" data-copy>${icon('doc')} Copy code</button>
              <a class="btn btn-primary" href="#/workers/${esc(res.workerId)}" data-close>Open worker</a>`
          });
          m.wrap.querySelector('[data-copy]').addEventListener('click', () => copyText(res.shortCode, 'Short code copied.'));
          form.reset();
          form.querySelector('[data-otp-hint]').textContent = 'Used for OTP and WhatsApp. Send the code only while the worker is with you.';
          face = null; idDoc = null;
          faceThumb.innerHTML = icon('camera');
          idThumb.innerHTML = icon('doc');
          faceThumb.classList.remove('has-photo');
          idThumb.classList.remove('has-photo');
          btn.disabled = false; btn.innerHTML = `${icon('id')} Register worker at L1`;
        } catch (err) {
          apiToast(err);
          btn.disabled = false; btn.innerHTML = `${icon('id')} Register worker at L1`;
        }
      });
    }
  };
}

/* ================================================================== worker register */

export async function workers({ query }) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.level) params.set('level', query.level);
  const rows = await api('/workers' + (params.toString() ? '?' + params : ''));

  const table = rows.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>Worker</th><th>Short code</th><th>Passport</th><th>Home</th><th>Record status</th><th></th></tr></thead>
    <tbody>${rows.map(w => `<tr>
      <td><div class="row" style="gap:10px">${avatar({ name: w.name, faceUrl: w.faceUrl }, 'avatar')}
        <div><b>${esc(w.name)}</b>${w.phone ? `<div class="tiny muted">${esc(w.phone)}</div>` : `<div class="tiny muted">Joined ${fmtDate(w.createdAt)}</div>`}</div></div></td>
      <td><span class="mono">${esc(w.shortCode)}</span></td>
      <td>${levelBadge(w.verificationLevel)}</td>
      <td><div class="small">${esc(w.village || '—')}</div><div class="tiny muted">${esc(w.regionName || '')}</div></td>
      <td>${recordBadge(w.recordStatus)}</td>
      <td class="end"><a class="btn btn-sm btn-ghost" href="#/workers/${esc(w.id)}">Open</a></td>
    </tr>`).join('')}</tbody></table></div>` : emptyState({
    iconName: 'users',
    title: 'No workers match',
    body: 'Try another name, code or level. Agents can register a worker from the field form.',
    action: `<a class="btn btn-primary" href="#/register-worker">Register a worker</a>`
  });

  return {
    html: `${pageHead('WorkerLink Passport', 'Worker register',
      'Searchable by name or short code. Levels and record status only — identity documents and next-of-kin require a worker-approved check.',
      `<a class="btn btn-primary" href="#/register-worker">${icon('plus')} Register a worker</a>`)}
      <form class="card tight mb-3" data-worker-filter>
        <div class="filters">
          <div class="field grow"><label for="wq">Search</label><input id="wq" name="q" type="search" placeholder="Name or short code" value="${esc(query.q || '')}"></div>
          <div class="field"><label for="wl">Level</label><select id="wl" name="level"><option value="">All levels</option>
            <option value="0"${query.level === '0' ? ' selected' : ''}>L0 · Self-declared</option>
            <option value="1"${query.level === '1' ? ' selected' : ''}>L1 · Documented</option>
            <option value="2"${query.level === '2' ? ' selected' : ''}>L2 · Community verified</option>
          </select></div>
          <button class="btn btn-primary" type="submit">${icon('search')} Filter</button>
          <a class="btn btn-ghost" href="#/workers">Clear</a>
        </div>
      </form>
      ${table}`,
    after() {
      document.querySelector('[data-worker-filter]').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target;
        const p = new URLSearchParams();
        if (f.q.value.trim()) p.set('q', f.q.value.trim());
        if (f.level.value) p.set('level', f.level.value);
        go('/workers' + (p.toString() ? '?' + p : ''));
      });
    }
  };
}

/* ================================================================== worker detail */

export async function workerDetail({ params }) {
  const w = await api('/workers/' + encodeURIComponent(params.id));
  const canVerify = ['agent', 'verifier', 'reviewer', 'admin'].includes(state.me?.role);

  const kin = (w.kin || []).map(k => `<tr><td><b>${esc(k.name)}</b><div class="tiny muted">${esc(k.relationship || '')}</div></td>
    <td class="mono">${esc(k.phone)}</td><td>${esc(k.village || '—')}</td></tr>`).join('');
  const refs = (w.references || []).map(r => `<tr><td><b>${esc(r.name)}</b><div class="tiny muted">${esc(r.role || '')}</div></td>
    <td class="mono">${esc(r.phone)}</td></tr>`).join('');
  const history = (w.verificationHistory || []).map(v => `<div class="timeline-item">
    <b>L${esc(v.level)} · ${esc(v.levelLabel)}</b>
    <div class="when">${fmtDate(v.createdAt)}${v.by ? ` · ${esc(v.by)}` : ''}</div>
    <p>${esc(v.note || v.method || '')}</p>
  </div>`).join('');
  const consents = (w.consents || []).map(c => `<tr><td>${esc(c.farmer)}</td><td class="small">${esc(c.purpose)}</td>
    <td>${statusBadge(c.status)}</td><td class="tiny muted">${timeAgo(c.requestedAt)}</td></tr>`).join('');

  return {
    html: `<p class="small muted"><a href="#/workers">Worker register</a> / ${esc(w.name)}</p>
    ${pageHead('WorkerLink Passport', w.name,
      `${w.shortCode} · ${w.village || 'Village not recorded'}${w.regionName ? `, ${w.regionName}` : ''}`,
      `${canVerify ? `<button class="btn btn-ghost" data-raise ${w.verificationLevel >= 2 ? 'disabled' : ''}>${icon('shield')} ${w.verificationLevel === 0 ? 'Raise to L1' : 'Raise to L2'}</button>` : ''}
       <a class="btn btn-ghost" href="#/workers">${icon('arrow')} Back</a>`)}

    <div class="split">
      <div class="stack">
        <div class="card">
          <div class="row" style="gap:18px;align-items:flex-start">
            ${w.faceUrl ? `<a href="${esc(w.faceUrl)}" target="_blank" rel="noopener"><img class="staff-face" src="${esc(w.faceUrl)}" alt="${esc(w.name)} face photo"></a>` : `<span class="avatar avatar-xl">${esc(w.name.charAt(0))}</span>`}
            <div style="flex:1">
              <div class="row mb-1" style="gap:8px">${levelBadge(w.verificationLevel)} ${recordBadge(w.recordStatus)}</div>
              <dl class="kv">
                <dt>Short code</dt><dd class="mono">${esc(w.shortCode)}</dd>
                <dt>Date of birth</dt><dd>${w.dob ? fmtDate(w.dob) : '—'}</dd>
                <dt>ID document</dt><dd>${esc(w.idDocType ? labelize(w.idDocType) : '—')} ${esc(w.idDocNumber || '')}</dd>
                <dt>Alternate phone</dt><dd>${esc(w.otherPhone || '—')}</dd>
                <dt>Where verified</dt><dd>${esc(w.village || '—')}${w.regionName ? `, ${esc(w.regionName)}` : ''}</dd>
              </dl>
              ${(w.skills?.length || w.languages?.length) ? `<div class="row mt-2" style="gap:6px;flex-wrap:wrap">
                ${(w.skills || []).map(s => `<span class="badge badge-grey plain">${esc(s)}</span>`).join('')}
                ${(w.languages || []).map(l => `<span class="badge badge-grey plain">${esc(labelize(l))}</span>`).join('')}
              </div>` : ''}
              <div class="row mt-2">
                ${w.idDocUrl ? `<a class="btn btn-sm btn-ghost" href="${esc(w.idDocUrl)}" target="_blank" rel="noopener">${icon('doc')} Open ID document</a>` : `<span class="badge badge-grey">No ID document on file</span>`}
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>${icon('clock')} Verification history</h3><p class="card-sub">Every level change is appended. Levels cannot be skipped.</p></div></div>
          <div class="timeline">${history || '<p class="small muted mb-0">No verification events yet.</p>'}</div>
        </div>

        <div class="grid cols-2">
          <div class="card">
            <h3>${icon('users')} Next of kin</h3>
            ${kin ? `<div class="table-wrap"><table class="table"><tbody>${kin}</tbody></table></div>` : '<p class="small muted mb-0">None recorded.</p>'}
            <p class="tiny muted mt-2 mb-0">Released only after the configured unreachable period and always logged.</p>
          </div>
          <div class="card">
            <h3>${icon('check')} References</h3>
            ${refs ? `<div class="table-wrap"><table class="table"><tbody>${refs}</tbody></table></div>` : '<p class="small muted mb-0">None recorded.</p>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>${icon('shield')} Consent requests</h3><p class="card-sub">Recent requests. The worker decides each one.</p></div></div>
          ${consents ? `<div class="table-wrap"><table class="table"><thead><tr><th>Farmer</th><th>Purpose</th><th>Status</th><th>Requested</th></tr></thead><tbody>${consents}</tbody></table></div>` : '<p class="small muted mb-0">No consent requests.</p>'}
        </div>
      </div>

      <div class="stack">
        <div class="card dark">
          <h3>Staff controls</h3>
          <p class="small mb-2" style="color:rgba(244,241,229,.78)">Levels describe documentation, not trustworthiness. A farmer still needs the worker’s consent before seeing the passport.</p>
          ${canVerify ? `<button class="btn btn-orange btn-block" data-raise ${w.verificationLevel >= 2 ? 'disabled' : ''}>${icon('shield')} ${w.verificationLevel === 0 ? 'Raise to L1' : 'Raise to L2'}</button>` : ''}
          <p class="tiny mt-2 mb-0" style="color:rgba(244,241,229,.55)">L1 needs face and ID on file. L2 needs an in-person check by a named verifier.</p>
        </div>
        <div class="card">
          <h3>${icon('alert')} Privacy</h3>
          <p class="small muted mb-0">This view is logged. ID numbers are masked for staff. Never copy a worker’s ID or next-of-kin details into WhatsApp or paper records.</p>
        </div>
      </div>
    </div>`,
    after() {
      document.querySelectorAll('[data-raise]').forEach(btn => btn.addEventListener('click', () => raiseLevel(w)));
    }
  };
}

function raiseLevel(w) {
  if (w.verificationLevel >= 2) return;
  const next = w.verificationLevel === 0 ? 1 : 2;
  if (next === 1) {
    const m = modal({
      title: 'Raise to L1 · Documented',
      sub: 'L1 confirms the face and ID document are on file.',
      narrow: true,
      body: `<div class="notice info mb-2">${icon('shield')} Check that the face photo matches the ID document and that both belong to this worker.</div>
        <label class="check"><input type="checkbox" data-confirm-check> I checked the face photo against the ID document.</label>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-go disabled>Raise to L1</button>`
    });
    const goBtn = m.wrap.querySelector('[data-go]');
    m.wrap.querySelector('[data-confirm-check]').addEventListener('change', e => { goBtn.disabled = !e.target.checked; });
    goBtn.addEventListener('click', async () => {
      goBtn.disabled = true; goBtn.textContent = 'Recording…';
      try {
        await api(`/workers/${encodeURIComponent(w.id)}/verifications`, { method: 'POST', body: { level: 1, method: 'document_check' } });
        toast('Worker raised to L1.', 'ok');
        go('#/workers/' + w.id);
      } catch (err) { apiToast(err); goBtn.disabled = false; goBtn.textContent = 'Raise to L1'; }
    });
    return;
  }

  const m = modal({
    title: 'Raise to L2 · Community verified',
    sub: 'L2 needs an in-person check by a named verifier.',
    narrow: true,
    body: `<div class="notice warn mb-2">${icon('alert')} Only raise to L2 if you or a named headman, church leader or agent has met the worker in person and confirmed their village and next of kin.</div>
      <div class="field"><label for="verifier-name">Verifier name</label><input id="verifier-name" placeholder="Full name and role"></div>
      <div class="field"><label for="verifier-note">Note</label><textarea id="verifier-note" rows="3" placeholder="When and where the in-person check happened"></textarea></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-orange" data-go>Raise to L2</button>`
  });
  m.wrap.querySelector('[data-go]').addEventListener('click', async () => {
    const verifierName = m.wrap.querySelector('#verifier-name').value.trim();
    if (verifierName.length < 3) { toast('Enter the verifier’s name.', 'warn'); return; }
    const btn = m.wrap.querySelector('[data-go]');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      await api(`/workers/${encodeURIComponent(w.id)}/verifications`, {
        method: 'POST',
        body: { level: 2, method: 'in_person', verifierName, note: m.wrap.querySelector('#verifier-note').value.trim() || undefined }
      });
      m.close();
      toast('Worker raised to L2.', 'ok');
      go('#/workers/' + w.id);
    } catch (err) { apiToast(err); btn.disabled = false; btn.textContent = 'Raise to L2'; }
  });
}
