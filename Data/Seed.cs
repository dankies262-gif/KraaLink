using System.Security;
using System.Text;

namespace KraaLink;

public static class Seed
{
    private static string Ago(int days, int hours = 0) =>
        DateTime.UtcNow.AddDays(-days).AddHours(-hours).ToString(Ts.Format, System.Globalization.CultureInfo.InvariantCulture);

    private static string In(int days) => Ts.DaysFromNow(days);

    public static void Ensure(Db db, string contentRoot)
    {
        if (db.Long("SELECT COUNT(*) FROM users") > 0)
        {
            // Databases created before the nationwide marketplace existed still
            // receive the countrywide demo sellers and produce listings.
            Nationwide(db);
            return;
        }

        db.Begin();
        try
        {
            Settings(db);
            Users(db);
            var files = DemoFiles(db, contentRoot);
            PassportData(db, files);
            Marketplace(db, files);
            VetBot(db);
            BrandTracker(db, files);
            SystemData(db, files);
            db.Commit();
        }
        catch
        {
            db.Dispose();
            throw;
        }
        Nationwide(db);
    }

    /// <summary>
    /// Idempotent demo sellers across all 14 regions, including the
    /// farm-produce side of the marketplace (eggs, maize, milk, and more).
    /// </summary>
    private static void Nationwide(Db db)
    {
        var sellers = new (string Id, string Name, string Phone, string Farm, string Region, string Title)[]
        {
            ("usr_kavango", "Kavango Fresh Produce", "+264811000021", "Rundu Green Belt", "KE", "Farm produce seller"),
            ("usr_zambezi", "Zambezi Gardens", "+264811000022", "Katima Mulilo Gardens", "ZE", "Farm produce seller"),
            ("usr_erongo", "Erongo Dairy", "+264811000023", "Omaruru Dairy", "ER", "Dairy farmer"),
            ("usr_khomas", "Khomas Feedlot", "+264811000024", "Windhoek Feedlot", "KH", "Livestock owner"),
            ("usr_karas", "Karas Goat Farm", "+264811000025", "Keetmanshoop Small Stock", "KA", "Farmer / livestock owner"),
            ("usr_kunene", "Kunene Herders", "+264811000026", "Opuwo Herders", "KU", "Farmer / livestock owner"),
            ("usr_omaheke", "Omaheke Cattle", "+264811000027", "Gobabis Cattle Post", "OK", "Farmer / livestock owner"),
            ("usr_otjozondjupa", "Otjiwarongo Mixed Farm", "+264811000028", "Otjiwarongo Mixed Farm", "OD", "Mixed farmer"),
            ("usr_hardap", "Hardap Irrigation", "+264811000029", "Mariental Irrigation Scheme", "HA", "Farm produce seller"),
            ("usr_ohangwena", "Ohangwena Poultry", "+264811000030", "Eenhana Poultry", "OH", "Farm produce seller")
        };

        foreach (var s in sellers)
        {
            if (db.Exists("SELECT 1 FROM users WHERE id = @id", new { id = s.Id })) continue;
            db.Exec(@"INSERT INTO users (id, role, role_title, phone_e164, full_name, language_code, last_seen_at, created_at)
                      VALUES (@id,'farmer',@title,@phone,@name,'en',@seen,@created)",
                new { id = s.Id, title = s.Title, phone = s.Phone, name = s.Name, seen = Ago(0, 3), created = Ago(120) });
            db.Exec(@"INSERT INTO farmers (user_id, farm_name, region_code, dismissed_reports_count, created_at)
                      VALUES (@id,@farm,@region,0,@created)",
                new { id = s.Id, farm = s.Farm, region = s.Region, created = Ago(120) });
        }

        var photo = db.Str("SELECT photo_path FROM listings WHERE photo_path IS NOT NULL LIMIT 1");

        var livestock = new (string Id, string Farmer, string Species, int Qty, string Age, string Sex, double Price, string Region, string Village)[]
        {
            ("lst_ke1", "usr_kavango", "Cattle", 18, "2 years", "Mixed", 9200, "KE", "Rundu"),
            ("lst_ze1", "usr_zambezi", "Goats", 40, "1–2 years", "Mixed", 1600, "ZE", "Katima Mulilo"),
            ("lst_ka1", "usr_karas", "Sheep", 30, "8 months", "Mixed", 2200, "KA", "Keetmanshoop"),
            ("lst_ku1", "usr_kunene", "Cattle", 15, "3 years", "Cows", 8700, "KU", "Opuwo"),
            ("lst_od1", "usr_otjozondjupa", "Cattle", 22, "2–3 years", "Mixed", 9900, "OD", "Otjiwarongo"),
            ("lst_ok1", "usr_omaheke", "Cattle", 9, "3 years", "Bulls", 10400, "OK", "Gobabis"),
            ("lst_kh1", "usr_khomas", "Pigs", 12, "5 months", "Mixed", 2600, "KH", "Windhoek"),
            ("lst_er1", "usr_erongo", "Cattle", 7, "2 years", "Cows", 9600, "ER", "Omaruru")
        };

        foreach (var l in livestock)
        {
            if (db.Exists("SELECT 1 FROM listings WHERE id = @id", new { id = l.Id })) continue;
            db.Exec(@"INSERT INTO listings (id, farmer_id, species, qty, age_text, sex, price_nad, region_code,
                        village, photo_path, tag_numbers, status, created_at, listing_kind)
                      VALUES (@id,@f,@s,@q,@age,@sex,@p,@region,@village,@photo,'[]','active',@created,'livestock')",
                new
                {
                    id = l.Id, f = l.Farmer, s = l.Species, q = l.Qty, age = l.Age, sex = l.Sex,
                    p = l.Price, region = l.Region, village = l.Village, photo, created = Ago(2)
                });
        }

        var produce = new (string Id, string Farmer, string Product, string Category, int Qty, string Unit, double Price, string Region, string Village)[]
        {
            ("lst_p1", "usr_kavango", "Free-range eggs", "Eggs & poultry", 30, "crate", 65, "KE", "Rundu"),
            ("lst_p2", "usr_omaheke", "White maize", "Grains & maize", 120, "bag (50 kg)", 380, "OK", "Gobabis"),
            ("lst_p3", "usr_hardap", "Tomatoes", "Fresh vegetables", 40, "crate", 220, "HA", "Mariental"),
            ("lst_p4", "usr_erongo", "Fresh milk", "Dairy & milk", 80, "litre", 22, "ER", "Omaruru"),
            ("lst_p5", "usr_karas", "Watermelons", "Fruit", 25, "each", 45, "KA", "Keetmanshoop"),
            ("lst_p6", "usr_omaheke", "Beef biltong", "Meat & biltong", 15, "kg", 420, "OK", "Gobabis"),
            ("lst_p7", "usr_kunene", "Makalani honey", "Honey & preserves", 20, "each", 180, "KU", "Opuwo"),
            ("lst_p8", "usr_otjozondjupa", "Lucerne bales", "Livestock feed", 60, "each", 110, "OD", "Otjiwarongo"),
            ("lst_p9", "usr_zambezi", "Goat milk soap", "Other farm produce", 50, "each", 60, "ZE", "Katima Mulilo"),
            ("lst_p10", "usr_ohangwena", "Broiler chickens", "Eggs & poultry", 45, "each", 95, "OH", "Eenhana")
        };

        foreach (var p in produce)
        {
            if (db.Exists("SELECT 1 FROM listings WHERE id = @id", new { id = p.Id })) continue;
            db.Exec(@"INSERT INTO listings (id, farmer_id, species, qty, price_nad, region_code, village,
                        status, created_at, listing_kind, category, unit)
                      VALUES (@id,@f,@s,@q,@p,@region,@village,'active',@created,'produce',@category,@unit)",
                new
                {
                    id = p.Id, f = p.Farmer, s = p.Product, q = p.Qty, p = p.Price,
                    region = p.Region, village = p.Village, created = Ago(1), category = p.Category, unit = p.Unit
                });
        }
    }

    private static void Settings(Db db)
    {
        var settings = new (string Key, string Value, string Description)[]
        {
            ("consent_window_hours", "24", "Validity of an approved hiring-check consent"),
            ("incident_worker_response_days", "7", "Days the worker has to respond"),
            ("incident_decision_days", "7", "Days reviewers have to decide"),
            ("incident_auto_remove_days", "30", "Under-review incident removed if no reviewer action"),
            ("warning_expiry_months", "24", "Verified With Warning expiry"),
            ("police_case_review_days", "30", "Review interval for police-case status"),
            ("no_checkout_days", "7", "Days before 'No check-out recorded' applies"),
            ("kin_unreachable_hours", "48", "Unreachable time before next-of-kin contact may be requested"),
            ("repeat_dismissed_threshold", "3", "Dismissed reports before a farmer is flagged"),
            ("employment_retention_years", "5", "Employment facts kept after last employment"),
            ("l0_inactivity_months", "12", "L0 profiles deleted after this inactivity"),
            ("signed_url_ttl_minutes", "5", "Lifetime of signed URLs"),
            ("found_report_owner_response_days", "7", "Days an alerted owner has to respond"),
            ("found_report_no_match_days", "30", "Days an unmatched found report stays open"),
            ("claim_review_days", "5", "Days reviewers have to decide an ownership claim"),
            ("brand_lookup_daily_limit", "20", "Lookups per user per 24 hours before review")
        };
        foreach (var (key, value, description) in settings)
        {
            db.Exec("INSERT OR REPLACE INTO app_settings (setting_key, setting_value, description) VALUES (@k,@v,@d)",
                new { k = key, v = value, d = description });
        }
    }

    private static void Users(Db db)
    {
        var people = new (string Id, string Role, string Phone, string Name, string Lang, int CreatedDays)[]
        {
            ("usr_admin", "admin", "+264811000009", "KraaLink Admin", "en", 420),
            ("usr_reviewer", "reviewer", "+264811000008", "Selma Kativa", "en", 400),
            ("usr_agent", "agent", "+264811000007", "Ndahafa Nghipandulwa", "osh", 390),
            ("usr_verifier", "verifier", "+264811000010", "Headman Johannes Haufiku", "osh", 380),
            ("usr_maria", "worker", "+264811000001", "Maria Ndapewa", "osh", 360),
            ("usr_petrus", "worker", "+264811000003", "Petrus Shikongo", "osh", 300),
            ("usr_anna", "worker", "+264811000004", "Anna Amukoto", "af", 120),
            ("usr_johannes", "farmer", "+264811000002", "Johannes Amutenya", "en", 410),
            ("usr_kambwa", "farmer", "+264811000005", "Petrus Kambwa", "en", 395),
            ("usr_tomas", "finder", "+264811000006", "Tomas Nghifikwa", "osh", 90)
        };

        foreach (var p in people)
        {
            db.Exec(@"INSERT INTO users (id, role, phone_e164, full_name, language_code, last_seen_at, created_at)
                      VALUES (@id,@role,@phone,@name,@lang,@seen,@created)",
                new
                {
                    id = p.Id, role = p.Role, phone = p.Phone, name = p.Name, lang = p.Lang,
                    seen = p.Role == "worker" ? Ago(3) : Ago(0, 2), created = Ago(p.CreatedDays)
                });
        }

        db.Exec("INSERT INTO farmers (user_id, farm_name, region_code, dismissed_reports_count, created_at) VALUES (@id,@f,@r,0,@c)",
            new { id = "usr_johannes", f = "Amutenya Cattle Post", r = "OS", c = Ago(410) });
        db.Exec("INSERT INTO farmers (user_id, farm_name, region_code, dismissed_reports_count, created_at) VALUES (@id,@f,@r,@d,@c)",
            new { id = "usr_kambwa", f = "Kambwa Kraal", r = "OM", d = 1, c = Ago(395) });
        db.Exec("INSERT INTO farmers (user_id, farm_name, region_code, dismissed_reports_count, created_at) VALUES (@id,@f,@r,0,@c)",
            new { id = "usr_tomas", f = "Community reporter", r = "OS", c = Ago(90) });

        db.Exec("INSERT INTO staff (user_id, staff_role, title, created_at) VALUES ('usr_admin','admin','System administrator',@c)", new { c = Ago(420) });
        db.Exec("INSERT INTO staff (user_id, staff_role, title, created_at) VALUES ('usr_reviewer','reviewer','Reviewer, passport and claims',@c)", new { c = Ago(400) });
        db.Exec("INSERT INTO staff (user_id, staff_role, title, created_at) VALUES ('usr_agent','field_agent','Field agent, Oshana',@c)", new { c = Ago(390) });
        db.Exec("INSERT INTO staff (user_id, staff_role, title, created_at) VALUES ('usr_verifier','verifier','Community verifier, Oshakati',@c)", new { c = Ago(380) });
    }

    private sealed class Files
    {
        public string MariaFace = "", PetrusFace = "", TomasFace = "";
        public string MariaId = "", PetrusId = "";
        public string ClaimDoc = "", BrandCert = "", BrandMark = "", Evidence = "";
        public string CattlePhoto = "", BrandPhoto2 = "";
    }

    private static Files DemoFiles(Db db, string contentRoot)
    {
        var assets = Path.Combine(contentRoot, "wwwroot", "assets", "demo");
        var f = new Files();

        string? Jpg(string file) => File.Exists(Path.Combine(assets, file)) ? Path.Combine(assets, file) : null;

        string SaveJpg(string? path, string kind, string owner, bool isPublic = false)
        {
            if (path is null) return SaveSvgDoc(kind, owner, "Demo photo", new[] { "Replace with a camera photo", "Asset not bundled" }, "#64748b", isPublic);
            var saved = Storage.SaveBytes(db, File.ReadAllBytes(path), kind, owner, "image/jpeg", ".jpg", isPublic);
            return (string)saved["id"]!;
        }

        string SaveSvgDoc(string kind, string owner, string title, string[] lines, string accent = "#14663a", bool isPublic = false)
        {
            var svg = Svg(title, lines, accent);
            var saved = Storage.SaveBytes(db, Encoding.UTF8.GetBytes(svg), kind, owner, "image/svg+xml", ".svg", isPublic);
            return (string)saved["id"]!;
        }

        f.MariaFace = SaveJpg(Jpg("portrait-maria.jpg"), "face", "usr_maria");
        f.PetrusFace = SaveJpg(Jpg("portrait-petrus.jpg"), "face", "usr_petrus");
        f.TomasFace = SaveJpg(Jpg("portrait-tomas.jpg"), "face", "usr_tomas");
        f.MariaId = SaveSvgDoc("id_doc", "usr_maria", "DEMO NATIONAL ID", new[]
        {
            "This is a synthetic demo document.", "Issued to: Maria Ndapewa", "ID no: 960412 00123 (demo)",
            "Not a real identity document."
        });
        f.PetrusId = SaveSvgDoc("id_doc", "usr_petrus", "DEMO NATIONAL ID", new[]
        {
            "This is a synthetic demo document.", "Issued to: Petrus Shikongo", "ID no: 910622 00456 (demo)",
            "Not a real identity document."
        });

        f.CattlePhoto = SaveJpg(Jpg("found-cattle.jpg"), "listing_photo", "usr_johannes", true);
        f.ClaimDoc = SaveSvgDoc("claim_doc", "usr_johannes", "DEMO BRAND CERTIFICATE", new[]
        {
            "Registrar of Brands — demonstration copy", "Brand: JA7   Registration: BR-2019-0421",
            "Owner: J. Amutenya   Area: Communal, Oshana", "This document is synthetic and for demo use only."
        });
        f.BrandCert = SaveSvgDoc("brand_cert", "usr_johannes", "DEMO BRAND CERTIFICATE", new[]
        {
            "Brand JA7 — BR-2019-0421", "Declared for the KraaLink demo register.", "Official records remain with the Registrar of Brands."
        });
        f.BrandMark = SaveSvgDoc("brand_photo", "usr_johannes", "BRAND MARK", new[] { "J A 7", "Registered brand area: communal", "Oshana region" }, "#b45309", true);
        f.BrandPhoto2 = SaveSvgDoc("brand_photo", "usr_kambwa", "BRAND MARK", new[] { "K 5", "Registered brand area: communal", "Omusati region" }, "#b45309", true);
        f.Evidence = SaveSvgDoc("evidence", "usr_kambwa", "DEMO EVIDENCE PHOTO", new[] { "Damaged kraal gate", "Uploaded with incident INC-DEMO-1", "Synthetic image for demonstration" });
        return f;
    }

    public static string Svg(string title, string[] lines, string accent = "#14663a")
    {
        static string Esc(string s) => SecurityElement.Escape(s) ?? "";
        var sb = new StringBuilder();
        sb.Append("<svg xmlns='http://www.w3.org/2000/svg' width='900' height='600' viewBox='0 0 900 600'>");
        sb.Append("<rect width='900' height='600' fill='#f7f4ea'/>");
        sb.Append($"<rect width='900' height='120' fill='{Esc(accent)}'/>");
        sb.Append($"<text x='56' y='76' font-family='Georgia,serif' font-size='34' fill='#ffffff'>{Esc(title)}</text>");
        sb.Append("<rect x='56' y='170' width='788' height='360' rx='14' fill='#ffffff' stroke='#d8d2bf'/>");
        var y = 235;
        foreach (var line in lines)
        {
            sb.Append($"<text x='96' y='{y}' font-family='Segoe UI,Arial,sans-serif' font-size='26' fill='#243028'>{Esc(line)}</text>");
            y += 52;
        }
        sb.Append("<text x='56' y='568' font-family='Segoe UI,Arial,sans-serif' font-size='16' fill='#7b857c'>KraaLink demo document — synthetic, not valid outside this demonstration</text>");
        sb.Append("</svg>");
        return sb.ToString();
    }

    private static void PassportData(Db db, Files files)
    {
        void Worker(string id, string code, string name, string dob, int level, string village, string constituency,
            string region, string face, string idDoc)
        {
            db.Exec(@"INSERT INTO workers (user_id, short_code, full_name, dob, id_doc_type, id_doc_number_encrypted,
                        id_doc_path, face_path, home_village, constituency, region_code, verification_level,
                        consent_version, consent_at, skills_json, languages_json, last_seen_at, created_at)
                      VALUES (@id,@code,@name,@dob,'namibian_id',@num,@iddoc,@face,@village,@const,@region,@level,
                        'consent-v1','2026-01-12T09:10:00.000Z',@skills,@langs,@seen,@created)",
                new
                {
                    id, code, name, dob, num = Crypto.Encrypt("DEMO-ID-" + code), iddoc = idDoc, face, village,
                    @const = constituency, region, level,
                    skills = "[\"livestock handling\",\"fencing\",\"tractor driving\"]",
                    langs = "[\"Oshiwambo\",\"English\"]", seen = Ago(3), created = Ago(360)
                });
        }

        Worker("usr_maria", "K7M2QP", "Maria Ndapewa", "1996-04-12", 2, "Oshakati East", "Oshakati", "OS",
            files.MariaFace, files.MariaId);
        Worker("usr_petrus", "P4XW9T", "Petrus Shikongo", "1991-06-22", 1, "Ondangwa", "Ondangwa", "OS",
            files.PetrusFace, files.PetrusId);
        Worker("usr_anna", "T8RN2M", "Anna Amukoto", "1999-11-03", 0, "Eenhana", "Eenhana", "OH",
            "", "");

        db.Exec("UPDATE users SET face_path = @f WHERE id = 'usr_maria'", new { f = files.MariaFace });
        db.Exec("UPDATE users SET face_path = @f WHERE id = 'usr_petrus'", new { f = files.PetrusFace });
        db.Exec("UPDATE users SET face_path = @f WHERE id = 'usr_tomas'", new { f = files.TomasFace });

        db.Exec(@"INSERT INTO next_of_kin (id, worker_id, name, relationship, phone_e164, village, listing_confirmed_by_agent, created_at)
                  VALUES ('kin_1','usr_maria','Selma Ndapewa','Sister','+264811000011','Oshakati East',1, @c)", new { c = Ago(360) });
        db.Exec(@"INSERT INTO next_of_kin (id, worker_id, name, relationship, phone_e164, village, listing_confirmed_by_agent, created_at)
                  VALUES ('kin_2','usr_maria','Andreas Ndapewa','Uncle','+264811000012','Ongwediva',1, @c)", new { c = Ago(360) });
        db.Exec(@"INSERT INTO next_of_kin (id, worker_id, name, relationship, phone_e164, village, listing_confirmed_by_agent, created_at)
                  VALUES ('kin_3','usr_petrus','Maria Shikongo','Mother','+264811000013','Ondangwa',1, @c)", new { c = Ago(300) });
        db.Exec(@"INSERT INTO next_of_kin (id, worker_id, name, relationship, phone_e164, village, listing_confirmed_by_agent, created_at)
                  VALUES ('kin_4','usr_petrus','Jonas Shikongo','Brother','+264811000014','Ondangwa',1, @c)", new { c = Ago(300) });

        db.Exec(@"INSERT INTO worker_references (id, worker_id, name, ref_role, phone_e164, created_at)
                  VALUES ('ref_1','usr_maria','Helvi Nangolo','Former farmer','+264811000015', @c)", new { c = Ago(360) });
        db.Exec(@"INSERT INTO worker_references (id, worker_id, name, ref_role, phone_e164, created_at)
                  VALUES ('ref_2','usr_petrus','Klaas Amupolo','Church leader','+264811000016', @c)", new { c = Ago(300) });

        void Ver(string id, string worker, int level, string method, string? agent, string? verifier, string note, int days)
        {
            db.Exec(@"INSERT INTO verification_events (id, worker_id, level, method, agent_id, verifier_id, note, created_at)
                      VALUES (@id,@w,@l,@m,@a,@v,@n,@c)",
                new { id, w = worker, l = level, m = method, a = agent, v = verifier, n = note, c = Ago(days) });
        }
        Ver("ver_1", "usr_maria", 0, "phone_otp", null, null, "Self-declared at registration", 360);
        Ver("ver_2", "usr_maria", 1, "id_and_face", "usr_agent", null, "ID and face photo checked by field agent", 356);
        Ver("ver_3", "usr_maria", 2, "in_person", "usr_agent", "usr_verifier", "Met in person; village and kin confirmed by phone", 350);
        Ver("ver_4", "usr_petrus", 0, "phone_otp", null, null, "Self-declared at registration", 300);
        Ver("ver_5", "usr_petrus", 1, "id_and_face", "usr_agent", null, "ID and face photo checked by field agent", 296);

        // Consent + access history (expired) for Maria's audit trail.
        db.Exec(@"INSERT INTO consents (id, worker_id, farmer_id, status, purpose, window_hours, requested_at, granted_at, expires_at)
                  VALUES ('con_hist','usr_maria','usr_kambwa','expired','Pre-employment hiring check',24,@r,@g,@e)",
            new { r = Ago(61), g = Ago(61), e = Ago(60) });
        db.Exec(@"INSERT INTO access_log (id, viewer_id, viewer_role, worker_id, consent_id, purpose, fields_viewed, client_ip, request_id, created_at)
                  VALUES ('acc_hist','usr_kambwa','farmer','usr_maria','con_hist','Pre-employment hiring check',
                    'photo,name,home_village,verification_level,last_3_employers,record_status','127.0.0.1','seed',@c)",
            new { c = Ago(61) });

        // Employment chain.
        db.Exec(@"INSERT INTO employments (id, worker_id, farmer_id, status, job_title, started_at, ended_at, end_reason, wages_paid, created_at)
                  VALUES ('emp_old','usr_maria','usr_kambwa','closed','Cattle herder',@s,@e,'contract_ended',1,@c)",
            new { s = Ago(330), e = Ago(240), c = Ago(330) });
        db.Exec(@"INSERT INTO employments (id, worker_id, farmer_id, status, job_title, started_at, created_at)
                  VALUES ('emp_open','usr_maria','usr_johannes','open','Cattle herder and general farm worker',@s,@c)",
            new { s = Ago(120), c = Ago(120) });
        db.Exec(@"INSERT INTO employments (id, worker_id, farmer_id, status, job_title, started_at, created_at)
                  VALUES ('emp_anna','usr_anna','usr_kambwa','open','Goat herder',@s,@c)", new { s = Ago(30), c = Ago(30) });

        void EmpEvent(string id, string emp, string type, string actor, string payload, int days)
        {
            db.Exec("INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at) VALUES (@id,@e,@t,@a,@p,@c)",
                new { id, e = emp, t = type, a = actor, p = payload, c = Ago(days) });
        }
        EmpEvent("evt_1", "emp_old", "check_in", "usr_kambwa", "{\"note\":\"Check-in confirmed by worker\"}", 330);
        EmpEvent("evt_2", "emp_old", "check_out", "usr_kambwa", "{\"reason\":\"contract_ended\"}", 240);
        EmpEvent("evt_3", "emp_old", "check_out_confirmed", "usr_maria", "{\"reason\":\"contract_ended\"}", 240);
        EmpEvent("evt_4", "emp_open", "check_in", "usr_johannes", "{\"note\":\"Check-in confirmed by worker\"}", 120);
        EmpEvent("evt_5", "emp_anna", "check_in", "usr_kambwa", "{\"note\":\"Check-in confirmed by worker\"}", 30);

        // Incidents. inc_1 is visible (evidence + worker notified); inc_2 is dismissed and hidden.
        db.Exec(@"INSERT INTO incidents (id, employment_id, reporter_id, worker_id, description, occurred_on, value_nad,
                    evidence_paths, status, worker_notified_at, created_at)
                  VALUES ('inc_1','emp_old','usr_kambwa','usr_maria',
                    'Farmer reports that three goats went missing during the last week of employment. Worker was notified and can respond.',
                    @d, 2400, @ev, 'under_review', @n, @c)",
            new { d = Ago(245), ev = "[\"" + files.Evidence + "\"]", n = Ago(5), c = Ago(5) });
        db.Exec(@"INSERT INTO incidents (id, employment_id, reporter_id, worker_id, description, occurred_on, value_nad,
                    evidence_paths, status, worker_notified_at, decision, decided_by, decided_at, created_at)
                  VALUES ('inc_2','emp_old','usr_kambwa','usr_maria',
                    'Report about a broken water pump. Dismissed after review: no link to the worker was established.',
                    @d, 900, @ev, 'dismissed', @n, 'insufficient_evidence', 'usr_reviewer', @dec, @c)",
            new { d = Ago(200), ev = "[\"" + files.Evidence + "\"]", n = Ago(190), dec = Ago(185), c = Ago(190) });

        // Notifications that make the demo feel alive.
        Notify.Send(db, "usr_maria", "New incident response window",
            "A farmer has filed an incident linked to a past employment. You have 7 days to reply. Your side is always heard before any decision.",
            "en", new { incidentId = "inc_1", action = "respond_incident" });
        Notify.Send(db, "usr_maria", "Your passport is at L2",
            "Your WorkerLink Passport is community-verified (L2). Farmers see the Verified badge. You decide who may view it.",
            "en");
        Notify.Send(db, "usr_johannes", "Welcome to KraaLink",
            "Your farmer account is ready. Run a hiring check with a worker short code, list livestock, or report found animals.",
            "en");
        Notify.Send(db, "usr_tomas", "Found report update",
            "Your found-livestock report KL-FND-7K2P has a potential match. The registered owner has been alerted. Ownership is not yet verified.",
            "en", new { caseRef = "KL-FND-7K2P" });
    }

    private static void Marketplace(Db db, Files files)
    {
        db.Exec(@"INSERT INTO listings (id, farmer_id, species, qty, age_text, sex, price_nad, region_code, village,
                    photo_path, brand_text, tag_numbers, status, created_at)
                  VALUES ('lst_1','usr_johannes','Cattle',12,'2–3 years','Mixed',9800,'OS','Oshakati',@p,'JA7','[]','active',@c)",
            new { p = files.CattlePhoto, c = Ago(3) });
        db.Exec(@"INSERT INTO listings (id, farmer_id, species, qty, age_text, sex, price_nad, region_code, village,
                    photo_path, brand_text, tag_numbers, status, created_at)
                  VALUES ('lst_2','usr_kambwa','Goats',25,'1–2 years','Mixed',1750,'OM','Outapi',NULL,'K5','[]','active',@c)",
            new { c = Ago(1) });
        db.Exec(@"INSERT INTO listings (id, farmer_id, species, qty, age_text, sex, price_nad, region_code, village,
                    photo_path, brand_text, tag_numbers, status, created_at)
                  VALUES ('lst_3','usr_johannes','Cattle',6,'3 years','Bulls',11500,'OS','Ongwediva',@p,NULL,'[]','active',@c)",
            new { p = files.CattlePhoto, c = Ago(2) });
        db.Exec(@"INSERT INTO listings (id, farmer_id, species, qty, age_text, sex, price_nad, region_code, village,
                    photo_path, brand_text, tag_numbers, status, hold_reason, created_at)
                  VALUES ('lst_held','usr_johannes','Cattle',4,'2 years','Cows',9000,'OS','Oshakati',NULL,'JA7',
                    @tags,'held','Tag OM 778-12 is reported stolen by another owner. Held for reviewer check.',@c)",
            new { tags = Passport.JsonList(new[] { "OM 778-12" }), c = Ago(1) });
        db.Exec(@"INSERT INTO listing_reports (id, listing_id, reporter_id, reason, status, created_at)
                  VALUES ('lrep_1','lst_2','usr_johannes','Price looks too low and the seller could not give a NamLITS tag. Please check.','open',@c)",
            new { c = Ago(1) });

        void Price(string id, string species, string type, double value, string source, string week)
        {
            db.Exec(@"INSERT INTO price_reference (id, species, price_type, value_nad, unit, source, week_of, created_by, created_at)
                      VALUES (@id,@s,@t,@v,'per head',@src,@w,'usr_reviewer',@c)",
                new { id, s = species, t = type, v = value, src = source, w = week, c = Ago(2) });
        }
        Price("pr_1", "Cattle", "auction", 9500, "LLPBN weekly report (demo)", "2026-11-09");
        Price("pr_2", "Goats", "auction", 1800, "LLPBN weekly report (demo)", "2026-11-09");
        Price("pr_3", "Sheep", "abattoir", 2100, "Reviewer entry, indicative", "2026-11-09");
    }

    private static void VetBot(Db db)
    {
        void Condition(string id, string name, string species, string symptoms, string advice, int notifiable, string by, string at)
        {
            db.Exec(@"INSERT INTO vet_conditions (id, name_en, translations, species, symptoms, advice, is_notifiable,
                        review_status, approved_by, approved_at, created_by, created_at)
                      VALUES (@id,@n,'{}',@s,@sym,@a,@not,@st,@by,@at,'usr_reviewer',@c)",
                new { id, n = name, s = species, sym = symptoms, a = advice, not = notifiable, st = by is null ? "pending" : "approved", by, at, c = Ago(45) });
        }

        Condition("vc_fmd", "Foot-and-mouth disease", "cattle,goats,sheep",
            "[\"blisters in the mouth\",\"drooling\",\"lameness\",\"fever\"]",
            "Isolate the animals immediately. Do not move, sell or slaughter them. Contact the nearest State Veterinary office now. This disease must be reported.",
            1, "Dr T. Nangolo (State Vet)", Ago(40));
        Condition("vc_anthrax", "Anthrax", "cattle,goats,sheep",
            "[\"sudden death\",\"blood from the nose or mouth\",\"sudden swelling\",\"weakness\"]",
            "Do not open or move the carcass. Keep people and dogs away. Isolate the area and call the State Veterinary office immediately. Anthrax can infect people.",
            1, "Dr T. Nangolo (State Vet)", Ago(40));
        Condition("vc_lsd", "Lumpy skin disease", "cattle",
            "[\"skin lumps\",\"fever\",\"swollen glands\",\"watery eyes\"]",
            "Separate animals with lumps from the herd. Do not move them. Contact the State Veterinary office for advice and vaccination guidance. This disease is notifiable.",
            1, "Dr T. Nangolo (State Vet)", Ago(40));
        Condition("vc_bloat", "Bloat", "cattle",
            "[\"swollen left flank\",\"laboured breathing\",\"restless\",\"no cudding\"]",
            "Move the animal slowly and keep it standing. Remove access to lush green feed. Call a vet or animal health technician now if breathing is difficult. Do not try to cut the animal yourself.",
            0, "Dr T. Nangolo (State Vet)", Ago(40));
        Condition("vc_mastitis", "Mastitis", "cattle",
            "[\"hot swollen udder\",\"clotted milk\",\"reduced milk\",\"discomfort when milked\"]",
            "Milk the affected quarter out gently and keep the udder clean. Separate the milk from the bulk tank. Ask a vet or technician to check the animal and advise on treatment.",
            0, "Dr T. Nangolo (State Vet)", Ago(40));
        Condition("vc_heartwater", "Heartwater", "cattle,goats,sheep",
            "[\"high fever\",\"staggering\",\"nervous signs\",\"lying down\"]",
            "Keep the animal quiet and shaded. Contact a vet or animal health technician quickly. Tick control and early treatment matter; only a professional should choose the medicine.",
            0, "Dr T. Nangolo (State Vet)", Ago(40));
        Condition("vc_worms", "Internal parasites", "goats,sheep",
            "[\"diarrhoea\",\"weight loss\",\"pale gums\",\"rough coat\"]",
            "Check the animals for worms with a vet or technician. Improve grazing rotation and clean water access. Do not use a dewormer without professional advice on the right product and interval.",
            0, "Dr T. Nangolo (State Vet)", Ago(40));

        // One pending item so the reviewer queue is not empty (FR-VET-09).
        db.Exec(@"INSERT INTO vet_conditions (id, name_en, translations, species, symptoms, advice, is_notifiable,
                    review_status, created_by, created_at)
                  VALUES ('vc_pending','Tick bite and tick-borne disease check','{}','cattle,goats,sheep',
                    @sym,'Awaiting vet review. Inspect the animal and contact a vet or technician if it is weak or feverish.',
                    0,'pending','usr_reviewer',@c)",
            new { sym = Passport.JsonList(new[] { "ticks visible", "fever", "anaemia" }), c = Ago(4) });

        void Vet(string id, string name, string type, string region, string phone, string town)
        {
            db.Exec(@"INSERT INTO vet_directory (id, name, vet_type, region_code, phone_e164, town, created_at)
                      VALUES (@id,@n,@t,@r,@p,@town,@c)",
                new { id, n = name, t = type, r = region, p = phone, town, c = Ago(60) });
        }
        Vet("vd_1", "Oshakati State Veterinary Office", "state_vet", "OS", "+264810000101", "Oshakati");
        Vet("vd_2", "Ondangwa Animal Health Office", "animal_health_technician", "OS", "+264810000102", "Ondangwa");
        Vet("vd_3", "Outapi State Veterinary Office", "state_vet", "OM", "+264810000103", "Outapi");
        Vet("vd_4", "Eenhana Veterinary Office", "state_vet", "OH", "+264810000104", "Eenhana");
        Vet("vd_5", "Oshikoto Animal Health Office", "animal_health_technician", "OT", "+264810000105", "Tsumeb");

        db.Exec(@"INSERT INTO herds (id, farmer_id, species, head_count, created_at)
                  VALUES ('herd_1','usr_johannes','Cattle',120,@c)", new { c = Ago(150) });
        db.Exec(@"INSERT INTO herds (id, farmer_id, species, head_count, created_at)
                  VALUES ('herd_2','usr_kambwa','Goats',80,@c)", new { c = Ago(100) });
        db.Exec(@"INSERT INTO vaccination_schedules (id, herd_id, vaccine, last_done, next_due, created_at)
                  VALUES ('vac_1','herd_1','Anthrax (annual)',@l,@n,@c)", new { l = Ago(360), n = In(14), c = Ago(360) });
        db.Exec(@"INSERT INTO vaccination_schedules (id, herd_id, vaccine, last_done, next_due, created_at)
                  VALUES ('vac_2','herd_1','Botulism booster',@l,@n,@c)", new { l = Ago(300), n = In(40), c = Ago(300) });
        db.Exec(@"INSERT INTO vaccination_schedules (id, herd_id, vaccine, last_done, next_due, created_at)
                  VALUES ('vac_3','herd_2','Pasteurellosis',@l,@n,@c)", new { l = Ago(340), n = In(5), c = Ago(340) });

        db.Exec(@"INSERT INTO vet_sessions (id, farmer_id, condition_id, language_code, symptoms_text, escalated, created_at)
                  VALUES ('vs_1','usr_kambwa','vc_worms','en','Goats losing weight with diarrhoea',0,@c)", new { c = Ago(9) });
    }

    private static void BrandTracker(Db db, Files files)
    {
        db.Exec(@"INSERT INTO stock_brands (id, owner_id, brand_mark_text, brand_normalized, brand_registration_no,
                    brand_area, region_code, photo_path, cert_path, status, verified_by, verified_at, created_at)
                  VALUES ('brd_1','usr_johannes','JA 7','JA7','BR-2019-0421','communal','OS',@p,@c,'verified','usr_reviewer',@v,@cr)",
            new { p = files.BrandMark, c = files.BrandCert, v = Ago(70), cr = Ago(80) });
        db.Exec(@"INSERT INTO stock_brands (id, owner_id, brand_mark_text, brand_normalized, brand_registration_no,
                    brand_area, region_code, photo_path, cert_path, status, verified_by, verified_at, created_at)
                  VALUES ('brd_2','usr_kambwa','K5','K5','BR-2021-1180','communal','OM',@p,NULL,'verified','usr_reviewer',@v,@cr)",
            new { p = files.BrandPhoto2, v = Ago(60), cr = Ago(65) });
        db.Exec(@"INSERT INTO stock_brands (id, owner_id, brand_mark_text, brand_normalized, brand_registration_no,
                    brand_area, region_code, status, created_at)
                  VALUES ('brd_3','usr_johannes','N9','N9','BR-2026-0088','communal','OS','pending',@c)", new { c = Ago(2) });

        void Tag(string id, string owner, string? brand, string number, string species, int namlits, string status, string created)
        {
            db.Exec(@"INSERT INTO livestock_tags (id, owner_id, brand_id, tag_number, tag_normalized, species, herd_name,
                        namlits_registered, status, created_at)
                      VALUES (@id,@o,@b,@n,@norm,@s,'Main herd',@n2,@st,@c)",
                new { id, o = owner, b = brand, n = number, norm = Codes.NormalizeMark(number), s = species, n2 = namlits, st = status, c = created });
        }
        Tag("tag_1", "usr_johannes", "brd_1", "NA 123-45", "Cattle", 1, "live", Ago(70));
        Tag("tag_2", "usr_johannes", "brd_1", "NA 123-46", "Cattle", 1, "live", Ago(70));
        Tag("tag_3", "usr_kambwa", "brd_2", "OM 778-12", "Cattle", 1, "stolen", Ago(60));
        Tag("tag_4", "usr_kambwa", "brd_2", "OM 778-13", "Cattle", 1, "live", Ago(60));

        db.Exec(@"INSERT INTO missing_reports (id, owner_id, brand_id, tag_numbers, species, qty, last_seen_place,
                    last_seen_at, police_case_no, status, created_at)
                  VALUES ('miss_1','usr_kambwa','brd_2',@tags,'Cattle',2,'Outapi grazing area',@seen,
                    'CR-120/11/2026','open',@c)",
            new { tags = Passport.JsonList(new[] { "OM 778-12" }), seen = Ago(11), c = Ago(11) });

        db.Exec(@"INSERT INTO found_reports (id, case_ref, finder_id, photo_path, brand_text, tag_numbers, species, qty,
                    location_text, matched_owner_id, matched_brand_id, status, expires_at, created_at)
                  VALUES ('fnd_1','KL-FND-7K2P','usr_tomas',@p,'JA 7',@tags,'Cattle',3,
                    'Main road east of Oshakati, near the water point','usr_johannes','brd_1','claim_pending',@e,@c)",
            new
            {
                p = files.CattlePhoto, tags = Passport.JsonList(new[] { "NA 123-45" }),
                e = In(26), c = Ago(4)
            });

        db.Exec(@"INSERT INTO ownership_claims (id, found_report_id, claimant_id, statement, status, created_at)
                  VALUES ('claim_1','fnd_1','usr_johannes',
                    'These animals carry my JA7 brand and tag NA 123-45. The brand certificate is attached and I can bring the original to the police station.',
                    'pending',@c)", new { c = Ago(3) });
        db.Exec(@"INSERT INTO ownership_documents (id, claim_id, doc_type, file_path, review_status, uploaded_by, created_at)
                  VALUES ('doc_1','claim_1','brand_certificate',@p,'pending','usr_johannes',@c)",
            new { p = files.ClaimDoc, c = Ago(3) });

        db.Exec(@"INSERT INTO found_reports (id, case_ref, finder_id, photo_path, brand_text, tag_numbers, species, qty,
                    location_text, status, expires_at, created_at)
                  VALUES ('fnd_2','KL-FND-9Q4M','usr_tomas',NULL,NULL,@tags,'Cattle',2,
                    'Near Eenhana road, no brand visible','open',@e,@c)",
            new { tags = Passport.JsonList(new[] { "XX 000-99" }), e = In(28), c = Ago(2) });

        db.Exec(@"INSERT INTO brand_lookups (id, user_id, query_type, query_value, matched, found_report_id, client_ip, created_at)
                  VALUES ('bl_1','usr_tomas','brand_tag','JA7 / NA12345',1,'fnd_1','127.0.0.1',@c)", new { c = Ago(4) });
        db.Exec(@"INSERT INTO brand_lookups (id, user_id, query_type, query_value, matched, found_report_id, client_ip, created_at)
                  VALUES ('bl_2','usr_tomas','tag','XX00099',0,'fnd_2','127.0.0.1',@c)", new { c = Ago(2) });

        db.Exec(@"INSERT INTO livestock_transfers (id, seller_id, buyer_id, listing_id, movement_permit_no, status,
                    seller_confirmed_at, created_at)
                  VALUES ('tr_1','usr_kambwa','usr_johannes','lst_2','MP-2026-0451','pending_buyer',@s,@c)",
            new { s = Ago(1), c = Ago(1) });
        db.Exec(@"INSERT INTO livestock_transfer_items (id, transfer_id, tag_id, species, qty)
                  VALUES ('tri_1','tr_1','tag_4','Cattle',1)");
    }

    private static void SystemData(Db db, Files files)
    {
        db.Exec(@"INSERT INTO police_requests (id, requester_name, case_no, worker_id, justification, status, created_at)
                  VALUES ('pol_1','Sgt K. Iipinge, Namibian Police, Oshakati','CR-118/11/2026','usr_petrus',
                    'Request for employment contact history in an open stock-theft investigation.','pending',@c)", new { c = Ago(1) });

        Audit.Log(db, null, "system.seed", "system", "seed", details: "Demo data seeded", actorRole: "system");

        Notify.Send(db, "usr_reviewer", "Review queues have new items",
            "Verification, a pending brand, an ownership claim and a flagged listing are waiting in the reviewer panel.",
            "en", new { action = "admin" }, "system");
        Notify.Send(db, "usr_johannes", "Ownership claim received",
            "Your claim on KL-FND-7K2P is with a reviewer. Keep your original brand certificate ready. Ownership is not verified until a reviewer decides.",
            "en", new { caseRef = "KL-FND-7K2P" });
        Notify.Send(db, "usr_kambwa", "A listing was held",
            "A marketplace listing carrying your stolen tag OM 778-12 has been held and hidden from buyers while a reviewer checks it.",
            "en", new { listingId = "lst_held" });
    }
}
