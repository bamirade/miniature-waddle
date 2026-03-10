/**
 * Round lifecycle management
 * Handles round start, transitions, and reveal logic
 */

const { PHASES, TIMINGS, EVENT_NAMES } = require('./constants');
const { getRandomQuestion } = require('./questions');
const { eventAll } = require('./utils');
const { computeCapacities } = require('./capacityCalculator');
const { getAlivePlayers, getAliveCount } = require('./playerManager');
const { markPlayerEliminated } = require('./eliminationManager');

/**
 * Start a new round with a fresh question
 * @param {object} state - Game state
 * @param {number} now - Current timestamp
 * @param {Array} events - Events array to append to
 */
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

  // Reset player round state
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

/**
 * Close current round and transition to reveal phase
 * Eliminates players who didn't pick or picked wrong
 * @param {object} state - Game state
 * @param {number} now - Current timestamp
 * @param {Array} events - Events array to append to
 */
function closeRoundAndStartReveal(state, now, events) {
  if (!state.currentQuestion) {
    return;
  }

  const eliminatedThisRound = [];
  const lostLivesThisRound = [];

  // Process timeouts (didn't pick)
  const aliveBeforeTimeoutCheck = getAlivePlayers(state);
  for (const player of aliveBeforeTimeoutCheck) {
    if (player.pickedOptionThisRound === null) {
      const result = markPlayerEliminated(state, player, {
        reason: 'timeout',
        roundNumber: state.roundNumber,
        option: null,
        at: now
      });

      if (result.type === 'life_lost') {
        lostLivesThisRound.push({
          playerId: result.playerId,
          name: result.name,
          reason: result.reason,
          option: result.option,
          livesRemaining: result.livesRemaining
        });
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
        eliminatedThisRound.push({
          playerId: result.playerId,
          name: result.name,
          reason: result.reason,
          option: result.option
        });
        events.push(eventAll(EVENT_NAMES.PLAYER_ELIMINATED, {
          roundNumber: result.roundNumber,
          playerId: result.playerId,
          name: result.name,
          reason: result.reason,
          option: result.option,
          at: result.at
        }));
      }
    }
  }

  // Process wrong answers
  const correctOption = state.currentQuestion.answerIndex;
  const aliveBeforeWrongCheck = getAlivePlayers(state);

  for (const player of aliveBeforeWrongCheck) {
    if (player.pickedOptionThisRound !== correctOption) {
      const result = markPlayerEliminated(state, player, {
        reason: 'wrong',
        roundNumber: state.roundNumber,
        option: player.pickedOptionThisRound,
        at: now
      });

      if (result.type === 'life_lost') {
        lostLivesThisRound.push({
          playerId: result.playerId,
          name: result.name,
          reason: result.reason,
          option: result.option,
          livesRemaining: result.livesRemaining
        });
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
        eliminatedThisRound.push({
          playerId: result.playerId,
          name: result.name,
          reason: result.reason,
          option: result.option
        });
        events.push(eventAll(EVENT_NAMES.PLAYER_ELIMINATED, {
          roundNumber: result.roundNumber,
          playerId: result.playerId,
          name: result.name,
          reason: result.reason,
          option: result.option,
          at: result.at
        }));
      }
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
    lostLivesThisRound: lostLivesThisRound,
    eliminatedThisRound: eliminatedThisRound,
    endsAt: state.phaseEndsAt
  }));
}

/**
 * Check if game should finish
 * @param {object} state - Game state
 * @returns {boolean} True if game should end
 */
function shouldFinish(state) {
  const { GAME_CONFIG } = require('./constants');
  return getAliveCount(state) <= GAME_CONFIG.SURVIVOR_THRESHOLD;
}

/**
 * Finish the game and prepare results
 * @param {object} state - Game state
 * @param {string} reason - Reason for game ending
 */
function finishGame(state, reason) {
  state.phase = PHASES.FINISHED;
  state.phaseStartedAt = Date.now();
  state.phaseEndsAt = null;
  state.countdownSecondsLeft = null;
  state.finishReason = reason;
  state.leaderboard = getResults(state).leaderboard;
}

/**
 * Get public round state
 * @param {object} state - Game state
 * @returns {object} Public round state
 */
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

/**
 * Get game results and leaderboard
 * @param {object} state - Game state
 * @returns {object} Results object with leaderboard
 */
function getResults(state) {
  const { listPlayers } = require('./playerManager');
  const { comparePlayersForLeaderboard } = require('./eliminationManager');
  const { GAME_CONFIG } = require('./constants');

  const ordered = listPlayers(state).sort(comparePlayersForLeaderboard);

  const leaderboard = ordered.map((player, index) => ({
    rank: index + 1,
    id: player.id,
    name: player.name,
    lives: player.lives,
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
    top: leaderboard.slice(0, GAME_CONFIG.SURVIVOR_THRESHOLD),
    leaderboard
  };
}

/**
 * Convert question to public format
 * @param {object} question - Question object
 * @param {boolean} includeAnswer - Whether to include answer
 * @returns {object|null} Public question object
 */
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

/**
 * Get available slots for each option
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
  startNextRound,
  closeRoundAndStartReveal,
  shouldFinish,
  finishGame,
  getPublicRoundState,
  getResults,
  toPublicQuestion,
  getSlotsLeft,
};
