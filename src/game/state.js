const { PHASES, TIMINGS, EVENT_NAMES } = require('./constants');
const { eventAll, eventPlayer } = require('./utils');
const {
  addPlayer,
  setReady,
  removePlayer,
  getAlivePlayers,
  getAliveCount,
  getPublicLobbyState,
  createRoundSlotsPayload,
  getSlotsLeft,
  listPlayers
} = require('./playerManager');
const { markPlayerEliminated } = require('./eliminationManager');
const {
  startNextRound,
  closeRoundAndStartReveal,
  shouldFinish,
  finishGame,
  getPublicRoundState,
  getResults
} = require('./roundManager');

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

/**
 * Create a new game state instance
 * @returns {object} Fresh game state
 */
function createGameState() {
  const { GAME_CONFIG } = require('./constants');
  const optionCount = GAME_CONFIG.OPTIONS_PER_QUESTION;

  return {
    phase: PHASES.LOBBY,
    createdAt: Date.now(),
    phaseStartedAt: null,
    phaseEndsAt: null,
    countdownSecondsLeft: null,
    roundNumber: 0,
    currentQuestion: null,
    capacities: new Array(optionCount).fill(0),
    pickedByOption: Array.from({ length: optionCount }, () => []),
    lastRoundEliminations: [],
    players: {},
    usedQuestionIds: new Set(),
    leaderboard: [],
    _eliminationSeq: 0,
    _rng: Math.random
  };
}

/**
 * Start or restart the game
 * @param {object} state - Game state
 * @returns {object} Result with ok flag and events
 */
function startGame(state) {
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

  // Reset all player states
  const { GAME_CONFIG } = require('./constants');
  const optionCount = GAME_CONFIG.OPTIONS_PER_QUESTION;

  for (const player of players) {
    player.lives = GAME_CONFIG.STARTING_LIVES;
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
  state.capacities = new Array(optionCount).fill(0);
  state.pickedByOption = Array.from({ length: optionCount }, () => []);
  state.lastRoundEliminations = [];
  state.usedQuestionIds.clear();
  state.leaderboard = [];
  state._eliminationSeq = 0;
  state.finishReason = null;

  const now = Date.now();
  state.phase = PHASES.COUNTDOWN;
  state.phaseStartedAt = now;
  state.phaseEndsAt = now + TIMINGS.COUNTDOWN_MS;
  state.countdownSecondsLeft = Math.ceil(TIMINGS.COUNTDOWN_MS / 1000);

  return {
    ok: true,
    reason: null,
    events: [
      eventAll(EVENT_NAMES.LOBBY_STATE, getPublicLobbyState(state)),
      eventAll(EVENT_NAMES.COUNTDOWN_STARTED, {
        phase: state.phase,
        roundNumber: state.roundNumber,
        secondsLeft: Math.ceil(TIMINGS.COUNTDOWN_MS / 1000),
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

    const result = markPlayerEliminated(state, player, {
      reason: 'full',
      roundNumber: state.roundNumber,
      option: optionIndex,
      at: now
    });

    // Emit appropriate event based on result type
    if (result.type === 'life_lost') {
      events.push(eventAll(EVENT_NAMES.PLAYER_LIFE_LOST, {
        roundNumber: result.roundNumber,
        playerId: result.playerId,
        name: result.name,
        reason: result.reason,
        option: result.option,
        livesRemaining: result.livesRemaining,
        at: result.at
      }));
    } else if (result.type === 'eliminated') {
      events.push(eventAll(EVENT_NAMES.PLAYER_ELIMINATED, {
        roundNumber: result.roundNumber,
        playerId: result.playerId,
        name: result.name,
        reason: result.reason,
        option: result.option,
        at: result.at
      }));
    }

    events.push(eventPlayer(EVENT_NAMES.PICK_RESULT, socketId, {
      phase: state.phase,
      roundNumber: state.roundNumber,
      playerId: socketId,
      option: optionIndex,
      status: result.type === 'eliminated' ? 'eliminated' : 'life_lost',
      reason: 'full',
      eliminated: result.type === 'eliminated',
      livesRemaining: result.livesRemaining,
      slotsLeft: getSlotsLeft(state)
    }));

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

/**
 * Game tick system - processes timed phase transitions
 * @param {object} state - Game state
 * @param {number} nowMs - Current timestamp
 * @returns {Array} Array of events generated
 */
function tick(state, nowMs) {
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
        const reason = getAliveCount(state) === 0 ? 'no_alive' : 'survivor_threshold';
        finishGame(state, reason);
        events.push(eventAll(EVENT_NAMES.GAME_FINISHED, getResults(state)));
      } else {
        startNextRound(state, now, events);
      }
    }
  }

  return events;
}

/**
 * Process countdown phase tick
 * @param {object} state - Game state
 * @param {number} now - Current timestamp
 * @param {Array} events - Events array to append to
 */
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

/**
 * Normalize and validate option index
 * @param {any} option - Option value to normalize
 * @returns {number|null} Valid option index (0 to OPTIONS_PER_QUESTION-1) or null
 */
function normalizeOption(option) {
  const { GAME_CONFIG } = require('./constants');
  const numeric = Number(option);
  if (!Number.isInteger(numeric)) {
    return null;
  }
  if (numeric < 0 || numeric >= GAME_CONFIG.OPTIONS_PER_QUESTION) {
    return null;
  }
  return numeric;
}

// Re-export all public functions
module.exports = {
  PHASES,
  TIMINGS,
  EVENT_NAMES,
  createGameState,
  addPlayer,
  setReady,
  removePlayer,
  startGame,
  handlePick,
  tick,
  getPublicLobbyState,
  getPublicRoundState,
  getResults,
};
