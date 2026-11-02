(() => {
  const backend = window.FAMILY_GARAGE_BACKEND;
  const screen = document.querySelector('#login-screen');
  const content = document.querySelector('#family-app');
  const form = document.querySelector('#login-form');
  const password = document.querySelector('#family-password');
  const submit = document.querySelector('#login-submit');
  const message = document.querySelector('#login-message');
  const logout = document.querySelector('#logout-button');
  let onUnlock;
  let onLock;
  let generation = 0;

  function showMessage(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  function lock(text = '') {
    generation += 1;
    content.hidden = true;
    screen.hidden = false;
    password.value = '';
    showMessage(text);
    onLock?.();
  }

  async function unlock() {
    const attempt = ++generation;
    const loaded = await onUnlock();
    if (loaded === false || attempt !== generation) return false;
    screen.hidden = true;
    content.hidden = false;
    window.dispatchEvent(new Event('resize'));
    document.querySelector('#new-reservation').focus();
    return true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    if (!password.value) {
      showMessage('Bitte gib das gemeinsame Familienpasswort ein.');
      password.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Wird geprüft …';
    showMessage('');
    try {
      const result = await backend.login(password.value);
      password.value = '';
      if (result.error === 'locked') {
        showMessage(`Zu viele Fehlversuche. Bitte in ${Math.max(1, Math.ceil(result.retry_after_seconds / 60))} Minuten erneut versuchen.`);
      } else if (result.error === 'not_configured') {
        showMessage('Der Passwortschutz wird noch eingerichtet. Bitte später erneut versuchen.');
      } else if (result.error) {
        showMessage('Das Passwort stimmt nicht. Bitte versuche es erneut.');
        password.focus();
      } else {
        await unlock();
      }
    } catch (error) {
      password.value = '';
      showMessage(error.message);
    } finally {
      submit.disabled = !backend.isSupabaseConfigured;
      submit.textContent = 'Kalender öffnen';
    }
  });

  logout.addEventListener('click', async () => {
    lock();
    password.focus();
    try { await backend.logout(); } catch (error) { showMessage(error.message); }
  });
  window.addEventListener('family-session-expired', () => lock('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'));
  window.FAMILY_GARAGE_AUTH = Object.freeze({
    async initialize(unlockCallback, lockCallback) {
      onUnlock = unlockCallback;
      onLock = lockCallback;
      if (!backend.isSupabaseConfigured) {
        submit.disabled = true;
        showMessage(backend.configurationError || 'Die sichere Kalenderverbindung ist noch nicht eingerichtet.');
        return;
      }
      if (backend.hasSession()) await unlock();
    },
  });
})();
