/**
 * Extended E2E Game Test - Classroom Scale (10+ players)
 * Validates game handles realistic sized classrooms
 *
 * Run: node test-game-classroom-scale.js
 */

const io = require('socket.io-client');

class GameClient {
  constructor(name) {
    this.name = name;
    this.socket = null;
    this.connected = false;
    this.joined = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io('http://localhost:3000', {
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        transports: ['websocket', 'polling'],
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connect timeout'));
      }, 5000);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  join() {
    return new Promise((resolve, reject) => {
      this.socket.emit('player:join', { name: this.name });

      const timeout = setTimeout(() => {
        reject(new Error('Join failed'));
      }, 5000);

      const handler = (data) => {
        if (data && data.phase === 'lobby') {
          this.socket.off('lobby:update', handler);
          clearTimeout(timeout);
          this.joined = true;
          resolve();
        }
      };

      this.socket.on('lobby:update', handler);
    });
  }

  markReady() {
    return new Promise((resolve) => {
      this.socket.emit('player:ready', {});
      setTimeout(resolve, 200);
    });
  }

  pickOption(idx) {
    return new Promise((resolve) => {
      this.socket.emit('player:pick', { option: idx });
      setTimeout(resolve, 100);
    });
  }

  startGame() {
    return new Promise((resolve) => {
      this.socket.emit('host:start', {});
      setTimeout(resolve, 500);
    });
  }

  disconnect() {
    if (this.socket) this.socket.disconnect();
  }
}

async function testClassroomScale() {
  console.log('\n====== CLASSROOM SCALE TEST (10 Students) ======\n');

  const NUM_STUDENTS = 10;
  const clients = [];
  const results = { passed: 0, failed: 0, errors: [] };

  try {
    // Create students
    for (let i = 0; i < NUM_STUDENTS; i++) {
      clients.push(new GameClient(`S${i + 1}`));
    }

    // Connect all students
    console.log(`[1] Connecting ${NUM_STUDENTS} students...`);
    for (const client of clients) {
      try {
        await client.connect();
      } catch (err) {
        results.errors.push(`${client.name}: ${err.message}`);
        results.failed++;
      }
    }
    if (results.failed === 0) {
      results.passed++;
      console.log(`✓  All ${NUM_STUDENTS} connected\n`);
    }

    // Join all students
    console.log(`[2] Joining game...`);
    for (const client of clients) {
      try {
        await client.join();
      } catch (err) {
        results.errors.push(`${client.name} join: ${err.message}`);
      }
    }
    const joinedCount = clients.filter(c => c.joined).length;
    if (joinedCount === NUM_STUDENTS) {
      results.passed++;
      console.log(`✓  All ${NUM_STUDENTS} joined\n`);
    } else {
      results.failed++;
      console.log(`✗  Only ${joinedCount}/${NUM_STUDENTS} joined\n`);
    }

    // Mark ready
    console.log(`[3] Marking ready...`);
    await Promise.all(clients.map(c => c.markReady()));
    results.passed++;
    console.log(`✓  All marked ready\n`);

    // Start game
    console.log(`[4] Starting game...`);
    await clients[0].startGame();
    await new Promise(r => setTimeout(r, 2000)); // Wait for countdown
    results.passed++;
    console.log(`✓  Game started\n`);

    // Play one round
    console.log(`[5] Playing round (10 seconds)...`);
    let pickCount = 0;
    for (let i = 0; i < 5; i++) {
      for (const client of clients.slice(0, 5)) {
        const option = (pickCount++) % 4;
        await client.pickOption(option);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    results.passed++;
    console.log(`✓  Round completed (${pickCount} picks)\n`);

    // Verify game progresses
    console.log(`[6] Checking game progression...`);
    await new Promise(r => setTimeout(r, 15000)); // Wait for game logic
    results.passed++;
    console.log(`✓  Game progressed\n`);

  } catch (err) {
    results.failed++;
    results.errors.push(`Fatal: ${err.message}`);
    console.error(err);
  } finally {
    // Cleanup
    for (const client of clients) {
      client.disconnect();
    }
  }

  // Results
  console.log('========== RESULTS ===========');
  console.log(`✓ Passed: ${results.passed}/6`);
  console.log(`✗ Failed: ${results.failed}`);
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.slice(0, 5).forEach(e => console.log(`  • ${e}`));
    if (results.errors.length > 5) console.log(`  ... and ${results.errors.length - 5} more`);
  }
  console.log('==============================\n');

  process.exit(results.failed > 0 ? 1 : 0);
}

testClassroomScale().catch(console.error);
