const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./src/config');
const { createServer } = require('./src/server/createServer');

let mainWindow;
let gameServer;

function checkWindowsFirewall() {
  // Only run on Windows
  if (process.platform !== 'win32') {
    return;
  }

  try {
    // Check if firewall rule exists for the app
    const result = execSync(`netsh advfirewall firewall show rule name="${config.firewall.ruleName}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!result.includes(config.firewall.ruleName)) {
      showFirewallWarning();
    }
  } catch (error) {
    // Rule doesn't exist or error checking - show warning
    showFirewallWarning();
  }
}

function showFirewallWarning() {
  const resourcesPath = process.resourcesPath || path.join(__dirname);
  const firewallScriptPath = path.join(resourcesPath, 'configure-firewall.bat');

  dialog.showMessageBox(mainWindow || null, {
    type: 'warning',
    title: 'Windows Firewall Configuration',
    message: 'Firewall May Block External Connections',
    detail: 'Students on other devices may not be able to connect unless Windows Firewall is configured.\n\n' +
            'Would you like to configure the firewall now? (Requires Administrator privileges)',
    buttons: ['Configure Firewall', 'Configure Manually Later', 'Ignore'],
    defaultId: 0,
    cancelId: 2
  }).then(result => {
    if (result.response === 0) {
      // Try to open the firewall configuration script
      shell.openPath(firewallScriptPath).catch(() => {
        dialog.showMessageBox(mainWindow || null, {
          type: 'info',
          title: 'Manual Configuration Required',
          message: 'Please configure the firewall manually',
          detail: 'To allow external connections:\n\n' +
                  '1. Open Windows Defender Firewall\n' +
                  '2. Click "Allow an app through firewall"\n' +
                  '3. Add "Game Host.exe" to the allowed apps list\n' +
                  '4. Or run configure-firewall.bat in the installation folder',
          buttons: ['OK']
        });
      });
    } else if (result.response === 1) {
      dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Manual Firewall Configuration',
        message: 'To configure the firewall manually:',
        detail: '1. Run "configure-firewall.bat" from the installation folder as Administrator\n' +
                '   OR\n' +
                '2. Open Windows Defender Firewall\n' +
                '3. Click "Allow an app or feature through Windows Defender Firewall"\n' +
                '4. Click "Change settings" then "Allow another app..."\n' +
                '5. Browse and select "Game Host.exe"\n' +
                '6. Make sure both "Private" and "Public" are checked\n' +
                '7. Click "Add"',
        buttons: ['OK']
      });
    }
  });
}


function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Game Host',
    backgroundColor: '#1a1a2e',
  });

  mainWindow.loadURL(`http://localhost:${port}/host`);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (gameServer) {
      gameServer.cleanup();
    }
    app.quit();
  });
}

function startServer() {
  const PUBLIC_DIR = path.join(__dirname, 'public');

  gameServer = createServer({ publicDir: PUBLIC_DIR });

  return gameServer.start().then(({ port }) => {
    console.log(`Electron: Server successfully started on port ${port}`);
    return port;
  });
}

app.whenReady().then(async () => {
  const port = await startServer();
  createWindow(port);

  // Check firewall configuration after a short delay (give window time to load)
  setTimeout(() => {
    checkWindowsFirewall();
  }, config.firewall.checkDelay);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

app.on('window-all-closed', () => {
  if (gameServer) {
    gameServer.cleanup();
  }
  app.quit();
});
