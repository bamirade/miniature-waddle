/**
 * Common client utilities for both student and host pages
 * Reduces duplication and provides reusable patterns
 */

(function initClientUtils() {
  'use strict';

  /**
   * Phase manager for toggling visibility of phase containers
   */
  class PhaseManager {
    constructor(phaseElements) {
      this.phases = phaseElements || {};
    }

    show(phaseName) {
      Object.keys(this.phases).forEach((key) => {
        const element = this.phases[key];
        if (element) {
          element.classList.toggle('hidden', key !== phaseName);
        }
      });
    }

    hide(phaseName) {
      const element = this.phases[phaseName];
      if (element) {
        element.classList.add('hidden');
      }
    }

    hideAll() {
      Object.values(this.phases).forEach((element) => {
        if (element) {
          element.classList.add('hidden');
        }
      });
    }
  }

  /**
   * Connection status indicator manager
   */
  class ConnectionStatusManager {
    constructor(statusElement, textElement) {
      this.statusElement = statusElement;
      this.textElement = textElement;
      this.statusTexts = {
        connecting: 'Connecting...',
        connected: 'Live',
        disconnected: 'Disconnected'
      };
    }

    update(status) {
      if (!this.statusElement || !this.textElement) return;

      this.statusElement.className = `connection-status ${status}`;
      this.textElement.textContent = this.statusTexts[status] || 'Unknown';
    }

    setStatus(status, text) {
      if (text) {
        this.statusTexts[status] = text;
      }
      this.update(status);
    }
  }

  /**
   * Countdown timer manager
   */
  class TimerManager {
    constructor(displayElement) {
      this.displayElement = displayElement;
      this.intervalId = null;
      this.endTime = null;
      this.onTick = null;
      this.onComplete = null;
    }

    start(endsAt, options = {}) {
      this.stop();

      this.endTime = endsAt;
      this.onTick = options.onTick || null;
      this.onComplete = options.onComplete || null;

      if (this.displayElement) {
        this.displayElement.classList.remove('hidden', 'critical');
      }

      this.intervalId = setInterval(() => {
        if (!this.endTime) {
          this.stop();
          return;
        }

        const now = Date.now();
        const remaining = Math.max(0, Math.ceil((this.endTime - now) / 1000));

        // Update display
        if (this.displayElement) {
          this.displayElement.textContent = `${remaining}s`;

          if (remaining <= 3) {
            this.displayElement.classList.add('critical');
          }
        }

        // Call tick callback
        if (this.onTick) {
          this.onTick(remaining);
        }

        // Check if complete
        if (remaining === 0) {
          this.stop();
          if (this.onComplete) {
            this.onComplete();
          }
        }
      }, 100);
    }

    stop() {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      if (this.displayElement) {
        this.displayElement.classList.add('hidden');
      }
      this.endTime = null;
    }

    isRunning() {
      return this.intervalId !== null;
    }
  }

  /**
   * Socket event handler builder
   * Provides fluent API for setting up socket listeners
   */
  class SocketEventBuilder {
    constructor(socket) {
      this.socket = socket;
    }

    on(eventName, handler) {
      this.socket.on(eventName, handler);
      return this;
    }

    once(eventName, handler) {
      this.socket.once(eventName, handler);
      return this;
    }

    emit(eventName, data) {
      this.socket.emit(eventName, data);
      return this;
    }
  }

  /**
   * DOM helper utilities
   */
  const DOM = {
    /**
     * Get element by ID with optional error handling
     */
    getById(id, required = false) {
      const element = document.getElementById(id);
      if (!element && required) {
        console.error(`Required element not found: #${id}`);
      }
      return element;
    },

    /**
     * Get multiple elements by IDs
     */
    getByIds(ids) {
      const elements = {};
      ids.forEach(id => {
        elements[id] = document.getElementById(id);
      });
      return elements;
    },

    /**
     * Create element with properties
     */
    create(tag, props = {}) {
      const element = document.createElement(tag);
      Object.keys(props).forEach(key => {
        if (key === 'className') {
          element.className = props[key];
        } else if (key === 'textContent') {
          element.textContent = props[key];
        } else if (key === 'innerHTML') {
          element.innerHTML = props[key];
        } else {
          element.setAttribute(key, props[key]);
        }
      });
      return element;
    },

    /**
     * Clear element's children
     */
    clear(element) {
      if (element) {
        element.innerHTML = '';
      }
    }
  };

  /**
   * Debounce function calls
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Throttle function calls
   */
  function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  // Export to global scope
  window.ClientUtils = {
    PhaseManager,
    ConnectionStatusManager,
    TimerManager,
    SocketEventBuilder,
    DOM,
    debounce,
    throttle
  };
})();
