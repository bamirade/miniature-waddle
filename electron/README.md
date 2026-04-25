# Electron Windows Executable for Miniature Waddle

## Host Usage
- Run the Windows executable (to be built) on the host machine.
- The Electron app will:
  - Start the Node.js server (server.js) if not already running.
  - Open a window to http://localhost:3000/host.html.
  - Auto-configure Windows Firewall to allow inbound connections on port 3000.

## Student Usage
- Students on the same WiFi can access the host at http://<host-ip>:3000 (find host IP via `ipconfig` on Windows).
- No Electron app needed for students; just use a browser.

## Build Instructions (for Windows)
1. Install dependencies:
   ```
npm install
npm install --no-save electron electron-packager
   ```
2. Build the Windows executable:
   ```
npm run build:win --prefix .
   ```
   The executable will be in the `dist/` folder.

## Notes
- The Electron app is in `electron/main.js`.
- The server entry point is `server.js`.
- The firewall rule is added automatically on first run.
- The Electron window defaults to `/host.html` for the host.
