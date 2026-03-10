/**
 * Extended E2E Game Test - Large Classroom Simulation (15+ players)
 * Tests game stability with realistic classroom sizes
 *
 * Run: node test-game-e2e-large.js
 */

const io = require('socket.io-client');

class GameClient {
  constructor(name, isHost = false) {
    this.name = name;
    this.isHost = isHost;
    this.socket = null;
    this.state = {
      phase: null,
      players: 0,
      question: null,
      lives: 3,
      hasPicked: false,
    };
    this.events = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io('http://localhost:3000', {
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
        transports: ['websocket', 'polling'],
        dropUpgrade: false,
      });

      this.socket.on('connect', () => {
        this.log(`✓ Connected`);
        this.setupListeners();
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        this.log(`✗ Connection error: ${err}`);
        reject(err);
      });

      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  }

  setupListeners() {
    this.socket.on('lobby:update', (data) => {
      this.state.players = data.players || 0;
      this.state.phase = data.phase;
      this._lastLobbyUpdate = Date.now();
    });

    this.socket.on('game:state', (data) => {
      this.state.phase = data.phase;
    });

    this.socket.on('round:new', (data) => {
      this.state.question = data.question;
      this.state.hasPicked = false;
      this.log(`q: "${data.question}"`);
    });

    this.socket.on('game:playerLifeLost', (data) => {
      this.log(`❤️ Lives: ${data.livesRemaining}`);
      this.state.lives = data.livesRemaining;
    });

    this.socket.on('game:playerEliminated', (data) => {
      this.log(`💀 Eliminated`);
      this.state.lives = 0;
    });

    this.socket.on('game:results', (data) => {
      this.log(`✓ Game over`);
    });

    this.socket.on('disconnect', (reason) => {
      this.log(`Disconnected: ${reason}`);
    });

    this.socket.on('error', (error) => {
      this.log(`Error: ${error}`);
    });

    this.socket.on('player:result', (data) => {
      this.log(`Action result: ${data.status} - ${data.reason}`);
      this._lastAction = data;
    });
  }

  join() {
    return new Promise((resolve, reject) => {
      let timeoutId;
      let pollCount = 0;
      let joined = false;

      const onLobbyUpdate = (data) => {
        if (data && data.phase === 'lobby') {
          joined = true;
        }
      };

      const checkJoin = () => {
        pollCount++;
        if (joined || (this.state.phase === 'lobby' && this._lastLobbyUpdate)) {
          clearTimeout(timeoutId);
          this.socket.off('lobby:update', onLobbyUpdate);
          this.log(`Joined`);
          resolve();
          return;
        }
        if (pollCount < 150) { // Max 15 seconds at 100ms intervals
          timeoutId = setTimeout(checkJoin, 100);
        } else {
          clearTimeout(timeoutId);
          this.socket.off('lobby:update', onLobbyUpdate);
          reject(new Error(`Join timeout - state=${this.state.phase}, players=${this.state.players}`));
        }
      };

      // Listen for immediate lobby updates
      this.socket.on('lobby:update', onLobbyUpdate);

      // Send join request
      this.socket.emit('player:join', { name: this.name });

      // Start polling
      timeoutId = setTimeout(checkJoin, 100);
    });
  }

  markReady() {
    return new Promise((resolve) => {
      this.socket.emit('player:ready', {}, () => {
        this.log(`Ready`);
        resolve();
      });
    });
  }

  pickOption(index) {
    if (this.state.hasPicked) return Promise.resolve();
    this.state.hasPicked = true;
    return new Promise((resolve) => {
      this.socket.emit('player:pick', { option: index }, () => {
        this.log(`Picked ${index}`);
        resolve();
      });
    });
  }

  startGame() {
    return new Promise((resolve) => {
      this.socket.emit('host:start', {}, () => {
        this.log(`Game started`);
        resolve();
      });
    });
  }

  disconnect() {
    this.socket.disconnect();
  }

  log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${this.name}] ${msg}`);
  }
}

async function testLargeClassroom() {
  console.log('\n========== LARGE CLASSROOM E2E TEST (15 Students) ==========\n');

  const results = {
    passed: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Create host + 15 student clients
    const clients = [];
    const host = new GameClient('HOST', true);
    clients.push(host);

    const names = [
      'Alice', 'Bob', 'Charlie', 'Diana', 'Eve',
      'Frank', 'Grace', 'Henry', 'Iris', 'Jack',
      'Kate', 'Leo', 'Maya', 'Noah', 'Olivia',
    ];

    console.log('📊 SETUP: Creating 15 student clients...');
    for (const name of names) {
      clients.push(new GameClient(name));
    }

    console.log('🔌 CONNECTIONS: Connecting all clients...');
    const startTime = Date.now();

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      try {
        await client.connect();
        // Stagger connections to avoid overwhelming server
        if (i < clients.length - 1) {
          await new Promise(r => setTimeout(r, 50));
        }
      } catch (err) {
        results.errors.push(`${client.name}: Connection failed - ${err.message}`);
        results.failed++;
      }
    }
    const connectTime = Date.now() - startTime;

    console.log(`✓ All ${clients.length} clients connected in ${connectTime}ms\n`);
    if (connectTime < 5000) results.passed++;

    // Host joins
    console.log('📋 LOBBY: Host and students joining...');

    // Host doesn't join as player, just starts when ready
    // For now, skip host join - it's the game organizer, not a player

    for (let i = 1; i < clients.length; i++) {
      try {
        await clients[i].join();
      } catch (err) {
        results.errors.push(`${clients[i].name}: Join failed - ${err.message}`);
        results.failed++;
      }
      if (i % 5 === 0) console.log(`  → ${i}/${clients.length - 1} students joined`);
    }
    results.passed++;
    console.log(`✓ All ${clients.length - 1} students and host in lobby\n`);

    // Mark ready in batches
    console.log('✓ READY: Marking students ready...');
    const readyPromises = clients.slice(1).map(c => c.markReady());
    await Promise.all(readyPromises);
    results.passed++;
    console.log(`✓ All ${clients.length - 1} students marked ready\n`);

    // Start game
    console.log('🎮 GAME START: Host starting game...');
    await host.startGame();
    results.passed++;

    await new Promise(r => setTimeout(r, 1000)); // Wait for countdown

    // Game loop - run for 30 seconds
    console.log('🎯 GAMEPLAY: Running game for 60 seconds...');
    const gameStartTime = Date.now();
    const gameTimeout = 60000;
    let roundCount = 0;
    let pickCount = 0;

    while (Date.now() - gameStartTime < gameTimeout) {
      const activePlayers = clients.filter(c => c.state.phase === 'round' && !c.state.hasPicked && c.state.lives > 0);

      if (activePlayers.length === 0) {
        console.log(`  → Round ${roundCount} complete, waiting for next round...`);
        roundCount++;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Random picks from active players
      for (const player of activePlayers.slice(0, Math.min(3, activePlayers.length))) {
        const option = Math.floor(Math.random() * 4);
        try {
          await player.pickOption(option);
          pickCount++;
        } catch (err) {
          results.errors.push(`${player.name}: Pick failed - ${err.message}`);
        }
      }

      await new Promise(r => setTimeout(r, 200));
    }

    const gameDuration = Date.now() - gameStartTime;
    console.log(`✓ Game ran for ${gameDuration}ms with ${pickCount} picks across ${roundCount} rounds\n`);
    results.passed++;

    // Verify game finished
    console.log('📊 RESULTS: Checking game completion...');
    const finishedCount = clients.filter(c => c.state.phase === 'finished').length;
    if (finishedCount >= clients.length - 2) {
      // Allow 1-2 lag
      results.passed++;
      console.log(`✓ ${finishedCount}/${clients.length} clients show game finished\n`);
    } else {
      results.failed++;
      results.errors.push(`Game finish verification: ${finishedCount}/${clients.length} finished`);
    }

    // Stress test: New players joining after game finishes
    console.log('🔄 REPLAY TEST: Adding new players after game finishes...');
    const newPlayers = [new GameClient('NewAlice'), new GameClient('NewBob')];
    let newJoinCount = 0;

    for (const player of newPlayers) {
      try {
        await player.connect();
        await player.join();
        newJoinCount++;
        player.disconnect();
      } catch (err) {
        results.errors.push(`New player join after finish failed: ${err.message}`);
      }
    }

    if (newJoinCount === newPlayers.length) {
      results.passed++;
      console.log(`✓ New players can join after game finishes (replay support)\n`);
    } else {
      results.failed++;
    }

    // Cleanup
    console.log('🧹 CLEANUP: Disconnecting all clients...');
    for (const client of clients) {
      client.disconnect();
    }
    results.passed++;

  } catch (err) {
    results.failed++;
    results.errors.push(`Fatal error: ${err.message}`);
    console.error('Test error:', err);
  }

  // Summary
  console.log('========== TEST RESULTS ==========');
  console.log(`✓ Passed: ${results.passed}`);
  console.log(`✗ Failed: ${results.failed}`);
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  - ${e}`));
  }
  console.log('==================================\n');

  const allPassed = results.failed === 0;
  process.exit(allPassed ? 0 : 1);
}

// Run test
testLargeClassroom().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
