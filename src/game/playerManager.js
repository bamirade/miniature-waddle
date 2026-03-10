/**
 * Player management operations
 * Handles adding, removing, and updating player state
 */

const { PHASES, GAME_CONFIG } = require('./constants');
const { sanitizeName, eventAll } = require('./utils');

/**
 * Add a new player to the game
 * @param {object} state - Game state
 * @param {string} socketId - Player's socket ID
 * @param {string} name - Player's chosen name
 * @returns {object} Result with ok flag, reason, and events
 */
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
    lives: GAME_CONFIG.STARTING_LIVES,
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
    events: [eventAll('lobby:state', getPublicLobbyState(state))]
  };
}

/**
 * Mark a player as ready
 * @param {object} state - Game state
 * @param {string} socketId - Player's socket ID
 * @returns {object} Result with ok flag, reason, and events
 */
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
    events: [eventAll('lobby:state', getPublicLobbyState(state))]
  };
}

/**
 * Remove a player from the game
 * @param {object} state - Game state
 * @param {string} socketId - Player's socket ID
 * @returns {object} Result with ok flag, reason, and events
 */
function removePlayer(state, socketId) {
  if (!state || !state.players || !state.players[socketId]) {
    return { ok: false, reason: 'player_not_found', events: [] };
  }

  delete state.players[socketId];

  const events = [];
  if (state.phase === PHASES.LOBBY) {
    events.push(eventAll('lobby:state', getPublicLobbyState(state)));
  } else if (state.phase === PHASES.ROUND || state.phase === PHASES.REVEAL || state.phase === PHASES.COUNTDOWN) {
    removePlayerFromRoundPicks(state, socketId);
    events.push(eventAll('round:slots', createRoundSlotsPayload(state)));
  }

  return { ok: true, reason: null, events };
}

/**
 * Remove player from all option pick arrays
 * @param {object} state - Game state
 * @param {string} socketId - Player's socket ID
 */
function removePlayerFromRoundPicks(state, socketId) {
  for (const pickedIds of state.pickedByOption) {
    const index = pickedIds.indexOf(socketId);
    if (index >= 0) {
      pickedIds.splice(index, 1);
    }
  }
}

/**
 * Get list of all players sorted by connection time
 * @param {object} state - Game state
 * @returns {Array} Sorted array of player objects
 */
function listPlayers(state) {
  return Object.values(state.players).sort((a, b) => {
    if (a.connectedAt !== b.connectedAt) {
      return a.connectedAt - b.connectedAt;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Get players who are still alive
 * @param {object} state - Game state
 * @returns {Array} Array of alive players
 */
function getAlivePlayers(state) {
  return listPlayers(state).filter((player) => player.status === 'alive');
}

/**
 * Get count of alive players
 * @param {object} state - Game state
 * @returns {number} Number of alive players
 */
function getAliveCount(state) {
  return getAlivePlayers(state).length;
}

/**
 * Get public lobby state for broadcasting
 * @param {object} state - Game state
 * @returns {object} Public lobby state
 */
function getPublicLobbyState(state) {
  const players = listPlayers(state).map((player) => ({
    id: player.id,
    name: player.name,
    connectedAt: player.connectedAt,
    ready: player.ready,
    status: player.status,
    lives: player.lives,
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

/**
 * Create round slots payload for broadcasting
 * @param {object} state - Game state
 * @returns {object} Round slots state
 */
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

/**
 * Calculate available slots for each option
 * @param {object} state - Game state
 * @returns {Array<number>} Slots left per option
 */
function getSlotsLeft(state) {
  return state.capacities.map((capacity, optionIndex) => {
    const pickedCount = state.pickedByOption[optionIndex].length;
    const value = capacity - pickedCount;
    return value > 0 ? value : 0;
  });
}

module.exports = {
  addPlayer,
  setReady,
  removePlayer,
  removePlayerFromRoundPicks,
  listPlayers,
  getAlivePlayers,
  getAliveCount,
  getPublicLobbyState,
  createRoundSlotsPayload,
  getSlotsLeft,
};
