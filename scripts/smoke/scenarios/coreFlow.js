const { io } = require('socket.io-client');

const CONNECT_TIMEOUT_MS = 8_000;
const EVENT_TIMEOUT_MS = 8_000;
const FINISH_TIMEOUT_MS = 25_000;

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertLeaderboardEntry(entry, label) {
  assertCondition(entry && typeof entry === 'object', `${label} must be an object`);
  assertCondition(Number.isInteger(entry.rank) && entry.rank > 0, `${label} rank must be a positive integer`);
  assertCondition(typeof entry.id === 'string' && entry.id.length > 0, `${label} id must be a non-empty string`);
  assertCondition(typeof entry.name === 'string' && entry.name.length > 0, `${label} name must be a non-empty string`);
  assertCondition(typeof entry.status === 'string' && entry.status.length > 0, `${label} status must be a non-empty string`);
  assertCondition(
    entry.eliminatedRound === null || Number.isInteger(entry.eliminatedRound),
    `${label} eliminatedRound must be null or integer`
  );
  assertCondition(
    entry.eliminationReason === null || typeof entry.eliminationReason === 'string',
    `${label} eliminationReason must be null or string`
  );
}

function waitForEvent(socket, eventName, predicate, timeoutMs, description) {
  return new Promise((resolve, reject) => {
    const onEvent = (payload) => {
      try {
        if (typeof predicate === 'function' && !predicate(payload)) {
          return;
        }
        cleanup();
        resolve(payload);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${description || eventName}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off(eventName, onEvent);
    }

    socket.on(eventName, onEvent);
  });
}

function connectClient(baseUrl, label) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });

    const timer = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error(`${label} connect timeout`));
    }, CONNECT_TIMEOUT_MS + 500);

    function cleanup() {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    }

    function onConnect() {
      cleanup();
      resolve(socket);
    }

    function onConnectError(error) {
      cleanup();
      socket.close();
      reject(new Error(`${label} failed to connect: ${error.message}`));
    }

    socket.once('connect', onConnect);
    socket.once('connect_error', onConnectError);
  });
}

function disconnectClient(socket) {
  if (!socket) {
    return;
  }

  if (socket.connected) {
    socket.disconnect();
    return;
  }

  socket.close();
}

async function runCoreFlow(context) {
  const { requestJson, requestText, baseUrl } = context;

  const config = await requestJson('/config', 5_000);
  assertCondition(config && typeof config === 'object', '/config must return a JSON object');
  assertCondition(Object.prototype.hasOwnProperty.call(config, 'port'), '/config missing required key: port');
  assertCondition(Object.prototype.hasOwnProperty.call(config, 'hostIp'), '/config missing required key: hostIp');
  assertCondition(Object.prototype.hasOwnProperty.call(config, 'joinUrl'), '/config missing required key: joinUrl');
  assertCondition(Object.prototype.hasOwnProperty.call(config, 'version'), '/config missing required key: version');
  assertCondition(Object.prototype.hasOwnProperty.call(config, 'timings'), '/config missing required key: timings');
  assertCondition(Object.prototype.hasOwnProperty.call(config, 'startPolicy'), '/config missing required key: startPolicy');
  assertCondition(Number.isInteger(config.port) && config.port > 0, '/config port must be a positive integer');
  assertCondition(typeof config.hostIp === 'string' && config.hostIp.length > 0, '/config hostIp must be a non-empty string');
  assertCondition(typeof config.joinUrl === 'string' && config.joinUrl.length > 0, '/config joinUrl must be a non-empty string');
  assertCondition(typeof config.version === 'string' && config.version.length > 0, '/config version must be a non-empty string');
  assertCondition(config.timings && typeof config.timings.countdownMs === 'number', '/config timings must include countdownMs');
  assertCondition(config.startPolicy && config.startPolicy.initialLaunchRequiresReady === true, '/config startPolicy should require ready launch');

  const health = await requestJson('/health', 5_000);
  assertCondition(health && health.status === 'ok', '/health must report ok status');
  assertCondition(health.phase === 'lobby', '/health should report lobby before the game starts');
  assertCondition(typeof health.uptimeMs === 'number' && health.uptimeMs >= 0, '/health uptimeMs must be a non-negative number');

  const qrSvg = await requestText('/qr.svg', 5_000);
  assertCondition(qrSvg.includes('<svg'), '/qr.svg must return SVG markup');

  const hostPage = await requestText('/host', 5_000);
  assertCondition(hostPage.includes('id="start-button"'), '/host did not return expected host dashboard markup');
  assertCondition(hostPage.includes('id="copy-join-button"'), '/host should expose copy join action');

  const hostSocket = await connectClient(baseUrl, 'host socket');
  const studentSocket = await connectClient(baseUrl, 'student socket');

  try {
    const joinedLobby = waitForEvent(
      hostSocket,
      'lobby:update',
      (payload) => {
        return payload && Array.isArray(payload.players) && payload.players.some((player) => player.name === 'Smoke Student');
      },
      EVENT_TIMEOUT_MS,
      'student lobby join update'
    );

    studentSocket.emit('player:join', { name: 'Smoke Student' });
    await joinedLobby;

    const blockedStart = waitForEvent(
      hostSocket,
      'player:result',
      (payload) => payload && payload.status === 'error' && /ready/i.test(payload.reason),
      EVENT_TIMEOUT_MS,
      'blocked host start before ready check-in'
    );

    hostSocket.emit('host:start', {});
    const blockedStartPayload = await blockedStart;
    assertCondition(/ready/i.test(blockedStartPayload.reason), 'host start should explain ready requirement');

    const readyLobby = waitForEvent(
      hostSocket,
      'lobby:update',
      (payload) => payload && typeof payload.readyCount === 'number' && payload.readyCount >= 1,
      EVENT_TIMEOUT_MS,
      'ready lobby update'
    );

    studentSocket.emit('player:ready', {});
    await readyLobby;

    const countdownState = waitForEvent(
      hostSocket,
      'game:state',
      (payload) => payload && payload.phase === 'countdown',
      EVENT_TIMEOUT_MS,
      'countdown game state after host start'
    );

    hostSocket.emit('host:start', {});

    const statePayload = await countdownState;
    assertCondition(
      statePayload.countdown && typeof statePayload.countdown.secondsLeft === 'number',
      'countdown payload missing secondsLeft'
    );

    const finishedResultsEvent = waitForEvent(
      hostSocket,
      'game:results',
      (payload) => payload && payload.phase === 'finished',
      FINISH_TIMEOUT_MS,
      'game finished results payload'
    );

    const finishedStateEvent = waitForEvent(
      hostSocket,
      'game:state',
      (payload) => payload && payload.phase === 'finished' && payload.results,
      FINISH_TIMEOUT_MS,
      'game finished state payload'
    );

    const finishedResults = await finishedResultsEvent;
    const finishedState = await finishedStateEvent;

    assertCondition(typeof finishedResults.reason === 'string' && finishedResults.reason.length > 0, 'finished payload missing reason');
    assertCondition(Array.isArray(finishedResults.top) && finishedResults.top.length > 0, 'finished payload missing winners in top');
    assertCondition(
      Array.isArray(finishedResults.leaderboard) && finishedResults.leaderboard.length >= finishedResults.top.length,
      'finished payload missing leaderboard entries'
    );
    assertCondition(
      Number.isInteger(finishedResults.totalPlayers) && finishedResults.totalPlayers === finishedResults.leaderboard.length,
      'finished payload totalPlayers mismatch'
    );
    assertCondition(
      Number.isInteger(finishedResults.aliveCount) && finishedResults.aliveCount >= 0,
      'finished payload aliveCount must be a non-negative integer'
    );

    assertLeaderboardEntry(finishedResults.top[0], 'top winner entry');
    assertLeaderboardEntry(finishedResults.leaderboard[0], 'leaderboard first entry');

    assertCondition(
      finishedState.results.reason === finishedResults.reason,
      'game:state results reason should match game:results reason'
    );
    assertCondition(
      Array.isArray(finishedState.results.top) && finishedState.results.top.length === finishedResults.top.length,
      'game:state results top should match game:results top length'
    );
  } finally {
    disconnectClient(studentSocket);
    disconnectClient(hostSocket);
  }
}

module.exports = {
  name: 'coreFlow',
  run: runCoreFlow,
};
