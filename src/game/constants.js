/**
 * Game configuration constants and phase definitions
 * Central location for all game timing, phases, and event names
 */

/**
 * Game phase constants
 * @typedef {Object} GamePhases
 * @property {string} LOBBY - Waiting for players to join
 * @property {string} COUNTDOWN - 3-second countdown before round starts
 * @property {string} ROUND - Active round where players pick answers
 * @property {string} REVEAL - Showing correct answer and eliminations
 * @property {string} FINISHED - Game over, showing results
 */
const PHASES = Object.freeze({
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  ROUND: 'round',
  REVEAL: 'reveal',
  FINISHED: 'finished',
});

/**
 * Game timing configuration in milliseconds
 * @typedef {Object} GameTimings
 * @property {number} COUNTDOWN_MS - Duration of countdown phase (3000ms = 3 seconds)
 * @property {number} ROUND_OPEN_MS - Time players have to pick (10000ms = 10 seconds)
 * @property {number} REVEAL_MS - Time to show results (3000ms = 3 seconds)
 */
const TIMINGS = Object.freeze({
  COUNTDOWN_MS: 3000,
  ROUND_OPEN_MS: 10000,
  REVEAL_MS: 3000,
});

/**
 * Core game rules configuration
 * @typedef {Object} GameConfig
 * @property {number} STARTING_LIVES - Lives each player starts with
 * @property {number} SURVIVOR_THRESHOLD - Max alive players before game ends(value: 3)
 * @property {number} OPTIONS_PER_QUESTION - Number of answer options (True/False = 2)
 */
const GAME_CONFIG = Object.freeze({
  STARTING_LIVES: 3,
  SURVIVOR_THRESHOLD: 3,
  OPTIONS_PER_QUESTION: 2,
});

/**
 * Socket.IO event names for client-server communication
 * @typedef {Object} EventNames
 */
const EVENT_NAMES = Object.freeze({
  LOBBY_STATE: 'lobby:state',
  COUNTDOWN_STARTED: 'game:countdownStarted',
  COUNTDOWN_TICK: 'game:countdownTick',
  ROUND_STARTED: 'game:roundStarted',
  ROUND_SLOTS: 'game:roundSlots',
  PICK_RESULT: 'game:pickResult',
  PLAYER_LIFE_LOST: 'game:playerLifeLost',
  PLAYER_ELIMINATED: 'game:playerEliminated',
  ROUND_REVEAL: 'game:roundReveal',
  GAME_FINISHED: 'game:finished',
});

const EVENT_PAYLOADS = Object.freeze({
  LOBBY_STATE: {
    phase: 'lobby',
    lobbySessionId: 'lobby-1710150000000-ab12cd34',
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
        lives: 3,
        eliminatedRound: null,
        eliminationReason: null,
      },
    ],
  },
  COUNTDOWN_STARTED: {
    phase: 'countdown',
    roundNumber: 0,
    secondsLeft: 3,
    startedAt: 0,
    endsAt: 0,
  },
  COUNTDOWN_TICK: {
    phase: 'countdown',
    roundNumber: 0,
    secondsLeft: 2,
    endsAt: 0,
  },
  ROUND_STARTED: {
    phase: 'round',
    roundNumber: 1,
    aliveCount: 0,
    question: { id: 'q001', text: 'Question text', options: ['True', 'False'] },
    capacities: [0, 0],
    slotsLeft: [0, 0],
    pickedCounts: [0, 0],
    endsAt: 0,
  },
  ROUND_SLOTS: {
    phase: 'round',
    roundNumber: 1,
    aliveCount: 0,
    capacities: [0, 0],
    slotsLeft: [0, 0],
    pickedCounts: [0, 0],
  },
  PICK_RESULT: {
    phase: 'round',
    roundNumber: 1,
    playerId: 'socketId',
    option: 0,
    status: 'accepted',
    reason: 'picked',
    eliminated: false,
    slotsLeft: [0, 0],
  },
  PLAYER_LIFE_LOST: {
    roundNumber: 1,
    playerId: 'socketId',
    name: 'Player',
    reason: 'wrong',
    option: 0,
    livesRemaining: 2,
    at: 0,
  },
  PLAYER_ELIMINATED: {
    roundNumber: 1,
    playerId: 'socketId',
    name: 'Player',
    reason: 'full',
    option: 0,
    at: 0,
  },
  ROUND_REVEAL: {
    phase: 'reveal',
    roundNumber: 1,
    aliveCount: 0,
    question: { id: 'q001', text: 'Question text', options: ['True', 'False'], answerIndex: 0 },
    pickedByOption: [[], []],
    eliminatedThisRound: [
      { playerId: 'socketId', name: 'Player', reason: 'wrong', option: 1 },
    ],
    endsAt: 0,
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
        eliminationReason: null,
      },
    ],
    leaderboard: [],
  },
});

module.exports = {
  PHASES,
  TIMINGS,
  GAME_CONFIG,
  EVENT_NAMES,
  EVENT_PAYLOADS,
};
