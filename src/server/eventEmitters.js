/**
 * Event emission logic for game state changes
 */

const { EVENT_NAMES } = require('../game/state');

/**
 * Create event emission function
 * @param {object} io - Socket.IO server instance
 * @param {object} gameState - Game state object
 * @param {Function} buildGameStatePayload - State payload builder function
 * @returns {Function} Event application function
 */
function createEventEmitter(io, gameState, buildGameStatePayload) {
  return function applyEngineEvents(events) {
    if (!events || events.length === 0) {
      return;
    }

    for (const event of events) {
      if (!event || !event.name) {
        continue;
      }

      switch (event.name) {
        case EVENT_NAMES.LOBBY_STATE:
          io.emit('lobby:update', event.payload);
          break;

        case EVENT_NAMES.COUNTDOWN_STARTED:
        case EVENT_NAMES.COUNTDOWN_TICK:
          io.emit('game:state', {
            ...buildGameStatePayload(),
            countdown: {
              secondsLeft: event.payload.secondsLeft,
              endsAt: event.payload.endsAt,
              startedAt: event.payload.startedAt || gameState.phaseStartedAt,
            },
          });
          break;

        case EVENT_NAMES.ROUND_STARTED:
          io.emit('round:new', event.payload);
          break;

        case EVENT_NAMES.ROUND_SLOTS:
          io.emit('round:update', {
            type: 'slots',
            ...event.payload,
          });
          break;

        case EVENT_NAMES.PICK_RESULT:
          if (event.scope === 'player' && event.to) {
            io.to(event.to).emit('player:result', event.payload);
          } else {
            io.emit('player:result', event.payload);
          }
          break;

        case EVENT_NAMES.PLAYER_ELIMINATED:
          io.emit('round:update', {
            type: 'elimination',
            ...event.payload,
          });
          break;

        case EVENT_NAMES.ROUND_REVEAL:
          io.emit('round:update', {
            type: 'reveal',
            ...event.payload,
          });
          break;

        case EVENT_NAMES.GAME_FINISHED:
          io.emit('game:results', event.payload);
          break;

        default:
          break;
      }
    }
  };
}

module.exports = { createEventEmitter };
