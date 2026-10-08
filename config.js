/* NEXUS JEE — Supabase auto-config (default keys)
   -------------------------------------------------------------------
   Is file me apne Supabase project ki keys daalo. Yeh values sabhi
   browsers/devices par default ke roop me load hoti hain, isliye naye
   device par "setup" screen nahi aayega.

   Zaroori:
     • Yahan sirf "anon public" key daalna — SERVICE_ROLE key KABHI nahi.
       anon key browser me dikhna normal hai (RLS usse protect karta hai).
     • Ye defaults sirf tab use hote hain jab us browser me
       localStorage ki config (nexus:supabase) na ho. Agar user ne
       manually keys save ki hain, to wahi override karti hain.

   Key paste karne ke baad kuch aur badalne ki zaroorat nahi — page
   reload karo, app khud connect ho jayegi.
   ------------------------------------------------------------------- */
(function () {
  'use strict';

  /* 1) Project URL — Supabase Dashboard → Settings → API → Project URL */
  var NEXUS_SUPABASE_URL = 'https://rwksneloozypxkwjngji.supabase.co';

  /* 2) anon public key — Supabase Dashboard → Settings → API → Project API keys → anon public */
  var NEXUS_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3a3NuZWxvb3p5cHhrd2puZ2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMjA3ODIsImV4cCI6MjEwNjg5Njc4Mn0.0VNsi1lktp8anY4uFv6jgPnKh5qT3LbhPg4gce7zUVY';

  /* 3) (Optional) Google OAuth Client ID — panel me prefill ke liye */
  var NEXUS_SUPABASE_GOOGLE_ID = '';

  var PLACEHOLDER = 'PASTE_ANON_PUBLIC_KEY_HERE';

  function val(v) {
    v = (v || '').trim();
    if (!v || v === PLACEHOLDER) return '';
    return v;
  }

  var url = val(NEXUS_SUPABASE_URL);
  var anonKey = val(NEXUS_SUPABASE_ANON_KEY);

  window.NEXUS_SUPABASE_CONFIG = {
    url: url,
    anonKey: anonKey,
    googleId: val(NEXUS_SUPABASE_GOOGLE_ID)
  };

  /* Key paste karna baaki hai? to app safely local-only mode me chalegi. */
  if (url && !anonKey) {
    try {
      console.warn('[NEXUS JEE] config.js line 24: anon public key abhi placeholder hai — app local-only mode me chal rahi hai. Us line par apna "anon public" key paste karo.');
    } catch (e) {}
  }
})();
