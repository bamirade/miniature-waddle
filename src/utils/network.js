/**
 * Network utility functions for IP address detection
 */

const os = require('os');

/**
 * Get the preferred LAN IPv4 address for this machine
 * @returns {string} IPv4 address or '127.0.0.1' if none found
 */
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

  // Prefer private IP addresses
  for (const address of ipv4Candidates) {
    if (isPrivateIpv4(address)) {
      return address;
    }
  }

  return '127.0.0.1';
}

/**
 * Check if an IP address is a private IPv4 address
 * @param {string} ip - IPv4 address to check
 * @returns {boolean} True if the address is private
 */
function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  // 10.0.0.0/8
  if (parts[0] === 10) {
    return true;
  }

  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }

  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  return false;
}

module.exports = {
  getPreferredLanIpv4,
  isPrivateIpv4,
};
