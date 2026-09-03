(() => {
  const config = window.FAMILY_GARAGE_CONFIG || {};
  const hasSettings =
    typeof config.SUPABASE_URL === "string" &&
    config.SUPABASE_URL.startsWith("https://") &&
    typeof config.SUPABASE_ANON_KEY === "string" &&
    config.SUPABASE_ANON_KEY.trim().length > 20;
  const sdk = window.supabase;
  const client = hasSettings && sdk
    ? sdk.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  window.FAMILY_GARAGE_BACKEND = Object.freeze({
    isSupabaseConfigured: Boolean(client),
    supabase: client,
    configurationError: hasSettings && !sdk
      ? "Das Supabase-SDK konnte nicht geladen werden. Bitte prüfe die Internetverbindung."
      : "",
  });
})();
