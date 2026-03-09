/**
 * Game configuration constants and phase definitions
 */

const PHASES = Object.freeze({
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  ROUND: 'round',
  REVEAL: 'reveal',
  FINISHED: 'finished',
});

const TIMINGS = Object.freeze({
  COUNTDOWN_MS: 3000,
  ROUND_OPEN_MS: 10000,
  REVEAL_MS: 2000,
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
  GAME_FINISHED: 'game:finished',
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
    question: { id: 'q001', text: 'Question text', options: ['A', 'B', 'C', 'D'] },
    capacities: [0, 0, 0, 0],
    slotsLeft: [0, 0, 0, 0],
    pickedCounts: [0, 0, 0, 0],
    endsAt: 0,
  },
  ROUND_SLOTS: {
    phase: 'round',
    roundNumber: 1,
    aliveCount: 0,
    capacities: [0, 0, 0, 0],
    slotsLeft: [0, 0, 0, 0],
    pickedCounts: [0, 0, 0, 0],
  },
  PICK_RESULT: {
    phase: 'round',
    roundNumber: 1,
    playerId: 'socketId',
    option: 0,
    status: 'accepted',
    reason: 'picked',
    eliminated: false,
    slotsLeft: [0, 0, 0, 0],
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
    question: { id: 'q001', text: 'Question text', options: ['A', 'B', 'C', 'D'], answerIndex: 0 },
    pickedByOption: [[], [], [], []],
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
  EVENT_NAMES,
  EVENT_PAYLOADS,
};
