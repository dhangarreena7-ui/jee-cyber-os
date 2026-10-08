/* NEXUS JEE — supabase.js
   Offline-first Supabase sync + Google login (supabase-js CDN se).

   index.html me do script tags chahiye (order matter karta hai):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
     <script src="supabase.js"></script>

   KAUNSI KEYS CHAHIYE (SUPABASE-GUIDE.md me poora step-by-step hai)
     url      : Project Settings -> API -> Project URL      (https://xxxx.supabase.co)
     anonKey  : Project Settings -> API -> anon public key  (frontend me yahi chalti hai)
     * service_role key KABHI yahan na daalo — usse RLS bypass ho jaata hai.
     googleId : optional, Google Cloud Console -> Credentials -> OAuth Client ID

   KAISE KAAM KARTA HAI
     1. Har likhaav pehle localStorage me jaata hai (Store.set) — offline bhi chalta hai.
     2. store.js ka bridge har change par NexusSupabase.push(key) call karta hai (debounced).
     3. Online + logged-in ho to engine us collection ko Supabase me upsert karta hai,
        aur jo rows remote pe hain par local me nahi, unhe delete kar deta hai.
     4. Login / reconnect / "Sync now" par pehle remote se pull hota hai: naya
        updated_at wala row jeetta hai, phir merged array Store me wapas likha jaata hai
        (isse dashboard/tests/mistakes sab apne aap refresh ho jaate hain).
     5. Row Level Security har table ko auth.uid() = user_id tak seemit rakhta hai,
        isliye doosre user ka data kabhi nahi aayega.

   PUBLIC API
     NexusSupabase.init()             -> client + auth listeners start
     NexusSupabase.onAuth(cb)         -> cb(user|null)
     NexusSupabase.signInWithGoogle() -> Google OAuth redirect shuru
     NexusSupabase.signOut()
     NexusSupabase.openPanel()        -> login / setup / sync panel kholta hai
     NexusSupabase.push(key)          -> ek collection ko remote pe bhejo
     NexusSupabase.pull(key)          -> ek collection remote se merge karo
     NexusSupabase.syncAll()          -> sab collections full sync
     NexusSupabase.status             -> 'local' | 'connecting' | 'online' | 'syncing' | 'offline'
     NexusSupabase.user               -> auth user ya null
     NexusSupabase.suppress           -> true hone par store.js push nahi karta (loop guard)
*/
(function () {
  'use strict';

  var CDN_MSG = 'supabase-js CDN load nahi hui — index.html me script tag check karo.';

  /* ------------------------------------------------------------------ */
  /*  Collection map: app ka Store key  <->  Supabase table             */
  /*  fields: local field name -> postgres column (snake_case)          */
  /* ------------------------------------------------------------------ */
  var MAP = {
    tasks: {
      table: 'tasks',
      idOf: function (r) { return r.id; },
      fields: {
        title: 'title', subject: 'subject', date: 'date', block: 'block',
        duration: 'duration', priority: 'priority', repeat: 'repeat',
        done: 'done', doneAt: 'done_at', dones: 'dones'
      }
    },
    sessions: {
      table: 'sessions',
      // sessions rows ka apna id nahi hota -> epoch ms se stable id banate hain
      idOf: function (r) { return 's' + (r.at || 0); },
      fields: { date: 'date', minutes: 'minutes', at: 'at' }
    },
    tests: {
      table: 'tests',
      idOf: function (r) { return r.id; },
      fields: {
        name: 'name', date: 'date', pm: 'pm', pq: 'pq', cm: 'cm', cq: 'cq',
        mm: 'mm', mq: 'mq', minutes: 'minutes', rank: 'rank', at: 'at'
      }
    },
    mistakes: {
      table: 'mistakes',
      idOf: function (r) { return r.id; },
      // base64 'photo' jaan-boojh kar skip — bahut bada hota hai. IndexedDB ka
      // photoRef sync hota hai, dobara same device pe khulne par photo mil jaati hai.
      fields: {
        title: 'title', subject: 'subject', chapter: 'chapter', reason: 'reason',
        notes: 'notes', photoRef: 'photo_ref', created: 'created', at: 'at',
        stage: 'stage', nextReview: 'next_review', mastered: 'mastered',
        history: 'history'
      }
    },
    lectures: {
      table: 'lectures',
      idOf: function (r) { return r.id; },
      fields: {
        title: 'title', subject: 'subject', chapter: 'chapter', status: 'status',
        url: 'url', duration: 'duration', watchedAt: 'watched_at', notes: 'notes'
      }
    }
  };

  var SYNC_KEYS = Object.keys(MAP);

  /* ------------------------------------------------------------------ */
  /*  State                                                             */
  /* ------------------------------------------------------------------ */
  var ready = false;      // init ho chuka hai
  var authSub = null;
  var timers = {};        // key -> debounce timer
  var queue = [];         // online hone se pehle ruke hue syncs

  window.NexusSupabase = {
    config: { url: '', anonKey: '', googleId: '' },
    client: null,
    user: null,
    status: 'local',
    suppress: false,      // store.js bridge ise dekhta hai
    keys: SYNC_KEYS,
    onUser: null,
    log: function () { if (window.console && console.log) console.log.apply(console, arguments); }
  };
  var NS = window.NexusSupabase;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return v && typeof v === 'object' && !isArr(v); }

  /* ------------------------------------------------------------------ */
  /*  Config (localStorage me save hoti hai, koi key repo me nahi jaati) */
  /* ------------------------------------------------------------------ */
  function loadConfig() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('nexus:supabase') || 'null'); } catch (e) { saved = null; }
    if (!saved || typeof saved !== 'object') saved = {};
    // file-level default (agar aap CONFIG hard-code karna chaho) — window.NEXUS_SUPABASE_CONFIG
    var dflt = window.NEXUS_SUPABASE_CONFIG || {};
    NS.config = {
      url: saved.url || dflt.url || '',
      anonKey: saved.anonKey || dflt.anonKey || '',
      googleId: saved.googleId || dflt.googleId || ''
    };
    return NS.config;
  }

  function saveConfig(c) {
    NS.config = { url: c.url || '', anonKey: c.anonKey || '', googleId: c.googleId || '' };
    try { localStorage.setItem('nexus:supabase', JSON.stringify(NS.config)); } catch (e) {}
    return NS.config;
  }

  function hasKeys() { return !!(NS.config.url && NS.config.anonKey); }

  /* ------------------------------------------------------------------ */
  /*  Client (ek hi instance — bar bar create karna session tod deta hai) */
  /* ------------------------------------------------------------------ */
  function makeClient() {
    if (!hasKeys()) { NS.client = null; return null; }
    if (!window.supabase || !window.supabase.createClient) { NS.client = null; return null; }
    if (NS.client && NS.clientUrl === NS.config.url) return NS.client;
    NS.client = window.supabase.createClient(NS.config.url, NS.config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    NS.clientUrl = NS.config.url;
    window.__supabase = NS.client;   // debugging ke liye
    return NS.client;
  }

  function online() {
    return !!(NS.client && NS.user && navigator.onLine !== false);
  }

  /* ------------------------------------------------------------------ */
  /*  Status pill                                                       */
  /* ------------------------------------------------------------------ */
  var PILL = {
    local:      { t: 'LOCAL',      cls: ''     },
    connecting: { t: 'CONNECTING', cls: 'busy' },
    online:     { t: 'SYNCED',     cls: 'ok'   },
    syncing:    { t: 'SYNCING',    cls: 'busy' },
    offline:    { t: 'OFFLINE',    cls: 'warn' }
  };

  function setStatus(s) {
    NS.status = s;
    var p = PILL[s] || PILL.local, el = $('supa-pill');
    if (el) {
      el.textContent = p.t;
      el.className = 'supa-pill' + (p.cls ? ' ' + p.cls : '');
      el.title = s === 'local'
        ? 'Local only — Supabase connect karne ke liye click karo'
        : 'Supabase sync: ' + s;
    }
    var msg = $('supa-msg');
    if (msg && msg.dataset.live === '1') msg.textContent = 'Status: ' + p.t.toLowerCase();
    if (NS.onUser) NS.onUser(NS.user);
  }

  function setUser(u) {
    NS.user = u || null;
    if (NS.onUser) NS.onUser(NS.user);
  }

  /* ------------------------------------------------------------------ */
  /*  Change ledger (nexus:syncmeta)                                    */
  /*                                                                    */
  /*  Local rows ka apna updated_at nahi hota — agar hum seedha remote  */
  /*  ke updated_at se compare karein to har pull local edit ko mita    */
  /*  dega. Isliye har row ka JSON signature + last-change time yahan   */
  /*  rakhte hain. Merge ka rule: jo taraf ZYADA NAYI hai wo jeettee    */
  /*  hai — local edit naya ho to local, remote naya ho to remote.       */
  /* ------------------------------------------------------------------ */
  var META_KEY = 'nexus:syncmeta';
  var meta = (function () {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch (e) { return {}; }
  })();

  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* full ya disabled */ }
  }
  function metaFor(table) { return meta[table] || (meta[table] = {}); }
  function sigOf(v) { try { return JSON.stringify(v); } catch (e) { return ''; } }

  /* sirf wahi rows stamp karo jinme asli badlav aaya ho */
  function stampRows(table, pairs) {
    var box = metaFor(table), changed = false;
    pairs.forEach(function (p) {
      var id = String(p[0] == null ? '' : p[0]);
      if (!id) return;
      var sig = sigOf(p[1]), e = box[id];
      if (!e || e.sig !== sig) { box[id] = { sig: sig, t: Date.now() }; changed = true; }
    });
    if (changed) saveMeta();
  }

  /* Store.set hone par turant bulao (debounce ke bahar) */
  function noteChange(key) {
    var m = MAP[key];
    if (m) {
      stampRows(m.table, localRows(key).map(function (r) { return [m.idOf(r), r]; }));
      return;
    }
    if (key === 'syllabusState') {
      var obj = Store.get('syllabusState', {}) || {};
      stampRows(SYL.table, Object.keys(obj).map(function (ch) { return [ch, obj[ch]]; }));
    }
  }

  function localStamp(table, id) {
    var box = meta[table];
    var e = box ? box[String(id)] : null;
    return e ? e.t : 0;
  }

  function rememberServer(table, id, value, serverUpdatedAt) {
    var box = metaFor(table);
    box[String(id)] = {
      sig: sigOf(value),
      t: serverUpdatedAt ? new Date(serverUpdatedAt).getTime() : Date.now()
    };
    saveMeta();
  }

  /* ------------------------------------------------------------------ */
  /*  Local <-> remote row conversion                                   */
  /* ------------------------------------------------------------------ */
  function localRows(key) {
    var v;
    if (key === 'syllabusState') v = Store.get('syllabusState', {});
    else v = Store.get(key, []);
    return isArr(v) ? v : [];
  }

  function toRow(m, r) {
    if (!isObj(r)) return null;
    var id = m.idOf(r);
    if (!id) return null;
    var row = { id: String(id), user_id: NS.user ? NS.user.id : null };
    for (var f in m.fields) {
      if (!Object.prototype.hasOwnProperty.call(m.fields, f)) continue;
      var v = r[f];
      row[m.fields[f]] = v === undefined ? null : v;
    }
    return row;
  }

  function fromRow(m, row) {
    var out = { id: row.id };
    for (var f in m.fields) {
      if (!Object.prototype.hasOwnProperty.call(m.fields, f)) continue;
      var col = m.fields[f];
      if (row[col] !== undefined) out[f] = row[col];
    }
    // sessions ka local shape stable rakho
    if (m.table === 'sessions') delete out.id;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Remote operations                                                 */
  /* ------------------------------------------------------------------ */
  function remoteIds(m) {
    return NS.client.from(m.table).select('id')
      .then(function (res) {
        if (res.error) throw res.error;
        return (res.data || []).map(function (r) { return r.id; });
      });
  }

  function remoteRows(m) {
    return NS.client.from(m.table).select('*')
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  function upsertRows(m, payload) {
    if (!payload.length) return Promise.resolve();
    return NS.client.from(m.table)
      .upsert(payload, { onConflict: 'user_id,id' })
      .then(function (res) {
        if (res.error) throw res.error;
        return res;
      });
  }

  function deleteRows(m, ids) {
    if (!ids.length) return Promise.resolve();
    return NS.client.from(m.table).delete().in('id', ids)
      .then(function (res) {
        if (res.error) throw res.error;
        return res;
      });
  }

  /* ------------------------------------------------------------------ */
  /*  Push: local -> remote (aur remote pe jo local me nahi, wo delete)  */
  /* ------------------------------------------------------------------ */
  function pushNow(key) {
    var m = MAP[key];
    if (!m || !online()) return Promise.resolve(false);

    var payload = localRows(key).map(function (r) { return toRow(m, r); }).filter(Boolean);
    var localIds = payload.map(function (p) { return p.id; });

    setStatus('syncing');
    return remoteIds(m).then(function (ids) {
      var stale = ids.filter(function (id) { return localIds.indexOf(id) < 0; });
      return deleteRows(m, stale).then(function () { return upsertRows(m, payload); });
    }).then(function () {
      // syllabus_progress: object keyed by chapter id
      setStatus('online');
      NS.log('push', key, payload.length, 'rows');
      return true;
    }).catch(function (e) {
      NS.log('push failed', key, e && e.message ? e.message : e);
      setStatus('offline');
      return false;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Pull: remote -> local merge (per-row newer updated_at jeetta hai)  */
  /* ------------------------------------------------------------------ */
  function pullNow(key) {
    var m = MAP[key];
    if (!m || !online()) return Promise.resolve(false);

    setStatus('syncing');
    return remoteRows(m).then(function (rows) {
      var local = localRows(key);
      var byId = {};
      rows.forEach(function (row) {
        byId[String(row.id)] = row;
      });

      var out = local.slice();
      var used = {};
      var adopted = 0;
      out = out.map(function (l) {
        var id = String(m.idOf(l) || '');
        var row = byId[id];
        if (!row) return l;
        used[id] = 1;
        var lt = localStamp(m.table, id);        // ledger se — local ka asli change time
        var rt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        if (lt >= rt) return l;                  // local naya (ya barabar) -> local rakho
        var merged = fromRow(m, row);
        rememberServer(m.table, id, merged, row.updated_at);
        adopted++;
        return merged;
      });
      // remote-only rows local me add karo
      rows.forEach(function (row) {
        var id = String(row.id);
        if (used[id]) return;
        var merged = fromRow(m, row);
        out.push(merged);
        rememberServer(m.table, id, merged, row.updated_at);
        adopted++;
      });
      NS.log('merge', key, 'remote rows', rows.length, 'adopted', adopted);

      // loop guard: Store.set se bridge dobara push na kare
      NS.suppress = true;
      try { Store.set(key, out); } finally { NS.suppress = false; }

      NS.log('pull', key, rows.length, 'remote ->', out.length, 'local');
      setStatus('online');
      return true;
    }).catch(function (e) {
      NS.log('pull failed', key, e && e.message ? e.message : e);
      setStatus('offline');
      return false;
    });
  }

  /* syllabusState: { chapterId: [[0,0,0,0], ...] } -> syllabus_progress rows */
  var SYL = {
    table: 'syllabus_progress',
    idField: 'chapter_id',
    payloadField: 'topic_states'
  };

  function sylPayload() {
    var obj = Store.get('syllabusState', {}) || {};
    var out = [];
    for (var ch in obj) {
      var st = obj[ch];
      if (!st) continue;
      out.push({ id: String(ch), user_id: NS.user.id, topic_states: st });
    }
    return out;
  }

  function pushSyllabus() {
    if (!online()) return Promise.resolve(false);
    var payload = sylPayload();
    var localIds = payload.map(function (p) { return p.id; });
    setStatus('syncing');
    return NS.client.from(SYL.table).select('id')
      .then(function (res) {
        if (res.error) throw res.error;
        var ids = (res.data || []).map(function (r) { return r.id; });
        var stale = ids.filter(function (id) { return localIds.indexOf(id) < 0; });
        var chain = Promise.resolve();
        if (stale.length) chain = chain.then(function () {
          return NS.client.from(SYL.table).delete().in('id', stale).then(function (r) { if (r.error) throw r.error; });
        });
        if (payload.length) chain = chain.then(function () {
          return NS.client.from(SYL.table).upsert(payload, { onConflict: 'user_id,id' })
            .then(function (r) { if (r.error) throw r.error; });
        });
        return chain;
      })
      .then(function () { setStatus('online'); return true; })
      .catch(function (e) { NS.log('push syllabus failed', e && e.message); setStatus('offline'); return false; });
  }

  function pullSyllabus() {
    if (!online()) return Promise.resolve(false);
    setStatus('syncing');
    return NS.client.from(SYL.table).select('*').then(function (res) {
      if (res.error) throw res.error;
      var obj = Store.get('syllabusState', {}) || {};
      var touched = false;
      (res.data || []).forEach(function (row) {
        var rt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        var known = Object.prototype.hasOwnProperty.call(obj, row.id);
        if (known && localStamp(SYL.table, row.id) >= rt) return;   // local naya -> chhodo
        obj[row.id] = row.topic_states || [];
        rememberServer(SYL.table, row.id, obj[row.id], row.updated_at);
        touched = true;
      });
      if (touched) {
        NS.suppress = true;
        try { Store.set('syllabusState', obj); } finally { NS.suppress = false; }
      }
      setStatus('online');
      return true;
    }).catch(function (e) { NS.log('pull syllabus failed', e && e.message); setStatus('offline'); return false; });
  }

  /* ------------------------------------------------------------------ */
  /*  Profile (name / xp / examDate) <-> profiles row                    */
  /* ------------------------------------------------------------------ */
  function pushProfile() {
    if (!online()) return Promise.resolve(false);
    var row = {
      id: NS.user.id,
      name: Store.get('name', '') || '',
      avatar_url: (NS.user.user_metadata && NS.user.user_metadata.avatar_url) || null,
      xp: +Store.get('xp', 0) || 0,
      exam_date: Store.get('examDate', '') || null,
      updated_at: new Date().toISOString()
    };
    return NS.client.from('profiles').upsert(row, { onConflict: 'id' })
      .then(function (res) { if (res.error) throw res.error; return true; })
      .catch(function (e) { NS.log('push profile failed', e && e.message); return false; });
  }

  function pullProfile() {
    if (!online()) return Promise.resolve(false);
    return NS.client.from('profiles').select('*').eq('id', NS.user.id).maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        var p = res.data;
        if (!p) return pushProfile();
        NS.suppress = true;
        try {
          if (p.name) Store.set('name', p.name);
          if (p.xp != null) Store.set('xp', +p.xp || 0);
          if (p.exam_date) Store.set('examDate', p.exam_date);
        } finally { NS.suppress = false; }
        return true;
      })
      .catch(function (e) { NS.log('pull profile failed', e && e.message); return false; });
  }

  /* ------------------------------------------------------------------ */
  /*  Orchestration                                                     */
  /* ------------------------------------------------------------------ */
  function pushKey(key) {
    if (key === 'syllabusState') return pushSyllabus();
    if (key === 'name' || key === 'xp' || key === 'examDate') return pushProfile();
    return pushNow(key);
  }

  function syncKey(key) {
    if (key === 'syllabusState') return pullSyllabus().then(pushSyllabus);
    if (key === 'name' || key === 'xp' || key === 'examDate') return pullProfile();
    return pullNow(key).then(function () { return pushNow(key); });
  }

  function syncAll() {
    if (!online()) {
      setStatus(hasKeys() ? (NS.user ? 'offline' : 'local') : 'local');
      return Promise.resolve(false);
    }
    var chain = Promise.resolve();
    chain = chain.then(pullProfile);
    SYNC_KEYS.forEach(function (k) {
      chain = chain.then(function () { return syncKey(k); });
    });
    chain = chain.then(function () { return pullSyllabus().then(pushSyllabus); });
    chain = chain.then(function () { return pushProfile(); });
    return chain.then(function () {
      setStatus('online');
      NS.log('full sync done');
      return true;
    });
  }

  /* store.js se aane wala debounced push */
  function push(key) {
    var keys = key ? [key] : SYNC_KEYS;
    keys.forEach(function (k) {
      if (!MAP[k] && k !== 'syllabusState' && k !== 'name' && k !== 'xp' && k !== 'examDate') return;
      if (!online()) return;                    // offline -> localStorage hi kaafi hai,
      if (timers[k]) clearTimeout(timers[k]);   //                          online hone par syncAll chalega
      timers[k] = setTimeout(function () {
        timers[k] = null;
        pushKey(k);
      }, 800);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Auth                                                              */
  /* ------------------------------------------------------------------ */
  function signInWithGoogle() {
    makeClient();
    if (!NS.client) {
      uiMessage(hasKeys() ? CDN_MSG : 'Pehle Project URL + anon key connect karo.', 'warn');
      return;
    }
    if (!navigator.onLine) { uiMessage('Google login ke liye internet chahiye.', 'warn'); return; }
    var redirectTo = window.location.origin + window.location.pathname;
    if (window.location.protocol === 'file:') {
      // file:// pe OAuth redirect wapas nahi aa sakta — local server chalao
      uiMessage('file:// pe Google login nahi chalta. `python -m http.server 8080` chala kar http://localhost:8080 kholo.', 'warn');
      return;
    }
    setStatus('connecting');
    NS.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo, queryParams: { prompt: 'select_account' } }
    }).then(function (res) {
      if (res && res.error) { setStatus('local'); uiMessage(res.error.message, 'warn'); }
      // warna browser redirect ho chuka hai — wapas aane par detectSessionInUrl session pakad lega
    }).catch(function (e) {
      setStatus('local');
      uiMessage(e && e.message ? e.message : String(e), 'warn');
    });
  }

  function signOut() {
    if (!NS.client) { setUser(null); setStatus('local'); renderPanel(); return; }
    var savedUser = NS.user;
    NS.client.auth.signOut().then(function () {
      setUser(null);
      setStatus('local');
      renderPanel();
      tintLocal(savedUser);
    }).catch(function (e) { NS.log('signOut failed', e && e.message); });
  }

  /* Sign-out ke baad us user ka data localStorage me na dikhe — warna dusra
     banda same browser pe pichle user ka data dekh lega. */
  var LOCAL_KEYS = ['tasks', 'sessions', 'tests', 'mistakes', 'lectures', 'syllabusState', 'milestones'];
  function tintLocal(prevUser) {
    if (!prevUser) return;
    var owner = localStorage.getItem('nexus:owner');
    if (owner && owner !== prevUser.id) return;
    localBackup(prevUser.id);
    NS.suppress = true;
    try { LOCAL_KEYS.forEach(function (k) { Store.set(k, k === 'syllabusState' ? {} : []); }); }
    finally { NS.suppress = false; }
    NS.log('local data cleared for', prevUser.email);
  }

  function localBackup(uid) {
    var dump = {};
    LOCAL_KEYS.forEach(function (k) { dump[k] = Store.get(k, null); });
    try { localStorage.setItem('nexus:backup:' + uid, JSON.stringify(dump)); } catch (e) {}
  }

  function onAuthReady(session) {
    if (session && session.user) {
      var prev = localStorage.getItem('nexus:owner');
      var switched = prev && prev !== session.user.id;
      localStorage.setItem('nexus:owner', session.user.id);
      if (switched) {
        // dusre account ka data dikhane se pehle local saaf karo, phir remote pull
        NS.suppress = true;
        try { LOCAL_KEYS.forEach(function (k) { Store.set(k, k === 'syllabusState' ? {} : []); }); }
        finally { NS.suppress = false; }
      }
      setUser(session.user);
      setStatus('online');
      renderPanel();
      syncAll();
    } else {
      setUser(null);
      setStatus(hasKeys() ? 'offline' : 'local');
      renderPanel();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Panel UI (same dark theme)                                        */
  /* ------------------------------------------------------------------ */
  function uiMessage(msg, cls) {
    var el = $('supa-msg');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'nexus-auth-status' + (cls ? ' ' + cls : '');
  }

  function setupBlock() {
    return '' +
      '<div class="nexus-auth-divider"></div>' +
      '<div class="nexus-auth-card-h"><span>Project keys</span></div>' +
      '<form class="nexus-auth-form" id="supa-form">' +
        '<input class="nexus-auth-input" id="supa-url" placeholder="Project URL  (https://xxxx.supabase.co)" autocomplete="off" spellcheck="false">' +
        '<input class="nexus-auth-input" id="supa-key" placeholder="anon public key" autocomplete="off" spellcheck="false">' +
        '<input class="nexus-auth-input" id="supa-goog-id" placeholder="Google OAuth Client ID (optional)" autocomplete="off" spellcheck="false">' +
        '<button type="submit" class="nexus-auth-btn nexus-auth-btn--p" id="supa-connect">Save &amp; connect</button>' +
      '</form>' +
      '<div class="nexus-auth-foot">' +
        '<small>Keys sirf is browser ke localStorage me rehti hain.</small>' +
        '<button class="nexus-auth-link" id="supa-clear">Clear keys</button>' +
      '</div>';
  }

  function renderPanel() {
    var ov = $('supa-overlay');
    if (!ov) return;
    var html, msg = '';

    if (NS.user) {
      var md = NS.user.user_metadata || {};
      html = '' +
        '<div class="nexus-auth">' +
          '<div class="nexus-auth-card">' +
            '<div class="nexus-auth-logo"><i></i><div><b>NEXUS JEE</b><small>Supabase sync</small></div></div>' +
            '<div class="nexus-auth-divider"></div>' +
            '<div class="nexus-auth-me">' +
              '<div class="nexus-auth-avatar">' +
                (md.avatar_url ? '<img src="' + esc(md.avatar_url) + '" alt="">' : '<i></i>') +
              '</div>' +
              '<div>' +
                '<div class="nexus-auth-name">' + esc(md.full_name || NS.user.email || 'User') + '</div>' +
                '<div class="nexus-auth-email">' + esc(NS.user.email || '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="nexus-auth-status" id="supa-msg" data-live="1">Status: ' + esc(NS.status) + '</div>' +
            '<div class="nexus-auth-rows">' +
              '<button class="nexus-auth-btn nexus-auth-btn--p" id="supa-syncnow">Sync now</button>' +
              '<button class="nexus-auth-btn nexus-auth-btn--anon" id="supa-signout">Sign out</button>' +
            '</div>' +
            '<div class="nexus-auth-foot"><small>Har change pehle offline save hota hai, phir cloud pe.</small>' +
              '<button class="nexus-auth-link" id="supa-close">Close</button></div>' +
          '</div>' +
        '</div>';
    } else {
      html = '' +
        '<div class="nexus-auth">' +
          '<div class="nexus-auth-card">' +
            '<div class="nexus-auth-logo"><i></i><div><b>NEXUS JEE</b><small>Command Center</small></div></div>' +
            '<p class="nexus-auth-sub">Google se login karo — padhai ka data device aur cloud, dono me safe. Offline bhi sab chalta rahega.</p>' +
            '<button class="nexus-auth-btn" id="supa-google">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.49H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.56 3.3-4.49 6.16-4.49z"/></svg>' +
              '<span>Continue with Google</span>' +
            '</button>' +
            '<div class="nexus-auth-rows" style="margin-top:10px">' +
              '<button class="nexus-auth-btn nexus-auth-btn--anon" id="supa-offline">' +
                '<span>Sirf offline use karo</span>' +
              '</button>' +
            '</div>' +
            '<div class="nexus-auth-status" id="supa-msg" class="' + (hasKeys() ? 'ok' : '') + '">' +
              (hasKeys() ? 'Keys saved — Google login ready.' : 'Supabase project abhi connect nahi hua.') +
            '</div>' +
            '<ol class="nexus-auth-steps">' +
              '<li><b>app.supabase.com</b> pe naya project banao</li>' +
              '<li><b>Auth → Providers → Google</b> on karo (Client ID + secret)</li>' +
              '<li><b>Auth → URL Configuration</b> me apna URL add karo</li>' +
              '<li><b>SQL Editor</b> me <b>supabase-schema.sql</b> chalao</li>' +
              '<li>Neeche <b>Project URL + anon key</b> paste karo</li>' +
            '</ol>' +
            (hasKeys() ? '' : setupBlock()) +
            '<div class="nexus-auth-foot"><small>Poora guide: <b>SUPABASE-GUIDE.md</b></small>' +
              '<button class="nexus-auth-link" id="supa-close">Close</button></div>' +
          '</div>' +
        '</div>';
    }

    ov.innerHTML = html;
    bindPanel();
  }

  function bindPanel() {
    var close = $('supa-close');
    if (close) close.addEventListener('click', closePanel);

    var off = $('supa-offline');
    if (off) off.addEventListener('click', closePanel);

    var g = $('supa-google');
    if (g) g.addEventListener('click', function () {
      var form = $('supa-form');
      if (form) saveFromForm(form);
      signInWithGoogle();
    });

    var sn = $('supa-syncnow');
    if (sn) sn.addEventListener('click', function () {
      uiMessage('Syncing…', '');
      syncAll().then(function (ok) {
        uiMessage(ok ? 'Synced ✓ — sab collections cloud pe.' : 'Sync nahi hua — internet/login check karo.', ok ? 'ok' : 'warn');
      });
    });

    var so = $('supa-signout');
    if (so) so.addEventListener('click', signOut);

    var form = $('supa-form');
    if (form) {
      var c = NS.config;
      $('supa-url').value = c.url || '';
      $('supa-key').value = c.anonKey || '';
      $('supa-goog-id').value = c.googleId || '';
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        saveFromForm(form);
        makeClient();
        renderPanel();
        if (NS.client) {
          var s = $('supa-msg');
          if (s) { s.textContent = 'Connected ✓ — ab Google se login karo.'; s.className = 'nexus-auth-status ok'; }
        } else {
          var t = $('supa-msg');
          if (t) { t.textContent = CDN_MSG; t.className = 'nexus-auth-status warn'; }
        }
      });
    }

    var cl = $('supa-clear');
    if (cl) cl.addEventListener('click', function () {
      saveConfig({ url: '', anonKey: '', googleId: '' });
      NS.client = null;
      NS.clientUrl = null;
      renderPanel();
    });
  }

  function saveFromForm(form) {
    var u = $('supa-url'), k = $('supa-key'), g = $('supa-goog-id');
    if (!u || !k) return;
    saveConfig({
      url: (u.value || '').trim().replace(/\/+$/, ''),
      anonKey: (k.value || '').trim(),
      googleId: g ? (g.value || '').trim() : ''
    });
  }

  function buildPanel() {
    if ($('supa-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'supa-overlay';
    ov.style.display = 'none';
    ov.addEventListener('click', function (e) { if (e.target === ov) closePanel(); });
    document.body.appendChild(ov);
    renderPanel();
  }

  function openPanel() {
    buildPanel();
    renderPanel();
    var ov = $('supa-overlay');
    if (ov) ov.style.display = '';
  }

  function closePanel() {
    var ov = $('supa-overlay');
    if (ov) ov.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                              */
  /* ------------------------------------------------------------------ */
  function applyConfigToClient() {
    loadConfig();
    makeClient();
    if (!NS.client) {
      setStatus(hasKeys() ? 'offline' : 'local');
      return false;
    }
    setStatus('connecting');
    return true;
  }

  function init() {
    if (ready) return NS;
    ready = true;

    loadConfig();
    makeClient();

    // header pill click -> panel
    var pill = $('supa-pill');
    if (pill) {
      pill.style.cursor = 'pointer';
      pill.addEventListener('click', function () { openPanel(); });
    }

    buildPanel();

    if (!NS.client) {
      setStatus(hasKeys() ? 'offline' : 'local');
      if (!hasKeys()) NS.log('Supabase keys nahi mile — app local-only mode me chal raha hai.');
      return NS;
    }

    setStatus('connecting');

    // auth listener
    var res = NS.client.auth.onAuthStateChange(function (ev, session) {
      if (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED' || ev === 'INITIAL_SESSION') {
        onAuthReady(session);
      } else if (ev === 'SIGNED_OUT') {
        setUser(null);
        setStatus('local');
        renderPanel();
      } else if (ev === 'USER_UPDATED') {
        setUser(session ? session.user : null);
      }
    });
    authSub = res && res.data ? res.data.subscription : null;

    // shuru me session check (redirect ke baad yahi session pakadta hai)
    NS.client.auth.getSession().then(function (r) {
      onAuthReady(r && r.data ? r.data.session : null);
    }).catch(function (e) { NS.log('getSession failed', e && e.message); });

    // internet wapas aaya -> pending sync
    window.addEventListener('online', function () {
      NS.log('back online — syncing');
      syncAll();
    });
    window.addEventListener('offline', function () {
      setStatus(NS.user ? 'offline' : 'local');
    });

    return NS;
  }

  /* merge karte waqt page refresh ki zaroorat na pade — Store subscribers
     (app.js / pages) already UI update kar dete hain, kuch extra nahi chahiye */

  NS.init = init;
  NS.noteChange = noteChange;
  NS.push = push;
  NS.pull = function (key) { return pullNow(key); };
  NS.syncKey = syncKey;
  NS.syncAll = syncAll;
  NS.onAuth = function (fn) { NS.onUser = fn; if (fn) fn(NS.user); };
  NS.signInWithGoogle = signInWithGoogle;
  NS.signOut = signOut;
  NS.openPanel = openPanel;
  NS.closePanel = closePanel;
  NS.refreshPanel = renderPanel;
  NS.hasKeys = hasKeys;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
