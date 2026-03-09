const path = require('path');
const { createServer } = require('./server/createServer');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Create and start the server
const gameServer = createServer({ publicDir: PUBLIC_DIR });

gameServer.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  gameServer.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  gameServer.cleanup();
  process.exit(0);
});
