const { getRandomQuestion } = require('./questions');

/**
 * Server-authoritative game engine.
 *
 * Event envelope returned by engine functions:
 * {
 *   name: string,
 *   scope: 'all' | 'player',
 *   to?: socketId,      // present only when scope === 'player'
 *   payload: object
 * }
 *
 * The server should emit events exactly as follows:
 * - scope 'all'    => io.emit(name, payload)
 * - scope 'player' => io.to(to).emit(name, payload)
 */

const PHASES = Object.freeze({
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  ROUND: 'round',
  REVEAL: 'reveal',
  FINISHED: 'finished'
});

const TIMINGS = Object.freeze({
  COUNTDOWN_MS: 3000,
  ROUND_OPEN_MS: 10000,
  REVEAL_MS: 2000
});

const EVENT_NAMES = Object.freeze({
  LOBBY_STATE: 'lobby:state',
  COUNTDOWN_STARTED: 'game:countdownStarted',
  COUNTDOWN_TICK: 'game:countdownTick',
  ROUND_STARTED: 'game:roundStarted',
  ROUND_SLOTS: 'game:roundSlots',
  PICK_RESULT: 'game:pickResult',
  PLAYER_ELIMINATED: 'game:playerEliminated',
  ROUND_REVEAL: 'game:roundReveal',
  GAME_FINISHED: 'game:finished'
});

const EVENT_PAYLOADS = Object.freeze({
  LOBBY_STATE: {
    phase: 'lobby',
    totalPlayers: 0,
    aliveCount: 0,
    readyCount: 0,
    canStart: false,
    players: [
      {
        id: 'socketId',
        name: 'Player',
        connectedAt: 0,
        ready: false,
        status: 'alive',
        eliminatedRound: null,
        eliminationReason: null
      }
    ]
  },
  COUNTDOWN_STARTED: {
    phase: 'countdown',
    roundNumber: 0,
    secondsLeft: 3,
    startedAt: 0,
    endsAt: 0
  },
  COUNTDOWN_TICK: {
    phase: 'countdown',
    roundNumber: 0,
    secondsLeft: 2,
    endsAt: 0
  },
  ROUND_STARTED: {
    phase: 'round',
    roundNumber: 1,
    aliveCount: 0,
    question: { id: 'q001', text: 'Question text', options: ['A', 'B', 'C', 'D'] },
    capacities: [0, 0, 0, 0],
    slotsLeft: [0, 0, 0, 0],
    pickedCounts: [0, 0, 0, 0],
    endsAt: 0
  },
  ROUND_SLOTS: {
    phase: 'round',
    roundNumber: 1,
    aliveCount: 0,
    capacities: [0, 0, 0, 0],
    slotsLeft: [0, 0, 0, 0],
    pickedCounts: [0, 0, 0, 0]
  },
  PICK_RESULT: {
    phase: 'round',
    roundNumber: 1,
    playerId: 'socketId',
    option: 0,
    status: 'accepted',
    reason: 'picked',
    eliminated: false,
    slotsLeft: [0, 0, 0, 0]
  },
  PLAYER_ELIMINATED: {
    roundNumber: 1,
    playerId: 'socketId',
    name: 'Player',
    reason: 'full',
    option: 0,
    at: 0
  },
  ROUND_REVEAL: {
    phase: 'reveal',
    roundNumber: 1,
    aliveCount: 0,
    question: { id: 'q001', text: 'Question text', options: ['A', 'B', 'C', 'D'], answerIndex: 0 },
    pickedByOption: [[], [], [], []],
    eliminatedThisRound: [
      { playerId: 'socketId', name: 'Player', reason: 'wrong', option: 1 }
    ],
    endsAt: 0
  },
  GAME_FINISHED: {
    phase: 'finished',
    reason: 'survivor_threshold',
    roundNumber: 4,
    aliveCount: 2,
    top: [
      {
        rank: 1,
        id: 'socketId',
        name: 'Player',
        status: 'alive',
        eliminatedRound: null,
        eliminationReason: null
      }
    ],
    leaderboard: []
  }
});

function createGameState() {
  // One room per server instance, in-memory only.
  return {
    phase: PHASES.LOBBY,
    createdAt: Date.now(),
    phaseStartedAt: null,
    phaseEndsAt: null,
    countdownSecondsLeft: null,
    roundNumber: 0,
    currentQuestion: null,
    capacities: [0, 0, 0, 0],
    pickedByOption: [[], [], [], []],
    lastRoundEliminations: [],
    players: {},
    usedQuestionIds: new Set(),
    leaderboard: [],
    _eliminationSeq: 0,
    _rng: Math.random
  };
}

function addPlayer(state, socketId, name) {
  if (!state || !socketId) {
    return { ok: false, reason: 'invalid_arguments', events: [] };
  }

  if (state.phase !== PHASES.LOBBY) {
    return { ok: false, reason: 'game_already_started', events: [] };
  }

  const player = {
    id: socketId,
    name: sanitizeName(name),
    connectedAt: Date.now(),
    ready: false,
    status: 'alive',
    eliminatedRound: null,
    eliminationReason: null,
    pickedOptionThisRound: null,
    lastPickAt: null,
    _eliminationOrder: null
  };

  state.players[socketId] = player;

  return {
    ok: true,
    reason: null,
    player,
    events: [eventAll(EVENT_NAMES.LOBBY_STATE, getPublicLobbyState(state))]
  };
}

function setReady(state, socketId) {
  const player = state && state.players ? state.players[socketId] : null;
  if (!player) {
    return { ok: false, reason: 'player_not_found', events: [] };
  }

  if (state.phase !== PHASES.LOBBY) {
    return { ok: false, reason: 'not_in_lobby', events: [] };
  }

  player.ready = true;

  return {
    ok: true,
    reason: null,
    events: [eventAll(EVENT_NAMES.LOBBY_STATE, getPublicLobbyState(state))]
  };
}

function removePlayer(state, socketId) {
  if (!state || !state.players || !state.players[socketId]) {
    return { ok: false, reason: 'player_not_found', events: [] };
  }

  delete state.players[socketId];

  const events = [];
  if (state.phase === PHASES.LOBBY) {
    events.push(eventAll(EVENT_NAMES.LOBBY_STATE, getPublicLobbyState(state)));
  } else if (state.phase === PHASES.ROUND || state.phase === PHASES.REVEAL || state.phase === PHASES.COUNTDOWN) {
    removePlayerFromRoundPicks(state, socketId);
    events.push(eventAll(EVENT_NAMES.ROUND_SLOTS, createRoundSlotsPayload(state)));
  }

  return { ok: true, reason: null, events };
}

function startGame(state) {
  // Host-only rule is enforced by server.js before this function is called.
  if (!state) {
    return { ok: false, reason: 'invalid_state', events: [] };
  }

  if (state.phase !== PHASES.LOBBY && state.phase !== PHASES.FINISHED) {
    return { ok: false, reason: 'game_in_progress', events: [] };
  }

  const players = listPlayers(state);
  if (players.length === 0) {
    return { ok: false, reason: 'no_players', events: [] };
  }

  // Reset all player states (whether starting fresh or restarting)
  for (const player of players) {
    player.status = 'alive';
    player.ready = false;
    player.eliminatedRound = null;
    player.eliminationReason = null;
    player.pickedOptionThisRound = null;
    player.lastPickAt = null;
    player._eliminationOrder = null;
  }

  state.roundNumber = 0;
  state.currentQuestion = null;
  state.capacities = [0, 0, 0, 0];
  state.pickedByOption = [[], [], [], []];
  state.lastRoundEliminations = [];
  state.usedQuestionIds.clear();
  state.leaderboard = [];
  state._eliminationSeq = 0;
  state.finishReason = null;

  const now = Date.now();
  state.phase = PHASES.COUNTDOWN;
  state.phaseStartedAt = now;
  state.phaseEndsAt = now + TIMINGS.COUNTDOWN_MS;
  state.countdownSecondsLeft = 3;

  return {
    ok: true,
    reason: null,
    events: [
      eventAll(EVENT_NAMES.LOBBY_STATE, getPublicLobbyState(state)),
      eventAll(EVENT_NAMES.COUNTDOWN_STARTED, {
        phase: state.phase,
        roundNumber: state.roundNumber,
        secondsLeft: 3,
        startedAt: state.phaseStartedAt,
        endsAt: state.phaseEndsAt
      })
    ]
  };
}

function handlePick(state, socketId, option) {
  // First-come-first-served is guaranteed by server arrival order.
  // Server should call handlePick synchronously per incoming socket event.
  const now = Date.now();
  const events = [];
  const optionIndex = normalizeOption(option);
  const player = state && state.players ? state.players[socketId] : null;

  if (!player) {
    return { ok: false, reason: 'player_not_found', events };
  }

  if (state.phase !== PHASES.ROUND) {
    events.push(eventPlayer(EVENT_NAMES.PICK_RESULT, socketId, {
      phase: state.phase,
      roundNumber: state.roundNumber,
      playerId: socketId,
      option: optionIndex,
      status: 'ignored',
      reason: 'phase_closed',
      eliminated: false,
      slotsLeft: getSlotsLeft(state)
    }));
    return { ok: false, reason: 'phase_closed', events };
  }

  if (player.status !== 'alive') {
    events.push(eventPlayer(EVENT_NAMES.PICK_RESULT, socketId, {
      phase: state.phase,
      roundNumber: state.roundNumber,
      playerId: socketId,
      option: optionIndex,
      status: 'ignored',
      reason: 'not_alive',
      eliminated: true,
      slotsLeft: getSlotsLeft(state)
    }));
    return { ok: false, reason: 'not_alive', events };
  }

  if (optionIndex === null) {
    events.push(eventPlayer(EVENT_NAMES.PICK_RESULT, socketId, {
      phase: state.phase,
      roundNumber: state.roundNumber,
      playerId: socketId,
      option: null,
      status: 'ignored',
      reason: 'invalid_option',
      eliminated: false,
      slotsLeft: getSlotsLeft(state)
    }));
    return { ok: false, reason: 'invalid_option', events };
  }

  if (player.pickedOptionThisRound !== null) {
    events.push(eventPlayer(EVENT_NAMES.PICK_RESULT, socketId, {
      phase: state.phase,
      roundNumber: state.roundNumber,
      playerId: socketId,
      option: optionIndex,
      status: 'ignored',
      reason: 'already_picked',
      eliminated: false,
      slotsLeft: getSlotsLeft(state)
    }));
    return { ok: false, reason: 'already_picked', events };
  }

  const alreadyPickedCount = state.pickedByOption[optionIndex].length;
  const capacity = state.capacities[optionIndex];

  if (alreadyPickedCount >= capacity) {
    player.pickedOptionThisRound = optionIndex;
    player.lastPickAt = now;

    const elimination = markPlayerEliminated(state, player, {
      reason: 'full',
      roundNumber: state.roundNumber,
      option: optionIndex,
      at: now
    });

    events.push(eventPlayer(EVENT_NAMES.PICK_RESULT, socketId, {
      phase: state.phase,
      roundNumber: state.roundNumber,
      playerId: socketId,
      option: optionIndex,
      status: 'eliminated',
      reason: 'full',
      eliminated: true,
      slotsLeft: getSlotsLeft(state)
    }));

    events.push(eventAll(EVENT_NAMES.PLAYER_ELIMINATED, elimination));
    events.push(eventAll(EVENT_NAMES.ROUND_SLOTS, createRoundSlotsPayload(state)));

    return { ok: true, reason: null, events };
  }

  state.pickedByOption[optionIndex].push(player.id);
  player.pickedOptionThisRound = optionIndex;
  player.lastPickAt = now;

  events.push(eventPlayer(EVENT_NAMES.PICK_RESULT, socketId, {
    phase: state.phase,
    roundNumber: state.roundNumber,
    playerId: socketId,
    option: optionIndex,
    status: 'accepted',
    reason: 'picked',
    eliminated: false,
    slotsLeft: getSlotsLeft(state)
  }));
  events.push(eventAll(EVENT_NAMES.ROUND_SLOTS, createRoundSlotsPayload(state)));

  return { ok: true, reason: null, events };
}

function tick(state, nowMs) {
  // tick drives all timed transitions:
  // countdown -> round -> reveal -> round/finished
  if (!state) {
    return [];
  }

  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const events = [];

  if (state.phase === PHASES.COUNTDOWN) {
    processCountdownTick(state, now, events);
  } else if (state.phase === PHASES.ROUND) {
    if (state.phaseEndsAt !== null && now >= state.phaseEndsAt) {
      closeRoundAndStartReveal(state, now, events);
    }
  } else if (state.phase === PHASES.REVEAL) {
    if (state.phaseEndsAt !== null && now >= state.phaseEndsAt) {
      if (shouldFinish(state)) {
        finishGame(state, getAliveCount(state) === 0 ? 'no_alive' : 'survivor_threshold');
        events.push(eventAll(EVENT_NAMES.GAME_FINISHED, getResults(state)));
      } else {
        startNextRound(state, now, events);
      }
    }
  }

  return events;
}

function getPublicLobbyState(state) {
  const players = listPlayers(state).map((player) => ({
    id: player.id,
    name: player.name,
    connectedAt: player.connectedAt,
    ready: player.ready,
    status: player.status,
    eliminatedRound: player.eliminatedRound,
    eliminationReason: player.eliminationReason
  }));

  const aliveCount = players.filter((player) => player.status === 'alive').length;
  const readyCount = players.filter((player) => player.ready).length;

  return {
    phase: state.phase,
    totalPlayers: players.length,
    aliveCount,
    readyCount,
    canStart: state.phase === PHASES.LOBBY && players.length > 0,
    players
  };
}

function getPublicRoundState(state) {
  const includeAnswer = state.phase === PHASES.REVEAL || state.phase === PHASES.FINISHED;

  return {
    phase: state.phase,
    roundNumber: state.roundNumber,
    aliveCount: getAliveCount(state),
    question: toPublicQuestion(state.currentQuestion, includeAnswer),
    capacities: [...state.capacities],
    slotsLeft: getSlotsLeft(state),
    pickedCounts: state.pickedByOption.map((pickedIds) => pickedIds.length),
    pickedByOption: state.pickedByOption.map((pickedIds) => [...pickedIds]),
    phaseStartedAt: state.phaseStartedAt,
    endsAt: state.phaseEndsAt,
    timings: {
      countdownMs: TIMINGS.COUNTDOWN_MS,
      roundOpenMs: TIMINGS.ROUND_OPEN_MS,
      revealMs: TIMINGS.REVEAL_MS
    }
  };
}

function getResults(state) {
  const ordered = listPlayers(state).sort(comparePlayersForLeaderboard);

  const leaderboard = ordered.map((player, index) => ({
    rank: index + 1,
    id: player.id,
    name: player.name,
    status: player.status,
    eliminatedRound: player.eliminatedRound,
    eliminationReason: player.eliminationReason
  }));

  return {
    phase: state.phase,
    reason: state.finishReason || null,
    roundNumber: state.roundNumber,
    totalPlayers: leaderboard.length,
    aliveCount: getAliveCount(state),
    top: leaderboard.slice(0, 3),
    leaderboard
  };
}

function processCountdownTick(state, now, events) {
  const msLeft = Math.max(0, state.phaseEndsAt - now);
  const computedSecondsLeft = Math.ceil(msLeft / 1000);

  if (computedSecondsLeft < state.countdownSecondsLeft) {
    for (let sec = state.countdownSecondsLeft - 1; sec >= Math.max(computedSecondsLeft, 1); sec -= 1) {
      events.push(eventAll(EVENT_NAMES.COUNTDOWN_TICK, {
        phase: state.phase,
        roundNumber: state.roundNumber,
        secondsLeft: sec,
        endsAt: state.phaseEndsAt
      }));
    }
    state.countdownSecondsLeft = computedSecondsLeft;
  }

  if (now >= state.phaseEndsAt) {
    startNextRound(state, now, events);
  }
}

function startNextRound(state, now, events) {
  const alivePlayers = getAlivePlayers(state);
  if (alivePlayers.length === 0) {
    finishGame(state, 'no_alive');
    events.push(eventAll(EVENT_NAMES.GAME_FINISHED, getResults(state)));
    return;
  }

  const question = getRandomQuestion(state.usedQuestionIds);
  state.usedQuestionIds.add(question.id);

  state.roundNumber += 1;
  state.currentQuestion = question;
  state.capacities = computeCapacities(alivePlayers.length, state._rng);
  state.pickedByOption = [[], [], [], []];
  state.lastRoundEliminations = [];

  for (const player of alivePlayers) {
    player.pickedOptionThisRound = null;
    player.lastPickAt = null;
  }

  state.phase = PHASES.ROUND;
  state.phaseStartedAt = now;
  state.phaseEndsAt = now + TIMINGS.ROUND_OPEN_MS;
  state.countdownSecondsLeft = null;

  events.push(eventAll(EVENT_NAMES.ROUND_STARTED, {
    phase: state.phase,
    roundNumber: state.roundNumber,
    aliveCount: alivePlayers.length,
    question: toPublicQuestion(state.currentQuestion, false),
    capacities: [...state.capacities],
    slotsLeft: getSlotsLeft(state),
    pickedCounts: [0, 0, 0, 0],
    endsAt: state.phaseEndsAt
  }));
}

function closeRoundAndStartReveal(state, now, events) {
  if (!state.currentQuestion) {
    return;
  }

  const eliminatedThisRound = [];

  const aliveBeforeTimeoutCheck = getAlivePlayers(state);
  for (const player of aliveBeforeTimeoutCheck) {
    if (player.pickedOptionThisRound === null) {
      const elimination = markPlayerEliminated(state, player, {
        reason: 'timeout',
        roundNumber: state.roundNumber,
        option: null,
        at: now
      });
      eliminatedThisRound.push(elimination);
      events.push(eventAll(EVENT_NAMES.PLAYER_ELIMINATED, elimination));
    }
  }

  const correctOption = state.currentQuestion.answerIndex;
  const aliveBeforeWrongCheck = getAlivePlayers(state);
  for (const player of aliveBeforeWrongCheck) {
    if (player.pickedOptionThisRound !== correctOption) {
      const elimination = markPlayerEliminated(state, player, {
        reason: 'wrong',
        roundNumber: state.roundNumber,
        option: player.pickedOptionThisRound,
        at: now
      });
      eliminatedThisRound.push(elimination);
      events.push(eventAll(EVENT_NAMES.PLAYER_ELIMINATED, elimination));
    }
  }

  state.lastRoundEliminations = eliminatedThisRound;
  state.phase = PHASES.REVEAL;
  state.phaseStartedAt = now;
  state.phaseEndsAt = now + TIMINGS.REVEAL_MS;

  events.push(eventAll(EVENT_NAMES.ROUND_REVEAL, {
    phase: state.phase,
    roundNumber: state.roundNumber,
    aliveCount: getAliveCount(state),
    question: toPublicQuestion(state.currentQuestion, true),
    pickedByOption: state.pickedByOption.map((pickedIds) => [...pickedIds]),
    eliminatedThisRound: eliminatedThisRound.map((entry) => ({
      playerId: entry.playerId,
      name: entry.name,
      reason: entry.reason,
      option: entry.option
    })),
    endsAt: state.phaseEndsAt
  }));
}

function shouldFinish(state) {
  return getAliveCount(state) <= 3;
}

function finishGame(state, reason) {
  state.phase = PHASES.FINISHED;
  state.phaseStartedAt = Date.now();
  state.phaseEndsAt = null;
  state.countdownSecondsLeft = null;
  state.finishReason = reason;
  state.leaderboard = getResults(state).leaderboard;
}

function createRoundSlotsPayload(state) {
  return {
    phase: state.phase,
    roundNumber: state.roundNumber,
    aliveCount: getAliveCount(state),
    capacities: [...state.capacities],
    slotsLeft: getSlotsLeft(state),
    pickedCounts: state.pickedByOption.map((pickedIds) => pickedIds.length)
  };
}

function markPlayerEliminated(state, player, details) {
  if (player.status !== 'alive') {
    return {
      roundNumber: details.roundNumber,
      playerId: player.id,
      name: player.name,
      reason: details.reason,
      option: details.option,
      at: details.at
    };
  }

  state._eliminationSeq += 1;
  player.status = 'eliminated';
  player.eliminatedRound = details.roundNumber;
  player.eliminationReason = details.reason;
  player._eliminationOrder = state._eliminationSeq;

  return {
    roundNumber: details.roundNumber,
    playerId: player.id,
    name: player.name,
    reason: details.reason,
    option: details.option,
    at: details.at
  };
}

function getAlivePlayers(state) {
  return listPlayers(state).filter((player) => player.status === 'alive');
}

function getAliveCount(state) {
  return getAlivePlayers(state).length;
}

function listPlayers(state) {
  return Object.values(state.players).sort((a, b) => {
    if (a.connectedAt !== b.connectedAt) {
      return a.connectedAt - b.connectedAt;
    }
    return a.id.localeCompare(b.id);
  });
}

function removePlayerFromRoundPicks(state, socketId) {
  for (const pickedIds of state.pickedByOption) {
    const index = pickedIds.indexOf(socketId);
    if (index >= 0) {
      pickedIds.splice(index, 1);
    }
  }
}

function computeCapacities(aliveCount, rngFn) {
  // Capacity rule:
  // A = aliveCount
  // base = floor(A/4), rem = A%4
  // capacities start [base, base, base, base]
  // rem extra slots go to random distinct options.
  const base = Math.floor(aliveCount / 4);
  const rem = aliveCount % 4;
  const capacities = [base, base, base, base];

  if (rem > 0) {
    const distinct = pickDistinctOptionIndices(rem, rngFn);
    for (const optionIndex of distinct) {
      capacities[optionIndex] += 1;
    }
  }

  return capacities;
}

function pickDistinctOptionIndices(count, rngFn) {
  const indexes = [0, 1, 2, 3];
  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rngFn() * (i + 1));
    const temp = indexes[i];
    indexes[i] = indexes[j];
    indexes[j] = temp;
  }
  return indexes.slice(0, count);
}

function getSlotsLeft(state) {
  return state.capacities.map((capacity, optionIndex) => {
    const pickedCount = state.pickedByOption[optionIndex].length;
    const value = capacity - pickedCount;
    return value > 0 ? value : 0;
  });
}

function toPublicQuestion(question, includeAnswer) {
  if (!question) {
    return null;
  }

  const out = {
    id: question.id,
    text: question.text,
    options: [...question.options]
  };

  if (includeAnswer) {
    out.answerIndex = question.answerIndex;
  }

  return out;
}

function comparePlayersForLeaderboard(a, b) {
  const aAlive = a.status === 'alive';
  const bAlive = b.status === 'alive';

  if (aAlive !== bAlive) {
    return aAlive ? -1 : 1;
  }

  if (aAlive && bAlive) {
    if (a.connectedAt !== b.connectedAt) {
      return a.connectedAt - b.connectedAt;
    }
    return a.id.localeCompare(b.id);
  }

  if (a.eliminatedRound !== b.eliminatedRound) {
    return (b.eliminatedRound || 0) - (a.eliminatedRound || 0);
  }

  if (a._eliminationOrder !== b._eliminationOrder) {
    return (b._eliminationOrder || 0) - (a._eliminationOrder || 0);
  }

  if (a.connectedAt !== b.connectedAt) {
    return a.connectedAt - b.connectedAt;
  }

  return a.id.localeCompare(b.id);
}

function normalizeOption(option) {
  const numeric = Number(option);
  if (!Number.isInteger(numeric)) {
    return null;
  }
  if (numeric < 0 || numeric > 3) {
    return null;
  }
  return numeric;
}

function sanitizeName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return 'Player';
  }
  return trimmed.slice(0, 32);
}

function eventAll(name, payload) {
  return {
    name,
    scope: 'all',
    payload
  };
}

function eventPlayer(name, socketId, payload) {
  return {
    name,
    scope: 'player',
    to: socketId,
    payload
  };
}

module.exports = {
  PHASES,
  TIMINGS,
  EVENT_NAMES,
  EVENT_PAYLOADS,
  createGameState,
  addPlayer,
  setReady,
  removePlayer,
  startGame,
  handlePick,
  tick,
  getPublicLobbyState,
  getPublicRoundState,
  getResults
};
