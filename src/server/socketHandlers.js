/**
 * Socket.IO event handlers for game actions
 */

const {
  PHASES,
  addPlayer,
  setReady,
  removePlayer,
  startGame,
  handlePick,
  getPublicLobbyState,
} = require('../game/state');

/**
 * Create socket event handlers
 * @param {object} io - Socket.IO server instance
 * @param {object} gameState - Game state object
 * @param {Function} applyEngineEvents - Event application function
 * @param {Function} buildGameStatePayload - State payload builder function
 * @returns {Function} Connection handler function
 */
function createSocketHandlers(io, gameState, applyEngineEvents, buildGameStatePayload) {
  return (socket) => {
    // Send initial state to new connection
    socket.emit('lobby:update', getPublicLobbyState(gameState));
    socket.emit('game:state', buildGameStatePayload());

    if (gameState.phase === PHASES.FINISHED) {
      const { getResults } = require('../game/state');
      socket.emit('game:results', getResults(gameState));
    }

    // Player joins the game
    socket.on('player:join', (payload = {}) => {
      const result = addPlayer(gameState, socket.id, payload.name);

      if (!result.ok) {
        socket.emit('player:result', {
          status: 'error',
          reason: result.reason,
        });
        return;
      }

      socket.data.role = 'student';
      applyEngineEvents(result.events);
      io.emit('lobby:update', getPublicLobbyState(gameState));
      io.emit('game:state', buildGameStatePayload());
    });

    // Player marks themselves as ready
    socket.on('player:ready', () => {
      const result = setReady(gameState, socket.id);

      if (!result.ok) {
        socket.emit('player:result', {
          status: 'error',
          reason: result.reason,
        });
        return;
      }

      applyEngineEvents(result.events);
      io.emit('lobby:update', getPublicLobbyState(gameState));
      io.emit('game:state', buildGameStatePayload());
    });

    // Player picks an option during a round
    socket.on('player:pick', (payload = {}) => {
      const result = handlePick(gameState, socket.id, payload.option);

      if (!result.ok && (!result.events || result.events.length === 0)) {
        socket.emit('player:result', {
          status: 'error',
          reason: result.reason,
        });
        return;
      }

      applyEngineEvents(result.events);
      io.emit('game:state', buildGameStatePayload());
    });

    // Host starts the game
    socket.on('host:start', () => {
      socket.data.role = 'host';

      const result = startGame(gameState);
      if (!result.ok) {
        socket.emit('player:result', {
          status: 'error',
          reason: result.reason,
        });
        return;
      }

      applyEngineEvents(result.events);
      io.emit('game:state', buildGameStatePayload());
    });

    // Player disconnects
    socket.on('disconnect', () => {
      const result = removePlayer(gameState, socket.id);
      if (result.ok) {
        applyEngineEvents(result.events);
        io.emit('lobby:update', getPublicLobbyState(gameState));
        io.emit('game:state', buildGameStatePayload());
      }
    });
  };
}

module.exports = { createSocketHandlers };
