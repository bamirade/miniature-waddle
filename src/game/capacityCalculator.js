/**
 * Capacity calculation for option slots
 * Implements fair distribution algorithm with random remainder allocation
 */

const { GAME_CONFIG } = require('./constants');

/**
 * Compute capacities for each option based on alive player count
 * Algorithm: base = floor(count/4), distribute remainder randomly
 * @param {number} aliveCount - Number of alive players
 * @param {Function} rngFn - Random number generator function (0-1)
 * @returns {Array<number>} Capacity for each of 4 options
 */
function computeCapacities(aliveCount, rngFn = Math.random) {
  const optionCount = GAME_CONFIG.OPTIONS_PER_QUESTION;
  const base = Math.floor(aliveCount / optionCount);
  const rem = aliveCount % optionCount;
  const capacities = new Array(optionCount).fill(base);

  if (rem > 0) {
    const distinct = pickDistinctOptionIndices(rem, rngFn);
    for (const optionIndex of distinct) {
      capacities[optionIndex] += 1;
    }
  }

  return capacities;
}

/**
 * Pick N distinct random option indices (0 to OPTIONS_PER_QUESTION-1)
 * Uses Fisher-Yates shuffle for fairness
 * @param {number} count - Number of indices to pick
 * @param {Function} rngFn - Random number generator function
 * @returns {Array<number>} Array of distinct indices
 */
function pickDistinctOptionIndices(count, rngFn) {
  const { GAME_CONFIG } = require('./constants');
  const optionCount = GAME_CONFIG.OPTIONS_PER_QUESTION;
  const indexes = Array.from({ length: optionCount }, (_, i) => i);

  // Fisher-Yates shuffle
  for (let i = optionCount - 1; i > 0; i--) {
    const j = Math.floor(rngFn() * (i + 1));
    const temp = indexes[i];
    indexes[i] = indexes[j];
    indexes[j] = temp;
  }

  return indexes.slice(0, count);
}

module.exports = {
  computeCapacities,
  pickDistinctOptionIndices,
};
