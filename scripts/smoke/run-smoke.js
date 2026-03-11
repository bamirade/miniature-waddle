#!/usr/bin/env node

const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const coreFlowScenario = require('./scenarios/coreFlow');
const browserConsoleFlowScenario = require('./scenarios/browserConsoleFlow');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ENTRY = path.join('src', 'server.js');
const DEFAULT_SERVER_PORT = 3000;
const SERVER_READY_TIMEOUT_MS = 15_000;
const SCENARIO_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 4_000;
const MAX_LOG_LINES = 200;
const STARTUP_LOG_TIMEOUT_MS = 10_000;

const fallbackStartupScenario = {
  name: 'occupiedDefaultPort',
  type: 'standalone',
};

const scenarios = [fallbackStartupScenario, coreFlowScenario, browserConsoleFlowScenario];

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();

    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address !== 'object') {
        probe.close(() => reject(new Error('Failed to determine free port')));
        return;
      }

      const { port } = address;
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function requestUrl(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`HTTP request timed out for ${url}`));
    });

    request.on('error', reject);
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function requestJson(baseUrl, pathname, timeoutMs = 5_000) {
  const response = await requestUrl(new URL(pathname, baseUrl), timeoutMs);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${pathname} returned unexpected status ${response.statusCode}`);
  }

  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new Error(`${pathname} returned invalid JSON: ${error.message}`);
  }
}

async function requestText(baseUrl, pathname, timeoutMs = 5_000) {
  const response = await requestUrl(new URL(pathname, baseUrl), timeoutMs);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${pathname} returned unexpected status ${response.statusCode}`);
  }
  return response.body;
}

function startServer(options = {}) {
  const { port } = options;
  const env = {
    ...process.env,
    HOST_IP: '127.0.0.1',
  };

  if (typeof port === 'number') {
    env.PORT = String(port);
  } else {
    delete env.PORT;
  }

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  const appendLogs = (source, chunk) => {
    const lines = String(chunk)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      logs.push(`[${source}] ${line}`);
      if (logs.length > MAX_LOG_LINES) {
        logs.shift();
      }
    }
  };

  child.stdout.on('data', (chunk) => appendLogs('stdout', chunk));
  child.stderr.on('data', (chunk) => appendLogs('stderr', chunk));

  return {
    child,
    baseUrl: typeof port === 'number' ? `http://127.0.0.1:${port}` : null,
    getLogs: () => logs.join('\n'),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(serverProcess, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (serverProcess.child.exitCode !== null) {
      throw new Error(`Server exited early with code ${serverProcess.child.exitCode}`);
    }

    try {
      await requestJson(serverProcess.baseUrl, '/config', 1_000);
      return;
    } catch (error) {
      await sleep(250);
    }
  }

  throw new Error('Timed out while waiting for /config to become available');
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(true);
      return;
    }

    const onExit = () => {
      cleanup();
      resolve(true);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      child.off('exit', onExit);
    }

    child.once('exit', onExit);
  });
}

function isProcessAlive(pid) {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

async function stopServer(serverProcess) {
  const { child } = serverProcess;

  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  let exited = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);

  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    exited = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
  }

  if (!exited || child.exitCode === null) {
    throw new Error('Server process failed to exit cleanly');
  }

  if (isProcessAlive(child.pid)) {
    throw new Error(`Server process ${child.pid} is still alive after shutdown`);
  }
}

async function runScenario(scenario) {
  const port = await getFreePort();
  const serverProcess = startServer({ port });
  const startedAt = Date.now();

  let scenarioError = null;
  let shutdownError = null;

  try {
    await waitForServerReady(serverProcess, SERVER_READY_TIMEOUT_MS);

    await withTimeout(
      scenario.run({
        baseUrl: serverProcess.baseUrl,
        requestJson: (pathname, timeoutMs) => requestJson(serverProcess.baseUrl, pathname, timeoutMs),
        requestText: (pathname, timeoutMs) => requestText(serverProcess.baseUrl, pathname, timeoutMs),
      }),
      SCENARIO_TIMEOUT_MS,
      `Scenario timeout after ${SCENARIO_TIMEOUT_MS}ms`
    );
  } catch (error) {
    scenarioError = error;
  }

  try {
    await stopServer(serverProcess);
  } catch (error) {
    shutdownError = error;
  }

  const durationMs = Date.now() - startedAt;

  return {
    name: scenario.name,
    ok: !scenarioError && !shutdownError,
    durationMs,
    scenarioError,
    shutdownError,
    serverLogs: serverProcess.getLogs(),
  };
}

function waitForLogMatch(serverProcess, regex, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    function check() {
      const logs = serverProcess.getLogs();
      const match = logs.match(regex);
      if (match) {
        resolve(match);
        return;
      }

      if (serverProcess.child.exitCode !== null) {
        reject(new Error(`Server exited early with code ${serverProcess.child.exitCode}`));
        return;
      }

      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for log pattern ${regex}`));
        return;
      }

      setTimeout(check, 100);
    }

    check();
  });
}

function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.unref();

    blocker.once('error', reject);
    blocker.listen(port, '0.0.0.0', () => {
      resolve(blocker);
    });
  });
}

function releasePortBlocker(blocker) {
  return new Promise((resolve, reject) => {
    if (!blocker || !blocker.listening) {
      resolve();
      return;
    }

    blocker.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function ensurePortOccupied(port) {
  try {
    const blocker = await occupyPort(port);
    return { blocker, occupiedBySmoke: true };
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      return { blocker: null, occupiedBySmoke: false };
    }
    throw error;
  }
}

async function runFallbackStartupScenario() {
  const startedAt = Date.now();
  let blocker = null;
  let serverProcess = null;
  let scenarioError = null;
  let shutdownError = null;
  let blockerError = null;
  let serverLogs = '';

  try {
    const occupiedPortState = await ensurePortOccupied(DEFAULT_SERVER_PORT);
    blocker = occupiedPortState.blocker;
    serverProcess = startServer();

    const joinUrlMatch = await waitForLogMatch(
      serverProcess,
      /Students join at:\s*(http:\/\/[^\s]+)/,
      STARTUP_LOG_TIMEOUT_MS
    );

    const fallbackWarningRegex = new RegExp(
      `Port ${DEFAULT_SERVER_PORT} is already in use\\. Falling back to port (\\d+)\\.`
    );

    const fallbackNoticeMatch = await waitForLogMatch(
      serverProcess,
      fallbackWarningRegex,
      STARTUP_LOG_TIMEOUT_MS
    );

    const joinUrl = joinUrlMatch[1];
    const joinUrlObject = new URL(joinUrl);
    const joinPort = Number.parseInt(joinUrlObject.port, 10);
    const loggedFallbackPort = Number.parseInt(fallbackNoticeMatch[1], 10);

    assertCondition(Number.isInteger(joinPort) && joinPort > 0, 'Join URL must include a valid fallback port');
    assertCondition(joinPort !== DEFAULT_SERVER_PORT, 'Join URL port should not remain 3000 when default port is occupied');
    assertCondition(joinPort === loggedFallbackPort, 'Fallback warning port and join URL port must match');

    const config = await requestJson(`http://127.0.0.1:${joinPort}`, '/config', 5_000);
    assertCondition(config.port === joinPort, '/config port should match fallback port');
    assertCondition(config.joinUrl === joinUrl, '/config joinUrl should match logged join URL');
  } catch (error) {
    scenarioError = error;
  }

  if (serverProcess) {
    serverLogs = serverProcess.getLogs();
    try {
      await stopServer(serverProcess);
    } catch (error) {
      shutdownError = error;
    }
  }

  if (blocker) {
    try {
      await releasePortBlocker(blocker);
    } catch (error) {
      blockerError = error;
    }
  }

  return {
    name: fallbackStartupScenario.name,
    ok: !scenarioError && !shutdownError && !blockerError,
    durationMs: Date.now() - startedAt,
    scenarioError,
    shutdownError,
    blockerError,
    serverLogs,
  };
}

async function main() {
  console.log('Running smoke suite with isolated server instances...');

  const results = [];
  for (const scenario of scenarios) {
    process.stdout.write(`- ${scenario.name} ... `);
    const result = scenario.type === 'standalone'
      ? await runFallbackStartupScenario()
      : await runScenario(scenario);
    results.push(result);

    if (result.ok) {
      console.log(`PASS (${result.durationMs}ms)`);
    } else {
      console.log(`FAIL (${result.durationMs}ms)`);

      if (result.scenarioError) {
        console.log(`  scenario error: ${result.scenarioError.message}`);
      }
      if (result.shutdownError) {
        console.log(`  shutdown error: ${result.shutdownError.message}`);
      }
      if (result.blockerError) {
        console.log(`  blocker cleanup error: ${result.blockerError.message}`);
      }
      if (result.serverLogs) {
        console.log('  server log tail:');
        for (const line of result.serverLogs.split('\n')) {
          console.log(`    ${line}`);
        }
      }
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log('');
  console.log(`Smoke summary: ${results.length - failed.length}/${results.length} passed`);

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

main().catch((error) => {
  console.error('Smoke runner crashed:', error);
  process.exitCode = 1;
});
