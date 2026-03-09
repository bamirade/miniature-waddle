# Game Host - Desktop Application

A standalone Windows desktop application for hosting multiplayer classroom warm-up games.

## Features

- 🖥️ Native Windows desktop application
- 🔥 Automatic Windows Firewall configuration
- 🌐 Local network multiplayer support
- 📱 Students connect via any web browser
- 🎮 No internet connection required

## Installation

### From Installer (Recommended)

1. Download `Game-Host-Setup-x.x.x.exe`
2. Run the installer (requires Administrator privileges)
3. The installer will automatically configure Windows Firewall
4. Launch "Game Host" from Start Menu or Desktop

### Portable Version

If using the portable version from `dist/win-unpacked/`:

1. Extract the folder to your desired location
2. Run `configure-firewall.bat` as Administrator to set up firewall rules
3. Run `Game Host.exe`

## Usage

1. **Start the Application**
   - Launch "Game Host" from Start Menu or run `Game Host.exe`
   - The host interface will open automatically
   - A server will start on port 3000

2. **Configure Firewall (if prompted)**
   - On first run, you may see a firewall configuration prompt
   - Choose "Configure Firewall" to automatically set up (requires admin)
   - Or configure manually later (see [FIREWALL.md](FIREWALL.md))

3. **Share the Join URL**
   - The host screen displays a join URL (e.g., `http://192.168.1.100:3000/`)
   - Students scan the QR code or visit the URL in their web browser
   - Students can use any device with a browser (phone, tablet, laptop)

4. **Start the Game**
   - Wait for students to join
   - Click "Start Game" when ready
   - Host screen shows questions and live statistics
   - Students answer on their devices

## Network Requirements

- Host computer and student devices must be on the same local network (WiFi/LAN)
- Port 3000 must be accessible (firewall rules are set up automatically)
- No internet connection required

## Troubleshooting

### Students Can't Connect

See [FIREWALL.md](FIREWALL.md) for detailed troubleshooting steps:

1. **Check Firewall**
   - Run `configure-firewall.bat` as Administrator
   - Or manually add firewall rules

2. **Verify Network**
   - Ensure all devices are on the same WiFi/network
   - Check that the IP address shown is correct

3. **Test Connection**
   - Try accessing the join URL from the host computer first
   - Temporarily disable firewall to test (don't forget to re-enable!)

### Performance Issues

- Close unnecessary applications
- Ensure good WiFi signal strength for all devices
- Reduce number of concurrent players if needed

## Building from Source

### Prerequisites

- Node.js (v16 or higher)
- npm

### Development Mode

```bash
# Install dependencies
npm install

# Run the server only (web version)
npm start

# Run as Electron app (desktop version)
npm run electron
```

### Building the Executable

```bash
# Build for Windows (64-bit)
npm run build

# Build for both 32-bit and 64-bit
npm run build:all
```

The executable will be created in the `dist/` folder:
- `dist/Game Host Setup x.x.x.exe` - Installer
- `dist/win-unpacked/` - Portable version

**Note**: Building on Linux/Mac requires Wine or cross-compilation tools for creating the Windows installer.

## Project Structure

```
.
├── electron.js              # Electron main process
├── src/
│   ├── server.js           # Express server (original)
│   └── game/               # Game logic
├── public/                 # Web frontend assets
│   ├── host.html          # Host interface
│   ├── student.html       # Student interface
│   └── ...
├── build/                  # Build scripts
│   ├── installer.nsh      # NSIS installer script
│   ├── configure-firewall.ps1
│   └── configure-firewall.bat
└── dist/                   # Build output (generated)
```

## Scripts

- `npm start` - Run server in Node.js (development)
- `npm run electron` - Run as Electron app
- `npm run build` - Build Windows executable (64-bit)
- `npm run build:all` - Build for both 32-bit and 64-bit

## Firewall Configuration

The application automatically configures Windows Firewall during installation. For manual configuration or troubleshooting, see [FIREWALL.md](FIREWALL.md).

## License

See LICENSE file for details.
