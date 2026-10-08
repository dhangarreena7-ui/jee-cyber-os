/* NEXUS JEE — store.js
   Chhota localStorage wrapper. Har key "nexus:" prefix ke saath save hoti hai
   (dusre apps/websites se takkar na ho) aur JSON serialize hoti hai, isliye
   string, number, object, array — sab store ho sakta hai.

   API:
     Store.get(key [, fallback])   -> saved value, ya fallback/null
     Store.set(key, value)         -> save + saare subscribers ko notify
     Store.subscribe(key, fn)      -> fn(value, key) har set() pe chalega;
                                      return value = unsubscribe function */

window.Store = (function () {
  var PREFIX = 'nexus:';
  var subs = {}; // key -> [fn, ...]

  function k(key) { return PREFIX + key; }

  function get(key, fallback) {
    try {
      var v = localStorage.getItem(k(key));
      if (v === null) return fallback === undefined ? null : fallback;
      return JSON.parse(v);
    } catch (e) {
      return fallback === undefined ? null : fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(k(key), JSON.stringify(value));
    } catch (e) { /* storage full ya disabled — app phir bhi chalta rahe */ }
    var list = subs[key];
    if (list) for (var i = 0; i < list.length; i++) {
      try { list[i](value, key); } catch (e) { /* ek subscriber fail ho to baaki chalein */ }
    }
    return value;
  }

  function subscribe(key, fn) {
    (subs[key] = subs[key] || []).push(fn);
    return function unsubscribe() {
      var list = subs[key] || [], i = list.indexOf(fn);
      if (i > -1) list.splice(i, 1);
    };
  }

  return { get: get, set: set, subscribe: subscribe };
})();

/* -------------------------------------------------------------------------
   Supabase sync bridge

   store.js app me sabse pehle load hota hai, supabase.js uske baad. Isliye
   yahan NexusSupabase ko capture NAHI karte — har push par window se fresh
   nikalte hain. Isse load order ka koi chakkar hi nahi bachta.

   Behaviour:
     • Store.set('tasks', ...)  ->  800ms debounce  ->  NexusSupabase.push('tasks')
     • app pehle localStorage me likhta hai, isliye internet na ho to bhi
       kuch nahi tootta — sirf push skip ho jaata hai.
     • NexusSupabase.suppress true ho (remote se merge ho raha hai) to push
       skip — warna infinite loop ban jaata.
   ------------------------------------------------------------------------- */
(function () {
  var SYNC_KEYS = [
    'tasks', 'sessions', 'tests', 'mistakes', 'lectures',
    'syllabusState', 'name', 'xp', 'examDate'
  ];
  var timers = {};

  function looksSyncable(key, value) {
    if (key === 'name' || key === 'xp' || key === 'examDate') return true;
    if (key === 'syllabusState') return value && typeof value === 'object';
    return Object.prototype.toString.call(value) === '[object Array]';
  }

  SYNC_KEYS.forEach(function (key) {
    Store.subscribe(key, function (value) {
      var ns = window.NexusSupabase;                  // lazy — load order se free
      if (!ns || typeof ns.push !== 'function') return;
      if (ns.suppress) return;                        // merge se aaya write, wapas na bhejo
      if (!looksSyncable(key, value)) return;
      // turant stamp karo (pull se pehle bhi sahi tay ho jaaye ki ye badlav naya hai)
      if (typeof ns.noteChange === 'function') ns.noteChange(key);
      if (timers[key]) clearTimeout(timers[key]);
      timers[key] = setTimeout(function () {
        timers[key] = null;
        var cur = window.NexusSupabase;
        if (cur && typeof cur.push === 'function') cur.push(key);
      }, 800);
    });
  });
})();

