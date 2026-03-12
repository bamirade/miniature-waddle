const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const CONFIG_PATH = path.join(REPO_ROOT, 'src', 'config.js');
const GAME_STATE_PATH = path.join(REPO_ROOT, 'src', 'game', 'state.js');
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

function assertArrayEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}`);
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

function getTextList(document, selector) {
  return Array.from(document.querySelectorAll(selector)).map((element) => element.textContent.trim());
}

function dispatchKey(window, key) {
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  window.document.dispatchEvent(event);
}

function getLatestPick(socket) {
  for (let index = socket.emitted.length - 1; index >= 0; index -= 1) {
    const entry = socket.emitted[index];
    if (entry.eventName === 'player:pick') {
      return entry;
    }
  }

  return null;
}

function withTemporaryLabelSet(labelSet, callback) {
  const previousLabelSet = process.env.GAME_LABEL_SET;

  if (typeof labelSet === 'string') {
    process.env.GAME_LABEL_SET = labelSet;
  } else {
    delete process.env.GAME_LABEL_SET;
  }

  delete require.cache[CONFIG_PATH];
  delete require.cache[GAME_STATE_PATH];

  try {
    return callback();
  } finally {
    delete require.cache[CONFIG_PATH];
    delete require.cache[GAME_STATE_PATH];

    if (typeof previousLabelSet === 'string') {
      process.env.GAME_LABEL_SET = previousLabelSet;
    } else {
      delete process.env.GAME_LABEL_SET;
    }
  }
}

function loadConfigWithLabelSet(labelSet) {
  return withTemporaryLabelSet(labelSet, () => require(CONFIG_PATH));
}

function assertConfigLabelSetParsing() {
  const defaultConfig = loadConfigWithLabelSet(undefined);
  assertCondition(defaultConfig.game.labelSet === 'true_false', 'default config labelSet should be true_false');

  const yesNoConfig = loadConfigWithLabelSet('yes_no');
  assertCondition(yesNoConfig.game.labelSet === 'yes_no', 'GAME_LABEL_SET=yes_no should select yes_no label set');

  const invalidConfig = loadConfigWithLabelSet('invalid_label_set');
  assertCondition(invalidConfig.game.labelSet === 'true_false', 'invalid GAME_LABEL_SET should fall back to true_false');
}

function assertEngineRoundProjection(labelSet, expectedOptions) {
  withTemporaryLabelSet(labelSet, () => {
    const gameStateModule = require(GAME_STATE_PATH);
    const playerId = `smoke-${labelSet}-student`;
    const state = gameStateModule.createGameState();

    assertCondition(state.labelSet === labelSet, `${labelSet} game state labelSet mismatch`);

    const addResult = gameStateModule.addPlayer(state, playerId, 'Smoke Student');
    assertCondition(addResult && addResult.ok, `${labelSet} addPlayer should succeed`);

    const readyResult = gameStateModule.setReady(state, playerId);
    assertCondition(readyResult && readyResult.ok, `${labelSet} setReady should succeed`);

    const startResult = gameStateModule.startGame(state);
    assertCondition(startResult && startResult.ok, `${labelSet} startGame should succeed`);

    gameStateModule.tick(state, state.phaseEndsAt);
    assertCondition(state.phase === gameStateModule.PHASES.ROUND, `${labelSet} should reach round phase after countdown tick`);

    const publicRound = gameStateModule.getPublicRoundState(state);
    assertCondition(publicRound && publicRound.question, `${labelSet} public round should include a question`);
    assertArrayEqual(publicRound.question.options, expectedOptions, `${labelSet} round options projection mismatch`);
    assertCondition(publicRound.question.answerIndex === undefined, `${labelSet} live round should not expose answerIndex`);
    assertCondition(Array.isArray(publicRound.capacities) && publicRound.capacities.length === expectedOptions.length, `${labelSet} capacities length mismatch`);
    assertCondition(Array.isArray(publicRound.slotsLeft) && publicRound.slotsLeft.length === expectedOptions.length, `${labelSet} slotsLeft length mismatch`);
  });
}

function getExpectedRuntimeLabelSet() {
  const normalized = String(process.env.GAME_LABEL_SET || 'true_false').trim().toLowerCase();
  return normalized === 'yes_no' ? 'yes_no' : 'true_false';
}

function assertRoundLabels(hostRuntime, studentRuntime, expectedKeys, expectedOptions, label) {
  const hostFlashKeys = getTextList(hostRuntime.window.document, '.flash-option-label');
  const hostRoundKeys = getTextList(hostRuntime.window.document, '#options-display .option-label');
  const studentKeys = getTextList(studentRuntime.window.document, '#options-container .option-label');
  const studentTexts = getTextList(studentRuntime.window.document, '#options-container .option-text');

  assertArrayEqual(hostFlashKeys, expectedKeys, `${label} host flash option keys mismatch`);
  assertArrayEqual(hostRoundKeys, expectedKeys, `${label} host round option keys mismatch`);
  assertArrayEqual(studentKeys, expectedKeys, `${label} student option keys mismatch`);
  assertArrayEqual(studentTexts, expectedOptions, `${label} student option text mismatch`);
}

async function runBrowserLabelCase({
  baseUrl,
  label,
  options,
  expectedKeys,
  keyboardKey,
  expectedPickedOption,
  expectedConfigLabelSet,
}) {
  const hostSocket = new FakeSocket(`host-${label}`);
  const studentSocket = new FakeSocket(`student-${label}`);

  const hostRuntime = await createPageRuntime({
    label: `host-${label}`,
    htmlPath: HOST_HTML_PATH,
    scriptPath: HOST_SCRIPT_PATH,
    pagePath: '/host',
    baseUrl,
    socket: hostSocket,
  });

  const studentRuntime = await createPageRuntime({
    label: `student-${label}`,
    htmlPath: STUDENT_HTML_PATH,
    scriptPath: STUDENT_SCRIPT_PATH,
    pagePath: '/student',
    baseUrl,
    socket: studentSocket,
    beforeEval: (window) => {
      window.localStorage.setItem('nickname', `Smoke Student ${label}`);
    },
  });

  try {
    hostSocket.id = `host-${label}-1`;
    studentSocket.id = `student-${label}-1`;

    hostSocket.trigger('connect');
    studentSocket.trigger('connect');
    await sleep(UI_SETTLE_MS);

    const configResponse = await hostRuntime.window.fetch('/config').then((response) => response.json());
    if (expectedConfigLabelSet) {
      assertCondition(
        configResponse && configResponse.labelSet === expectedConfigLabelSet,
        `${label} /config labelSet mismatch`
      );
    }

    const lobby = {
      phase: 'lobby',
      totalPlayers: 1,
      readyCount: 1,
      aliveCount: 1,
      canStart: true,
      players: [
        {
          id: studentSocket.id,
          name: `Smoke Student ${label}`,
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
        text: '7 + 5 equals 12.',
        options,
        answerIndex: 0,
      },
      capacities: [1, 1],
      pickedCounts: [0, 0],
      slotsLeft: [1, 1],
      endsAt: Date.now() + 400,
    };

    const results = {
      phase: 'finished',
      reason: 'last-player-standing',
      top: [
        {
          rank: 1,
          id: studentSocket.id,
          name: `Smoke Student ${label}`,
          status: 'alive',
          eliminatedRound: null,
          eliminationReason: null,
        },
      ],
      leaderboard: [
        {
          rank: 1,
          id: studentSocket.id,
          name: `Smoke Student ${label}`,
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

    assertRoundLabels(hostRuntime, studentRuntime, expectedKeys, options, label);

    dispatchKey(studentRuntime.window, keyboardKey);
    await sleep(UI_SETTLE_MS);

    const latestPick = getLatestPick(studentSocket);
    assertCondition(latestPick, `${label} keyboard shortcut did not emit player:pick`);
    assertCondition(
      latestPick.payload && latestPick.payload.option === expectedPickedOption,
      `${label} keyboard shortcut picked wrong option`
    );

    hostSocket.trigger('round:update', {
      type: 'slots',
      capacities: round.capacities,
      pickedCounts: expectedPickedOption === 0 ? [1, 0] : [0, 1],
      slotsLeft: expectedPickedOption === 0 ? [0, 1] : [1, 0],
    });
    studentSocket.trigger('round:update', {
      type: 'slots',
      slotsLeft: expectedPickedOption === 0 ? [0, 1] : [1, 0],
    });
    studentSocket.trigger('game:roundSlots', {
      slotsLeft: expectedPickedOption === 0 ? [0, 1] : [1, 0],
    });
    await sleep(UI_SETTLE_MS);

    hostSocket.trigger('round:update', {
      type: 'reveal',
      question: round.question,
      pickedByOption: expectedPickedOption === 0 ? [[studentSocket.id], []] : [[], [studentSocket.id]],
    });
    hostSocket.trigger('game:state', {
      phase: 'reveal',
      round,
      lobby,
    });

    studentSocket.trigger('game:state', { phase: 'reveal' });
    studentSocket.trigger('game:roundReveal', {
      roundNumber: 1,
      question: round.question,
      pickedByOption: expectedPickedOption === 0 ? [[studentSocket.id], []] : [[], [studentSocket.id]],
      eliminatedThisRound: [],
      lostLivesThisRound: [],
    });
    await sleep(UI_SETTLE_MS);

    const hostRevealKeys = getTextList(hostRuntime.window.document, '#options-display .reveal-option-bar .option-label');
    const studentRevealValues = getTextList(studentRuntime.window.document, '.reveal-row-value');
    assertArrayEqual(hostRevealKeys, expectedKeys, `${label} host reveal option keys mismatch`);
    assertCondition(
      studentRevealValues.some((value) => value.startsWith(`${expectedKeys[expectedPickedOption]} -`) || value.startsWith(`${expectedKeys[expectedPickedOption]} —`)),
      `${label} student reveal card did not use expected option key`
    );

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
    assertCondition(hostResultsCard, `${label} host results card element missing`);
    assertCondition(!hostResultsCard.classList.contains('hidden'), `${label} host results card should be visible in finished phase`);

    const studentResultsPhase = studentRuntime.window.document.getElementById('phase-results');
    assertCondition(studentResultsPhase, `${label} student results phase element missing`);
    assertCondition(!studentResultsPhase.classList.contains('hidden'), `${label} student results phase should be visible in finished phase`);

    assertNoBlockingDiagnostics(hostRuntime.diagnostics);
    assertNoBlockingDiagnostics(studentRuntime.diagnostics);
  } finally {
    hostRuntime.dom.window.close();
    studentRuntime.dom.window.close();
  }
}

async function runBrowserConsoleFlow(context) {
  const { baseUrl } = context;
  const expectedRuntimeLabelSet = getExpectedRuntimeLabelSet();

  assertConfigLabelSetParsing();
  assertEngineRoundProjection('true_false', ['True', 'False']);
  assertEngineRoundProjection('yes_no', ['Yes', 'No']);

  await runBrowserLabelCase({
    baseUrl,
    label: 'true_false',
    options: ['True', 'False'],
    expectedKeys: ['T', 'F'],
    keyboardKey: 't',
    expectedPickedOption: 0,
    expectedConfigLabelSet: expectedRuntimeLabelSet,
  });

  await runBrowserLabelCase({
    baseUrl,
    label: 'true_false_numeric',
    options: ['True', 'False'],
    expectedKeys: ['T', 'F'],
    keyboardKey: '2',
    expectedPickedOption: 1,
    expectedConfigLabelSet: expectedRuntimeLabelSet,
  });

  await runBrowserLabelCase({
    baseUrl,
    label: 'yes_no',
    options: ['Yes', 'No'],
    expectedKeys: ['Y', 'N'],
    keyboardKey: 'y',
    expectedPickedOption: 0,
    expectedConfigLabelSet: expectedRuntimeLabelSet,
  });

  await runBrowserLabelCase({
    baseUrl,
    label: 'yes_no_negative',
    options: ['Yes', 'No'],
    expectedKeys: ['Y', 'N'],
    keyboardKey: 'n',
    expectedPickedOption: 1,
    expectedConfigLabelSet: expectedRuntimeLabelSet,
  });

  await runBrowserLabelCase({
    baseUrl,
    label: 'yes_no_numeric',
    options: ['Yes', 'No'],
    expectedKeys: ['Y', 'N'],
    keyboardKey: '2',
    expectedPickedOption: 1,
    expectedConfigLabelSet: expectedRuntimeLabelSet,
  });
}

module.exports = {
  name: 'browserConsoleFlow',
  run: runBrowserConsoleFlow,
};
