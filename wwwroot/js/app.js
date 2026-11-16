import {
  route, startRouter, loadMe, loadConfig, refreshUnread, renderShell, wireChrome, state, toast
} from './core.js';

import {
  home, login, signup, market, produce, marketDetail, priceBoard, vet, foundInfo, check,
  wireMarket, wireMarketDetail, wireVet
} from './pages/public.js';
import { passport, passportCard, consents, jobs, jobDetail, incidents, incidentDetail } from './pages/worker.js';
import {
  hiring, hiringDetail, listings, listingNew, brands, foundReports, transfers, herds, wireHerds
} from './pages/farmer.js';
import { reportFound, myReports, foundReportDetail } from './pages/finder.js';
import { registerWorker, workers, workerDetail } from './pages/agent.js';
import {
  adminOverview, verificationQueue, adminBrands, adminClaims, adminIncidents, adminListings,
  adminFound, tagConflicts, policeRequests, vetContent, outbox, adminUsers, settings, auditLog, accessLog
} from './pages/admin.js';
import { dashboard, notifications, profile } from './pages/account.js';

const ALL = ['worker', 'farmer', 'finder', 'agent', 'verifier', 'reviewer', 'admin'];
const REVIEW = ['reviewer', 'admin'];
const STAFF = ['agent', 'verifier', 'reviewer', 'admin'];

/* ------------------------------------------------------------------ public */

route('/', home, { title: 'Namibia’s livestock & farm-produce network' });
route('/login', login, { title: 'Sign in' });
route('/signup', signup, { title: 'Create account' });
route('/market', async ctx => ({ html: await market(ctx), after: wireMarket }), { title: 'Marketplace' });
route('/produce', async ctx => ({ html: await produce(ctx), after: wireMarket }), { title: 'Farm produce' });
route('/market/:id', async ctx => ({ html: await marketDetail(ctx), after: wireMarketDetail }), { title: 'Listing' });
route('/price-board', priceBoard, { title: 'Price board' });
route('/vet', async ctx => ({ html: await vet(ctx), after: wireVet }), { title: 'VetBot' });
route('/found', foundInfo, { title: 'Found livestock' });
route('/check', check, { title: 'Worker check' });

/* ------------------------------------------------------------------ account */

route('/dashboard', dashboard, { roles: ALL, title: 'Dashboard' });
route('/notifications', notifications, { roles: ALL, title: 'Notifications' });
route('/profile', profile, { roles: ALL, title: 'My profile' });

/* ------------------------------------------------------------------ shared case record */

route('/report-found', reportFound, { roles: ALL, title: 'Report found livestock' });
route('/my-reports', myReports, { roles: ALL, title: 'My found reports' });
route('/found-report/:caseRef', foundReportDetail, { roles: ALL, title: 'Found report' });

/* ------------------------------------------------------------------ worker */

route('/passport', passport, { roles: ['worker'], title: 'My passport' });
route('/passport/card', passportCard, { roles: ['worker'], title: 'Passport card' });
route('/consents', consents, { roles: ['worker'], title: 'Consent requests' });
route('/jobs', jobs, { roles: ['worker', 'farmer'], title: 'Jobs & check-outs' });
route('/jobs/:id', jobDetail, { roles: ['worker', 'farmer'], title: 'Employment record' });
route('/incidents', incidents, { roles: ['worker', 'farmer'], title: 'Incidents' });
route('/incidents/:id', incidentDetail, { roles: ['worker', 'farmer'], title: 'Incident' });

/* ------------------------------------------------------------------ farmer */

route('/hiring', hiring, { roles: ['farmer'], title: 'Hiring checks' });
route('/hiring/:id', hiringDetail, { roles: ['farmer'], title: 'Hiring check' });
route('/listings', listings, { roles: ['farmer'], title: 'My listings' });
route('/listings/new', listingNew, { roles: ['farmer'], title: 'List livestock' });
route('/brands', brands, { roles: ['farmer'], title: 'Brands & ear tags' });
route('/missing', brands, { roles: ['farmer'], title: 'Missing animals' });
route('/found-reports', foundReports, { roles: ['farmer'], title: 'Found & claims' });
route('/transfers', transfers, { roles: ['farmer'], title: 'Transfers' });
route('/herds', async () => ({ html: await herds(), after: wireHerds }), { roles: ['farmer'], title: 'Herds & vaccinations' });

/* ------------------------------------------------------------------ finder nav is shared above */

/* ------------------------------------------------------------------ agent and staff */

route('/register-worker', registerWorker, { roles: ['agent'], title: 'Register a worker' });
route('/workers', workers, { roles: STAFF, title: 'Worker register' });
route('/workers/:id', workerDetail, { roles: STAFF, title: 'Worker profile' });

/* ------------------------------------------------------------------ admin */

route('/admin', adminOverview, { roles: REVIEW, title: 'Operations overview' });
route('/admin/verification', verificationQueue, { roles: ['verifier', ...REVIEW], title: 'Verification queue' });
route('/admin/brands', adminBrands, { roles: REVIEW, title: 'Brand verification' });
route('/admin/claims', adminClaims, { roles: REVIEW, title: 'Ownership claims' });
route('/admin/incidents', adminIncidents, { roles: REVIEW, title: 'Incident review' });
route('/admin/listings', adminListings, { roles: REVIEW, title: 'Listing moderation' });
route('/admin/found', adminFound, { roles: REVIEW, title: 'Found reports' });
route('/admin/tags', tagConflicts, { roles: REVIEW, title: 'Tag conflicts' });
route('/admin/police', policeRequests, { roles: REVIEW, title: 'Police requests' });
route('/admin/vet', vetContent, { roles: REVIEW, title: 'Vet content' });
route('/admin/outbox', outbox, { roles: REVIEW, title: 'WhatsApp outbox' });
route('/admin/users', adminUsers, { roles: REVIEW, title: 'Accounts' });
route('/admin/settings', settings, { roles: ['admin'], title: 'Rules & settings' });
route('/admin/audit', auditLog, { roles: ['admin'], title: 'Audit log' });
route('/admin/access', accessLog, { roles: REVIEW, title: 'Access log' });

/* ------------------------------------------------------------------ boot */

async function boot() {
  wireChrome();
  try { await loadConfig(); } catch (err) { console.error('Config failed to load', err); }
  await loadMe();
  await refreshUnread();
  renderShell();
  if (!state.me && location.hash.includes('next=')) toast('Sign in to continue.', 'warn');
  startRouter();
}

boot();
