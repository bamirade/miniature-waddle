(function bootstrapCommon() {
  const MIN_NICKNAME_LENGTH = 2;
  const MAX_NICKNAME_LENGTH = 16;
  const STUDENT_ROUTE = '/student';

  function normalizeNickname(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function isValidNickname(value) {
    const normalized = normalizeNickname(value);
    return normalized.length >= MIN_NICKNAME_LENGTH && normalized.length <= MAX_NICKNAME_LENGTH;
  }

  function initJoinPage() {
    const form = document.getElementById('join-form');
    const input = document.getElementById('nickname');
    const errorEl = document.getElementById('join-error');
    const button = document.getElementById('join-button');

    if (!form || !input || !errorEl || !button) {
      return;
    }

    const savedName = window.localStorage.getItem('nickname') || '';
    if (savedName) {
      input.value = normalizeNickname(savedName).slice(0, MAX_NICKNAME_LENGTH);
    }

    function setError(message) {
      errorEl.textContent = message || '';
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();

      const nickname = normalizeNickname(input.value);
      if (!isValidNickname(nickname)) {
        setError('Nickname must be 2 to 16 characters.');
        input.focus();
        return;
      }

      setError('');
      input.value = nickname;
      window.localStorage.setItem('nickname', nickname);

      // Redirect to student page - it will handle the socket connection and joining
      window.location.assign(STUDENT_ROUTE);
    });
  }

  window.appCommon = {
    version: '0.2.0',
    normalizeNickname,
    isValidNickname
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJoinPage);
  } else {
    initJoinPage();
  }
})();
