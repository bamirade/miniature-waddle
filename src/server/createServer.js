/**
 * Shared server factory - eliminates duplication between electron.js and server.js
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const config = require('../config');
const { getPreferredLanIpv4 } = require('../utils/network');
const { createGameState, tick, getPublicLobbyState, getPublicRoundState, getResults, PHASES } = require('../game/state');
const { createSocketHandlers } = require('./socketHandlers');
const { createEventEmitter } = require('./eventEmitters');

/**
 * Create and configure the game server
 * @param {object} options - Server configuration options
 * @param {string} options.publicDir - Path to public directory
 * @param {number} [options.port] - Server port (defaults to config)
 * @param {string} [options.host] - Host IP to bind (defaults to config)
 * @returns {object} Server instance with metadata
 */
function createServer(options = {}) {
  const { publicDir, port = config.server.port, host = config.server.host } = options;

  if (!publicDir) {
    throw new Error('publicDir is required');
  }

  const app = express();
  const server = http.createServer(app);

  // Configure Socket.IO for classroom environments with multiple concurrent connections
  const io = new Server(server, {
    pingInterval: 25000,           // Ping interval in ms (default 25s)
    pingTimeout: 60000,            // Ping timeout in ms (default 60s)
    maxHttpBufferSize: 1e6,        // Max HTTP buffer size (1MB, default 100KB)
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling'], // Try WebSocket first, fallback to polling
  });

  const LAN_IP = process.env.HOST_IP || getPreferredLanIpv4();
  const JOIN_URL = `http://${LAN_IP}:${port}/`;
  const gameState = createGameState();

  // Serve static files
  app.use(express.static(publicDir));

  // Routes
  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/student', (req, res) => {
    res.sendFile(path.join(publicDir, 'student.html'));
  });

  app.get('/host', (req, res) => {
    res.sendFile(path.join(publicDir, 'host.html'));
  });

  app.get('/config', (req, res) => {
    res.json({
      port,
      joinUrl: JOIN_URL,
      ip: LAN_IP,
    });
  });

  // Build game state payload helper
  function buildGameStatePayload() {
    const lobby = getPublicLobbyState(gameState);
    const payload = {
      phase: gameState.phase,
      roundNumber: gameState.roundNumber,
      aliveCount: lobby.aliveCount,
      lobby,
    };

    if (gameState.phase !== PHASES.LOBBY) {
      payload.round = getPublicRoundState(gameState);
    }

    if (gameState.phase === PHASES.FINISHED) {
      payload.results = getResults(gameState);
    }

    return payload;
  }

  // Create event emitter
  const applyEngineEvents = createEventEmitter(io, gameState, buildGameStatePayload);

  // Setup socket handlers
  io.on('connection', createSocketHandlers(io, gameState, applyEngineEvents, buildGameStatePayload));

  // Game tick interval
  const tickIntervalId = setInterval(() => {
    const generatedEvents = tick(gameState, Date.now());
    if (!generatedEvents || generatedEvents.length === 0) {
      return;
    }

    applyEngineEvents(generatedEvents);
    io.emit('game:state', buildGameStatePayload());
  }, config.server.tickInterval);

  // Start server
  const startServer = () => {
    return new Promise((resolve) => {
      server.listen(port, host, () => {
        console.log(`=== Game Host Server Started ===`);
        console.log(`Server listening on all interfaces (${host}:${port})`);
        console.log(`Local address: http://localhost:${port}/host`);
        console.log(`Network address: ${JOIN_URL}`);
        console.log(`Students join at: ${JOIN_URL}`);
        console.log(`================================`);
        resolve({
          server,
          io,
          gameState,
          port,
          joinUrl: JOIN_URL,
          lanIp: LAN_IP,
        });
      });
    });
  };

  // Cleanup function
  const cleanup = () => {
    clearInterval(tickIntervalId);
    server.close();
  };

  return {
    start: startServer,
    cleanup,
    server,
    io,
    gameState,
  };
}

module.exports = { createServer };
