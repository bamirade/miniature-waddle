/**
 * Player elimination and life management
 * Handles life loss events and elimination logic
 */

/**
 * Mark a player as having lost a life or being eliminated
 * @param {object} state - Game state
 * @param {object} player - Player object
 * @param {object} details - Elimination details (reason, roundNumber, option, at)
 * @returns {object} Result with type, player info, and remaining lives
 */
function markPlayerEliminated(state, player, details) {
  if (player.status !== 'alive') {
    return {
      type: 'already_eliminated',
      roundNumber: details.roundNumber,
      playerId: player.id,
      name: player.name,
      reason: details.reason,
      option: details.option,
      livesRemaining: player.lives,
      at: details.at
    };
  }

  // Decrease life count
  player.lives -= 1;

  // If player still has lives, just lose a life
  if (player.lives > 0) {
    return {
      type: 'life_lost',
      roundNumber: details.roundNumber,
      playerId: player.id,
      name: player.name,
      reason: details.reason,
      option: details.option,
      livesRemaining: player.lives,
      at: details.at
    };
  }

  // No more lives - eliminate the player
  state._eliminationSeq += 1;
  player.status = 'eliminated';
  player.eliminatedRound = details.roundNumber;
  player.eliminationReason = details.reason;
  player._eliminationOrder = state._eliminationSeq;

  return {
    type: 'eliminated',
    roundNumber: details.roundNumber,
    playerId: player.id,
    name: player.name,
    reason: details.reason,
    option: details.option,
    livesRemaining: 0,
    at: details.at
  };
}

/**
 * Compare two players for leaderboard ordering
 * Alive players first, then by elimination round, then by elimination order
 * @param {object} a - First player
 * @param {object} b - Second player
 * @returns {number} Comparison result (-1, 0, 1)
 */
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

module.exports = {
  markPlayerEliminated,
  comparePlayersForLeaderboard,
};
