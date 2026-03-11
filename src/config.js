/**
 * Application configuration constants
 */

const DEFAULT_SERVER_PORT = 3000;
const parsedPort = Number.parseInt(process.env.PORT, 10);
const hasExplicitPort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535;

const config = {
  // Server configuration
  server: {
    port: hasExplicitPort ? parsedPort : DEFAULT_SERVER_PORT,
    defaultPort: DEFAULT_SERVER_PORT,
    explicitPort: hasExplicitPort,
    host: '0.0.0.0', // Listen on all network interfaces
    tickInterval: 50, // Game state tick interval in milliseconds
  },

  // Game timing configuration
  game: {
    countdownMs: 3000,
    roundOpenMs: 10000,
    revealMs: 2000,
  },

  // Firewall configuration (Windows only)
  firewall: {
    ruleName: 'Game Host',
    checkDelay: 2000, // Delay before checking firewall rules
  },

  // Environment helpers
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};

module.exports = config;
