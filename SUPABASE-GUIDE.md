# Supabase Setup — NEXUS JEE

Supabase add karne ka poora tareeka, step by step. Sirf **ek baar** karna hai (~10 min).

Files jo is kaam ke liye bani hain:

| File | Kaam |
|---|---|
| `supabase-schema.sql` | Saari tables + Row Level Security policies (SQL Editor me paste karke Run) |
| `config.js` | Default Project URL + anon key (naye device par setup screen nahi aata) |
| `supabase.js` | Supabase client, Google login, offline-first sync engine, login UI |
| `store.js` | Sync bridge — har `Store.set()` par debounced push |
| `index.html` | supabase-js CDN + header me sync pill |

---

## STEP 0 — Kaunsi keys chahiye

Bas **do** keys chahiye (teesri optional):

| Key | Kahan milegi | Kis kaam ki |
|---|---|---|
| **Project URL** | Project Settings → API → Project URL | Client kis project se baat kare (`https://xxxx.supabase.co`) |
| **anon public key** | Project Settings → API → Project API keys → `anon` `public` | Frontend se API calls karne ke liye — public hone ke liye bani hai |
| **Google OAuth Client ID** *(optional)* | Google Cloud Console → Credentials | Google login provider set karne ke liye (Supabase me daalni hoti hai) |

> ⚠️ **`service_role` key KABHI frontend me na daalo.** Wo RLS ko bypass kar deti hai — usse koi bhi poora database padh/dele te kar sakta hai. Uske liye chahiye hi nahi.

---

## STEP 1 — Supabase project banao

1. <https://app.supabase.com> kholo → sign up / log in (GitHub ya email se).
2. **New project** click karo.
3. Bharo:
   - **Name** — `NEXUS JEE`
   - **Database Password** — strong password (kahin note kar lo)
   - **Region** — India ke liye `Mumbai (ap-south-1)` ya sabse nazdeek
   - **Pricing** — Free plan kaafi hai
4. **Create new project** → 1–2 minute wait karo jab tak "Project is ready" na aaye.

---

## STEP 2 — Keys copy karo

1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. Copy karo:
   - **Project URL** → ye app me `supa-url` field me jaayega
   - **Project API keys → `anon` `public`** → ye `supa-key` field me
3. **Service role key ko chhoo bhi na dena.**

---

## STEP 2b — Auto-config (recommended)

Ek hi jagah keys daalo aur **har naye browser/device par app khud connect ho jaayegi** (setup screen aayega hi nahi):

1. `config.js` kholo.
2. **Line 24** par `PASTE_ANON_PUBLIC_KEY_HERE` ki jagah apni **`anon public` key** paste karo:
   ```js
   var NEXUS_SUPABASE_ANON_KEY = 'PASTE_ANON_PUBLIC_KEY_HERE';
   ```
3. **Line 21** par Project URL pehle se bhari hui hai — agar aapka project alag hai to wahan badal do.
4. Save karo → page reload. Header ka pill **LOCAL** se hatt kar connect ho jaayega.

Kaise kaam karta hai:

- Ye values sirf **default** hain. Jis browser me user ne manually keys save ki hain (`localStorage` key `nexus:supabase`), wahan wahi jeetti hain — manually entered config ab bhi defaults ko override karta hai.
- Placeholder (`PASTE_ANON_PUBLIC_KEY_HERE`) chhoda hua ho to app chup-chaap **local-only mode** me chalti hai — kuch tootta nahi, bas cloud sync off rehti hai.
- `anon public` key browser me dikhna normal hai (RLS usse protect karta hai). Ye file Vercel/GitHub par bhi safe hai — bashart ki aap **kabhi** `service_role` key na daalo.

---

## STEP 3 — Google login enable karo

Iske do hisse hain: Supabase ko Google client batao, aur Google ko redirect URI batao.

**3a. Google Cloud Console**

1. <https://console.cloud.google.com> → naya project banao (ya existing chuno).
2. **APIs & Services → OAuth consent screen** → External → app name + support email bharo → Save.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Application type: **Web application**.
5. **Authorised JavaScript origins**:
   ```
   http://localhost:8080
   ```
6. **Authorised redirect URIs** — yahi sabse important line hai:
   ```
   https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback
   ```
   `<YOUR-PROJECT-REF>` wahi hai jo Project URL me hai (`https://abcd1234.supabase.co` → ref = `abcd1234`).
7. **Create** → **Client ID** aur **Client secret** copy karo.

**3b. Supabase me Google provider on karo**

1. Supabase Dashboard → **Authentication → Providers → Google** → toggle **ON**.
2. **Client ID** aur **Client Secret** paste karo (Google se jo mila) → **Save**.

**3c. Redirect URLs allow karo**

1. **Authentication → URL Configuration**.
2. **Site URL**:
   ```
   http://localhost:8080
   ```
3. **Redirect URLs** me add karo:
   ```
   http://localhost:8080/**
   ```

> Google login `file://` se **nahi** chalta — browser OAuth redirect wapas file path pe nahi bhej sakta. Local server chalao:
> ```bash
> python -m http.server 8080
> # phir kholo: http://localhost:8080/index.html
> ```
> Project me `serve.ps1` bhi hai (Windows).

---

## STEP 4 — SQL chalao (tables + RLS)

1. Supabase Dashboard → **SQL Editor** → **New query**.
2. `supabase-schema.sql` ka poora content paste karo → **Run**.
3. Ye ban jaana chahiye:

| Table | Kya store hota hai |
|---|---|
| `profiles` | user ka naam, avatar, XP, exam date |
| `tasks` | planner / calendar / dashboard tasks |
| `sessions` | focus timer ke sessions (date + minutes) |
| `syllabus_progress` | har chapter ke 4 topic toggles (Lecture/Notes/PYQ/Revised) |
| `mistakes` | mistake book entries + revision stage |
| `lectures` | lecture tracker |
| `tests` | mock test results (Physics/Chemistry/Maths marks + questions) |

4. **Check karne ke liye** (optional) SQL Editor me:
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables
    WHERE schemaname = 'public' ORDER BY tablename;
   ```
   Har row me `rowsecurity = true` hona chahiye.

**Security kaise lagti hai:** har table par RLS ON hai aur ek hi policy hai —
`auth.uid() = user_id` (profiles me `auth.uid() = id`). Iska matlab:
agar tum apne anon key se bhi query bhejo, to bina login **zero rows** aayengi,
aur login karne ke baad **sirf apni** rows aayengi. Doosre user ka data DB level
par hi block hai — JavaScript pe bharosa nahi karna padta.

---

## STEP 5 — Keys app me paste karo

1. App kholo (http://localhost:8080).
2. Header me right side **`LOCAL`** pill par click karo (ya jo bhi status likha ho).
3. Panel me paste karo: **Project URL**, **anon public key**, (optional) **Google Client ID**.
4. **Save & connect** → phir **Continue with Google**.
5. Google se login → wapas app pe aa jaoge, pill **`SYNCED`** dikhayega.

Keys sirf us browser ke `localStorage` me `nexus:supabase` ke naam se rehti hain —
na repo me, na kisi server pe.

---

## STEP 6 — Sync kaise chalta hai (offline-first)

```
        user kuch add karta hai
                 │
                 ▼
     Store.set('tests', [...])          <-- pehle yahan, turant
                 │
                 ├─► localStorage 'nexus:tests'   (offline bhi kaam karta hai)
                 │
                 └─► store.js bridge (800ms debounce)
                              │
                              ▼
                  NexusSupabase.push('tests')
                        │            │
                    online?       offline?
                        │            │
                        ▼            ▼
                 Supabase upsert   skip (localStorage safe hai)
                 + remote se wo rows delete jo local me
                   nahi hain (delete bhi sync ho jaata hai)
```

**Login / reconnect / "Sync now" par:**

1. `profiles` se naam, XP, exam date pull hote hain.
2. Har collection remote se pull hota hai aur merge hota hai:
   per row **naya `updated_at` jeetta hai**; remote-only rows local me add ho jaate hain.
3. Merged array `Store.set()` se wapas likha jaata hai — isliye dashboard, tests,
   mistake book, syllabus sab apne aap refresh ho jaate hain (sab `Store.subscribe`
   par lage hain).
4. Merge ke waqt `NexusSupabase.suppress = true` rehta hai, warna push↔pull ka
   infinite loop ban jaata.

**Account switch:** login karne par agar `nexus:owner` kisi doosre user ka tha, to
local collections saaf kar di jaati hain (aur ek backup `nexus:backup:<userId>` me
rakh diya jaata hai) — taaki ek device pe dusra banda pichle user ka data na dekhe.

**Status pill:**

| Pill | Matlab |
|---|---|
| `LOCAL` | Keys nahi mile — sirf localStorage (app poora chalta hai) |
| `CONNECTING` | Client ban gaya, session check ho raha hai |
| `SYNCING` | Abhi push/pull chal raha hai |
| `SYNCED` | Sab cloud pe sync hai |
| `OFFLINE` | Login hai par internet nahi — data local me safe hai |

---

## Local-only kya rehta hai (jaan-boojh kar)

| Cheek | Kyun |
|---|---|
| `milestones` | Auto-generated hai, aur tumhari list me table nahi thi — local rehta hai |
| mistake ka base64 `photo` | Bahut bada hota hai; `photoRef` (IndexedDB) sync hota hai |
| `nexus:supabase` keys | Sirf is browser me — repo me kabhi nahi |

---

## Common problems

| Problem | Fix |
|---|---|
| `redirect_uri_mismatch` (Google) | Google Console me redirect URI exactly `https://<ref>.supabase.co/auth/v1/callback` hona chahiye |
| Login ke baad wapas `LOCAL` | **URL Configuration** me Site URL `http://localhost:8080` aur Redirect URL `http://localhost:8080/**` add karo |
| `null value in column "user_id"` | Login nahi hua — pehle Google se sign in karo, phir data add karo |
| Kuch bhi sync nahi ho raha | DevTools → Network me `/rest/v1/...` dekho; 401 = session gaya (sign out → sign in), 404 = SQL nahi chala |
| `new row violates row-level security` | `user_id` payload me current user ka nahi hai — schema ka section 0–9 dobara chalao |
| Do devices pe data alag | Dono pe **Sync now** dabao — merge `updated_at` se hota hai, newer jeetta hai |

---

## Kaise test karo ki sab theek hai

1. `python -m http.server 8080` → http://localhost:8080 kholo.
2. Pill `LOCAL` → panel kholo → keys paste → **Save & connect** → **Continue with Google**.
3. Login ke baad pill `SYNCED` ho jaana chahiye. Dashboard pe ek task add karo.
4. Supabase Dashboard → **Table Editor → tasks** → tumhari row dikhni chahiye.
5. Doosre browser / incognito me same Google account se login karo → tasks, tests,
   mistakes sab wapas aa jaane chahiye.
6. **Delete test:** ek test delete karo → Table Editor me wo row bhi gayab honi chahiye.
