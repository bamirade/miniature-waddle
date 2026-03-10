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

// Logging helper for debugging
const log = (socketId, action, details) => {
  const shortId = socketId.substring(0, 6);
  const msg = details ? ` - ${details}` : '';
  console.log(`[SOCKET ${shortId}] ${action}${msg}`);
};

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
    log(socket.id, 'CONNECTED');

    // Send initial state to new connection
    socket.emit('lobby:update', getPublicLobbyState(gameState));
    socket.emit('game:state', buildGameStatePayload());

    if (gameState.phase === PHASES.FINISHED) {
      const { getResults } = require('../game/state');
      socket.emit('game:results', getResults(gameState));
    }

    // Player joins the game
    socket.on('player:join', (payload = {}) => {
      log(socket.id, 'player:join', payload.name);

      // Prevent joining if game is in progress (but allow joining after game finishes for replay)
      if (gameState.phase !== PHASES.LOBBY && gameState.phase !== PHASES.FINISHED) {
        log(socket.id, 'join REJECTED', `phase=${gameState.phase}`);
        socket.emit('player:result', {
          status: 'error',
          reason: 'Game has already started. Cannot join now.',
        });
        return;
      }

      const result = addPlayer(gameState, socket.id, payload.name);

      if (!result.ok) {
        log(socket.id, 'join FAILED', result.reason);
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
      log(socket.id, 'player:ready');

      const result = setReady(gameState, socket.id);

      if (!result.ok) {
        log(socket.id, 'ready FAILED', result.reason);
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
      log(socket.id, 'player:pick', `option=${payload.option}`);

      const result = handlePick(gameState, socket.id, payload.option);

      if (!result.ok && (!result.events || result.events.length === 0)) {
        log(socket.id, 'pick FAILED', result.reason);
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
      log(socket.id, 'host:start', `phase=${gameState.phase}`);

      socket.data.role = 'host';

      const result = startGame(gameState);
      if (!result.ok) {
        log(socket.id, 'start FAILED', result.reason);
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
      log(socket.id, 'DISCONNECTED', `players=${Object.keys(gameState.players).length}`);

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
