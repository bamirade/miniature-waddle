/**
 * Helper utilities for game state management
 */

const MAX_PLAYER_NAME_LENGTH = 16;

/**
 * Sanitize and validate player name
 * @param {string} name - Player name to sanitize
 * @returns {string} Sanitized player name
 */
function sanitizeName(name) {
  if (!name || typeof name !== 'string') {
    return 'Player';
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Player';
  }

  const sanitized = trimmed.slice(0, MAX_PLAYER_NAME_LENGTH);
  return sanitized;
}

/**
 * Create an event envelope for 'all' scope
 * @param {string} name - Event name
 * @param {object} payload - Event payload
 * @returns {object} Event envelope
 */
function eventAll(name, payload) {
  return {
    name,
    scope: 'all',
    payload,
  };
}

/**
 * Create an event envelope for 'player' scope
 * @param {string} name - Event name
 * @param {string} socketId - Target socket ID
 * @param {object} payload - Event payload
 * @returns {object} Event envelope
 */
function eventPlayer(name, socketId, payload) {
  return {
    name,
    scope: 'player',
    to: socketId,
    payload,
  };
}

/**
 * Calculate available slots for each option
 * @param {Array} capacities - Capacity for each option
 * @param {Array<Array>} pickedByOption - Players who picked each option
 * @returns {Array<number>} Slots left for each option
 */
function calculateSlotsLeft(capacities, pickedByOption) {
  return capacities.map((capacity, index) => {
    const picked = pickedByOption[index] || [];
    return Math.max(0, capacity - picked.length);
  });
}

module.exports = {
  MAX_PLAYER_NAME_LENGTH,
  sanitizeName,
  eventAll,
  eventPlayer,
  calculateSlotsLeft,
};
