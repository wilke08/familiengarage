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

  const sessionKey = 'familiengarage-session-v2';
  let session = null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(sessionKey));
    if (saved && /^[a-f0-9]{64}$/.test(saved.token) && Date.parse(saved.expiresAt) > Date.now()) session = saved;
  } catch {
    // Ohne Session Storage bleibt die Sitzung ausschließlich im Arbeitsspeicher.
  }

  function clearSession() {
    session = null;
    try { window.sessionStorage.removeItem(sessionKey); } catch { /* Private Browser können Speicher sperren. */ }
  }

  function expireSession() {
    clearSession();
    window.dispatchEvent(new CustomEvent('family-session-expired'));
  }

  async function protectedRequest(name, parameters = {}) {
    if (!client || !session || Date.parse(session.expiresAt) <= Date.now()) {
      expireSession();
      return { data: null, error: { code: '42501', message: 'Bitte erneut anmelden.' } };
    }
    const requestedSession = session;
    const response = await client.rpc(name, { ...parameters, p_session_token: requestedSession.token });
    if (response.error?.code === '42501' && session === requestedSession) expireSession();
    return response;
  }

  window.FAMILY_GARAGE_BACKEND = Object.freeze({
    isSupabaseConfigured: Boolean(client),
    hasSession: () => Boolean(session && Date.parse(session.expiresAt) > Date.now()),
    async login(password) {
      if (!client) throw new Error('Die Verbindung zum Kalender ist noch nicht eingerichtet.');
      const { data, error } = await client.rpc('family_login', { p_password: password });
      if (error) throw new Error('Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.');
      if (data?.error) return data;
      if (!data || !/^[a-f0-9]{64}$/.test(data.session_token) || !(Date.parse(data.expires_at) > Date.now())) {
        throw new Error('Die Anmeldung konnte nicht bestätigt werden.');
      }
      session = { token: data.session_token, expiresAt: data.expires_at };
      try { window.sessionStorage.setItem(sessionKey, JSON.stringify(session)); } catch { /* Sitzung bleibt im Speicher. */ }
      return { success: true };
    },
    async logout() {
      const token = session?.token;
      clearSession();
      if (client && token) {
        const { error } = await client.rpc('family_logout', { p_session_token: token });
        if (error) throw new Error('Die Sitzung wurde auf diesem Gerät geschlossen. Die Server-Sitzung läuft spätestens nach 12 Stunden ab.');
      }
    },
    listReservations: () => protectedRequest('family_list_reservations'),
    createReservation: (draft) => protectedRequest('family_create_reservation', {
      p_car: draft.car, p_person: draft.person, p_start_time: draft.start_time,
      p_end_time: draft.end_time, p_is_all_day: draft.is_all_day, p_notes: draft.notes,
    }),
    deleteReservation: (id) => protectedRequest('family_delete_reservation', { p_id: id }),
    configurationError: hasSettings && !sdk
      ? "Das Supabase-SDK konnte nicht geladen werden. Bitte prüfe die Internetverbindung."
      : "",
  });
})();
