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
      if (message) {
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 500);
      }
    }

    // Real-time validation feedback
    input.addEventListener('input', () => {
      const nickname = normalizeNickname(input.value);
      if (nickname.length > 0 && !isValidNickname(nickname)) {
        if (nickname.length < MIN_NICKNAME_LENGTH) {
          setError(`At least ${MIN_NICKNAME_LENGTH} characters required`);
        } else if (nickname.length > MAX_NICKNAME_LENGTH) {
          setError(`Maximum ${MAX_NICKNAME_LENGTH} characters`);
        }
      } else {
        setError('');
      }
    });

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

      // Show loading state
      button.disabled = true;
      button.textContent = 'Joining...';

      // Redirect to student page - it will handle the socket connection and joining
      window.location.assign(STUDENT_ROUTE);
    });
  }

  window.appCommon = {
    version: '0.2.0',
    normalizeNickname,
    isValidNickname,
    showToast
  };

  // Toast Notification System
  let toastContainer = null;

  function showToast(message, type = 'info', duration = 3000) {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    toastContainer.appendChild(toast);

    // Auto-dismiss after duration
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
        // Clean up container if empty
        if (toastContainer && toastContainer.children.length === 0) {
          toastContainer.remove();
          toastContainer = null;
        }
      }, 300);
    }, duration);

    // Allow manual dismiss by clicking
    toast.addEventListener('click', () => {
      toast.classList.add('hiding');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    });

    return toast;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJoinPage);
  } else {
    initJoinPage();
  }
})();
