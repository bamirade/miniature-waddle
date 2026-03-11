# 🎮 Classroom Elimination Game

A fast-paced, local multiplayer quiz game designed for classroom warm-ups. Students join on their phones via a web app while the teacher controls the game from a dashboard. **No internet required** — runs entirely on a local network. Just connect the laptop and student devices to the same WiFi!

## 🎯 What is This?

This is a **limited slots elimination game**:
- Each round, students answer multiple-choice questions on their phones
- Available slots are **limited** based on how many students are alive
- First to pick gets their slot, latecomers are eliminated
- Wrong answers and timeouts also eliminate players
- Game continues until 3 or fewer students remain

Perfect for classroom engagement, review sessions, or just for fun!

## 📦 Installation

Install dependencies:

```bash
npm install
```

## 🚀 How to Run

Start the server:

```bash
npm start
```

The server will:
- Auto-detect your LAN IP address (e.g., `192.168.x.x`)
- Listen on port `3000` by default
- If port `3000` is occupied and `PORT` is unset, automatically select a free fallback port
- If `PORT` is explicitly set to an occupied port, exit with concise remediation text
- Display the join URL in the console

## 🌐 URLs

Once the server is running:

- **Host Dashboard**: `http://localhost:3000/host`
   Open this on the laptop to control the game, display the join QR code, and watch live progress.
   If fallback is used, replace `3000` with the port printed at startup.

- **Student Join Page**: `http://<YOUR_LAN_IP>:3000/`
  Students scan the QR code or type this URL on their phones to join.
   Example: `http://192.168.137.1:3000/` (or fallback port shown in logs)

After joining, students are automatically redirected to the gameplay page.

## Network Setup

### Simple Setup: Use Existing WiFi (Recommended)

**This is the easiest approach:**

1. **Connect your laptop to the classroom/school WiFi**
2. **Students connect their phones to the same WiFi network**
3. **Run `npm start` on the laptop**
4. **Students scan the QR code** displayed on the host dashboard, or manually enter the join URL

That's it! The server automatically detects your laptop's local IP address and generates the join URL.

### Allow Node Through Firewall

When you first run `npm start`, your system may show a firewall prompt. **Click "Allow access"** for network connections.

**Windows:**
1. Open **Windows Defender Firewall** → **Allow an app through firewall**
2. Click **"Change settings"** → **"Allow another app"**
3. Browse to your Node.js executable (usually `C:\Program Files\nodejs\node.exe`)
4. Check both **Private** and **Public** boxes
5. Click **OK**

**macOS:**
- System Preferences → Security & Privacy → Firewall → Firewall Options
- Add Node.js if prompted

**Linux:**
- Use `ufw` or your distribution's firewall manager to allow port 3000

### Alternative: Mobile Hotspot

If you don't have WiFi or want an isolated network:

**Windows:**
1. Open **Settings** → **Network & Internet** → **Mobile hotspot**
2. Turn on **"Share my Internet connection with other devices"**
3. Note the **Network name** and **Password**
4. Students connect their phones to this hotspot WiFi

**macOS:**
- System Preferences → Sharing → Internet Sharing

**Linux:**
- Use NetworkManager to create a hotspot

## 🛠️ Troubleshooting

### Phone Can't Open the Page

**Check these common issues:**

1. **Wrong IP or Port**
   - The console shows the detected IP when the server starts
   - Verify the URL matches what's displayed: `http://<IP>:3000/`

2. **Firewall Blocking**
   - Ensure Node.js is allowed through Windows Firewall (see above)
   - Temporarily disable firewall to test: if it works, re-enable and add Node properly

3. **Not on Same Network**
   - Both laptop and student phones must be connected to the **same WiFi network**
   - Check WiFi name on all devices matches
   - If using mobile hotspot, ensure students are connected to the hotspot, not some other WiFi

4. **Using HTTPS Instead of HTTP**
   - Ensure the URL starts with `http://` not `https://`
   - Browsers may auto-correct to `https` — manually type `http://`

5. **Phone Browser Cache**
   - Try opening in incognito/private mode
   - Or clear browser cache and reload

### Wrong IP Address Detected

If the server detects the wrong LAN IP (e.g., VirtualBox adapter instead of your WiFi):

1. **Find your correct IPv4 address:**
   - **Windows:** Open Command Prompt or PowerShell and run `ipconfig`
   - **macOS/Linux:** Open Terminal and run `ifconfig` or `ip addr`
   - Look for the **"Wi-Fi"**, **"Wireless"**, or **"Mobile Hotspot"** adapter
   - Note the **IPv4 Address** (e.g., `192.168.1.100` or `192.168.137.1`)

2. **Override with environment variable:**

   **On Windows (Command Prompt):**
   ```cmd
   set HOST_IP=192.168.137.1
   npm start
   ```

   **On Windows (PowerShell):**
   ```powershell
   $env:HOST_IP="192.168.137.1"
   npm start
   ```

   **On Linux/Mac:**
   ```bash
   HOST_IP=192.168.137.1 npm start
   ```

3. **Verify in console:**
   - Check the join URL displayed at startup
   - Open `/host` to confirm the QR code shows the correct IP

### Port Already in Use

Startup behavior is intentionally different for unset vs explicit `PORT`:

- If `PORT` is **unset** and `3000` is occupied: the app auto-falls back to a free port and logs the final join URL.
- If `PORT` is **explicitly set** and occupied: startup exits non-zero with remediation text.

Use an explicit override when you want a specific fixed port:

```bash
PORT=3001 npm start
```

Windows Command Prompt:

```cmd
set PORT=3001 && npm start
```

## 🎮 Game Flow

1. **Teacher** opens `/host` on laptop
2. **Students** scan QR code or visit join URL
3. **Students** enter nickname and click "Join"
4. **Teacher** waits for students to click "Ready"
5. **Teacher** clicks "Start Game" when ready
6. **Game starts** with 3-second countdown
7. **Each round:**
   - Students see question + 4 options (A/B/C/D)
   - Limited slots shown under each option
   - Students pick quickly before slots fill
   - Wrong picks, timeouts, or full slots = elimination
8. **Game ends** when 3 or fewer students remain
9. **Results** show top 3 winners

## 🔧 Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Real-time**: WebSocket connections via Socket.IO
- **No build step**: Runs directly with Node

## 🧪 Smoke Testing

Run the automated smoke suite to verify the server and core game flow work correctly on a clean machine:

```bash
npm run smoke
```

**Expected output:**
```
Running smoke suite with isolated server instances...
- occupiedDefaultPort ... PASS (250ms)
- coreFlow ... PASS (300ms)
- browserConsoleFlow ... PASS (900ms)

Smoke summary: 3/3 passed
```

The suite validates occupied-default-port startup fallback, core game flow through finished-phase payload integrity checks, and browser-runtime host/student phase transitions with blocking console/runtime error detection.

**Common failure hints:**
- `EADDRINUSE` — another process is holding the chosen port; retry or kill the conflicting process.
- `Server did not become ready` — server may be hanging on startup; run `npm start` manually to check for errors.
- `game did not reach countdown` — game logic or socket event regression; check `src/game/` and `src/server/socketHandlers.js`.
- On Linux, `npm run build` will additionally require Wine for the Windows installer target; this is an environment prerequisite, not an application regression.

## 📄 License

MIT
