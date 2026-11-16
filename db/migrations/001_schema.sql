-- KraaLink schema (SQLite demo build of the PostgreSQL design in SRS section 9)
-- Every table, constraint, view and trigger below mirrors an integrity rule in SRS 9.6.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================== IDENTITY ==============================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('worker','farmer','agent','verifier','reviewer','admin','finder')),
  phone_e164    TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  language_code TEXT NOT NULL DEFAULT 'en' CHECK (language_code IN ('en','osh','af','her','pt')),
  face_path     TEXT,
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_users_role ON users(role);

CREATE TABLE IF NOT EXISTS workers (
  user_id                  TEXT PRIMARY KEY REFERENCES users(id),
  short_code               TEXT NOT NULL UNIQUE,
  full_name                TEXT NOT NULL,
  dob                      TEXT,
  id_doc_type              TEXT CHECK (id_doc_type IN ('namibian_id','angolan_passport','angolan_id','birth_certificate')),
  id_doc_number_encrypted  TEXT,
  id_doc_path              TEXT,
  face_path                TEXT,
  other_phone              TEXT,
  home_village             TEXT,
  constituency             TEXT,
  region_code              TEXT,
  verification_level       INTEGER NOT NULL DEFAULT 0 CHECK (verification_level BETWEEN 0 AND 2),
  consent_version          TEXT,
  consent_at               TEXT,
  skills_json              TEXT,
  languages_json           TEXT,
  last_seen_at             TEXT,
  created_at               TEXT NOT NULL,
  CHECK (verification_level < 1 OR (face_path IS NOT NULL AND id_doc_path IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_workers_code ON workers(short_code);
CREATE INDEX IF NOT EXISTS ix_workers_level ON workers(verification_level);

CREATE TABLE IF NOT EXISTS next_of_kin (
  id         TEXT PRIMARY KEY,
  worker_id  TEXT NOT NULL REFERENCES workers(user_id),
  name       TEXT NOT NULL,
  relationship TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  village    TEXT,
  listing_confirmed_by_agent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_kin_worker ON next_of_kin(worker_id);

CREATE TABLE IF NOT EXISTS worker_references (
  id         TEXT PRIMARY KEY,
  worker_id  TEXT NOT NULL REFERENCES workers(user_id),
  name       TEXT NOT NULL,
  ref_role   TEXT,
  phone_e164 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_refs_worker ON worker_references(worker_id);

CREATE TABLE IF NOT EXISTS farmers (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id),
  farm_name               TEXT,
  region_code             TEXT,
  dismissed_reports_count INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  staff_role TEXT NOT NULL,
  title      TEXT,
  created_at TEXT NOT NULL
);

-- ============================== PASSPORT ==============================

CREATE TABLE IF NOT EXISTS verification_events (
  id          TEXT PRIMARY KEY,
  worker_id   TEXT NOT NULL REFERENCES workers(user_id),
  level       INTEGER NOT NULL CHECK (level BETWEEN 0 AND 2),
  method      TEXT NOT NULL,
  agent_id    TEXT,
  verifier_id TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ver_worker ON verification_events(worker_id, created_at);

CREATE TABLE IF NOT EXISTS consents (
  id          TEXT PRIMARY KEY,
  worker_id   TEXT NOT NULL REFERENCES workers(user_id),
  farmer_id   TEXT NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','granted','denied','revoked','expired')),
  purpose     TEXT NOT NULL,
  window_hours INTEGER NOT NULL DEFAULT 24,
  requested_at TEXT NOT NULL,
  granted_at  TEXT,
  expires_at  TEXT,
  revoked_at  TEXT,
  denied_at   TEXT,
  CHECK (status <> 'granted' OR (granted_at IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_consents_worker ON consents(worker_id, status);
CREATE INDEX IF NOT EXISTS ix_consents_farmer ON consents(farmer_id, status);

CREATE TABLE IF NOT EXISTS access_log (
  id           TEXT PRIMARY KEY,
  viewer_id    TEXT,
  viewer_role  TEXT,
  worker_id    TEXT,
  consent_id   TEXT,
  purpose      TEXT NOT NULL,
  fields_viewed TEXT,
  client_ip    TEXT,
  request_id   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_access_worker ON access_log(worker_id, created_at);

CREATE TABLE IF NOT EXISTS employments (
  id              TEXT PRIMARY KEY,
  worker_id       TEXT NOT NULL REFERENCES workers(user_id),
  farmer_id       TEXT NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL CHECK (status IN ('pending_checkin','open','pending_checkout','closed','disputed')),
  job_title       TEXT,
  started_at      TEXT,
  ended_at        TEXT,
  end_reason      TEXT CHECK (end_reason IS NULL OR end_reason IN ('contract_ended','resigned','dismissed','other')),
  wages_paid      INTEGER,
  left_reported_at TEXT,
  no_checkout_at  TEXT,
  created_at      TEXT NOT NULL,
  CHECK (status <> 'closed' OR (ended_at IS NOT NULL AND end_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_emp_worker ON employments(worker_id, status);
CREATE INDEX IF NOT EXISTS ix_emp_farmer ON employments(farmer_id, status);
-- A worker cannot have two live employments with the same farmer
CREATE UNIQUE INDEX IF NOT EXISTS ux_emp_live ON employments(worker_id, farmer_id)
  WHERE status IN ('pending_checkin','open','pending_checkout','disputed');

CREATE TABLE IF NOT EXISTS employment_events (
  id            TEXT PRIMARY KEY,
  employment_id TEXT NOT NULL REFERENCES employments(id),
  type          TEXT NOT NULL,
  actor_id      TEXT,
  payload       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_emp_events ON employment_events(employment_id, created_at);

CREATE TABLE IF NOT EXISTS incidents (
  id                 TEXT PRIMARY KEY,
  employment_id      TEXT NOT NULL REFERENCES employments(id),
  reporter_id        TEXT NOT NULL,
  worker_id          TEXT NOT NULL REFERENCES workers(user_id),
  description        TEXT NOT NULL,
  occurred_on        TEXT,
  value_nad          REAL,
  evidence_paths     TEXT NOT NULL DEFAULT '[]',
  police_case_no     TEXT,
  status             TEXT NOT NULL CHECK (status IN ('under_review','worker_responded','verified_warning','suspended_police','dismissed','expired')),
  worker_notified_at TEXT,
  worker_response    TEXT,
  responded_at       TEXT,
  decision           TEXT,
  decided_by         TEXT,
  decided_at         TEXT,
  expires_at         TEXT,
  created_at         TEXT NOT NULL,
  CHECK (status <> 'suspended_police' OR police_case_no IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_inc_worker ON incidents(worker_id, status);

CREATE TABLE IF NOT EXISTS next_of_kin_requests (
  id            TEXT PRIMARY KEY,
  employment_id TEXT NOT NULL REFERENCES employments(id),
  farmer_id     TEXT NOT NULL,
  worker_id     TEXT NOT NULL,
  reason        TEXT NOT NULL,
  client_ip     TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS police_requests (
  id             TEXT PRIMARY KEY,
  requester_name TEXT NOT NULL,
  case_no        TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  justification  TEXT NOT NULL,
  approved_by    TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at     TEXT NOT NULL,
  decided_at     TEXT
);

-- ============================== MARKETPLACE ==============================

CREATE TABLE IF NOT EXISTS listings (
  id          TEXT PRIMARY KEY,
  farmer_id   TEXT NOT NULL REFERENCES users(id),
  species     TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  age_text    TEXT,
  sex         TEXT,
  price_nad   REAL NOT NULL,
  region_code TEXT,
  village     TEXT,
  photo_path  TEXT,
  brand_text  TEXT,
  tag_numbers TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','held','removed','sold')),
  hold_reason TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_listings_status ON listings(status, species, region_code);
CREATE INDEX IF NOT EXISTS ix_listings_farmer ON listings(farmer_id);

CREATE TABLE IF NOT EXISTS listing_reports (
  id          TEXT PRIMARY KEY,
  listing_id  TEXT NOT NULL REFERENCES listings(id),
  reporter_id TEXT NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared','removed')),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_reference (
  id         TEXT PRIMARY KEY,
  species    TEXT NOT NULL,
  price_type TEXT NOT NULL,
  value_nad  REAL NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'per head',
  source     TEXT NOT NULL,
  week_of    TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- ============================== VETBOT ==============================

CREATE TABLE IF NOT EXISTS vet_conditions (
  id              TEXT PRIMARY KEY,
  name_en         TEXT NOT NULL,
  translations    TEXT NOT NULL DEFAULT '{}',
  species         TEXT NOT NULL,
  symptoms        TEXT NOT NULL DEFAULT '[]',
  advice          TEXT NOT NULL,
  is_notifiable   INTEGER NOT NULL DEFAULT 0,
  review_status   TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved')),
  approved_by     TEXT,
  approved_at     TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  CHECK (review_status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS vet_sessions (
  id            TEXT PRIMARY KEY,
  farmer_id     TEXT,
  condition_id  TEXT,
  language_code TEXT NOT NULL DEFAULT 'en',
  symptoms_text TEXT,
  escalated     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS herds (
  id         TEXT PRIMARY KEY,
  farmer_id  TEXT NOT NULL,
  species    TEXT NOT NULL,
  head_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vaccination_schedules (
  id              TEXT PRIMARY KEY,
  herd_id         TEXT NOT NULL REFERENCES herds(id),
  vaccine         TEXT NOT NULL,
  last_done       TEXT,
  next_due        TEXT NOT NULL,
  reminder_sent_at TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vet_directory (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  vet_type    TEXT NOT NULL,
  region_code TEXT NOT NULL,
  phone_e164  TEXT NOT NULL,
  town        TEXT,
  created_at  TEXT NOT NULL
);

-- ============================== BRAND TRACKER ==============================

CREATE TABLE IF NOT EXISTS stock_brands (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL REFERENCES users(id),
  brand_mark_text      TEXT NOT NULL,
  brand_normalized     TEXT NOT NULL,
  brand_registration_no TEXT,
  brand_area           TEXT CHECK (brand_area IN ('commercial','communal')),
  region_code          TEXT,
  photo_path           TEXT,
  cert_path            TEXT,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_by          TEXT,
  verified_at          TEXT,
  created_at           TEXT NOT NULL,
  CHECK (status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_brands_norm ON stock_brands(brand_normalized, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_regno ON stock_brands(brand_registration_no)
  WHERE status <> 'rejected' AND brand_registration_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS livestock_tags (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id),
  brand_id       TEXT REFERENCES stock_brands(id),
  tag_number     TEXT NOT NULL,
  tag_normalized TEXT NOT NULL,
  species        TEXT,
  herd_name      TEXT,
  namlits_registered INTEGER NOT NULL DEFAULT 0,
  card_path      TEXT,
  status         TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','missing','stolen','conflict','retired')),
  created_at     TEXT NOT NULL
);
-- A live tag number belongs to only one owner
CREATE UNIQUE INDEX IF NOT EXISTS ux_tag_live ON livestock_tags(tag_normalized)
  WHERE status IN ('live','missing','stolen');
CREATE INDEX IF NOT EXISTS ix_tags_owner ON livestock_tags(owner_id);

CREATE TABLE IF NOT EXISTS missing_reports (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  brand_id      TEXT,
  tag_numbers   TEXT NOT NULL DEFAULT '[]',
  species       TEXT,
  qty           INTEGER,
  last_seen_place TEXT,
  last_seen_at  TEXT,
  police_case_no TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','closed')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS found_reports (
  id              TEXT PRIMARY KEY,
  case_ref        TEXT NOT NULL UNIQUE,
  finder_id       TEXT,
  photo_path      TEXT,
  brand_text      TEXT,
  tag_numbers     TEXT NOT NULL DEFAULT '[]',
  species         TEXT,
  qty             INTEGER,
  location_text   TEXT,
  lat             REAL,
  lng             REAL,
  matched_owner_id TEXT,
  matched_brand_id TEXT,
  matched_missing_id TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','match_found','claim_pending','claim_approved','handover_arranged','closed','expired','rejected')),
  expires_at      TEXT,
  created_at      TEXT NOT NULL,
  CHECK (brand_text IS NOT NULL OR photo_path IS NOT NULL OR tag_numbers <> '[]')
);
CREATE INDEX IF NOT EXISTS ix_found_status ON found_reports(status);

CREATE TABLE IF NOT EXISTS ownership_claims (
  id                TEXT PRIMARY KEY,
  found_report_id   TEXT NOT NULL REFERENCES found_reports(id),
  claimant_id       TEXT NOT NULL,
  statement         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by       TEXT,
  decision_reason   TEXT,
  decided_at        TEXT,
  handover_method   TEXT CHECK (handover_method IS NULL OR handover_method IN ('police_station','state_vet_office','direct_with_consent')),
  handover_at       TEXT,
  handover_place    TEXT,
  created_at        TEXT NOT NULL,
  CHECK (status <> 'approved' OR (reviewed_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_claim_approved ON ownership_claims(found_report_id) WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS ownership_documents (
  id            TEXT PRIMARY KEY,
  claim_id      TEXT REFERENCES ownership_claims(id),
  brand_id      TEXT,
  tag_id        TEXT,
  doc_type      TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected')),
  uploaded_by   TEXT,
  created_at    TEXT NOT NULL,
  CHECK (claim_id IS NOT NULL OR brand_id IS NOT NULL OR tag_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS brand_lookups (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  query_type      TEXT NOT NULL,
  query_value     TEXT,
  matched         INTEGER NOT NULL DEFAULT 0,
  found_report_id TEXT,
  client_ip       TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lookup_user ON brand_lookups(user_id, created_at);

CREATE TABLE IF NOT EXISTS livestock_transfers (
  id               TEXT PRIMARY KEY,
  seller_id        TEXT NOT NULL,
  buyer_id         TEXT NOT NULL,
  listing_id       TEXT,
  movement_permit_no TEXT,
  status           TEXT NOT NULL DEFAULT 'pending_buyer' CHECK (status IN ('pending_buyer','pending_seller','confirmed','cancelled')),
  seller_confirmed_at TEXT,
  buyer_confirmed_at  TEXT,
  created_at       TEXT NOT NULL,
  CHECK (status <> 'confirmed' OR (seller_confirmed_at IS NOT NULL AND buyer_confirmed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS livestock_transfer_items (
  id          TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES livestock_transfers(id),
  tag_id      TEXT NOT NULL,
  species     TEXT,
  qty         INTEGER NOT NULL DEFAULT 1
);

-- ============================== SYSTEM ==============================

CREATE TABLE IF NOT EXISTS audit_log (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL,
  actor_id       TEXT,
  actor_role     TEXT,
  action         TEXT NOT NULL,
  object_type    TEXT NOT NULL,
  table_name     TEXT,
  record_id      TEXT,
  old_data       TEXT,
  new_data       TEXT,
  changed_fields TEXT,
  details        TEXT,
  request_id     TEXT,
  client_ip      TEXT,
  source         TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_log(actor_id, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_record ON audit_log(table_name, record_id);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description   TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms','system')),
  direction     TEXT NOT NULL DEFAULT 'out',
  language_code TEXT NOT NULL DEFAULT 'en',
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  meta_json     TEXT,
  read_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS otps (
  id          TEXT PRIMARY KEY,
  phone_e164  TEXT NOT NULL,
  code        TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_otp_phone ON otps(phone_e164, created_at);

-- ============================== VIEWS ==============================

-- Finder-facing view: deliberately omits matched_owner_id (SRS 9.5, AT-12)
CREATE VIEW IF NOT EXISTS v_found_report_finder_view AS
SELECT id, case_ref, species, qty, location_text, status, expires_at, created_at
FROM found_reports;

CREATE VIEW IF NOT EXISTS v_brand_lookup_daily AS
SELECT user_id, substr(created_at,1,10) AS day, COUNT(*) AS lookups, SUM(1 - matched) AS misses
FROM brand_lookups GROUP BY user_id, substr(created_at,1,10);

CREATE VIEW IF NOT EXISTS v_listing_price_median AS
SELECT species, region_code, COUNT(*) AS listings, AVG(price_nad) AS avg_nad
FROM listings WHERE status = 'active' GROUP BY species, region_code;

-- ============================== IMMUTABILITY TRIGGERS ==============================
-- SRS 9.6 and AT-03/AT-04: append-only logs and no hard deletes.

CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_access_no_update BEFORE UPDATE ON access_log
BEGIN SELECT RAISE(ABORT, 'access_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_access_no_delete BEFORE DELETE ON access_log
BEGIN SELECT RAISE(ABORT, 'access_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_emp_events_no_update BEFORE UPDATE ON employment_events
BEGIN SELECT RAISE(ABORT, 'employment_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_emp_events_no_delete BEFORE DELETE ON employment_events
BEGIN SELECT RAISE(ABORT, 'employment_events is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_ver_events_no_update BEFORE UPDATE ON verification_events
BEGIN SELECT RAISE(ABORT, 'verification_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_ver_events_no_delete BEFORE DELETE ON verification_events
BEGIN SELECT RAISE(ABORT, 'verification_events is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_lookups_no_update BEFORE UPDATE ON brand_lookups
BEGIN SELECT RAISE(ABORT, 'brand_lookups is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_lookups_no_delete BEFORE DELETE ON brand_lookups
BEGIN SELECT RAISE(ABORT, 'brand_lookups is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_emp_no_delete BEFORE DELETE ON employments
BEGIN SELECT RAISE(ABORT, 'employments are never hard-deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_inc_no_delete BEFORE DELETE ON incidents
BEGIN SELECT RAISE(ABORT, 'incidents are never hard-deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_consent_no_delete BEFORE DELETE ON consents
BEGIN SELECT RAISE(ABORT, 'consents are never hard-deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_found_no_delete BEFORE DELETE ON found_reports
BEGIN SELECT RAISE(ABORT, 'found_reports are never hard-deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_claims_no_delete BEFORE DELETE ON ownership_claims
BEGIN SELECT RAISE(ABORT, 'ownership_claims are never hard-deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_docs_no_delete BEFORE DELETE ON ownership_documents
BEGIN SELECT RAISE(ABORT, 'ownership_documents are never hard-deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_tags_no_delete BEFORE DELETE ON livestock_tags
BEGIN SELECT RAISE(ABORT, 'livestock_tags are never hard-deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_brands_no_delete BEFORE DELETE ON stock_brands
BEGIN SELECT RAISE(ABORT, 'stock_brands are never hard-deleted'); END;
CREATE TRIGGER IF NOT EXISTS trg_transfers_no_delete BEFORE DELETE ON livestock_transfers
BEGIN SELECT RAISE(ABORT, 'livestock_transfers are never hard-deleted'); END;
