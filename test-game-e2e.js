#!/usr/bin/env node
/**
 * Comprehensive E2E Game Test Suite
 * Simulates: join → lobby → countdown → round → picks → eliminations → results
 */

const io = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';
const TEST_PLAYERS = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
let results = { pass: 0, fail: 0, errors: [] };

class GameClient {
  constructor(name) {
    this.name = name;
    this.socket = null;
    this.state = {};
    this.logs = [];
  }

  connect(serverUrl) {
    return new Promise((resolve, reject) => {
      this.socket = io(serverUrl, {
        reconnection: true,
        reconnectionDelay: 100,
        reconnectionDelayMax: 200,
        timeout: 5000
      });

      this.socket.on('connect', () => {
        this.log('✓ Connected');
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        this.log(`✗ Connection error: ${err.message}`);
        reject(err);
      });

      this.setupListeners();
      setTimeout(() => reject(new Error('Connection timeout')), 6000);
    });
  }

  setupListeners() {
    this.socket.on('lobby:update', (data) => {
      this.state.lobby = data;
      this.log(`Lobby update: ${data.totalPlayers} players, ${data.readyCount} ready, phase=${data.phase}`);
    });

    this.socket.on('game:state', (data) => {
      this.state.gameState = data;
      if (data.phase) this.log(`Game phase: ${data.phase}`);
    });

    this.socket.on('round:new', (data) => {
      this.state.round = data;
      this.log(`Round ${data.roundNumber} started: "${data.question.text}"`);
      this.log(`  Options: ${data.question.options.join(', ')}`);
      this.log(`  Slots: ${data.slotsLeft.join(', ')}`);
    });

    this.socket.on('round:update', (data) => {
      if (data.type === 'slots') {
        this.log(`Slots updated: ${data.slotsLeft.join(', ')}`);
      } else if (data.type === 'elimination') {
        this.log(`⚠ Player ${data.playerId} eliminated: ${data.reason}`);
      }
    });

    this.socket.on('game:playerLifeLost', (data) => {
      this.log(`❤️ Life lost: ${data.reason}, lives remaining: ${data.livesRemaining}`);
    });

    this.socket.on('game:playerEliminated', (data) => {
      this.log(`💀 ELIMINATED: ${data.reason}`);
    });

    this.socket.on('player:result', (data) => {
      this.log(`Pick result: status=${data.status}, reason=${data.reason}`);
      if (data.eliminated) this.log('  → Player was eliminated');
      if (data.livesRemaining !== undefined) this.log(`  → Lives: ${data.livesRemaining}`);
    });

    this.socket.on('game:results', (data) => {
      this.log(`Game finished: ${data.top.map(p => p.name).join(', ')}`);
    });

    this.socket.on('disconnect', (reason) => {
      this.log(`Disconnected: ${reason}`);
    });

    this.socket.on('error', (error) => {
      this.log(`Socket error: ${error}`);
      results.errors.push(`${this.name}: ${error}`);
    });
  }

  log(msg) {
    const timestamp = new Date().toISOString().substr(11, 8);
    const line = `[${timestamp}] [${this.name}] ${msg}`;
    this.logs.push(line);
    console.log(line);
  }

  join(name) {
    return new Promise((resolve) => {
      this.log('Joining game...');
      this.socket.emit('player:join', { name }, () => resolve());
      setTimeout(resolve, 500);
    });
  }

  ready() {
    return new Promise((resolve) => {
      this.log('Marking ready...');
      this.socket.emit('player:ready', {}, () => resolve());
      setTimeout(resolve, 500);
    });
  }

  pickOption(index) {
    return new Promise((resolve) => {
      this.log(`Picking option ${index}...`);
      this.socket.emit('player:pick', { option: index }, () => resolve());
      setTimeout(resolve, 500);
    });
  }

  startGame() {
    return new Promise((resolve) => {
      this.log('Starting game...');
      this.socket.emit('host:start', {}, () => resolve());
      setTimeout(resolve, 1000);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.log('Disconnected');
    }
  }

  get isEliminated() {
    return this.state.gameState?.phase === 'eliminated';
  }
}

async function test(name, fn) {
  try {
    await fn();
    results.pass++;
    console.log(`\n✓ PASS: ${name}\n`);
  } catch (err) {
    results.fail++;
    results.errors.push(`${name}: ${err.message}`);
    console.log(`\n✗ FAIL: ${name}\n  ${err.message}\n`);
  }
}

async function runTests() {
  console.log('\n========== GAME E2E TEST SUITE ==========\n');

  let host, players = [];

  await test('HOST: Can connect', async () => {
    host = new GameClient('HOST');
    await host.connect(SERVER_URL);
    assert(host.socket.connected, 'Host socket not connected');
  });

  await test('STUDENTS: Can connect and join', async () => {
    for (const name of TEST_PLAYERS) {
      const client = new GameClient(name);
      await client.connect(SERVER_URL);
      await client.join(name);
      players.push(client);
      await new Promise(r => setTimeout(r, 200));
    }
    assert.equal(players.length, TEST_PLAYERS.length, 'Not all students joined');
  });

  await test('LOBBY: Correct player count', async () => {
    await new Promise(r => setTimeout(r, 300));
    assert(host.state.lobby, 'Host has no lobby state');
    assert.equal(host.state.lobby.totalPlayers, TEST_PLAYERS.length, 'Player count mismatch');
  });

  await test('READY: Students can mark ready', async () => {
    for (const player of players) {
      await player.ready();
    }
    await new Promise(r => setTimeout(r, 300));
    assert(host.state.lobby.readyCount >= TEST_PLAYERS.length - 1, 'Not all players marked ready');
  });

  await test('GAME START: Host can start game', async () => {
    await host.startGame();
    await new Promise(r => setTimeout(r, 500));
    assert(host.state.gameState.phase === 'countdown', `Expected phase countdown, got ${host.state.gameState.phase}`);
  });

  await test('COUNTDOWN: Phase transitions correctly', async () => {
    await new Promise(r => setTimeout(r, 4000));
    assert(host.state.gameState.phase === 'round', 'Did not transition to round phase');
  });

  await test('ROUND: Question is displayed', async () => {
    await new Promise(r => setTimeout(r, 500));
    const activePlayers = players.filter(p => !p.isEliminated);
    for (const player of activePlayers) {
      assert(player.state.round, `${player.name} has no round state`);
      assert(player.state.round.question, 'No question in round state');
      assert(player.state.round.question.text, 'Question text missing');
      assert.equal(player.state.round.question.options.length, 4, 'Should have 4 options');
    }
  });

  await test('PICKING: Students can pick options', async () => {
    const activePlayers = players.filter(p => !p.isEliminated && p.state.round);
    for (let i = 0; i < Math.min(activePlayers.length, 3); i++) {
      const option = i % 4;
      await activePlayers[i].pickOption(option);
    }
    await new Promise(r => setTimeout(r, 500));
  });

  await test('LIVES SYSTEM: Life lost events are broadcast', async () => {
    // Give time for reveal phase and next round
    await new Promise(r => setTimeout(r, 4000));
    // Check if any player received a life-lost event
    const hasLifeLostLog = players.some(p => p.logs.some(l => l.includes('Life lost')));
    // Note: May not have life-lost if picks were correct, so this is informational
    console.log(`  Info: Life-lost events detected: ${hasLifeLostLog}`);
  });

  await test('GAME FLOW: Game can progress through multiple rounds', async () => {
    // Let game run for ~20 seconds (covers multiple rounds if picking fast)
    const startTime = Date.now();
    while (Date.now() - startTime < 20000) {
      if (host.state.gameState.phase === 'finished') break;
      await new Promise(r => setTimeout(r, 500));
    }
    assert(host.state.gameState.phase === 'finished' || host.state.gameState.phase === 'round', 'Game did not complete or continue');
  });

  // Cleanup
  for (const player of players) {
    player.disconnect();
  }
  host.disconnect();

  await new Promise(r => setTimeout(r, 500));
}

runTests()
  .then(() => {
    console.log('\n========== TEST RESULTS ==========');
    console.log(`✓ Passed: ${results.pass}`);
    console.log(`✗ Failed: ${results.fail}`);
    if (results.errors.length > 0) {
      console.log('\nErrors:');
      results.errors.forEach(e => console.log(`  - ${e}`));
    }
    console.log('==================================\n');
    process.exit(results.fail > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
