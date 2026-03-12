/**
 * Shared server factory - eliminates duplication between electron.js and server.js
 */

const path = require('path');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const config = require('../config');
const packageJson = require('../../package.json');
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
  const startedAt = Date.now();

  function buildServerSnapshot() {
    const lobby = getPublicLobbyState(gameState);
    return {
      appName: packageJson.productName || packageJson.name,
      version: packageJson.version,
      startedAt,
      uptimeMs: Date.now() - startedAt,
      hostIp: LAN_IP,
      joinUrl: JOIN_URL,
      hostDashboardUrl: `http://localhost:${port}/host`,
      port,
      labelSet: gameState.labelSet,
      phase: gameState.phase,
      roundNumber: gameState.roundNumber,
      totalPlayers: lobby.totalPlayers,
      readyCount: lobby.readyCount,
      aliveCount: lobby.aliveCount,
      canStart: lobby.canStart,
      timings: {
        countdownMs: config.game.countdownMs,
        roundOpenMs: config.game.roundOpenMs,
        revealMs: config.game.revealMs,
      },
      startPolicy: {
        initialLaunchRequiresReady: true,
        replayFromResultsAllowed: true,
      },
    };
  }

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
      ...buildServerSnapshot(),
      ip: LAN_IP,
    });
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      ...buildServerSnapshot(),
    });
  });

  app.get('/qr.svg', async (req, res) => {
    const qrText = typeof req.query.text === 'string' && req.query.text.trim()
      ? req.query.text.trim()
      : JOIN_URL;

    try {
      const svg = await QRCode.toString(qrText, {
        type: 'svg',
        margin: 1,
        width: 160,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      res.type('image/svg+xml');
      res.send(svg);
    } catch (error) {
      res.status(500).json({
        status: 'error',
        reason: 'qr_generation_failed',
      });
    }
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
    return new Promise((resolve, reject) => {
      const onListening = () => {
        server.off('error', onError);
        console.log(`=== Game Host Server Started ===`);
        console.log(`Version: ${packageJson.version} | Label set: ${gameState.labelSet}`);
        console.log(`Server listening on all interfaces (${host}:${port})`);
        console.log(`Local address: http://localhost:${port}/host`);
        console.log(`Network address: ${JOIN_URL}`);
        console.log(`Students join at: ${JOIN_URL}`);
        console.log(`Health check: http://localhost:${port}/health`);
        console.log(`================================`);
        resolve({
          server,
          io,
          gameState,
          port,
          joinUrl: JOIN_URL,
          lanIp: LAN_IP,
          startedAt,
        });
      };

      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };

      server.once('listening', onListening);
      server.once('error', onError);

      try {
        server.listen(port, host);
      } catch (error) {
        server.off('listening', onListening);
        server.off('error', onError);
        reject(error);
      }
    });
  };

  // Cleanup function
  const cleanup = () => {
    clearInterval(tickIntervalId);
    io.close();
    if (server.listening) {
      server.close();
    }
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
