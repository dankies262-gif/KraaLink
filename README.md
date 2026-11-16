# KraaLink

A working reference implementation of the **KraaLink SRS v1.1** — a WhatsApp-first Namibian
AgriTech platform with four modules:

| Module | What it does |
| --- | --- |
| **WorkerLink Passport** | L0/L1/L2 verified worker identity, worker-owned short code + QR card, consent-gated hiring checks, check-in/check-out, neutral employment records, incidents and next-of-kin release. |
| **Kraal Marketplace-lite** | Nationwide livestock **and farm-produce** listings (eggs, vegetables, maize, milk, biltong, honey, feed) with photo upload, WhatsApp contact, live livestock price board, suspicious-listing reports, automatic holds for missing/stolen/duplicate tags. |
| **VetBot-lite** | Vet-approved symptom triage, notifiable-disease escalation, vaccination reminders, State Vet directory. |
| **Brand & Trade Tracker** | Verified brand/ear-tag register, blind owner matching for found animals, document-backed claims, reviewer decisions, handover via police or State Vet, transfers. |

One ASP.NET Core app serves both the JSON API and the single-page front end (vanilla ES modules).

---

## Run it

Prerequisites: **.NET 10 SDK**.

```bash
cd KraaLink
dotnet run
```

Open <http://localhost:5181> (the port comes from `Properties/launchSettings.json`).

Demo mode is **on** by default:

- OTP codes are shown on screen and auto-filled.
- One-tap demo sign-in is available on the home and login pages.
- Seeded users, herds, listings, found reports and incidents are created on first start.

### Reset the demo database

Stop the app, then delete the database and uploaded demo files:

```bash
rm -rf App_Data/kraalink.db* storage/*
```

Migrations and seed data run again on the next start.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `KRAALINK_DATA` | `./App_Data` | Directory for the SQLite database. |
| `KRAALINK_DB` | `<data>/kraalink.db` | Full database path. |
| `KRAALINK_STORAGE` | `./storage` | Private file store (faces, ID docs, evidence, claims). |
| `KRAALINK_JWT_KEY` | documented demo key | HS256 signing key for sessions and signed file URLs. **Change in production.** |
| `KRAALINK_ENC_KEY` | documented demo key | Key material for AES-GCM field encryption of ID numbers. **Change in production.** |
| `KRAALINK_DEMO` | `true` | Set to `false` to disable demo sign-in and stop returning OTP codes in API responses. |

The app supports `dotnet run` (Development) and `dotnet KraaLink.dll --urls http://localhost:5181`
when you only have the build output.

---

## Demo accounts

Sign in with the phone number, or tap the account on the login page. OTP `demoCode` is returned
by the API and filled in automatically.

| Name | Role | Phone | Notes |
| --- | --- | --- | --- |
| Maria Ndapewa | Worker | +264 81 100 0001 | L2, short code **K7M2QP**, active employment + incident |
| Petrus Shikongo | Worker | +264 81 100 0003 | L2, short code **P4XW9T** |
| Anna Amukoto | Worker | +264 81 100 0004 | L0, no face/ID on file (verification queue) |
| Johannes Amutenya | Farmer | +264 81 100 0002 | Listings, brands, tags, herds, a matched found report |
| Tomas Nghifikwa | Community finder | +264 81 100 0006 | Found reports only; never sees owner details |
| Ndahafa Nghipandulwa | Field agent | +264 81 100 0007 | Worker registration with face + ID capture |
| Selma Kativa | Reviewer | +264 81 100 0008 | Queues, claims, incidents, police requests, outbox |
| KraaLink Admin | Administrator | +264 81 100 0009 | Settings, audit log, police approvals |

Nationwide demo sellers (all passwordless, OTP auto-filled): **+264 81 100 0021 – +264 81 100 0030**.
They cover Kavango East, Zambezi, Erongo, Khomas, //Karas, Kunene, Omaheke, Otjozondjupa, Hardap and
Ohangwena with livestock and produce such as eggs, maize, tomatoes, milk, watermelon, biltong,
honey, lucerne and soap.

New sign-ups also work: a fresh phone number goes through OTP, then the details wizard.

### Dynamic roles at sign-up

The sign-up wizard reads `GET /api/config → signupRoles` and shows every open role as a card
(Farm worker, Farmer / livestock owner, Farm produce seller, Buyer / trader, Community member,
Transporter, Veterinary professional). The user picks a card and can type their own job title
(e.g. "Poultry farmer", "Goat trader"). The free-text title is stored as `roleTitle` and becomes the
displayed role, while the chosen card maps to the permission base role (`worker`, `farmer` or
`finder`). Staff roles are listed as invite-only and cannot be self-selected.

---

## Face capture at sign-up

The flow the SRS calls for is implemented end-to-end:

1. **Role → phone** — OTP is requested and verified (simulated WhatsApp in demo mode).
2. **Details** — workers must capture a **face photo** and an **ID document photo**.
3. **Submit** — images are uploaded as data URLs, stored privately, and the worker receives an
   L1 passport with a unique short code.

The capture dialog (`openCamera` in `wwwroot/js/core.js`):

- uses `getUserMedia` with a live preview, oval guide and mirroring for the front camera;
- falls back to **Upload instead** when no camera is available (headless devices, denied permission);
- lets the user retake or discard before accepting — a cancelled dialog returns no photo;
- downsizes to max 1280 px and encodes JPEG at 0.87 before upload.

Staff can also retake their own face photo from **My profile** (`PATCH /api/me/face`); the previous
file is retained and the change is written to the audit log.

> **Privacy invariant:** the face photo is stored for human identification only. There is **no face
> matching, no biometric template and no automated comparison** anywhere in the codebase. The UI
> states this on every capture dialog and on the passport.

---

## Design and branding

The front end follows the supplied AgroPro template: local **Poppins** webfonts, a **green
`#2e7d32` and orange `#ef7d1a`** palette, charcoal `#323232` text, uppercase section titles, 5 px
radii, soft large shadows and a 12 px orange strip above the header. The theme is self-contained in
`wwwroot/css/app.css`; no CDN
or webfont fetch is required, so it works offline.

- **Header** — the supplied KraaLink logo (`wwwroot/assets/brand/kraalink-logo.png`), uppercase
  public navigation and a role-aware account menu.
- **Sidebar** — collapsible sections with state remembered in `localStorage`, active-link
  highlighting and auto-scroll, an off-canvas backdrop and close button on mobile, Escape support
  and background scroll lock while open.
- **Home carousel** — the five supplied farm photos (`kraal-cattle`, `herd-farmer`, `cow-close`,
  `farmer-sunset`, `sunset-fence`) slide **left** every six seconds, with arrows, dots, touch swipe
  and pause-on-hover.
- **Footer** — four-column dark footer with the KraaLink logo and contacts
  `atustokacc@gmail.com`, CEO & Founder **Hiskiel Awene** (`Jhiskiel@gmail.com`) and Technical
  Director **Reinhold Shilongo** (`reinholdshilongo44@gmail.com`), plus a green copyright bar:
  “Designed by **Reinhold IT Solutions**” followed by the Reinhold IT Solutions logo.

The supplied logos are used only as branding, never as photographic backgrounds.

### Selling farm produce

Any farmer account can publish either livestock or produce:

1. **My listings → New produce** (or *Farm produce → Sell your produce*).
2. Choose a category (eggs & poultry, fresh vegetables, fruit, grains & maize, dairy, meat &
   biltong, honey, livestock feed, other), the unit you sell in (each, dozen, kg, crate, bag 50 kg,
   litre, bunch, box, head), quantity and price.
3. **Take photo** with the phone camera or **Upload photo** from the gallery — the image is
   resized to max 1280 px JPEG before upload and stored privately.
4. Choose any of the 14 regions, add a village and publish.

Produce listings appear under **#/produce** with category filters and are excluded from the
livestock price board. Livestock listings keep the tag-conflict hold and reviewer moderation.

---

## What to try

**Worker (Maria)** — Dashboard → *My passport* (face, QR, printable card) → *Consent requests*
approve/deny → *Jobs & check-outs* (check-out is two-sided) → *Incidents* (right to respond).
**My profile → Retake face photo** exercises the live capture again.

**Farmer (Johannes)** — *Hiring checks*: enter `K7M2QP`. The code is looked up live and the farmer
sees only the verification level and whether a check can be requested — never a name or photo.
The worker approves on their side, then the farmer sees only photo, name, village, level and last
three employers. If the worker has no smartphone, tick *The worker has no smartphone* and send an
approval code to the worker's phone; the worker reads it back and the check is granted without the
worker needing an app. *Brands & ear tags*, *Missing animals*, *Found & claims*,
*Herds & vaccinations* (reminders), *Transfers*.

**Finder (Tomas)** — *Report a found animal* with a brand or tag. A matching owner is alerted
**without the finder learning who they are**; the finder gets only a case reference and status.

**Agent (Ndahafa)** — *Register a worker*: face + ID are mandatory, two next-of-kin contacts and a
reference are captured, the worker gives consent in person, and the passport starts at L1. The
worker's phone is confirmed with a one-time code sent by the agent and read back by the worker;
the registration cannot be submitted without it. Date of birth (16+) and constituency/commune are
required, and the consent can be read aloud in the worker's language.

**Reviewer (Selma)** — *Operations overview*, verification queue (private face/ID links), brand
verification, ownership claims, incidents, marketplace holds, found reports, tag conflicts, police
requests, VetBot content approval, WhatsApp outbox, users, access log.

**Admin** — everything above plus *Rules & settings*, the append-only *Audit log* and role changes
on *People* (change a user's role; a worker role requires an existing passport; the last
administrator cannot be demoted; every change is audited and notified).

Public pages: livestock marketplace, farm produce (`#/produce`), listing detail, price board,
VetBot, found-livestock guidance, and `#/check?code=K7M2QP` (a short code never reveals passport
data).

---

## Privacy and security design

| Requirement | Implementation |
| --- | --- |
| Face photo only, no biometrics | Images stored as private files; no matching code path exists. |
| ID numbers encrypted | AES-GCM with a versioned `v1:` envelope (`Core/Storage.cs` → `Crypto`); only masked values are rendered. |
| Photos/documents private | All files served through `GET /api/files/{id}` with short-lived HMAC-signed URLs; no public storage path. |
| Consent gates passport views | A hiring check returns nothing until the worker approves; approval expires after `consent_window_hours`; revocation is immediate. |
| Every sensitive view logged | `access_log` rows for staff passport views, uploaded-document views, police approvals. |
| Append-only trails | SQLite triggers block UPDATE/DELETE on audit, access, employment and verification logs; no hard deletes for domain records. |
| Blind matching | `Matching.FindOwner` resolves the owner server-side. The finder response contains a case reference only; owner identity is never serialized to the finder. |
| Next of kin only when justified | Release requires the worker to be unreachable for `kin_unreachable_hours` during an open job, and each release is logged. |
| Neutral language | Missing check-out renders as **“No check-out recorded”**, never “absconded” or “disappeared”. |
| Notifiable disease | VetBot escalates with *isolate, do not move/sell/slaughter, contact the State Vet* instead of offering a home remedy. |
| No secrets in source | Demo keys are documented defaults and are overridden by `KRAALINK_JWT_KEY` / `KRAALINK_ENC_KEY`. |

A background `LifecycleService` expires consents, records no-check-out events, closes stale
incidents/reports and sends reminders.

---

## Project layout

```
KraaLink/
  Program.cs              app startup, migrations, seed, error envelope
  Api/                    minimal-API endpoints per module
  Core/                   Db, Auth, Storage/Crypto, Audit, Matching, Passport,
                          Lifecycle, Geo, Notify
  Data/Seed.cs            demo users and scenario data
  db/migrations/          schema + file metadata (SQLite)
  wwwroot/
    index.html            shell, header/sidebar/footer, icon sprite
    css/app.css           AgroPro theme (Poppins, green/orange tokens)
    fonts/                local Poppins TTF files
    assets/brand/         KraaLink and Reinhold IT Solutions logos
    assets/img/           supplied carousel and background photos
    js/core.js            router, API client, camera, modals, formatting
    js/pages/             public, worker, farmer, finder, agent, account, admin
    js/app.js             route table and boot
  App_Data/               SQLite database (created at runtime)
  storage/                private uploads (created at runtime)
```

### API surface (selected)

```
POST /api/auth/otp/request | /api/auth/otp/verify | /api/auth/signup
GET  /api/auth/demo-accounts        POST /api/auth/demo
GET  /api/me  PATCH /api/me  PATCH /api/me/face  GET /api/dashboard
GET  /api/workers  POST /api/workers  POST /api/workers/otp  GET /api/workers/{id}
POST /api/workers/{id}/verifications  GET /api/workers/{id}/qrcard | /card
GET  /api/worker-check/{shortCode}  (status only — no personal data)
POST /api/hiring-checks  POST /api/hiring-checks/otp  GET /api/hiring-checks/mine
GET  /api/hiring-checks/{id}/passport
GET  /api/consents/mine  POST /api/consents/{id}/respond | /revoke
POST /api/employments  GET /api/employments/mine  POST /api/employments/{id}/checkout…
GET  /api/listings?kind=livestock|produce  POST /api/listings  GET /api/price-board
POST /api/listings/{id}/reports
GET  /api/vetbot/conditions  POST /api/vetbot/sessions  GET /api/vet-directory
GET  /api/brands/mine  GET /api/tags/mine  POST /api/found-reports
GET  /api/found-reports/{caseRef}  POST /api/found-reports/{caseRef}/claims
GET  /api/admin/overview  /queues/verification  /queues/incidents  /claims  /brands
     /listings  /found-reports  /tag-conflicts  /police-requests  /outbox  /users
     /settings (admin)  /audit-log (admin)  /access-log
POST /api/admin/users/{id}/role  (admin only)
```

Errors use a consistent `{ title, status, detail, traceId }` envelope.

---

## Verified end-to-end

Tested in a browser against a running instance:

- worker sign-up with live face capture (camera fallback → upload) and ID capture → L1 passport + short code;
- face photo replacement from the profile (new signed URL, audit entry);
- hiring check request → worker approval → farmer sees only consented fields, with expiry;
- found report with photo and brand/tag → blind match found, owner alerted, finder sees no owner data;
- agent registration with mandatory face + ID, two kin, one reference, date of birth and
  constituency, guarded by a worker-confirmed one-time code → L1 worker created;
- worker short-code lookup shows only passport status, never personal data, and explains when a
  field agent must register the worker first;
- hiring check by smartphone approval, plus the no-smartphone fallback where the worker reads an
  approval code to the farmer; pending and revoked checks return no passport data;
- admin role changes (worker / farmer / finder / agent / verifier / reviewer / admin) with the
  last-admin and existing-passport safeguards;
- farmer listings/brands/herds/found-reports, marketplace + listing detail, price board;
- VetBot notifiable-disease escalation (staff access fixed during testing);
- reviewer verification queue with private face/ID links, claims, police requests;
- admin settings and the append-only audit log;
- AgroPro redesign on Poppins with the supplied logos, five-photo home carousel auto-sliding left,
  footer contacts and Reinhold IT Solutions copyright block;
- desktop sidebar collapse/persistence and mobile off-canvas behaviour;
- dynamic role cards plus custom role title at sign-up;
- nationwide produce market (`#/produce`) with category filter, and produce listing creation via
  camera or photo upload, confirmed in the UI and through `POST /api/listings`.

Two backend defects found and fixed during this pass:
`verification_events` inserts in agent registration were missing the `agent_id` value, and
`POST /api/vetbot/sessions` rejected reviewer/admin roles.

---

## Deploy on Render

Vercel cannot host this app: it is ASP.NET Core on .NET 10 with SQLite, private file storage and a
background service, none of which run on Vercel Functions. Use a Docker host instead. This repo
ships a `Dockerfile` and `render.yaml`.

1. Push the repository to GitHub (see below).
2. In Render, choose **New → Blueprint**, select the repository, and apply `render.yaml`.
3. Render builds the Dockerfile and serves the app on an HTTPS URL. `KRAALINK_JWT_KEY` and
   `KRAALINK_ENC_KEY` are generated per service, and demo mode is on.

Free plan instances use an ephemeral filesystem, so the SQLite database and uploaded photos reset
on every deploy or restart. For persistent data, switch the service to the Starter plan and mount
a disk as described in the comments in `render.yaml`. The Free plan also sleeps after inactivity,
so the first request after a quiet period takes several seconds.

Set `KRAALINK_DEMO=false` before using real worker data: demo mode exposes the one-tap demo
accounts and returns OTP codes in API responses.

Push to GitHub:

```
git remote add origin https://github.com/<your-account>/KraaLink.git
git branch -M main
git push -u origin main
```

---

## Production notes

This is a reference implementation, not a hardened deployment. Before going live:

- Move to PostgreSQL (the schema is portable; `Db` isolates SQLite specifics).
- Connect a WhatsApp Business API sender for OTP and notifications instead of the outbox simulator.
- Store files in object storage with server-side encryption and keep the signed-URL TTL short.
- Supply strong `KRAALINK_JWT_KEY` and `KRAALINK_ENC_KEY` values from a secret manager.
- Put the API behind TLS, add rate limiting at the edge, and schedule database backups.
- Add an independent security review of the consent, access-log and next-of-kin paths.
