const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const {
  PHASES,
  EVENT_NAMES,
  createGameState,
  addPlayer,
  setReady,
  removePlayer,
  startGame,
  handlePick,
  tick,
  getPublicLobbyState,
  getPublicRoundState,
  getResults
} = require('./game/state');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SERVER_HOST = '0.0.0.0';
const LAN_IP = process.env.HOST_IP || getPreferredLanIpv4();
const JOIN_URL = `http://${LAN_IP}:${PORT}/`;
const gameState = createGameState();

app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/student', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'student.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'host.html'));
});

app.get('/config', (req, res) => {
  res.json({
    port: PORT,
    joinUrl: JOIN_URL,
    ip: LAN_IP
  });
});

io.on('connection', (socket) => {
  socket.emit('lobby:update', getPublicLobbyState(gameState));
  socket.emit('game:state', buildGameStatePayload());

  if (gameState.phase === PHASES.FINISHED) {
    socket.emit('game:results', getResults(gameState));
  }

  socket.on('player:join', (payload = {}) => {
    const result = addPlayer(gameState, socket.id, payload.name);

    if (!result.ok) {
      socket.emit('player:result', {
        status: 'error',
        reason: result.reason
      });
      return;
    }

    socket.data.role = 'student';
    applyEngineEvents(result.events);
    io.emit('lobby:update', getPublicLobbyState(gameState));
    io.emit('game:state', buildGameStatePayload());
  });

  socket.on('player:ready', () => {
    const result = setReady(gameState, socket.id);

    if (!result.ok) {
      socket.emit('player:result', {
        status: 'error',
        reason: result.reason
      });
      return;
    }

    applyEngineEvents(result.events);
    io.emit('lobby:update', getPublicLobbyState(gameState));
    io.emit('game:state', buildGameStatePayload());
  });

  socket.on('player:pick', (payload = {}) => {
    const result = handlePick(gameState, socket.id, payload.option);

    if (!result.ok && (!result.events || result.events.length === 0)) {
      socket.emit('player:result', {
        status: 'error',
        reason: result.reason
      });
      return;
    }

    applyEngineEvents(result.events);
    io.emit('game:state', buildGameStatePayload());
  });

  socket.on('host:start', () => {
    socket.data.role = 'host';

    const result = startGame(gameState);
    if (!result.ok) {
      socket.emit('player:result', {
        status: 'error',
        reason: result.reason
      });
      return;
    }

    applyEngineEvents(result.events);
    io.emit('game:state', buildGameStatePayload());
  });

  socket.on('disconnect', () => {
    const result = removePlayer(gameState, socket.id);
    if (result.ok) {
      applyEngineEvents(result.events);
      io.emit('lobby:update', getPublicLobbyState(gameState));
      io.emit('game:state', buildGameStatePayload());
    }
  });
});

setInterval(() => {
  const generatedEvents = tick(gameState, Date.now());
  if (!generatedEvents || generatedEvents.length === 0) {
    return;
  }

  applyEngineEvents(generatedEvents);
  io.emit('game:state', buildGameStatePayload());
}, 50);

server.listen(PORT, SERVER_HOST, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Join URL: ${JOIN_URL}`);
});

function applyEngineEvents(events) {
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
            startedAt: event.payload.startedAt || gameState.phaseStartedAt
          }
        });
        break;

      case EVENT_NAMES.ROUND_STARTED:
        io.emit('round:new', event.payload);
        break;

      case EVENT_NAMES.ROUND_SLOTS:
        io.emit('round:update', {
          type: 'slots',
          ...event.payload
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
          ...event.payload
        });
        break;

      case EVENT_NAMES.ROUND_REVEAL:
        io.emit('round:update', {
          type: 'reveal',
          ...event.payload
        });
        break;

      case EVENT_NAMES.GAME_FINISHED:
        io.emit('game:results', event.payload);
        break;

      default:
        break;
    }
  }
}

function buildGameStatePayload() {
  const lobby = getPublicLobbyState(gameState);
  const payload = {
    phase: gameState.phase,
    roundNumber: gameState.roundNumber,
    aliveCount: lobby.aliveCount,
    lobby
  };

  if (gameState.phase !== PHASES.LOBBY) {
    payload.round = getPublicRoundState(gameState);
  }

  if (gameState.phase === PHASES.FINISHED) {
    payload.results = getResults(gameState);
  }

  return payload;
}

function getPreferredLanIpv4() {
  const allInterfaces = os.networkInterfaces();
  const ipv4Candidates = [];

  for (const entries of Object.values(allInterfaces)) {
    if (!entries) {
      continue;
    }

    for (const item of entries) {
      const isIpv4 = item.family === 'IPv4' || item.family === 4;
      if (!isIpv4 || item.internal || item.address === '127.0.0.1') {
        continue;
      }

      ipv4Candidates.push(item.address);
    }
  }

  for (const address of ipv4Candidates) {
    if (isPrivateIpv4(address)) {
      return address;
    }
  }

  return '127.0.0.1';
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  if (parts[0] === 10) {
    return true;
  }

  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }

  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  return false;
}
