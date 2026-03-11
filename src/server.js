const net = require('net');
const path = require('path');
const config = require('./config');
const { createServer } = require('./server/createServer');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
let gameServer = null;

function isAddressInUseError(error) {
  return Boolean(error && error.code === 'EADDRINUSE');
}

function createFriendlyStartupError(message) {
  const error = new Error(message);
  error.isFriendly = true;
  return error;
}

function getExplicitPortRemediationMessage(port) {
  return [
    `Port ${port} is already in use and PORT was explicitly set.`,
    `Free port ${port} or set PORT to a different value.`,
    'Examples:',
    '  Linux/macOS: PORT=3001 npm start',
    '  Windows (cmd): set PORT=3001 && npm start'
  ].join('\n');
}

function getFreePort(host) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();

    probe.once('error', reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      if (!address || typeof address !== 'object' || !Number.isInteger(address.port)) {
        probe.close(() => reject(new Error('Failed to allocate a fallback port')));
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

async function startServerOnPort(port) {
  const serverInstance = createServer({
    publicDir: PUBLIC_DIR,
    host: config.server.host,
    port,
  });

  try {
    await serverInstance.start();
    return serverInstance;
  } catch (error) {
    serverInstance.cleanup();
    throw error;
  }
}

async function startWithFallback(requestedPort) {
  const maxAttempts = 5;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const fallbackPort = await getFreePort(config.server.host);
    if (fallbackPort === requestedPort) {
      continue;
    }

    try {
      const serverInstance = await startServerOnPort(fallbackPort);
      console.warn(`Port ${requestedPort} is already in use. Falling back to port ${fallbackPort}.`);
      return serverInstance;
    } catch (error) {
      if (!isAddressInUseError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError || createFriendlyStartupError(`Unable to bind a fallback port after ${maxAttempts} attempts.`);
}

async function startServer() {
  const requestedPort = config.server.port;

  try {
    gameServer = await startServerOnPort(requestedPort);
    return;
  } catch (error) {
    if (!isAddressInUseError(error)) {
      throw error;
    }

    if (config.server.explicitPort) {
      throw createFriendlyStartupError(getExplicitPortRemediationMessage(requestedPort));
    }

    gameServer = await startWithFallback(requestedPort);
  }
}

startServer().catch((error) => {
  if (error && error.isFriendly) {
    console.error(error.message);
  } else {
    console.error('Failed to start server:', error);
  }
  process.exit(1);
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down server...');
  if (gameServer && typeof gameServer.cleanup === 'function') {
    gameServer.cleanup();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
