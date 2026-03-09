# Windows Firewall Configuration

## Overview

The Game Host application needs to accept incoming network connections so that students can connect from their devices. Windows Firewall may block these connections by default.

## Automatic Configuration

The application includes automatic firewall configuration:

### During Installation (NSIS Installer)

When you install Game Host using the `.exe` installer:
1. The installer will request Administrator privileges
2. It automatically creates Windows Firewall rules to allow incoming connections
3. Rules are created for both the executable and port 3000 (TCP)

### At Runtime

When you launch the Game Host application:
1. The app checks if firewall rules exist
2. If rules are missing, a dialog will prompt you to configure the firewall
3. You can choose to:
   - **Configure Firewall**: Opens the configuration script (requires admin rights)
   - **Configure Manually Later**: Shows manual configuration instructions
   - **Ignore**: Continue without changing firewall settings (students may not be able to connect)

## Manual Configuration

### Option 1: Use the Configuration Script

The easiest way to configure the firewall manually:

1. Navigate to the installation folder (usually `C:\Program Files\Game Host\resources\`)
2. Right-click `configure-firewall.bat`
3. Select "Run as administrator"
4. Follow the prompts

### Option 2: Windows Firewall Settings

To configure the firewall through Windows settings:

1. Open **Windows Defender Firewall**
2. Click **"Allow an app or feature through Windows Defender Firewall"**
3. Click **"Change settings"** (requires admin)
4. Click **"Allow another app..."**
5. Browse and select **"Game Host.exe"** from the installation folder
6. Make sure both **"Private"** and **"Public"** are checked
7. Click **"Add"**

### Option 3: Command Line

Open PowerShell or Command Prompt as Administrator and run:

```powershell
netsh advfirewall firewall add rule name="Game Host" dir=in action=allow protocol=TCP localport=3000 program="C:\Path\To\Game Host.exe" enable=yes
```

Replace `C:\Path\To\Game Host.exe` with the actual path to the executable.

## Firewall Rules Details

The application creates the following firewall rules:

- **Rule Name**: Game Host
- **Direction**: Inbound (and Outbound)
- **Protocol**: TCP
- **Port**: 3000
- **Action**: Allow
- **Profile**: All (Private, Public, Domain)

## Troubleshooting

### Students Can't Connect

If students cannot connect to the game:

1. **Check Firewall Rules**
   - Run the configure-firewall script again
   - Verify rules exist in Windows Defender Firewall

2. **Check Network Connection**
   - Ensure all devices are on the same network
   - Verify the host computer's IP address is correct
   - Try pinging the host computer from a student device

3. **Temporarily Disable Firewall** (for testing only)
   - Open Windows Defender Firewall
   - Click "Turn Windows Defender Firewall on or off"
   - Temporarily turn off for Private networks
   - If students can connect now, the issue is firewall-related
   - **Remember to turn the firewall back on!**

4. **Check Antivirus Software**
   - Some antivirus programs have their own firewall
   - Add Game Host to the antivirus exceptions/whitelist

### Permission Issues

If you get "Access Denied" errors:
- Make sure you're running the configuration script as Administrator
- Right-click and select "Run as administrator"

### Corporate/School Networks

On managed networks (school, corporate):
- You may need IT administrator assistance
- Network policies might block certain connections
- The port 3000 might be blocked by network firewall rules

## Uninstallation

When you uninstall Game Host, the firewall rules are automatically removed.

To manually remove firewall rules:

```powershell
netsh advfirewall firewall delete rule name="Game Host"
```

Or through PowerShell:

```powershell
Remove-NetFirewallRule -DisplayName "Game Host"
```

## Security Notes

- The firewall rules only allow connections to the Game Host application
- Only port 3000 (TCP) is opened
- The application only listens on the local network (private IP ranges)
- No external internet connections are accepted
- The server is only accessible from devices on your local network

## For Developers

### Build Configuration

The firewall configuration is implemented through:

1. **NSIS Installer Script** (`build/installer.nsh`)
   - Runs during installation with elevated privileges
   - Creates firewall rules using `netsh` commands

2. **PowerShell Script** (`build/configure-firewall.ps1`)
   - Standalone script for manual configuration
   - Can be run post-installation

3. **Batch File** (`build/configure-firewall.bat`)
   - Wrapper that requests elevation and runs PowerShell script

4. **Electron Runtime Check** (`electron.js`)
   - Checks if firewall rules exist on startup
   - Prompts user if configuration is needed
   - Uses `child_process.execSync` to check rules

### Testing Firewall Configuration

To test if firewall rules are working:

```powershell
# Check if rule exists
netsh advfirewall firewall show rule name="Game Host"

# Test port connectivity from another device
Test-NetConnection -ComputerName <HOST_IP> -Port 3000
```
