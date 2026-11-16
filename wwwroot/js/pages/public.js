import {
  api, apiToast, loadConfig, loadMe, state, setSession, refreshUnread, go,
  esc, icon, avatar, money, fmtDate, statusBadge, toast, modal, openCamera, emptyState, readAloud
} from '../core.js';

const SIGNUP_CONSENT = {
  en: 'I agree to KraaLink storing my details and photos for identity verification, and to the privacy rules described in the WorkerLink Passport. I understand I can revoke a hiring check at any time.',
  af: 'Ek stem in dat KraaLink my besonderhede en foto’s vir identiteitsverifikasie mag stoor, en tot die privaatheidreëls van die WorkerLink-paspoort. Ek verstaan dat ek enige tyd ’n huurproef kan herroep.',
  pt: 'Concordo que a KraaLink guarde os meus dados e fotografias para verificação de identidade, e com as regras de privacidade do Passaporte WorkerLink. Compreendo que posso revogar uma verificação a qualquer momento.'
};

const ROLE_ICONS = {
  worker: 'id', farmer: 'market', seller: 'tag', buyer: 'search',
  finder: 'shield', transporter: 'arrow', vet: 'vet'
};

const BASE_ROLE_LABEL = {
  worker: 'Worker tools',
  farmer: 'Farmer tools',
  finder: 'Community tools'
};

const FALLBACK_ROLES = [
  { code: 'worker', label: 'Farm worker', baseRole: 'worker', description: 'Herding, fencing, tractor work. Build a WorkerLink Passport.' },
  { code: 'farmer', label: 'Farmer / livestock owner', baseRole: 'farmer', description: 'Own livestock. Hire with consent, list animals and register brands.' },
  { code: 'seller', label: 'Farm produce seller', baseRole: 'farmer', description: 'Sell eggs, vegetables, milk and other produce with photos.' },
  { code: 'buyer', label: 'Buyer / trader', baseRole: 'finder', description: 'Buy livestock or produce and contact sellers on WhatsApp.' },
  { code: 'finder', label: 'Community member', baseRole: 'finder', description: 'Report a found animal without revealing who you are.' },
  { code: 'transporter', label: 'Transporter', baseRole: 'finder', description: 'Move animals or produce and find work across regions.' },
  { code: 'vet', label: 'Veterinary professional', baseRole: 'finder', description: 'Support animal health in the field and use vet-approved guidance.' },
  { code: 'agent', label: 'Field agent', baseRole: 'agent', description: 'Register workers in the field.', inviteOnly: true },
  { code: 'verifier', label: 'Verifier', baseRole: 'verifier', description: 'Check identity documents and passport levels.', inviteOnly: true },
  { code: 'reviewer', label: 'Reviewer', baseRole: 'reviewer', description: 'Review claims, incidents and listings.', inviteOnly: true },
  { code: 'admin', label: 'Administrator', baseRole: 'admin', description: 'Run the platform and its rules.', inviteOnly: true }
];

function options(list, selected, valueKey = 'code', labelKey = 'name') {
  return list.map(item =>
    `<option value="${esc(item[valueKey])}"${String(item[valueKey]) === String(selected) ? ' selected' : ''}>${esc(item[labelKey])}</option>`
  ).join('');
}

function speciesOptions(species, selected) {
  return species.map(s => `<option${s === selected ? ' selected' : ''}>${esc(s)}</option>`).join('');
}

function errorBox(message) {
  return `<div class="form-error" role="alert">${esc(message)}</div>`;
}

/* ================================================================== home */

const HERO_SLIDES = [
  { src: '/assets/img/kraal-cattle.png', alt: 'Cattle gathered at a kraal in Namibia' },
  { src: '/assets/img/herd-farmer.png', alt: 'A farmer walking with a herd at golden hour' },
  { src: '/assets/img/cow-close.png', alt: 'A close view of a healthy cow' },
  { src: '/assets/img/farmer-sunset.png', alt: 'A farmer on the land at sunset' },
  { src: '/assets/img/sunset-fence.png', alt: 'Cattle beside a fence line at sunset' }
];

const GALLERY = [
  { src: '/assets/img/kraal-cattle.png', alt: 'Cattle gathered at a kraal in Namibia', caption: 'Cattle at the kraal' },
  { src: '/assets/img/herd-farmer.png', alt: 'A farmer walking with a herd at golden hour', caption: 'Walking the herd' },
  { src: '/assets/img/cow-close.png', alt: 'A close view of a healthy cow', caption: 'Healthy animals' },
  { src: '/assets/img/farmer-sunset.png', alt: 'A farmer on the land at sunset', caption: 'Working the land' },
  { src: '/assets/img/sunset-fence.png', alt: 'Cattle beside a fence line at sunset', caption: 'From Kunene to Zambezi' }
];

const PRODUCE_TEASERS = [
  { icon: 'tag', title: 'Eggs & poultry', body: 'Eggs by the crate or dozen, broilers and layers.' },
  { icon: 'market', title: 'Fresh vegetables', body: 'Tomatoes, onions, spinach and seasonal vegetables.' },
  { icon: 'check', title: 'Grains & maize', body: 'Maize, mahangu, sorghum and lucerne by the bag.' },
  { icon: 'vet', title: 'Dairy & meat', body: 'Fresh milk, goat milk, beef and biltong.' }
];

export async function home() {
  let demo = [];
  try { demo = await api('/auth/demo-accounts'); } catch { demo = []; }
  const me = state.me;
  const primary = me
    ? `<a class="btn btn-primary btn-lg" href="#/dashboard">Open my dashboard ${icon('arrow')}</a>`
    : `<a class="btn btn-primary btn-lg" href="#/signup">Create your free account ${icon('arrow')}</a>`;

  const slides = HERO_SLIDES.map(s =>
    `<div class="carousel-slide"><img src="${esc(s.src)}" alt="${esc(s.alt)}"></div>`).join('');
  const dots = HERO_SLIDES.map((_, i) =>
    `<button type="button" data-dot="${i}" class="${i === 0 ? 'active' : ''}" aria-label="Show slide ${i + 1}"></button>`).join('');

  const html = `<section class="carousel" data-carousel aria-roledescription="carousel" aria-label="KraaLink across Namibia">
    <div class="carousel-track" data-track>${slides}</div>
    <div class="carousel-inner">
      <div class="carousel-copy">
        <div class="eyebrow">Namibia's WhatsApp-first livestock network</div>
        <h1>Farm trust, from <em>Kunene to Zambezi</em>.</h1>
        <p>KraaLink connects workers, farmers and communities through a verified WorkerLink Passport, a nationwide marketplace for livestock and farm produce, vet-approved animal health guidance and a tamper-resistant brand and trade register. Every region, every language, any phone.</p>
        <div class="carousel-actions">
          ${primary}
          <a class="btn btn-ghost" href="#/produce">See what farms are selling</a>
        </div>
        <div class="carousel-trust">
          <div><b>14</b><span>Regions covered</span></div>
          <div><b>L0–L2</b><span>Worker verification</span></div>
          <div><b>5</b><span>Languages</span></div>
          <div><b>24h</b><span>Consent window</span></div>
        </div>
      </div>
    </div>
    <button type="button" class="carousel-arrow prev" data-prev aria-label="Previous slide">${icon('chevron')}</button>
    <button type="button" class="carousel-arrow next" data-next aria-label="Next slide">${icon('chevron')}</button>
    <div class="carousel-dots" data-dots>${dots}</div>
  </section>

  <div class="home-body">
    <div class="section-head">
      <div><div class="eyebrow">One trust layer for the whole country</div><h2>What you can do on KraaLink</h2></div>
      <span class="pill">${icon('check')} No passwords — phone + WhatsApp code</span>
    </div>
    <div class="grid cols-4">
      <a class="card feature hover-card" href="#/passport" style="text-decoration:none;color:inherit">
        <div class="feature-icon">${icon('id')}</div>
        <h3>WorkerLink Passport</h3>
        <p>A worker-owned identity card with a short code and QR. Hire with consent, check in and out, and keep a neutral employment record.</p>
        <span class="link-arrow">How it works ${icon('arrow')}</span>
      </a>
      <a class="card feature hover-card" href="#/market" style="text-decoration:none;color:inherit">
        <div class="feature-icon">${icon('market')}</div>
        <h3>Livestock market</h3>
        <p>Cattle, goats, sheep and more from all 14 regions. Contact sellers on WhatsApp; listings carrying stolen or missing tags are held automatically.</p>
        <span class="link-arrow">Browse livestock ${icon('arrow')}</span>
      </a>
      <a class="card feature hover-card" href="#/produce" style="text-decoration:none;color:inherit">
        <div class="feature-icon">${icon('tag')}</div>
        <h3>Farm produce</h3>
        <p>Eggs, milk, maize, tomatoes, honey and more — sold with real photos, a clear unit and a price the farmer sets.</p>
        <span class="link-arrow">Shop farm produce ${icon('arrow')}</span>
      </a>
      <a class="card feature hover-card" href="#/vet" style="text-decoration:none;color:inherit">
        <div class="feature-icon">${icon('vet')}</div>
        <h3>VetBot &amp; trade tracker</h3>
        <p>Vet-approved triage in your language, plus a brand and ear-tag register that reunites found animals with owners privately.</p>
        <span class="link-arrow">Check an animal ${icon('arrow')}</span>
      </a>
    </div>

    <div class="section-head"><div><div class="eyebrow">From the Orange River to the Kavango</div><h2>Built for the entire country</h2></div></div>
    <div class="band" style="background-image:url('/assets/img/farmer-sunset.png')">
      <div class="eyebrow">Every region counts</div>
      <h2>Farmers in //Karas and Kunene need the same trust as those in Omusati.</h2>
      <p>KraaLink lists livestock and produce in all 14 regions — from Oshana and Ohangwena to Erongo, Khomas, Hardap, Omaheke and Zambezi. Region and village filters keep every listing local to the buyer.</p>
      <div class="band-stats">
        <div><b>14</b><span>Regions</span></div>
        <div><b>2</b><span>Market types</span></div>
        <div><b>0</b><span>Data fees on WhatsApp</span></div>
        <div><b>1</b><span>Shared trust register</span></div>
      </div>
    </div>

    <div class="section-head">
      <div><div class="eyebrow">Across Namibia</div><h2>Real farms, real livestock, real produce</h2></div>
      <a class="btn btn-ghost" href="#/market">Browse the market ${icon('arrow')}</a>
    </div>
    <div class="photo-gallery">
      ${GALLERY.map((g, i) => `<figure${i === 0 ? ' class="wide"' : ''}>
        <img src="${esc(g.src)}" alt="${esc(g.alt)}" loading="lazy">
        <figcaption>${esc(g.caption)}</figcaption>
      </figure>`).join('')}
    </div>

    <div class="section-head">
      <div><div class="eyebrow">Sell what your farm produces</div><h2>Eggs, maize, milk, vegetables — with photos</h2></div>
      <a class="btn btn-orange" href="#/produce">Open the produce market ${icon('arrow')}</a>
    </div>
    <div class="grid cols-4">
      ${PRODUCE_TEASERS.map(t => `<a class="card feature hover-card" href="#/produce" style="text-decoration:none;color:inherit">
        <div class="feature-icon">${icon(t.icon)}</div>
        <h3>${esc(t.title)}</h3>
        <p>${esc(t.body)}</p>
        <span class="link-arrow">Browse ${icon('arrow')}</span>
      </a>`).join('')}
    </div>

    <div class="section-head"><div><div class="eyebrow">Designed around rights</div><h2>How trust is earned</h2></div></div>
    <div class="steps">
      <div class="step"><b>Verified, not assumed</b><span>Passports rise from L0 to L2 only with a face photo, ID document and an in-person check.</span></div>
      <div class="step"><b>Consent before access</b><span>A farmer requests; the worker approves for 24 hours. Next-of-kin and ID numbers are never in that view.</span></div>
      <div class="step"><b>Evidence and both sides</b><span>Incidents stay private without evidence, and the worker always gets a right to respond.</span></div>
      <div class="step"><b>Logs that cannot be edited</b><span>Every sensitive view and decision lands in an append-only audit trail.</span></div>
    </div>

    ${demo.length ? `<div class="section-head"><div><div class="eyebrow">Try it immediately</div><h2>Demo accounts</h2><p class="lead" style="margin-bottom:0">One tap signs you in. Data resets when the demo database is rebuilt.</p></div></div>
    <div class="demo-grid" data-demo-grid>${demo.map(d => demoCard(d)).join('')}</div>` : ''}

    <div class="panel-dark mt-4" style="background-image:radial-gradient(620px 320px at 88% 12%, rgba(239,125,26,.35), transparent 65%),radial-gradient(560px 340px at 6% 92%, rgba(46,125,50,.45), transparent 68%),linear-gradient(120deg, rgba(18,42,20,.94), rgba(38,38,38,.93)),url('/assets/img/sunset-fence.png');background-size:cover;background-position:center">
      <div class="row between" style="position:relative;z-index:1;gap:26px">
        <div style="max-width:640px">
          <div class="eyebrow" style="color:#ffcf9c">Start where you are</div>
          <h2 style="margin-bottom:10px">A phone number is all you need.</h2>
          <p class="muted" style="margin-bottom:0">Choose the role that fits you, or describe your own. Sign in with a one-time code on WhatsApp. Workers can capture a face photo and ID during sign-up with the phone camera — no app store, no password.</p>
        </div>
        <div class="row">
          <a class="btn btn-primary" href="#/signup">Create account</a>
          <a class="btn btn-footer-ghost" href="#/login">Sign in</a>
        </div>
      </div>
    </div>

    <p class="tiny muted center mt-4">KraaLink demo · Face photos are used for identification only. No automated face matching or biometric templates.</p>
  </div>`;

  return {
    html,
    after() {
      const view = document.getElementById('view');
      wireDemoGrid(view);
      wireCarousel(view);
    }
  };
}

function demoCard(d) {
  return `<button type="button" class="demo-card" data-demo-phone="${esc(d.phone)}">
    <b>${esc(d.name)}</b>
    <span>${esc(d.label)}</span>
    ${d.shortCode ? `<span class="code">${esc(d.shortCode)}</span>` : `<span class="code">${esc(d.phone)}</span>`}
  </button>`;
}

export async function demoLogin(phone) {
  try {
    const data = await api('/auth/demo', { method: 'POST', body: { phone } });
    setSession(data.token, data.user);
    await loadMe(true);
    await refreshUnread();
    toast(`Signed in as ${data.user.name}.`, 'ok');
    go('/dashboard');
  } catch (err) {
    apiToast(err);
  }
}

export function wireDemoGrid(root) {
  root.querySelectorAll?.('[data-demo-phone]').forEach(btn => {
    btn.addEventListener('click', () => demoLogin(btn.dataset.demoPhone));
  });
}

function wireCarousel(root) {
  const carousel = root.querySelector('[data-carousel]');
  if (!carousel) return;
  const track = carousel.querySelector('[data-track]');
  const slides = [...track.children];
  const dots = [...carousel.querySelectorAll('[data-dot]')];
  let index = 0;
  let timer = null;

  function show(next) {
    index = (next + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
    slides.forEach((slide, i) => slide.setAttribute('aria-hidden', String(i !== index)));
  }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.body.contains(carousel)) { clearInterval(timer); return; }
      show(index + 1);
    }, 6000);
  }

  carousel.querySelector('[data-prev]').addEventListener('click', () => { show(index - 1); startTimer(); });
  carousel.querySelector('[data-next]').addEventListener('click', () => { show(index + 1); startTimer(); });
  dots.forEach(dot => dot.addEventListener('click', () => { show(Number(dot.dataset.dot)); startTimer(); }));

  carousel.addEventListener('mouseenter', () => clearInterval(timer));
  carousel.addEventListener('mouseleave', startTimer);

  let touchX = null;
  carousel.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  carousel.addEventListener('touchend', e => {
    if (touchX === null) return;
    const delta = e.changedTouches[0].clientX - touchX;
    if (Math.abs(delta) > 45) show(index + (delta < 0 ? 1 : -1));
    touchX = null;
    startTimer();
  }, { passive: true });

  show(0);
  startTimer();
}

/* ================================================================== login */

export async function login({ query }) {
  if (state.me) { setTimeout(() => go('/dashboard'), 0); return '<div class="page-loading"><span class="spinner"></span></div>'; }
  const cfg = await loadConfig();
  let demo = [];
  try { demo = await api('/auth/demo-accounts'); } catch { /* optional */ }

  const html = `<div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);align-items:stretch">
    <div class="panel-dark" style="display:flex;flex-direction:column;justify-content:center">
      <div class="eyebrow" style="color:#f5c789">Welcome back</div>
      <h2 style="color:#fffdf7;font-size:2rem">Your livestock network, one code away.</h2>
      <p style="color:rgba(244,241,229,.75)">We send a one-time code to your phone. KraaLink never asks for a password, and never asks you to share the code with anyone.</p>
      <div class="stack-sm" style="margin-top:18px;color:rgba(244,241,229,.8);font-size:.86rem">
        <div class="row">${icon('check')} Works on WhatsApp, any phone</div>
        <div class="row">${icon('check')} Workers control their passport</div>
        <div class="row">${icon('check')} Every sensitive view is logged</div>
      </div>
    </div>
    <div class="card">
      <h2 style="margin-bottom:6px">Sign in</h2>
      <p class="muted small">Enter the phone number on your KraaLink account.</p>
      <div data-step="phone">
        <form data-phone-form>
          <div class="field">
            <label for="phone">Phone number</label>
            <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+264 81 100 0001" required>
            <div class="hint">Namibian numbers can be entered as 081 100 0001.</div>
          </div>
          <button class="btn btn-primary btn-block" type="submit">Send my sign-in code</button>
        </form>
      </div>
      <div data-step="code" hidden>
        <form data-code-form>
          <p class="small muted">Code sent to <b data-phone-show></b>. <button type="button" class="btn btn-xs btn-ghost" data-change-phone>Change</button></p>
          <div class="field">
            <label for="code">6-digit code</label>
            <input id="code" name="code" class="otp-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" required>
            <div class="hint" data-demo-hint hidden></div>
          </div>
          <button class="btn btn-primary btn-block" type="submit">Verify and sign in</button>
          <button type="button" class="btn btn-ghost btn-block mt-1" data-resend>Send a new code</button>
        </form>
      </div>
      ${demo.length ? `<div class="divider dashed"></div>
        <p class="tiny muted" style="margin-bottom:8px">Demo mode — one-tap sign in:</p>
        <div class="demo-grid" data-demo-grid>${demo.map(demoCard).join('')}</div>` : ''}
      <p class="small muted mt-2">New here? <a href="#/signup">Create an account</a> · Demo mode: a new phone number signs up with a face photo.</p>
    </div>
  </div>`;

  return {
    html,
    after() {
      const view = document.getElementById('view');
      wireDemoGrid(view);
      let phone = '';
      const phoneStep = view.querySelector('[data-step="phone"]');
      const codeStep = view.querySelector('[data-step="code"]');
      const phoneShow = view.querySelector('[data-phone-show]');
      const demoHint = view.querySelector('[data-demo-hint]');

      async function requestCode(number) {
        const res = await api('/auth/otp/request', { method: 'POST', body: { phone: number } });
        phoneStep.hidden = true;
        codeStep.hidden = false;
        phoneShow.textContent = number;
        demoHint.hidden = !res.demoCode;
        demoHint.textContent = res.demoCode ? `Demo code: ${res.demoCode} (also simulated on WhatsApp)` : '';
        if (res.demoCode) view.querySelector('#code').value = res.demoCode;
        toast(res.demoCode ? `Demo code ${res.demoCode} — already filled in.` : 'Code sent on WhatsApp.', 'ok');
      }

      view.querySelector('[data-phone-form]').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        const number = e.target.phone.value.trim();
        if (!number) return;
        phone = number;
        btn.disabled = true; btn.textContent = 'Sending…';
        try { await requestCode(number); }
        catch (err) { apiToast(err); }
        finally { btn.disabled = false; btn.textContent = 'Send my sign-in code'; }
      });

      view.querySelector('[data-code-form]').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        const code = e.target.code.value.trim();
        btn.disabled = true; btn.textContent = 'Checking…';
        try {
          const res = await api('/auth/otp/verify', { method: 'POST', body: { phone, code } });
          if (res.needsSignup) {
            sessionStorage.setItem('kraalink.signupToken', res.signupToken);
            sessionStorage.setItem('kraalink.signupPhone', res.phone || phone);
            toast('Phone verified. Finish your account.', 'ok');
            go('/signup');
            return;
          }
          await finishLogin(res);
        } catch (err) {
          apiToast(err);
          btn.disabled = false; btn.textContent = 'Verify and sign in';
        }
      });

      view.querySelector('[data-change-phone]').addEventListener('click', () => {
        codeStep.hidden = true; phoneStep.hidden = false;
      });
      view.querySelector('[data-resend]').addEventListener('click', async () => {
        try { await requestCode(phone); } catch (err) { apiToast(err); }
      });
    }
  };
}

export async function finishLogin(data) {
  setSession(data.token, data.user);
  await refreshUnread();
  const next = state.next;
  state.next = null;
  toast(`Welcome, ${data.user.name.split(' ')[0]}.`, 'ok');
  go(next || '/dashboard');
}

/* ================================================================== signup */

export async function signup() {
  const cfg = await loadConfig();
  const storedToken = sessionStorage.getItem('kraalink.signupToken') || '';
  const storedPhone = sessionStorage.getItem('kraalink.signupPhone') || '';

  const allRoles = cfg.signupRoles?.length ? cfg.signupRoles : FALLBACK_ROLES;
  const roleOptions = allRoles.filter(r => !r.inviteOnly);
  const inviteOnly = allRoles.filter(r => r.inviteOnly);

  const draft = {
    choice: '',
    title: '',
    token: storedToken,
    phone: storedPhone,
    faceImage: null,
    idDocImage: null
  };

  const html = `<div style="max-width:880px;margin:0 auto">
    <div class="page-head" style="margin-bottom:18px">
      <div>
        <div class="eyebrow">Join KraaLink</div>
        <h1>Create your account</h1>
        <p class="lead">It takes about four minutes. Workers capture a face photo and ID document so their passport can be trusted by farmers.</p>
      </div>
      <a class="btn btn-ghost" href="#/login">Already have an account</a>
    </div>
    <div class="steps-bar" data-steps><div class="current"><i></i></div><div><i></i></div><div><i></i></div></div>
    <div class="card" data-signup-body></div>
  </div>`;

  return {
    html,
    after() {
      const body = document.getElementById('view').querySelector('[data-signup-body]');
      const bars = document.getElementById('view').querySelectorAll('[data-steps] div');

      function setStep(n) {
        bars.forEach((bar, i) => {
          bar.classList.toggle('done', i < n - 1);
          bar.classList.toggle('current', i === n - 1);
        });
      }

      function roleStep() {
        setStep(1);
        body.innerHTML = `<h2 style="margin-bottom:4px">What is your role?</h2>
          <p class="muted small">Choose the closest match so KraaLink opens the right tools, then describe your own role in your words. Staff accounts are invite-only.</p>
          <div class="role-grid mt-2">
            ${roleOptions.map(r => `
              <button type="button" class="role-card${draft.choice === r.code ? ' selected' : ''}" data-role="${esc(r.code)}">
                ${icon(ROLE_ICONS[r.code] || 'users')}
                <b>${esc(r.label)}</b>
                <span>${esc(r.description)}</span>
                <span class="role-base">${esc(BASE_ROLE_LABEL[r.baseRole] || 'Community tools')}</span>
              </button>`).join('')}
          </div>
          <div class="role-custom">
            <div class="field">
              <label for="roleTitle">Your role in your own words</label>
              <input id="roleTitle" maxlength="60" value="${esc(draft.title)}" placeholder="e.g. Goat farmer and egg supplier in Outapi">
              <div class="hint">This shows on your account. It can be more specific than the list above.</div>
            </div>
            <div class="notice info">${icon('shield')} ${esc(inviteOnly.length
              ? `${inviteOnly.map(r => r.label).join(', ')} accounts are created by an administrator.`
              : 'Field agents, verifiers, reviewers and administrators are created by an administrator.')}</div>
          </div>
          <div class="row end mt-3"><button type="button" class="btn btn-primary" data-continue>Continue ${icon('arrow')}</button></div>`;

        const titleInput = body.querySelector('#roleTitle');

        function selectRole(card) {
          const role = roleOptions.find(r => r.code === card.dataset.role);
          if (!role) return;
          const previous = roleOptions.find(r => r.code === draft.choice);
          const current = titleInput.value.trim();
          draft.choice = role.code;
          if (!current || (previous && current === previous.label)) titleInput.value = role.label;
          draft.title = titleInput.value.trim();
          body.querySelectorAll('[data-role]').forEach(c => c.classList.toggle('selected', c === card));
        }

        body.querySelectorAll('[data-role]').forEach(card => {
          card.addEventListener('click', () => selectRole(card));
        });

        titleInput.addEventListener('input', () => {
          draft.title = titleInput.value.trim();
        });

        body.querySelector('[data-continue]').addEventListener('click', () => {
          draft.title = titleInput.value.trim();
          if (!draft.choice) {
            toast('Choose the role that fits you best, then continue.', 'warn');
            return;
          }
          if (draft.title.length < 2) {
            toast('Describe your role in a few words.', 'warn');
            titleInput.focus();
            return;
          }
          if (draft.token) detailsStep();
          else verifyStep();
        });
      }

      function verifyStep() {
        setStep(2);
        body.innerHTML = `<h2 style="margin-bottom:4px">Verify your phone number</h2>
          <p class="muted small">We send a one-time code by WhatsApp. There is no password to remember.</p>
          <form data-verify-phone class="mt-2">
            <div class="field">
              <label for="su-phone">Phone number</label>
              <input id="su-phone" name="phone" type="tel" inputmode="tel" placeholder="+264 81 123 4567" required>
              <div class="hint">Use the number that will receive job and consent messages.</div>
            </div>
            <button class="btn btn-primary" type="submit">Send code</button>
          </form>
          <form data-verify-code class="mt-3" hidden>
            <div class="field">
              <label for="su-code">6-digit code</label>
              <input id="su-code" name="code" class="otp-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required>
              <div class="hint" data-code-hint></div>
            </div>
            <div class="row"><button class="btn btn-primary" type="submit">Verify phone</button>
            <button type="button" class="btn btn-ghost" data-back>Back</button></div>
          </form>`;

        let phone = '';
        body.querySelector('[data-verify-phone]').addEventListener('submit', async e => {
          e.preventDefault();
          phone = e.target.phone.value.trim();
          const btn = e.target.querySelector('button');
          btn.disabled = true;
          try {
            const res = await api('/auth/otp/request', { method: 'POST', body: { phone } });
            const codeForm = body.querySelector('[data-verify-code]');
            codeForm.hidden = false;
            const hint = codeForm.querySelector('[data-code-hint]');
            hint.textContent = res.demoCode ? `Demo code: ${res.demoCode}` : 'Check WhatsApp for the code.';
            if (res.demoCode) codeForm.code.value = res.demoCode;
            toast(res.demoCode ? `Demo code ${res.demoCode} — filled in for you.` : 'Code sent.', 'ok');
          } catch (err) { apiToast(err); }
          finally { btn.disabled = false; }
        });

        body.querySelector('[data-verify-code]').addEventListener('submit', async e => {
          e.preventDefault();
          const btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true;
          try {
            const res = await api('/auth/otp/verify', { method: 'POST', body: { phone, code: e.target.code.value.trim() } });
            if (res.token) { await finishLogin(res); return; }
            draft.token = res.signupToken;
            draft.phone = res.phone || phone;
            sessionStorage.setItem('kraalink.signupToken', draft.token);
            sessionStorage.setItem('kraalink.signupPhone', draft.phone);
            toast('Phone verified.', 'ok');
            detailsStep();
          } catch (err) { apiToast(err); }
          finally { btn.disabled = false; }
        });
        body.querySelector('[data-back]').addEventListener('click', roleStep);
      }

      function detailsStep() {
        setStep(3);
        const choiceInfo = roleOptions.find(r => r.code === draft.choice) || roleOptions[0];
        const baseRole = choiceInfo?.baseRole || 'finder';
        const isWorker = baseRole === 'worker';
        const isFarmer = baseRole === 'farmer';
        const roleTitle = draft.title.trim() || choiceInfo?.label || 'Community member';
        body.innerHTML = `<form data-details novalidate>
          <h2 style="margin-bottom:4px">Your details</h2>
          <p class="muted small">Signing up as <b>${esc(roleTitle)}</b>. ${isWorker ? 'Your passport needs a clear face photo and one ID document. These are stored privately.' : 'Tell us who you are and where you work.'}</p>
          <div class="form-grid mt-2">
            <div class="field span-2">
              <label for="fullName">Full name</label>
              <input id="fullName" name="fullName" required minlength="3" placeholder="e.g. Maria Nangula" autocomplete="name">
            </div>
            <div class="field">
              <label for="language">Language for WhatsApp messages</label>
              <select id="language" name="language">${options(cfg.languages, state.me?.language || 'en')}</select>
            </div>
            ${isFarmer ? `
              <div class="field">
                <label for="farmName">Farm name</label>
                <input id="farmName" name="farmName" placeholder="e.g. Ombuga Cattle Post">
              </div>
              <div class="field">
                <label for="regionCode">Farm region</label>
                <select id="regionCode" name="regionCode" required>${options(cfg.regions, state.me?.farmer?.regionCode || '')}</select>
              </div>` : ''}
            ${!isWorker && !isFarmer ? `<div class="field span-2"><div class="notice info">${icon('shield')} You can report found animals anonymously. Your name is never shown to the owner.</div></div>` : ''}
          </div>

          <div class="form-section">
            <h4>Face photo ${isWorker ? '(required)' : '(recommended)'}</h4>
            <div class="photo-field">
              <span class="photo-thumb round" data-face-preview>${icon('camera')}</span>
              <div class="meta">A clear photo of your face, taken now. Used for identification only — no automated face matching is performed.</div>
              <button type="button" class="btn btn-soft" data-take-face>${icon('camera')} Capture face</button>
            </div>
          </div>

          ${isWorker ? workerFields(cfg) : ''}

          <label class="check group mt-2">
            <input type="checkbox" name="consent" required>
            <span>I agree to KraaLink storing my details and photos for identity verification, and to the privacy rules described in the WorkerLink Passport. I understand I can revoke a hiring check at any time.</span>
          </label>
          <div class="row mt-1">
            <button type="button" class="btn btn-sm btn-ghost" data-read-consent>${icon('bell')} Read this aloud</button>
            <span class="tiny muted">Plays in your chosen language where the device supports it.</span>
          </div>

          <div class="row mt-3" style="justify-content:space-between">
            <button type="button" class="btn btn-ghost" data-back>Back</button>
            <button type="submit" class="btn btn-orange" data-submit>Create my account</button>
          </div>
          <div data-form-error></div>
        </form>`;

        const form = body.querySelector('[data-details]');
        form.querySelector('[data-back]').addEventListener('click', roleStep);
        form.querySelector('[data-read-consent]')?.addEventListener('click', () => {
          const language = form.language?.value || 'en';
          readAloud(SIGNUP_CONSENT[language] || SIGNUP_CONSENT.en, language);
        });

        form.querySelector('[data-take-face]').addEventListener('click', async () => {
          const shot = await openCamera({
            title: 'Capture your face',
            sub: 'This photo appears on your WorkerLink Passport. It is stored privately.',
            guide: 'face',
            facing: 'user',
            hint: 'Look straight ahead. Good light. No hat or sunglasses.',
            confirmLabel: 'Use this face photo'
          });
          if (shot) {
            draft.faceImage = shot;
            form.querySelector('[data-face-preview]').innerHTML = `<img src="${shot}" alt="Face photo preview">`;
            toast('Face photo captured.', 'ok');
          }
        });

        if (isWorker) wireWorkerFields(form, draft);

        form.addEventListener('submit', async e => {
          e.preventDefault();
          const errBox = form.querySelector('[data-form-error]');
          errBox.innerHTML = '';
          const fd = new FormData(form);
          const fullName = String(fd.get('fullName') || '').trim();
          const fail = msg => { errBox.innerHTML = errorBox(msg); errBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

          if (fullName.length < 3) return fail('Enter your full name.');
          if (!draft.token) return fail('Verify your phone number first.');
          if (!fd.get('consent')) return fail('Please accept the privacy terms to continue.');
          if (isWorker && !draft.faceImage) return fail('Capture a face photo — it is required for a WorkerLink Passport.');
          if (isWorker && !draft.idDocImage) return fail('Capture or upload a photo of your ID document.');

          const payload = {
            signupToken: draft.token,
            roleChoice: draft.choice,
            roleTitle,
            role: baseRole,
            fullName,
            language: fd.get('language') || 'en',
            faceImage: draft.faceImage || undefined
          };

          if (isFarmer) {
            payload.farmer = { farmName: String(fd.get('farmName') || '').trim() || fullName, regionCode: fd.get('regionCode') };
          }

          if (isWorker) {
            payload.worker = {
              dob: fd.get('dob'),
              idDocType: fd.get('idDocType'),
              idDocNumber: String(fd.get('idDocNumber') || '').trim(),
              idDocImage: draft.idDocImage,
              village: String(fd.get('village') || '').trim(),
              constituency: String(fd.get('constituency') || '').trim(),
              regionCode: fd.get('regionCode'),
              otherPhone: String(fd.get('otherPhone') || '').trim() || undefined,
              skills: String(fd.get('skills') || '').split(',').map(s => s.trim()).filter(Boolean),
              languages: String(fd.get('languages') || '').split(',').map(s => s.trim()).filter(Boolean),
              nextOfKin: [...form.querySelectorAll('[data-kin-row]')].map(row => ({
                name: row.querySelector('[name=kinName]').value.trim(),
                relationship: row.querySelector('[name=kinRelationship]').value.trim(),
                phone: row.querySelector('[name=kinPhone]').value.trim(),
                village: row.querySelector('[name=kinVillage]').value.trim() || undefined
              })),
              references: [...form.querySelectorAll('[data-ref-row]')].map(row => ({
                name: row.querySelector('[name=refName]').value.trim(),
                role: row.querySelector('[name=refRole]').value.trim() || undefined,
                phone: row.querySelector('[name=refPhone]').value.trim()
              })),
              consentAccepted: true,
              consentVersion: 'consent-v1'
            };
            if (!payload.worker.dob) return fail('Enter your date of birth.');
            if (!payload.worker.idDocNumber) return fail('Enter the ID document number.');
            if (!payload.worker.village) return fail('Enter your home village.');
            if (!payload.worker.constituency) return fail('Enter your constituency, or your commune if you live in Angola.');
            if (!payload.worker.regionCode) return fail('Choose your home region.');
            if (payload.worker.nextOfKin.length < 2 || payload.worker.nextOfKin.some(k => !k.name || !k.phone))
              return fail('Add two next-of-kin contacts with a name and phone number.');
            if (payload.worker.references.length < 1 || payload.worker.references.some(r => !r.name || !r.phone))
              return fail('Add at least one reference person.');
          }

          const btn = form.querySelector('[data-submit]');
          btn.disabled = true; btn.textContent = 'Creating your account…';
          try {
            const res = await api('/auth/signup', { method: 'POST', body: payload });
            sessionStorage.removeItem('kraalink.signupToken');
            sessionStorage.removeItem('kraalink.signupPhone');
            setSession(res.token, res.user);
            await refreshUnread();
            toast(isWorker
              ? `Passport created at L1 as ${roleTitle}. Your short code is ${res.user.worker?.shortCode}.`
              : `Account created as ${roleTitle}. Welcome to KraaLink.`, 'ok', 7000);
            go('/dashboard');
          } catch (err) {
            fail(err.message);
            btn.disabled = false; btn.textContent = 'Create my account';
          }
        });
      }

      roleStep();
    }
  };
}

function workerFields(cfg) {
  return `<div class="form-section">
      <h4>Identity document</h4>
      <div class="form-grid">
        <div class="field">
          <label for="dob">Date of birth</label>
          <input id="dob" name="dob" type="date" required>
          <div class="hint">You must be at least 16 years old.</div>
        </div>
        <div class="field">
          <label for="idDocType">Document type</label>
          <select id="idDocType" name="idDocType" required>
            <option value="namibian_id">Namibian ID</option>
            <option value="angolan_passport">Angolan passport</option>
            <option value="angolan_id">Angolan ID</option>
            <option value="birth_certificate">Birth certificate</option>
          </select>
        </div>
        <div class="field span-2">
          <label for="idDocNumber">Document number</label>
          <input id="idDocNumber" name="idDocNumber" required autocomplete="off" placeholder="Encrypted before it is stored">
        </div>
        <div class="field span-2">
          <label>Photo of the ID document</label>
          <div class="photo-field">
            <span class="photo-thumb doc" data-id-preview>${icon('doc')}</span>
            <div class="meta">Lay the document flat. All corners must be visible. Stored privately; only authorised staff can view it.</div>
            <button type="button" class="btn btn-soft" data-take-id>${icon('camera')} Capture document</button>
          </div>
        </div>
      </div>
    </div>

    <div class="form-section">
      <h4>Home area</h4>
      <div class="form-grid">
        <div class="field">
          <label for="village">Home village</label>
          <input id="village" name="village" required placeholder="Village or settlement">
        </div>
        <div class="field">
          <label for="constituency">Constituency / commune</label>
          <input id="constituency" name="constituency" required placeholder="Constituency in Namibia, commune in Angola">
        </div>
        <div class="field">
          <label for="regionCode">Region</label>
          <select id="regionCode" name="regionCode" required>${options(cfg.regions, '')}</select>
        </div>
        <div class="field">
          <label for="otherPhone">Other phone number</label>
          <input id="otherPhone" name="otherPhone" type="tel" placeholder="Optional second number">
        </div>
        <div class="field">
          <label for="skills">Skills</label>
          <input id="skills" name="skills" placeholder="Herding, fencing, tractor driving">
          <div class="hint">Separate with commas.</div>
        </div>
        <div class="field">
          <label for="languages">Languages spoken</label>
          <input id="languages" name="languages" placeholder="Oshiwambo, Afrikaans, English">
          <div class="hint">Separate with commas.</div>
        </div>
      </div>
    </div>

    <div class="form-section">
      <h4>Next of kin — two contacts</h4>
      <p class="tiny muted">Only contacted if you are unreachable for 48 hours during an open job, and every contact is logged.</p>
      ${kinRow(0)}
      ${kinRow(1)}
      <button type="button" class="btn btn-ghost btn-sm" data-add-kin>${icon('plus')} Add another contact</button>
    </div>

    <div class="form-section">
      <h4>Reference — one person</h4>
      ${refRow(0)}
      <button type="button" class="btn btn-ghost btn-sm" data-add-ref>${icon('plus')} Add another reference</button>
    </div>`;
}

function kinRow(index) {
  return `<div class="form-grid" data-kin-row style="border:1px solid var(--line);border-radius:12px;padding:12px 14px 0;margin-bottom:10px">
    <div class="field"><label>Name</label><input name="kinName" placeholder="Contact ${index + 1} full name"></div>
    <div class="field"><label>Relationship</label><input name="kinRelationship" placeholder="Mother, brother, neighbour"></div>
    <div class="field"><label>Phone</label><input name="kinPhone" type="tel" placeholder="+264 …"></div>
    <div class="field"><label>Village</label><input name="kinVillage" placeholder="Optional"></div>
  </div>`;
}

function refRow(index) {
  return `<div class="form-grid" data-ref-row style="border:1px solid var(--line);border-radius:12px;padding:12px 14px 0;margin-bottom:10px">
    <div class="field"><label>Name</label><input name="refName" placeholder="Reference ${index + 1} full name"></div>
    <div class="field"><label>Role</label><input name="refRole" placeholder="Former employer, headman"></div>
    <div class="field"><label>Phone</label><input name="refPhone" type="tel" placeholder="+264 …"></div>
  </div>`;
}

function wireWorkerFields(form, draft) {
  form.querySelector('[data-take-id]').addEventListener('click', async () => {
    const shot = await openCamera({
      title: 'Capture the ID document',
      sub: 'Private to authorised staff. Used to verify your passport.',
      guide: 'doc',
      facing: 'environment',
      hint: 'Place the document on a flat, well-lit surface and fill the frame.',
      confirmLabel: 'Use this document photo'
    });
    if (shot) {
      draft.idDocImage = shot;
      form.querySelector('[data-id-preview]').innerHTML = `<img src="${shot}" alt="ID document preview">`;
      toast('Document photo captured.', 'ok');
    }
  });

  form.querySelector('[data-add-kin]').addEventListener('click', () => {
    const count = form.querySelectorAll('[data-kin-row]').length;
    form.querySelectorAll('[data-kin-row]').at(-1).insertAdjacentHTML('afterend', kinRow(count));
  });
  form.querySelector('[data-add-ref]').addEventListener('click', () => {
    const count = form.querySelectorAll('[data-ref-row]').length;
    form.querySelectorAll('[data-ref-row]').at(-1).insertAdjacentHTML('afterend', refRow(count));
  });
}

/* ================================================================== marketplace */

export async function market({ query }) {
  const cfg = await loadConfig();
  const produce = query.kind === 'produce';
  const kind = produce ? 'produce' : 'livestock';
  const params = new URLSearchParams();
  params.set('kind', kind);
  if (query.species && !produce) params.set('species', query.species);
  if (query.category && produce) params.set('category', query.category);
  if (query.region) params.set('region', query.region);
  if (query.q) params.set('q', query.q);
  const [listings, prices] = await Promise.all([
    api('/listings?' + params.toString()),
    produce ? Promise.resolve(null) : api('/price-board')
  ]);

  const board = prices ? prices.board.slice(0, 4).map(row => `<div class="price-cell">
      <div class="species">${esc(row.species)}</div>
      <div class="value">${money(row.medianNad)}</div>
      <div class="range">${row.listings} listing${row.listings === 1 ? '' : 's'} · ${money(row.minNad)} – ${money(row.maxNad)}</div>
    </div>`).join('') : '';

  const canSell = state.me?.role === 'farmer';
  const sellLink = produce ? '#/listings/new?kind=produce' : '#/listings/new';
  const clearLink = produce ? '#/produce' : '#/market';

  return `<div class="page-head">
      <div>
        <div class="eyebrow">${produce ? 'Farm produce market' : 'Kraal Marketplace'}</div>
        <h1>${produce ? 'Fresh from the farm, across Namibia.' : 'Livestock, without the guesswork.'}</h1>
        <p class="lead">${produce
          ? 'Eggs, milk, maize, vegetables, honey and more from farmers in all 14 regions. Farmers add a real photo, the unit they sell in and their own price. Contact the seller directly on WhatsApp.'
          : 'Asking prices from farmers across Namibia. Contact the seller directly on WhatsApp. Listings carrying a missing or stolen tag are held before buyers see them.'}</p>
      </div>
      ${canSell
        ? `<a class="btn btn-orange" href="${sellLink}">${icon('plus')} ${produce ? 'List produce' : 'List livestock'}</a>`
        : `<a class="btn btn-primary" href="#/signup">Join to sell</a>`}
    </div>

    <div class="market-tabs">
      <a class="market-tab${produce ? '' : ' active'}" href="#/market">${icon('market')} Livestock</a>
      <a class="market-tab${produce ? ' active' : ''}" href="#/produce">${icon('tag')} Farm produce</a>
    </div>

    ${board ? `<div class="price-strip mb-3">${board}</div>` : ''}

    <form class="card tight mb-3" data-filters>
      <input type="hidden" name="kind" value="${kind}">
      <div class="filters">
        ${produce
          ? `<div class="field"><label for="f-category">Category</label><select id="f-category" name="category"><option value="">All produce</option>${cfg.produceCategories.map(c => `<option${c === query.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`
          : `<div class="field"><label for="f-species">Species</label><select id="f-species" name="species"><option value="">All species</option>${speciesOptions(cfg.species, query.species || '')}</select></div>`}
        <div class="field"><label for="f-region">Region</label><select id="f-region" name="region"><option value="">All regions</option>${options(cfg.regions, query.region || '')}</select></div>
        <div class="field grow"><label for="f-q">Search</label><input id="f-q" name="q" type="search" placeholder="${produce ? 'Product, category or village' : 'Village, brand or breed'}" value="${esc(query.q || '')}"></div>
        <button class="btn btn-primary" type="submit">${icon('search')} Filter</button>
        <a class="btn btn-ghost" href="${clearLink}">Clear</a>
      </div>
    </form>

    <div class="row between mb-2">
      <p class="small muted mb-0"><b>${listings.length}</b> active ${produce ? 'produce ' : ''}listing${listings.length === 1 ? '' : 's'} across Namibia</p>
      <span class="tiny muted">${produce ? 'Photos and units are supplied by the farmer.' : 'Hold rule applies to every new listing automatically.'}</span>
    </div>

    ${listings.length ? `<div class="market-grid">${listings.map(listingCard).join('')}</div>` :
      emptyState({
        iconName: produce ? 'tag' : 'market',
        title: 'No listings match',
        body: produce
          ? 'Try another region or category. Farmers add new produce throughout the week.'
          : 'Try a wider region or another species. New listings appear here immediately.',
        action: `<a class="btn btn-ghost" href="${clearLink}">Reset filters</a>`
      })}`;
}

export async function produce(ctx) {
  return market({ ...ctx, query: { ...ctx.query, kind: 'produce' } });
}

function listingCard(l) {
  const isProduce = l.kind === 'produce';
  const title = isProduce
    ? esc(l.species)
    : `${esc(l.qty)} × ${esc(l.species)}${l.ageText ? ` · ${esc(l.ageText)}` : ''}`;
  return `<a class="listing-card hover-card" href="#/market/${esc(l.id)}" style="text-decoration:none;color:inherit">
    <div class="listing-photo">
      ${l.photoUrl ? `<img src="${esc(l.photoUrl)}" alt="${esc(l.species)} listed in ${esc(l.village || l.regionName)}" loading="lazy">` : `<span class="no-photo">${icon(isProduce ? 'tag' : 'market')}</span>`}
      <span class="badge badge-dark float-badge">${esc(isProduce ? (l.category || 'Produce') : l.species)}</span>
      ${isProduce ? `<span class="badge badge-olive float-kind">Produce</span>` : ''}
    </div>
    <div class="listing-body">
      <h3>${title}</h3>
      <span class="listing-price">${money(l.priceNad)}${isProduce && l.unit ? ` <small>per ${esc(l.unit)}</small>` : ''}</span>
      <div class="listing-meta">
        <span>${icon('pin')} ${esc(l.village || l.regionName || 'Namibia')}</span>
        ${isProduce ? `<span>${esc(l.qty)} ${esc(l.unit || '')} available</span>` : (l.sex ? `<span>${esc(l.sex)}</span>` : '')}
        ${!isProduce && l.brandText ? `<span>Brand ${esc(l.brandText)}</span>` : ''}
      </div>
      <div class="listing-foot">
        <span class="seller">${avatar({ name: l.sellerName })} ${esc(l.sellerName || '')}</span>
        <span class="link-arrow">View ${icon('arrow')}</span>
      </div>
    </div>
  </a>`;
}

export async function marketDetail({ params }) {
  const data = await api('/listings/' + encodeURIComponent(params.id));
  const l = data.listing;
  const isProduce = l.kind === 'produce';
  const canReport = state.me && state.me.id !== l.farmerId;

  const details = isProduce ? `
    <dl class="kv">
      <dt>Category</dt><dd>${esc(l.category || '—')}</dd>
      <dt>Available</dt><dd>${esc(l.qty)} ${esc(l.unit || '')}</dd>
      <dt>Sold per</dt><dd>${esc(l.unit || '—')}</dd>
      <dt>Region</dt><dd>${esc(l.regionName || l.regionCode || '—')}</dd>
      <dt>Village</dt><dd>${esc(l.village || '—')}</dd>
      <dt>Status</dt><dd>${statusBadge(l.status)}</dd>
    </dl>` : `
    <dl class="kv">
      <dt>Region</dt><dd>${esc(l.regionName || l.regionCode || '—')}</dd>
      <dt>Village</dt><dd>${esc(l.village || '—')}</dd>
      <dt>Brand mark</dt><dd>${esc(l.brandText || 'Not stated')}</dd>
      <dt>Ear tags</dt><dd>${l.tagNumbers?.length ? l.tagNumbers.map(t => `<span class="badge badge-grey plain mono">${esc(t)}</span>`).join(' ') : 'Not stated'}</dd>
      <dt>Status</dt><dd>${statusBadge(l.status)}</dd>
    </dl>`;

  return `<p class="small muted"><a href="#/market">Marketplace</a> / <a href="${isProduce ? '#/produce' : '#/market'}">${isProduce ? 'Farm produce' : 'Livestock'}</a> / ${esc(l.species)}</p>
    <div class="split">
      <div class="stack">
        <div class="card flush">
          <div style="aspect-ratio:16/10;background:linear-gradient(150deg,var(--olive-soft),#eff0e4)">
            ${l.photoUrl ? `<img src="${esc(l.photoUrl)}" alt="${esc(l.species)}" style="width:100%;height:100%;object-fit:cover">` : `<div style="height:100%;display:grid;place-items:center;color:var(--olive);opacity:.35">${icon(isProduce ? 'tag' : 'market')}</div>`}
          </div>
          <div style="padding:26px">
            <div class="row between">
              <div><h1 style="font-size:2rem">${esc(l.species)}</h1>
              <p class="muted small mb-0">${isProduce
                ? `${esc(l.qty)} ${esc(l.unit || '')} available · Listed ${fmtDate(l.createdAt)}`
                : `${esc(l.qty)} animals · ${esc(l.ageText || 'Age not stated')}${l.sex ? ' · ' + esc(l.sex) : ''} · Listed ${fmtDate(l.createdAt)}`}</p></div>
              <span class="listing-price" style="font-size:1.9rem">${money(l.priceNad)}${isProduce && l.unit ? `<small> per ${esc(l.unit)}</small>` : ''}</span>
            </div>
            <div class="divider"></div>
            ${details}
            <div class="notice mt-2">${icon('shield')} ${isProduce
              ? 'Inspect freshness, quantity and packaging before paying. KraaLink does not hold produce or money; agree the price per unit with the farmer.'
              : "Ask to see the animal's brand or ear tag in person. KraaLink holds any listing that carries a tag reported missing, stolen or owned by someone else."}</div>
          </div>
        </div>

        ${canReport ? `<div class="card">
          <div class="card-head"><div><h3>${icon('alert')} Something looks wrong?</h3><p class="card-sub">Report a suspicious listing. Reviewers see your reason; other buyers do not.</p></div></div>
          <form data-report-form>
            <div class="field"><label for="report-reason">Why is this listing suspicious?</label>
            <textarea id="report-reason" name="reason" required minlength="8" placeholder="e.g. The ear tag matches an animal reported missing in my area."></textarea></div>
            <button class="btn btn-danger" type="submit">Send report to reviewers</button>
          </form>
        </div>` : ''}
      </div>

      <div class="stack">
        <div class="card">
          <h3>Contact the seller</h3>
          <div class="row mt-1" style="gap:12px">
            ${avatar({ name: l.sellerName }, 'avatar-lg')}
            <div><b>${esc(l.sellerName || '')}</b><div class="small muted">Seller on KraaLink</div></div>
          </div>
          ${l.whatsapp ? `<a class="btn btn-orange btn-block mt-2" href="${esc(l.whatsapp)}" target="_blank" rel="noopener">${icon('market')} Message on WhatsApp</a>` : `<div class="notice warn mt-2">${icon('alert')} No phone number is available for this seller.</div>`}
          <p class="tiny muted mt-2 mb-0">${isProduce
            ? 'Confirm quantity, packaging and collection point on WhatsApp. Inspect the produce and agree the unit price before paying. KraaLink does not hold funds.'
            : 'Arrange payment in person, inspect the animals, and check the brand or ear tag before money changes hands. KraaLink does not hold funds.'}</p>
        </div>
        <div class="card">
          <h3>Buying safely</h3>
          <div class="stack-sm small">
            ${isProduce ? `
              <div class="row">${icon('check')} Agree quantity and packaging first</div>
              <div class="row">${icon('check')} Inspect freshness and grading in person</div>
              <div class="row">${icon('check')} Confirm the price per ${esc(l.unit || 'unit')}</div>
              <div class="row">${icon('check')} Never pay before you see the goods</div>` : `
              <div class="row">${icon('check')} Ask for the brand certificate</div>
              <div class="row">${icon('check')} Match the ear tag to the seller's register</div>
              <div class="row">${icon('check')} Use a written transfer record</div>
              <div class="row">${icon('check')} Never pay before you see the animals</div>`}
          </div>
          <a class="btn btn-ghost btn-block mt-2" href="${isProduce ? '#/produce' : '#/found'}">${isProduce ? 'Browse more produce' : 'Report found livestock'}</a>
        </div>
      </div>
    </div>`;
}

marketDetail.after = undefined;

export function wireMarket() {
  const form = document.querySelector('[data-filters]');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const qs = new URLSearchParams();
    const produce = form.kind.value === 'produce';
    const category = form.querySelector('[name=category]');
    const species = form.querySelector('[name=species]');
    if (species?.value) qs.set('species', species.value);
    if (category?.value) qs.set('category', category.value);
    if (form.region.value) qs.set('region', form.region.value);
    if (form.q.value.trim()) qs.set('q', form.q.value.trim());
    const base = produce ? '/produce' : '/market';
    go(base + (qs.toString() ? '?' + qs.toString() : ''));
  });
}

export async function priceBoard() {
  const data = await api('/price-board');
  return `<div class="page-head"><div><div class="eyebrow">Marketplace</div><h1>Price board</h1>
    <p class="lead">${esc(data.label)}</p></div>
    <a class="btn btn-ghost" href="#/market">Back to listings</a></div>
    <div class="card mb-3">
      <div class="card-head"><div><h3>Live asking prices</h3><p class="card-sub">Median, lowest and highest asking price from active listings.</p></div></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Species</th><th>Listings</th><th>Median</th><th>Range</th></tr></thead>
        <tbody>${data.board.map(r => `<tr><td><b>${esc(r.species)}</b></td><td>${r.listings}</td><td>${money(r.medianNad)}</td><td>${money(r.minNad)} – ${money(r.maxNad)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3>Reference indicators</h3><p class="card-sub">Indicative weekly references. Not an auction or abattoir quote.</p></div><span class="badge badge-amber">Indicative only</span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Week of</th><th>Species</th><th>Type</th><th>Value</th><th>Unit</th><th>Source</th></tr></thead>
        <tbody>${data.references.map(r => `<tr><td>${fmtDate(r.weekOf)}</td><td>${esc(r.species)}</td><td>${esc(r.priceType)}</td><td>${money(r.valueNad)}</td><td>${esc(r.unit)}</td><td class="muted">${esc(r.source)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

export function wireMarketDetail() {
  const form = document.querySelector('[data-report-form]');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const id = location.hash.split('/')[2].split('?')[0];
      await api(`/listings/${encodeURIComponent(id)}/reports`, { method: 'POST', body: { reason: form.reason.value.trim() } });
      toast('Report sent to reviewers. Thank you.', 'ok');
      form.reset();
    } catch (err) { apiToast(err); }
    finally { btn.disabled = false; }
  });
}

/* ================================================================== vetbot */

export async function vet({ query }) {
  const cfg = await loadConfig();
  const conditions = await api('/vetbot/conditions');
  const region = state.me?.farmer?.regionCode || query.region || '';
  const directory = await api('/vet-directory' + (region ? '?region=' + encodeURIComponent(region) : ''));
  const me = state.me;

  return `<div class="page-head">
    <div><div class="eyebrow">VetBot-lite</div><h1>Animal health guidance, checked by vets.</h1>
    <p class="lead">Pick the signs you see. KraaLink matches them against content approved by a registered veterinarian. This is information, not a diagnosis.</p></div>
    <span class="badge badge-amber badge-lg">Never a substitute for a vet</span>
  </div>

  <div class="split">
    <div class="card">
      <div class="card-head"><div><h3>${icon('vet')} Describe what you see</h3><p class="card-sub">Select every sign that applies. You can also type a short description.</p></div></div>
      <form data-vet-form>
        <div class="form-grid">
          <div class="field">
            <label for="vet-species">Species</label>
            <select id="vet-species" name="species">${speciesOptions(cfg.species, 'Cattle')}</select>
          </div>
          <div class="field">
            <label for="vet-language">Reply language</label>
            <select id="vet-language" name="language">${options(cfg.languages, me?.language || 'en')}</select>
          </div>
          <div class="field span-2">
            <label for="vet-region">Your region (for the vet directory)</label>
            <select id="vet-region" name="regionCode"><option value="">Choose a region</option>${options(cfg.regions, region)}</select>
          </div>
        </div>
        <div class="field">
          <label>Symptoms</label>
          <div class="check-list">${conditions.symptoms.map(s => `<label class="chip-check"><input type="checkbox" name="symptoms" value="${esc(s)}"><span>${esc(s)}</span></label>`).join('')}</div>
        </div>
        <div class="field">
          <label for="vet-note">Anything else?</label>
          <textarea id="vet-note" name="symptomsText" placeholder="How long has the animal been sick? Is it eating or drinking? Any deaths in the herd?"></textarea>
        </div>
        <div class="notice warn mb-2">${icon('alert')} For sudden deaths, multiple sick animals, or suspected notifiable disease, contact the State Veterinary office immediately. Do not move, sell or slaughter the animals.</div>
        <button class="btn btn-primary" type="submit">${icon('check')} Get guidance</button>
        ${!me ? `<p class="tiny muted mt-1 mb-0">You need an account to log a triage session. <a href="#/login">Sign in</a> or <a href="#/signup">create one</a>.</p>` : ''}
      </form>
      <div data-vet-result class="mt-3"></div>
    </div>

    <div class="stack">
      <div class="card">
        <h3>Vet directory</h3>
        <p class="card-sub">Demo contacts. In production these come from the State Veterinary register.</p>
        <div class="stack-sm mt-2">
          ${directory.map(v => `<div class="vet-card">
            <b>${esc(v.name)}</b>
            <div class="type">${esc(v.type || 'Veterinary service')}</div>
            <div class="where">${esc(v.town || '')}${v.regionName ? ' · ' + esc(v.regionName) : ''}</div>
            ${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : ''}
          </div>`).join('') || '<p class="small muted">No directory entries for this region.</p>'}
        </div>
      </div>
      <div class="card">
        <h3>Notifiable disease protocol</h3>
        <ol class="small" style="padding-left:18px;margin:8px 0 0;color:var(--ink-soft)">
          <li>Isolate the animals immediately.</li>
          <li>Do not move, sell or slaughter them.</li>
          <li>Call the nearest State Veterinary office.</li>
          <li>Follow their instructions; keep a record of what you saw.</li>
        </ol>
      </div>
      <div class="card dark">
        <h3>Why vet approval matters</h3>
        <p class="muted small mb-0">Only content marked approved by a named registered vet can trigger advice. Unreviewed drafts never reach farmers. When a notifiable disease is suspected, VetBot escalates instead of guessing.</p>
      </div>
    </div>
  </div>`;
}

export function wireVet() {
  const form = document.querySelector('[data-vet-form]');
  if (!form) return;
  const result = document.querySelector('[data-vet-result]');

  form.querySelector('[name=regionCode]').addEventListener('change', async e => {
    try {
      const region = e.target.value;
      const rows = await api('/vet-directory' + (region ? '?region=' + encodeURIComponent(region) : ''));
      const holder = document.querySelector('.vet-card')?.parentElement;
      if (holder) {
        holder.innerHTML = rows.map(v => `<div class="vet-card"><b>${esc(v.name)}</b><div class="type">${esc(v.type || '')}</div><div class="where">${esc(v.town || '')}</div>${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : ''}</div>`).join('') || '<p class="small muted">No entries.</p>';
      }
    } catch { /* directory refresh is optional */ }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.me) { toast('Sign in to log a triage session.', 'warn'); go('/login'); return; }
    const symptoms = [...form.querySelectorAll('[name=symptoms]:checked')].map(i => i.value);
    const note = form.symptomsText.value.trim();
    if (!symptoms.length && !note) { toast('Select at least one symptom or describe what you see.', 'warn'); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Checking approved guidance…';
    try {
      const data = await api('/vetbot/sessions', {
        method: 'POST',
        body: {
          species: form.species.value,
          symptoms,
          language: form.language.value,
          regionCode: form.regionCode.value || undefined,
          symptomsText: note || undefined
        }
      });
      result.innerHTML = vetResult(data);
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      apiToast(err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('check')} Get guidance`;
    }
  });
}

function vetResult(data) {
  if (!data.matched) {
    return `<div class="card vet-result">
      <div class="card-head"><div><span class="badge badge-grey">No exact match</span><h3 class="mt-1">${esc(data.title)}</h3></div></div>
      <p class="small">${esc(data.advice)}</p>
      <div class="notice">${icon('shield')} ${esc(data.disclaimer)}</div>
    </div>`;
  }
  return `<div class="card vet-result${data.notifiable ? ' notifiable' : ''}">
    <div class="card-head"><div>
      <span class="badge ${data.notifiable ? 'badge-red' : 'badge-green'}">${data.notifiable ? 'Suspected notifiable disease' : 'Matched, vet-approved'}</span>
      <h3 class="mt-1">${esc(data.title)}</h3>
      <p class="card-sub">Approved by ${esc(data.approvedBy || 'a registered vet')} · Session ${esc(data.sessionId)}</p>
    </div></div>
    <p class="small">${esc(data.advice)}</p>
    ${data.notifiable ? `<div class="escalation">
      <h3>${icon('alert')} ${esc(data.escalation.title)}</h3>
      <ol>${data.escalation.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      ${data.escalation.phone ? `<a class="btn btn-danger mt-2" href="tel:${esc(data.escalation.phone)}">Call ${esc(data.escalation.phone)}</a>` : ''}
    </div>` : ''}
    <div class="notice mt-2">${icon('shield')} ${esc(data.disclaimer)}</div>
    ${data.vets?.length ? `<div class="divider"></div><p class="tiny muted">Nearest contacts</p><div class="stack-sm">${data.vets.map(v => `<div class="row between small"><span>${esc(v.name)} · ${esc(v.town || '')}</span>${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : ''}</div>`).join('')}</div>` : ''}
  </div>`;
}

/* ================================================================== found livestock (public) */

export async function foundInfo() {
  const me = state.me;
  const canReport = me && ['finder', 'farmer', 'worker'].includes(me.role);
  return `<div class="hero" style="grid-template-columns:1.1fr .9fr">
    <div class="hero-copy">
      <div class="eyebrow">Livestock Brand &amp; Trade Tracker</div>
      <h1>Found animals? <em>Alert the owner</em> without exposing yourself.</h1>
      <p>Record a brand mark, an ear-tag number or a photo. KraaLink compares it with the verified brand and tag register and open missing-animal reports. If there is a match, the owner is alerted and a reviewer checks any claim before any handover.</p>
      <div class="hero-actions">
        ${canReport ? `<a class="btn btn-orange" href="#/report-found">Report found livestock ${icon('arrow')}</a>` : `<a class="btn btn-orange" href="${me ? '#/report-found' : '#/signup'}">Create an account to report ${icon('arrow')}</a>`}
        ${me?.role === 'farmer' ? `<a class="btn btn-ghost" style="color:#f6f2e5;border-color:rgba(255,255,255,.3)" href="#/found-reports">View matched reports</a>` : ''}
      </div>
      <div class="hero-trust">
        <div><b>Blind</b><span>No owner details to finder</span></div>
        <div><b>Documented</b><span>Claims need proof</span></div>
        <div><b>Neutral</b><span>Police or State Vet handover</span></div>
      </div>
    </div>
    <div class="hero-art">
      <div class="photo"><img src="/assets/demo/found-cattle.jpg" alt="Cattle with ear tags in a kraal"></div>
      <div class="hero-float">${icon('shield')}<div><b>Your identity stays hidden</b><span>The finder never sees the owner, and the owner never sees the finder.</span></div></div>
    </div>
  </div>

  <div class="section-head"><div><div class="eyebrow">A fair process</div><h2>What happens after a report</h2></div></div>
  <div class="steps">
    <div class="step"><b>You record the animal</b><span>Brand, tag numbers, species, quantity and a photo. A daily lookup limit prevents misuse.</span></div>
    <div class="step"><b>KraaLink matches blindly</b><span>Verified brands, live tags and open missing reports are checked. You receive a case reference only.</span></div>
    <div class="step"><b>The owner proves ownership</b><span>A brand certificate, registration card or tag record must be attached to a claim.</span></div>
    <div class="step"><b>A reviewer decides</b><span>Handover happens at a police station, State Veterinary office, or directly only with both parties' consent.</span></div>
  </div>

  <div class="grid cols-3 mt-3">
    <div class="card"><h3>${icon('doc')} No public photos</h3><p class="small muted mb-0">Found-animal photos and claim documents are private. They are shared through short-lived signed links with the people in the case.</p></div>
    <div class="card"><h3>${icon('shield')} No owner details</h3><p class="small muted mb-0">A match is a lead, not proof. The finder never receives a name, phone number or farm name.</p></div>
    <div class="card"><h3>${icon('alert')} No pressure</h3><p class="small muted mb-0">Never pay a reward under pressure. Report extortion to the police. The platform does not hold or transfer money.</p></div>
  </div>`;
}

/* ================================================================== QR check */

export async function check({ query }) {
  const code = (query.code || '').trim().toUpperCase();
  const me = state.me;
  const info = code ? await api('/worker-check/' + encodeURIComponent(code)).catch(() => null) : null;
  const canRequest = info?.found && info.canRequest;
  const statusNote = !code ? ''
    : !info ? ''
    : !info.found
      ? `<div class="notice warn mb-2">${icon('alert')} <span><b>No passport uses this code yet.</b> A field agent must register the worker in person first.</span></div>`
      : !info.canRequest
        ? `<div class="notice warn mb-2">${icon('alert')} <span><b>${esc(info.levelLabel)}.</b> This worker is not documented yet. A field agent must capture the face and ID before a hiring check.</span></div>`
        : `<div class="notice ok mb-2">${icon('check')} <span><b>${esc(info.levelLabel)}${info.verified ? ' · Verified badge' : ''}.</b> The worker must still approve every check.</span></div>`;

  return `<div style="max-width:640px;margin:0 auto;text-align:center">
    <div class="eyebrow" style="justify-content:center">WorkerLink Passport check</div>
    <h1>${code ? 'Worker code ' + esc(code) : 'Scan a worker card'}</h1>
    <p class="lead" style="margin:10px auto 26px">A short code is not a passport view. The worker must approve a hiring check before any personal details are shown.</p>
    <div class="card" style="text-align:left">
      <div class="row between">
        <div class="row">${icon('id')} <b class="mono" style="font-size:1.2rem;letter-spacing:.12em">${esc(code || '—')}</b></div>
        <span class="badge badge-green">Consent required</span>
      </div>
      <div class="divider"></div>
      ${statusNote}
      <ol class="small" style="padding-left:18px;color:var(--ink-soft);margin:0 0 16px">
        <li>A farmer enters the short code and states the purpose of the check.</li>
        <li>The worker receives a WhatsApp request and approves or denies it.</li>
        <li>If approved, the farmer sees only the agreed fields for 24 hours.</li>
        <li>Every view is recorded in the access log.</li>
      </ol>
      ${canRequest
        ? me?.role === 'farmer'
          ? `<a class="btn btn-primary btn-block" href="#/hiring${code ? '?code=' + encodeURIComponent(code) : ''}">${icon('shield')} Start a hiring check</a>`
          : me ? `<a class="btn btn-ghost btn-block" href="#/dashboard">Go to my dashboard</a>`
          : `<a class="btn btn-primary btn-block" href="#/login">Sign in as a farmer to check this code</a>`
        : `<a class="btn btn-ghost btn-block" href="mailto:atustokacc@gmail.com?subject=Field%20agent%20registration">${icon('users')} Ask KraaLink for a field agent</a>`}
    </div>
    <p class="tiny muted mt-2">KraaLink never reveals a worker's ID number, ID document, face photo or next-of-kin contacts in a hiring check.</p>
  </div>`;
}
