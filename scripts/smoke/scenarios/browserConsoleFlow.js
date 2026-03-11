const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const UI_SETTLE_MS = 40;

const HOST_HTML_PATH = path.join(PUBLIC_DIR, 'host.html');
const HOST_SCRIPT_PATH = path.join(PUBLIC_DIR, 'host.js');
const STUDENT_HTML_PATH = path.join(PUBLIC_DIR, 'student.html');
const STUDENT_SCRIPT_PATH = path.join(PUBLIC_DIR, 'student.js');

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch (serializationError) {
    return String(error);
  }
}

function formatConsoleArgs(args) {
  return args
    .map((value) => {
      if (value instanceof Error) {
        return value.stack || value.message;
      }

      if (typeof value === 'string') {
        return value;
      }

      try {
        return JSON.stringify(value);
      } catch (serializationError) {
        return String(value);
      }
    })
    .join(' ');
}

class FakeSocket {
  constructor(label) {
    this.label = label;
    this.id = `${label}-socket`;
    this.connected = false;
    this.handlers = new Map();
    this.emitted = [];
  }

  on(eventName, handler) {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }

    this.handlers.get(eventName).add(handler);
    return this;
  }

  once(eventName, handler) {
    const onceHandler = (payload) => {
      this.off(eventName, onceHandler);
      handler(payload);
    };

    return this.on(eventName, onceHandler);
  }

  off(eventName, handler) {
    const listeners = this.handlers.get(eventName);
    if (!listeners) {
      return this;
    }

    listeners.delete(handler);
    if (listeners.size === 0) {
      this.handlers.delete(eventName);
    }

    return this;
  }

  emit(eventName, payload) {
    this.emitted.push({ eventName, payload });
    return this;
  }

  trigger(eventName, payload) {
    if (eventName === 'connect') {
      this.connected = true;
    }

    if (eventName === 'disconnect') {
      this.connected = false;
    }

    const listeners = this.handlers.get(eventName);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of Array.from(listeners)) {
      listener(payload);
    }
  }

  disconnect() {
    this.connected = false;
  }

  close() {
    this.connected = false;
  }
}

function buildFetch(baseUrl) {
  return async function fetchWithBase(input, init) {
    let target = input;

    if (typeof input === 'string' || input instanceof URL) {
      target = new URL(String(input), baseUrl).toString();
    } else if (input && typeof input.url === 'string') {
      target = new URL(input.url, baseUrl).toString();
    }

    return fetch(target, init);
  };
}

async function createPageRuntime(options) {
  const {
    label,
    htmlPath,
    scriptPath,
    pagePath,
    baseUrl,
    socket,
    beforeEval,
  } = options;

  const [htmlSource, scriptSource] = await Promise.all([
    fs.readFile(htmlPath, 'utf8'),
    fs.readFile(scriptPath, 'utf8'),
  ]);

  const dom = new JSDOM(htmlSource, {
    url: new URL(pagePath, baseUrl).toString(),
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const diagnostics = {
    label,
    consoleErrors: [],
    consoleWarnings: [],
    runtimeErrors: [],
  };

  const originalConsole = window.console;
  window.console = {
    ...originalConsole,
    error: (...args) => {
      diagnostics.consoleErrors.push(formatConsoleArgs(args));
    },
    warn: (...args) => {
      diagnostics.consoleWarnings.push(formatConsoleArgs(args));
    },
  };

  window.addEventListener('error', (event) => {
    diagnostics.runtimeErrors.push(normalizeError(event.error || event.message));
  });

  window.addEventListener('unhandledrejection', (event) => {
    diagnostics.runtimeErrors.push(normalizeError(event.reason));
  });

  window.io = () => socket;
  window.fetch = buildFetch(baseUrl);
  window.appCommon = {
    showToast: () => {},
  };
  window.alert = () => {};

  // Prevent navigation side effects in test runtime.
  if (window.location && typeof window.location.assign === 'function') {
    window.location.assign = () => {};
  }

  if (label === 'host') {
    window.QRCode = function QRCode() {};
    window.QRCode.CorrectLevel = { M: 'M' };
    window.AISimulation = undefined;
  }

  if (typeof beforeEval === 'function') {
    beforeEval(window);
  }

  window.eval(scriptSource);
  await sleep(UI_SETTLE_MS);

  return {
    dom,
    window,
    diagnostics,
  };
}

function assertNoBlockingDiagnostics(diagnostics) {
  if (diagnostics.consoleErrors.length === 0 && diagnostics.runtimeErrors.length === 0) {
    return;
  }

  const details = [];
  if (diagnostics.consoleErrors.length > 0) {
    details.push(`console errors: ${diagnostics.consoleErrors.join(' | ')}`);
  }
  if (diagnostics.runtimeErrors.length > 0) {
    details.push(`runtime errors: ${diagnostics.runtimeErrors.join(' | ')}`);
  }

  throw new Error(`${diagnostics.label} page emitted blocking diagnostics: ${details.join(' ; ')}`);
}

async function runBrowserConsoleFlow(context) {
  const { baseUrl } = context;

  const hostSocket = new FakeSocket('host');
  const studentSocket = new FakeSocket('student');

  const hostRuntime = await createPageRuntime({
    label: 'host',
    htmlPath: HOST_HTML_PATH,
    scriptPath: HOST_SCRIPT_PATH,
    pagePath: '/host',
    baseUrl,
    socket: hostSocket,
  });

  const studentRuntime = await createPageRuntime({
    label: 'student',
    htmlPath: STUDENT_HTML_PATH,
    scriptPath: STUDENT_SCRIPT_PATH,
    pagePath: '/student',
    baseUrl,
    socket: studentSocket,
    beforeEval: (window) => {
      window.localStorage.setItem('nickname', 'Smoke Student');
    },
  });

  try {
    hostSocket.id = 'host-1';
    studentSocket.id = 'student-1';

    hostSocket.trigger('connect');
    studentSocket.trigger('connect');
    await sleep(UI_SETTLE_MS);

    const lobby = {
      phase: 'lobby',
      totalPlayers: 1,
      readyCount: 1,
      aliveCount: 1,
      canStart: true,
      players: [
        {
          id: 'student-1',
          name: 'Smoke Student',
          ready: true,
          status: 'alive',
          lives: 3,
          eliminatedRound: null,
          eliminationReason: null,
        },
      ],
    };

    const round = {
      roundNumber: 1,
      question: {
        text: 'Which number is four?',
        options: ['1', '2', '3', '4'],
      },
      capacities: [1, 1, 1, 1],
      pickedCounts: [0, 0, 0, 0],
      slotsLeft: [1, 1, 1, 1],
      endsAt: Date.now() + 400,
    };

    const results = {
      phase: 'finished',
      reason: 'last-player-standing',
      top: [
        {
          rank: 1,
          id: 'student-1',
          name: 'Smoke Student',
          status: 'alive',
          eliminatedRound: null,
          eliminationReason: null,
        },
      ],
      leaderboard: [
        {
          rank: 1,
          id: 'student-1',
          name: 'Smoke Student',
          status: 'alive',
          eliminatedRound: null,
          eliminationReason: null,
        },
      ],
      totalPlayers: 1,
      aliveCount: 1,
    };

    hostSocket.trigger('lobby:update', lobby);
    studentSocket.trigger('lobby:update', { phase: 'lobby', totalPlayers: 1 });
    await sleep(UI_SETTLE_MS);

    const countdownState = {
      phase: 'countdown',
      countdown: { secondsLeft: 3 },
      lobby,
    };

    hostSocket.trigger('game:state', countdownState);
    studentSocket.trigger('game:state', countdownState);
    studentSocket.trigger('game:countdownStarted', { secondsLeft: 3 });
    studentSocket.trigger('game:countdownTick', { secondsLeft: 2 });
    await sleep(UI_SETTLE_MS);

    const roundState = {
      phase: 'round',
      round,
      lobby,
    };

    hostSocket.trigger('game:state', roundState);
    hostSocket.trigger('round:new', round);
    studentSocket.trigger('game:state', roundState);
    studentSocket.trigger('game:roundStarted', round);
    await sleep(UI_SETTLE_MS);

    hostSocket.trigger('round:update', {
      type: 'slots',
      capacities: round.capacities,
      pickedCounts: [1, 0, 0, 0],
      slotsLeft: [0, 1, 1, 1],
    });
    studentSocket.trigger('round:update', {
      type: 'slots',
      slotsLeft: [0, 1, 1, 1],
    });
    studentSocket.trigger('game:roundSlots', {
      slotsLeft: [0, 1, 1, 1],
    });
    await sleep(UI_SETTLE_MS);

    hostSocket.trigger('round:update', {
      type: 'reveal',
      question: round.question,
      pickedByOption: [['student-1'], [], [], []],
    });
    hostSocket.trigger('game:state', {
      phase: 'reveal',
      round,
      lobby,
    });

    studentSocket.trigger('game:state', { phase: 'reveal' });
    studentSocket.trigger('game:roundReveal', { roundNumber: 1 });
    await sleep(UI_SETTLE_MS);

    hostSocket.trigger('game:results', results);
    hostSocket.trigger('game:state', {
      phase: 'finished',
      results,
      lobby,
    });

    studentSocket.trigger('game:results', results);
    studentSocket.trigger('game:state', {
      phase: 'finished',
      results,
    });
    studentSocket.trigger('game:finished', results);
    await sleep(UI_SETTLE_MS);

    const hostResultsCard = hostRuntime.window.document.getElementById('results-card');
    assertCondition(hostResultsCard, 'host results card element missing');
    assertCondition(!hostResultsCard.classList.contains('hidden'), 'host results card should be visible in finished phase');

    const studentResultsPhase = studentRuntime.window.document.getElementById('phase-results');
    assertCondition(studentResultsPhase, 'student results phase element missing');
    assertCondition(!studentResultsPhase.classList.contains('hidden'), 'student results phase should be visible in finished phase');

    assertNoBlockingDiagnostics(hostRuntime.diagnostics);
    assertNoBlockingDiagnostics(studentRuntime.diagnostics);
  } finally {
    hostRuntime.dom.window.close();
    studentRuntime.dom.window.close();
  }
}

module.exports = {
  name: 'browserConsoleFlow',
  run: runBrowserConsoleFlow,
};
