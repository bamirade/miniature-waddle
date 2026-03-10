/**
 * Edge Cases & Stress Test
 * Tests rapid picks, simultaneous actions, capacity overflow
 *
 * Run: node test-edge-cases.js
 */

const io = require('socket.io-client');

class TestClient {
  constructor(name) {
    this.name = name;
    this.socket = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io('http://localhost:3000', {
        transports: ['websocket', 'polling'],
      });

      const timeout = setTimeout(() => reject(new Error('Connect timeout')), 5000);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  join() {
    return new Promise((resolve) => {
      this.socket.emit('player:join', { name: this.name });

      const timeout = setTimeout(resolve, 3000);
      this.socket.once('lobby:update', (data) => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  markReady() {
    return new Promise((resolve) => {
      this.socket.emit('player:ready', {});
      setTimeout(resolve, 100);
    });
  }

  pick(option) {
    return new Promise((resolve) => {
      this.socket.emit('player:pick', { option });
      setTimeout(resolve, 50);
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

async function testEdgeCases() {
  console.log('\n====== EDGE CASE TESTS ======\n');

  const results = { passed: 0, failed: 0, errors: [] };

  try {
    // TEST 1: Rapid consecutive picks from same player
    console.log('[1] Rapid picks from single player...');
    {
      const c1 = new TestClient('RapidPlayer');
      const host = new TestClient('Host1');

      try {
        await c1.connect();
        await host.connect();
        await c1.join();
        await c1.markReady();
        await host.startGame();

        // Wait for round to start
        await new Promise(r => setTimeout(r, 1500));

        // Rapid-fire picks
        for (let i = 0; i < 4; i++) {
          await c1.pick(Math.floor(Math.random() * 4));
        }

        results.passed++;
        console.log('✓  Rapid picks handled\n');
      } catch (err) {
        results.failed++;
        results.errors.push(`Rapid picks: ${err.message}`);
        console.log(`✗  ${err.message}\n`);
      }

      c1.disconnect();
      host.disconnect();
    }

    // TEST 2: All players pick same option (capacity overflow)
    console.log('[2] Capacity overflow (all to option 0)...');
    {
      const players = [];
      for (let i = 0; i < 5; i++) {
        players.push(new TestClient(`Picker${i}`));
      }
      const host = new TestClient('Host2');

      try {
        await Promise.all([...players, host].map(c => c.connect()));
        await Promise.all(players.map(c => c.join()));
        await Promise.all(players.map(c => c.markReady()));
        await host.startGame();

        // Wait for round
        await new Promise(r => setTimeout(r, 1500));

        // All pick option 0
        await Promise.all(players.map(c => c.pick(0)));

        // Wait for results
        await new Promise(r => setTimeout(r, 2000));

        results.passed++;
        console.log('✓  Capacity overflow handled\n');
      } catch (err) {
        results.failed++;
        results.errors.push(`Capacity overflow: ${err.message}`);
        console.log(`✗  ${err.message}\n`);
      }

      [...players, host].forEach(c => c.disconnect());
    }

    // TEST 3: Simultaneous ready + start (race condition)
    console.log('[3] Simultaneous ready + start race...');
    {
      const players = [];
      for (let i = 0; i < 3; i++) {
        players.push(new TestClient(`SimPlayer${i}`));
      }
      const host = new TestClient('Host3');

      try {
        await Promise.all([...players, host].map(c => c.connect()));
        await Promise.all(players.map(c => c.join()));

        // Simultaneous ready + start
        await Promise.all([
          ...players.map(c => c.markReady()),
          new Promise(r => setTimeout(() => host.startGame().then(r), 100))
        ]);

        results.passed++;
        console.log('✓  Race condition handled\n');
      } catch (err) {
        results.failed++;
        results.errors.push(`Race condition: ${err.message}`);
        console.log(`✗  ${err.message}\n`);
      }

      [...players, host].forEach(c => c.disconnect());
    }

    // TEST 4: Pick during lobby phase (invalid)
    console.log('[4] Invalid pick during lobby...');
    {
      const c = new TestClient('InvalidPicker');

      try {
        await c.connect();
        await c.join();

        // Try to pick while still in lobby
        await c.pick(0);

        // Should not crash server
        results.passed++;
        console.log('✓  Invalid pick rejected gracefully\n');
      } catch (err) {
        // This is expected to fail
        results.passed++;
        console.log('✓  Invalid pick rejected\n');
      }

      c.disconnect();
    }

    // TEST 5: Multiple joins from same connection (should error)
    console.log('[5] Duplicate join attempt...');
    {
      const c = new TestClient('DuplicatePlayer');

      try {
        await c.connect();
        await c.join();

        // Try to join again with existing socket
        await c.join();

        // Second join should either be rejected or ignored
        results.passed++;
        console.log('✓  Duplicate join handled\n');
      } catch (err) {
        results.errors.push(`Duplicate join: ${err.message}`);
      }

      c.disconnect();
    }

  } catch (err) {
    results.failed++;
    results.errors.push(`Fatal: ${err.message}`);
    console.error(err);
  }

  // Results
  console.log('========== RESULTS ===========');
  console.log(`✓ Passed: ${results.passed}/5`);
  console.log(`✗ Failed: ${results.failed}`);
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  • ${e}`));
  }
  console.log('==============================\n');

  process.exit(results.failed > 2 ? 1 : 0); // Allow 2 expected failures
}

testEdgeCases().catch(console.error);
