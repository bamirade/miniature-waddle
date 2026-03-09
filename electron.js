const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { execSync } = require('child_process');
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
} = require('./src/game/state');

let mainWindow;
let server;

function checkWindowsFirewall() {
  // Only run on Windows
  if (process.platform !== 'win32') {
    return;
  }

  try {
    // Check if firewall rule exists for the app
    const result = execSync('netsh advfirewall firewall show rule name="Game Host"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (!result.includes('Game Host')) {
      showFirewallWarning();
    }
  } catch (error) {
    // Rule doesn't exist or error checking - show warning
    showFirewallWarning();
  }
}

function showFirewallWarning() {
  const resourcesPath = process.resourcesPath || path.join(__dirname);
  const firewallScriptPath = path.join(resourcesPath, 'configure-firewall.bat');

  dialog.showMessageBox(mainWindow || null, {
    type: 'warning',
    title: 'Windows Firewall Configuration',
    message: 'Firewall May Block External Connections',
    detail: 'Students on other devices may not be able to connect unless Windows Firewall is configured.\n\n' +
            'Would you like to configure the firewall now? (Requires Administrator privileges)',
    buttons: ['Configure Firewall', 'Configure Manually Later', 'Ignore'],
    defaultId: 0,
    cancelId: 2
  }).then(result => {
    if (result.response === 0) {
      // Try to open the firewall configuration script
      shell.openPath(firewallScriptPath).catch(() => {
        dialog.showMessageBox(mainWindow || null, {
          type: 'info',
          title: 'Manual Configuration Required',
          message: 'Please configure the firewall manually',
          detail: 'To allow external connections:\n\n' +
                  '1. Open Windows Defender Firewall\n' +
                  '2. Click "Allow an app through firewall"\n' +
                  '3. Add "Game Host.exe" to the allowed apps list\n' +
                  '4. Or run configure-firewall.bat in the installation folder',
          buttons: ['OK']
        });
      });
    } else if (result.response === 1) {
      dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Manual Firewall Configuration',
        message: 'To configure the firewall manually:',
        detail: '1. Run "configure-firewall.bat" from the installation folder as Administrator\n' +
                '   OR\n' +
                '2. Open Windows Defender Firewall\n' +
                '3. Click "Allow an app or feature through Windows Defender Firewall"\n' +
                '4. Click "Change settings" then "Allow another app..."\n' +
                '5. Browse and select "Game Host.exe"\n' +
                '6. Make sure both "Private" and "Public" are checked\n' +
                '7. Click "Add"',
        buttons: ['OK']
      });
    }
  });
}


function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'Game Host',
    backgroundColor: '#1a1a2e'
  });

  mainWindow.loadURL(`http://localhost:${port}/host`);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (server) {
      server.close();
    }
    app.quit();
  });
}

function startServer() {
  const expressApp = express();
  server = http.createServer(expressApp);
  const io = new Server(server);

  const PORT = Number(process.env.PORT) || 3000;
  const PUBLIC_DIR = path.join(__dirname, 'public');
  const SERVER_HOST = '0.0.0.0'; // Listen on all network interfaces for external access
  const LAN_IP = process.env.HOST_IP || getPreferredLanIpv4();
  const JOIN_URL = `http://${LAN_IP}:${PORT}/`;
  const gameState = createGameState();

  expressApp.use(express.static(PUBLIC_DIR));

  expressApp.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  expressApp.get('/student', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'student.html'));
  });

  expressApp.get('/host', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'host.html'));
  });

  expressApp.get('/config', (req, res) => {
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

  return new Promise((resolve) => {
    server.listen(PORT, SERVER_HOST, () => {
      console.log(`=== Game Host Server Started ===`);
      console.log(`Server listening on all interfaces (${SERVER_HOST}:${PORT})`);
      console.log(`Local address: http://localhost:${PORT}/host`);
      console.log(`Network address: ${JOIN_URL}/`);
      console.log(`Students join at: ${JOIN_URL}`);
      console.log(`================================`);
      resolve(PORT);
    });
  });
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

app.whenReady().then(async () => {
  const port = await startServer();
  createWindow(port);

  // Check firewall configuration after a short delay (give window time to load)
  setTimeout(() => {
    checkWindowsFirewall();
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  app.quit();
});
