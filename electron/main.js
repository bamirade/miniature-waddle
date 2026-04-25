const { app, BrowserWindow } = require('electron');
const { exec } = require('child_process');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });
  win.loadURL('http://localhost:3000/host.html');
}

function allowFirewallPort() {
  // Add firewall rule for port 3000 (Windows only)
  if (process.platform === 'win32') {
    exec('netsh advfirewall firewall add rule name="MiniWaddle3000" dir=in action=allow protocol=TCP localport=3000', (err) => {
      if (err) {
        console.error('Firewall rule could not be added:', err);
      }
    });
  }
}

function startServer() {
  // Start the Node.js server if not already running
  const serverPath = path.join(__dirname, '..', 'server.js');
  exec(`node "${serverPath}"`, (err, stdout, stderr) => {
    if (err) {
      // Server may already be running, ignore error
      if (!stderr.includes('EADDRINUSE')) {
        console.error('Server start error:', err);
      }
    }
  });
}

app.whenReady().then(() => {
  allowFirewallPort();
  startServer();
  setTimeout(createWindow, 2000); // Wait a bit for server to start
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
