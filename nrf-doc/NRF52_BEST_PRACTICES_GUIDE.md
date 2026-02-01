# nRF52 Development Best Practices Guide
## Nordic Semiconductor & Zephyr RTOS - Lessons Learned

**Created:** January 29, 2026  
**Based On:** Real debugging session with nRF52840 DK + nRF Connect SDK v3.2.1  
**Purpose:** Document best practices, common pitfalls, and proven workflows

---

## Table of Contents

1. [Essential Command-Line Workflows](#essential-command-line-workflows)
2. [Build & Flash Best Practices](#build--flash-best-practices)
3. [Log Capture Strategies](#log-capture-strategies)
4. [Device Management](#device-management)
5. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
6. [Debugging Workflow](#debugging-workflow)
7. [Struggles & Lessons Learned](#struggles--lessons-learned)
8. [Pro Tips](#pro-tips)

---

## Essential Command-Line Workflows

### 1. Project Setup & Initial Build

```bash
# Navigate to project directory
cd central  # or cd peripheral

# Build for specific board (FIRST build)
west build -b nrf52840dk/nrf52840 .

# Incremental build (if build/ exists)
west build

# Clean rebuild (if issues suspected)
west build -b nrf52840dk/nrf52840 . -p always
```

**Best Practice:** Always specify full board name `nrf52840dk/nrf52840` - using just `nrf52840dk` will fail.

### 2. Flashing to Specific Device

```bash
# Check connected devices
nrfjprog --ids

# Flash to specific device by serial number
west flash --snr 683247800  # Central board
west flash --snr 683007782  # Peripheral board

# Flash from specific build directory
west flash --build-dir central/build --snr 683247800
```

**Best Practice:** Always use `--snr` when multiple devices connected to avoid flashing to wrong board.

### 3. Device Management

```bash
# Reset a specific device (clean start)
nrfjprog --reset -s 683247800

# Erase all flash on device (fresh start)
nrfjprog --eraseall -s 683247800

# Recover device (if flash fails)
nrfjprog --recover -s 683247800
```

**Best Practice:** Use `--reset` before starting log capture to ensure clean boot sequence.

### 4. Process Cleanup (CRITICAL!)

```bash
# Kill all J-Link processes before new operation
pkill -9 JLink
pkill -9 nrfutil
sleep 1  # Wait for processes to fully terminate

# Check for running processes
ps aux | grep -E "JLink|nrfutil"
```

**Best Practice:** Always kill J-Link/nrfutil before flashing or starting new log capture. Prevents port conflicts and stuck processes.

### 5. Flash with Auto-Reset

```bash
# Flash with automatic reset after programming
timeout 60s west flash --snr 683247800

# Add erase flag for clean flash
west flash --erase --snr 683247800
```

**Best Practice:** Use `timeout 60s` for all flashing commands to prevent hangs.

---

## Build & Flash Best Practices

### Build Decision Tree

```
Does build/ directory exist?
├─ NO → Use: west build -b nrf52840dk/nrf52840 .
└─ YES →
    ├─ Fresh rebuild needed? → Use: west build -b nrf52840dk/nrf52840 . -p always
    └─ Incremental OK? → Use: west build
```

### Build Troubleshooting

```bash
# If build fails with cryptic errors
rm -rf build/
west build -b nrf52840dk/nrf52840 .

# If configuration issues
west build -b nrf52840dk/nrf52840 . -t menuconfig  # Interactive config

# If compilation errors
grep -r "error" build/  # Find specific errors
```

### Flash Verification

```bash
# After flash, verify device is running
nrfjprog --memrd 0x0 --len 4 -s 683247800  # Check if flash is valid

# Check device identity after boot
# Look for: "Identity: XX:XX:XX:XX:XX:XX (random)" in logs
```

---

## Log Capture Strategies

### Strategy 1: UART Logging (RECOMMENDED for Production)

**Why:** More reliable than RTT, works without debugger, better for production debugging.

**Configuration (prj.conf):**
```kconfig
# Enable logging
CONFIG_LOG=y
CONFIG_LOG_MODE_IMMEDIATE=y  # Prevents log loss on crash
CONFIG_LOG_DEFAULT_LEVEL=3   # 1=ERR, 2=WRN, 3=INFO, 4=DBG

# UART backend
CONFIG_LOG_BACKEND_UART=y
CONFIG_UART_CONSOLE=y
CONFIG_SERIAL=y
CONFIG_UART_INTERRUPT_DRIVEN=y

# Disable RTT
CONFIG_USE_SEGGER_RTT=n
CONFIG_RTT_CONSOLE=n
```

**Capture Logs:**
```bash
# Method 1: Direct cat (simple)
cat /dev/ttyACM0

# Method 2: Timeout capture (controlled)
timeout 10s cat /dev/ttyACM0 > logs/central.log 2>&1

# Method 3: Background capture (both boards simultaneously)
rm -f logs/*.log
(timeout 10s cat /dev/ttyACM0 > logs/central.log 2>&1) &
timeout 10s cat /dev/ttyACM1 > logs/peripheral.log 2>&1
wait  # Wait for background process

# Method 4: Reset & Cat (captures boot sequence) - CRITICAL!
timeout 20s sh -c 'nrfjprog --reset -s 683007782 && sleep 1 && cat /dev/ttyACM1 > logs/peripheral.log'
```

**Troubleshooting UART:**
```bash
# Check device mapping
ls -la /dev/ttyACM*
# Output: /dev/ttyACM0 (Central), /dev/ttyACM1 (Peripheral)

# If no device, check permissions
sudo chmod 666 /dev/ttyACM0

# If garbage characters, check baud rate (should be 115200 for nRF52840)
```

### Strategy 2: RTT Logging (RECOMMENDED for Development)

**Why:** Faster, no UART overhead, requires J-Link debugger.

**Configuration (prj.conf):**
```kconfig
# Enable logging
CONFIG_LOG=y
CONFIG_LOG_MODE_IMMEDIATE=y

# RTT backend
CONFIG_USE_SEGGER_RTT=y
CONFIG_RTT_CONSOLE=y
CONFIG_LOG_BACKEND_RTT=y

# Disable UART
CONFIG_UART_CONSOLE=n
```

**Capture Logs:**

**Method A: nRF Connect for Desktop (RECOMMENDED)**
1. Open nRF Connect app
2. Click "Programmer" in left sidebar
3. Select device (J-Link OB or SEGGER)
4. Click "Open RTT View"
5. Logs appear in real-time

**Method B: JLinkRTTLogger (Command Line)**
```bash
# Single device
JLinkRTTLogger -Device nRF52840_xxAA -If SWD -Speed 4000 -RTTCh 0

# To file (background)
JLinkRTTLogger -Device nRF52840_xxAA -If SWD -Speed 4000 -RTTCh 0 > logs/rtt.log &

# Multiple devices (separate terminals)
Terminal 1: JLinkRTTLogger -Device nRF52840_xxAA -If SWD -SerialNo 683247800 -RTTCh 0 > central.log &
Terminal 2: JLinkRTTLogger -Device nRF52840_xxAA -If SWD -SerialNo 683007782 -RTTCh 0 > peripheral.log &
```

**Troubleshooting RTT:**
```bash
# If RTT doesn't start, kill processes first
pkill -9 JLink
pkill -9 JLinkRTTLogger
sleep 2

# Check J-Link connection
nrfjprog --ids
# Should show connected devices

# Check RTT channels in firmware
# Search for: LOG_MODULE_REGISTER in code
```

### Strategy 3: Mixed (Development: RTT, Production: UART)

```kconfig
# Development config (prj_debug.conf)
CONFIG_LOG=y
CONFIG_LOG_MODE_IMMEDIATE=y
CONFIG_USE_SEGGER_RTT=y
CONFIG_LOG_BACKEND_RTT=y

# Production config (prj.conf)
CONFIG_LOG=y
CONFIG_LOG_MODE_IMMEDIATE=y
CONFIG_LOG_BACKEND_UART=y
CONFIG_UART_CONSOLE=y
```

**Build with different config:**
```bash
# Development
west build -b nrf52840dk/nrf52840 . -DEXTRA_CONF_FILE=prj_debug.conf

# Production
west build -b nrf52840dk/nrf52840 .
```

---

## Device Management

### Device Identification

```bash
# List all connected nRF devices
nrfjprog --ids

# Expected output:
# 683247800
# 683007782

# Get detailed device info (for specific device)
nrfjprog --id 683247800 --info

# Check which firmware is running
# Look in logs for: "=== nRF52840 IoT Hub (Central) Starting ==="
```

### Board-to-Firmware Mapping

**RECOMMENDED:** Create a tracking document:

```
# devices.txt
Central Board (Hub):
  Serial: 683247800
  Address: E6:E8:B1:97:92:27
  USB: /dev/ttyACM0
  Firmware: central/build/zephyr/zephyr.hex
  Command: west flash --snr 683247800

Peripheral Board (Sensor):
  Serial: 683007782
  Address: E8:2B:68:5E:01:1A
  USB: /dev/ttyACM1
  Firmware: peripheral/build/zephyr/zephyr.hex
  Command: west flash --snr 683007782
```

### Device State Management

```bash
# Full cleanup sequence (start fresh)
pkill -9 JLink
pkill -9 nrfutil
nrfjprog --eraseall -s 683247800
nrfjprog --eraseall -s 683007782
sleep 2

# Flash both devices
west flash --snr 683247800 &
west flash --snr 683007782 &
wait

# Reset both devices
nrfjprog --reset -s 683247800
nrfjprog --reset -s 683007782
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Wrong Terminal Type

**Problem:** Using regular terminal for `west`/`nrfjprog` commands instead of nRF Connect terminal.

**Symptoms:**
```
command not found: west
command not found: nrfjprog
```

**Solution:** Always use **nRF Connect Extension Pack** terminal in VS Code.

**How to Verify:**
```bash
echo $ZEPHYR_BASE
# Should show path like: /home/omar/ncs/v3.2.1/zephyr
# If empty, you're in wrong terminal!
```

### Pitfall 2: Flashing to Wrong Board

**Problem:** Multiple boards connected, firmware flashed to wrong device.

**Symptoms:**
- Central starts advertising instead of scanning
- Peripheral boots but has wrong name in logs
- Confusion about which board is which

**Solution:** 
```bash
# ALWAYS check devices first
nrfjprog --ids

# ALWAYS use --snr flag
west flash --snr 683247800  # Explicitly target specific board
```

### Pitfall 3: J-Link Process Conflicts

**Problem:** Old J-Link process still running, causing "Device already in use" errors.

**Symptoms:**
```
Error: J-Link DLL not found
Error: Could not open device
timeout exceeded
```

**Solution:**
```bash
# Kill ALL J-Link processes before ANY operation
pkill -9 JLink
pkill -9 nrfutil
sleep 2  # Wait for cleanup

# Verify processes are gone
ps aux | grep -E "JLink|nrfutil"
```

### Pitfall 4: Log Capture Missing Boot Sequence

**Problem:** Starting log capture AFTER device has already booted, missing critical boot logs.

**Symptoms:**
- Logs start in middle of execution
- No "Booting nRF Connect SDK" message
- Can't see initialization sequence

**Solution:**
```bash
# Method 1: Reset & Cat (RECOMMENDED)
timeout 20s sh -c 'nrfjprog --reset -s 683247800 && sleep 1 && cat /dev/ttyACM0 > boot.log'

# Method 2: Background capture with reset
(timeout 15s cat /dev/ttyACM0 > logs/central.log 2>&1) &
nrfjprog --reset -s 683247800  # Reset AFTER starting capture
```

### Pitfall 5: Log Buffering Hiding Crash Data

**Problem:** Using buffered logging mode, crash causes log data to be lost.

**Symptoms:**
- Logs stop abruptly without error message
- Can't see what caused crash
- Logs end mid-function

**Solution:**
```kconfig
# ALWAYS use immediate mode for debugging
CONFIG_LOG_MODE_IMMEDIATE=y
```

**How to verify:**
```bash
grep CONFIG_LOG_MODE prj.conf
# Should show: CONFIG_LOG_MODE_IMMEDIATE=y
```

### Pitfall 6: Wrong Board Name in Build Command

**Problem:** Using `nrf52840dk` instead of `nrf52840dk/nrf52840`.

**Symptoms:**
```
Error: Board nrf52840dk not found
Error: Could not determine board directory
```

**Solution:**
```bash
# CORRECT
west build -b nrf52840dk/nrf52840 .

# WRONG
west build -b nrf52840dk .
```

**How to find correct board name:**
```bash
west boards | grep nrf52840
# Output: nrf52840dk/nrf52840
```

### Pitfall 7: UART Device Not Found

**Problem:** /dev/ttyACM0 or /dev/ttyACM1 not accessible.

**Symptoms:**
```
cat: /dev/ttyACM0: No such file or directory
Permission denied
```

**Solution:**
```bash
# Check available devices
ls -la /dev/ttyACM*

# If not found, unplug and replug USB cable
# If permission denied:
sudo chmod 666 /dev/ttyACM0

# Permanent fix (add user to dialout group):
sudo usermod -a -G dialout $USER
# Then logout and login again
```

### Pitfall 8: RF Range Issues (BLE Not Connecting)

**Problem:** Boards too far apart, can't detect each other's advertisements.

**Symptoms:**
- Central scanning but not finding Peripheral
- Peripheral advertising but Central never sees it
- RSSI values very weak (< -80dBm)

**Solution:**
```bash
# 1. Increase TX power in prj.conf
CONFIG_BT_CTLR_TX_PWR_PLUS_8=y  # +8dBm maximum

# 2. Physically place boards close together (< 5cm) for testing

# 3. Remove obstacles between boards

# 4. Check RSSI in scan logs
grep "rssi" logs/central.log
# Look for values > -70dBm for good signal
```

---

## Debugging Workflow

### Recommended Debugging Process

```
1. Setup
   ├─ Kill old processes: pkill -9 JLink
   ├─ Check devices: nrfjprog --ids
   └─ Verify terminal: echo $ZEPHYR_BASE

2. Build
   ├─ Clean if needed: rm -rf build/
   ├─ Build: west build -b nrf52840dk/nrf52840 .
   └─ Check for errors: grep -r "error" build/

3. Flash
   ├─ Identify target: nrfjprog --ids
   ├─ Flash: west flash --snr <SERIAL>
   └─ Timeout to prevent hang: timeout 60s west flash --snr <SERIAL>

4. Test
   ├─ Reset device: nrfjprog --reset -s <SERIAL>
   ├─ Start log capture: timeout 10s cat /dev/ttyACM0 > logs/test.log
   ├─ Verify boot: grep "Starting" logs/test.log
   └─ Check for errors: grep -E "error|Error|ERROR|fail|Fail|FAIL" logs/test.log

5. Analyze
   ├─ Review logs: cat logs/test.log
   ├─ Search specific: grep "keyword" logs/test.log
   └─ Hex dumps: grep "Hex" logs/test.log
```

### Log Analysis Techniques

```bash
# Find boot sequence
grep -E "Booting|Starting|Initializing" logs/*.log

# Find errors
grep -iE "error|fail|timeout|exception" logs/*.log

# Find BLE connections
grep -iE "connect|disconnect|scan|advertising" logs/*.log

# Find specific device address
grep "E8:2B:68" logs/central.log

# Count occurrences
grep -c "Connected" logs/*.log

# Extract timestamps
grep -oE "\[00:00:[0-9]+\.[0-9]+\]" logs/central.log

# Hex dump analysis
grep -A 5 "Sensor Data TX (Hex)" logs/peripheral.log
```

---

## Struggles & Lessons Learned

### Struggle 1: Terminal Environment Issues

**What Happened:**
- Initially tried to use regular terminal for `west` commands
- Got "command not found" errors
- Wasted time trying to fix PATH variables

**What Went Wrong:**
- Didn't understand nRF Connect SDK requires specific terminal with environment variables
- Regular terminal lacks $ZEPHYR_BASE and other SDK variables

**Best Practice:**
```bash
# ALWAYS use nRF Connect terminal in VS Code
# Verify before running commands:
echo $ZEPHYR_BASE
# If empty, you're in wrong terminal!
```

### Struggle 2: J-Link Process Conflicts

**What Happened:**
- Flash operations would hang or timeout
- Got "Device already in use" errors
- Had to manually kill processes each time

**What Went Wrong:**
- J-Link processes from previous operations remained running
- nrfutil processes weren't being cleaned up
- No consistent cleanup procedure

**Best Practice:**
```bash
# ALWAYS kill J-Link/nrfutil before ANY operation
pkill -9 JLink
pkill -9 nrfutil
sleep 2  # Wait for cleanup

# Make this a habit before flashing or log capture
```

### Struggle 3: Log Capture Missing Boot Logs

**What Happened:**
- Started log capture AFTER devices had booted
- Missed critical initialization sequences
- Couldn't debug boot-time issues

**What Went Wrong:**
- No synchronization between reset and log capture
- Log capture started too late
- Background processes timing out

**Best Practice:**
```bash
# Method 1: Reset & Cat (RELIABLE)
timeout 20s sh -c 'nrfjprog --reset -s 683247800 && sleep 1 && cat /dev/ttyACM0 > logs/boot.log'

# Method 2: Background capture first
(timeout 15s cat /dev/ttyACM0 > logs/central.log 2>&1) &
sleep 0.5
nrfjprog --reset -s 683247800  # Reset AFTER starting capture
```

### Struggle 4: Flashing Wrong Board

**What Happened:**
- Flashed Central firmware to Peripheral board
- Got confused about which board was which
- Wasted time debugging wrong device

**What Went Wrong:**
- Multiple boards connected, used `west flash` without `--snr`
- No board identification system
- Assumed first device was target

**Best Practice:**
```bash
# 1. ALWAYS check devices first
nrfjprog --ids

# 2. ALWAYS use --snr flag
west flash --snr 683247800

# 3. Create device mapping document
# See "Board-to-Firmware Mapping" section
```

### Struggle 5: UART Device Mapping Confusion

**What Happened:**
- Didn't know which /dev/ttyACM* corresponded to which board
- Captured logs from wrong device
- Got confused about which logs belonged to which board

**What Went Wrong:**
- No systematic device identification
- Assumed ACM0 = Central, ACM1 = Peripheral (not always true)
- Changed after USB reconnection

**Best Practice:**
```bash
# Check device mapping before starting
ls -la /dev/ttyACM*

# Test each device
cat /dev/ttyACM0  # Look for "Central" or "Sensor" in boot log
cat /dev/ttyACM1  # Look for "Central" or "Sensor" in boot log

# Document mapping
# devices.txt: Central = /dev/ttyACM0, Peripheral = /dev/ttyACM1
```

### Struggle 6: Log Buffering Hiding Crash Data

**What Happened:**
- Device crashed but logs stopped abruptly
- Couldn't see error message that caused crash
- Logs ended mid-function

**What Went Wrong:**
- Used default logging mode (buffered)
- Crash caused buffered data to be lost
- No immediate mode configured

**Best Practice:**
```kconfig
# ALWAYS use immediate mode for debugging
CONFIG_LOG_MODE_IMMEDIATE=y

# Verify in prj.conf
grep CONFIG_LOG_MODE prj.conf
```

### Struggle 7: RF Visibility Issues

**What Happened:**
- Central couldn't detect Peripheral's advertisements
- Spent hours debugging code, logs, configuration
- Real issue was physical distance/RF power

**What Went Wrong:**
- Assumed code/logic issue first
- Didn't check RF configuration (TX power)
- Didn't verify physical proximity of boards

**Best Practice:**
```bash
# 1. Check TX power in prj.conf
grep TX_PWR prj.conf

# 2. Increase TX power if needed
# Add to prj.conf:
CONFIG_BT_CTLR_TX_PWR_PLUS_8=y

# 3. Physically verify board proximity
# Place boards within 5cm for initial testing

# 4. Check RSSI in scan logs
grep "rssi" logs/central.log
# Look for values > -70dBm for good signal
```

### Struggle 8: Board Name in Build Command

**What Happened:**
- Used `nrf52840dk` in build command
- Got "Board not found" error
- Tried multiple board names before finding correct one

**What Went Wrong:**
- Didn't know correct board name format
- No documentation lookup
- Guessing instead of querying system

**Best Practice:**
```bash
# Query system for correct board name
west boards | grep nrf52840

# Use exact name from output
west build -b nrf52840dk/nrf52840 .  # CORRECT
```

---

## Pro Tips

### Tip 1: Create Aliases for Common Operations

```bash
# Add to ~/.bashrc or ~/.zshrc

# Device management
alias nrf-reset='nrfjprog --reset'
alias nrf-erase='nrfjprog --eraseall'
alias nrf-clean='pkill -9 JLink && pkill -9 nrfutil'

# Quick device check
alias nrf-devices='nrfjprog --ids'

# Quick build
alias build-central='cd ~/projects/central && west build -b nrf52840dk/nrf52840 .'
alias build-peripheral='cd ~/projects/peripheral && west build -b nrf52840dk/nrf52840 .'

# Quick flash
alias flash-central='cd ~/projects/central && timeout 60s west flash --snr 683247800'
alias flash-peripheral='cd ~/projects/peripheral && timeout 60s west flash --snr 683007782'
```

### Tip 2: Use Script for Multi-Device Operations

```bash
#!/bin/bash
# flash_both.sh - Flash both boards

set -e  # Exit on error

echo "=== Flashing Central (Hub) ==="
cd central
timeout 60s west flash --snr 683247800
cd ..

echo "=== Flashing Peripheral (Sensor) ==="
cd peripheral
timeout 60s west flash --snr 683007782
cd ..

echo "=== Resetting Both Boards ==="
nrfjprog --reset -s 683247800
nrfjprog --reset -s 683007782

echo "=== Done! ==="
```

### Tip 3: Log Management

```bash
#!/bin/bash
# capture_logs.sh - Capture logs from both devices

set -e

mkdir -p logs

echo "=== Killing old processes ==="
pkill -9 JLink
pkill -9 nrfutil
sleep 1

echo "=== Starting log capture ==="
rm -f logs/central.log logs/peripheral.log

# Start background capture for Central
(timeout 15s cat /dev/ttyACM0 > logs/central.log 2>&1) &

sleep 0.5

# Reset devices to get boot logs
nrfjprog --reset -s 683247800
nrfjprog --reset -s 683007782

sleep 0.5

# Capture Peripheral logs (foreground)
timeout 15s cat /dev/ttyACM1 > logs/peripheral.log 2>&1

echo "=== Log capture complete ==="

# Quick analysis
echo "Central boot:"
grep "Starting" logs/central.log | head -1

echo "Peripheral boot:"
grep "Starting" logs/peripheral.log | head -1
```

### Tip 4: Quick Health Check

```bash
#!/bin/bash
# health_check.sh - Quick system health check

echo "=== nRF Devices ==="
nrfjprog --ids

echo ""
echo "=== Environment ==="
echo "ZEPHYR_BASE: $ZEPHYR_BASE"
echo "NCS_VERSION: $NCS_VERSION"

echo ""
echo "=== USB Devices ==="
ls -la /dev/ttyACM*

echo ""
echo "=== Running Processes ==="
ps aux | grep -E "JLink|nrfutil|west" | grep -v grep

echo ""
echo "=== Recent Logs ==="
ls -lt logs/ | head -5
```

### Tip 5: Log Analysis Script

```bash
#!/bin/bash
# analyze_logs.sh - Quick log analysis

LOG_DIR="logs"

if [ ! -d "$LOG_DIR" ]; then
    echo "No logs directory found"
    exit 1
fi

echo "=== Boot Sequences ==="
grep -h "Starting" logs/*.log | cut -d: -f4-

echo ""
echo "=== Errors ==="
grep -ihE "error|fail|exception" logs/*.log | head -20

echo ""
echo "=== BLE Connections ==="
grep -h "Connected\|Disconnected" logs/*.log | head -20

echo ""
echo "=== Boot Times ==="
for log in logs/*.log; do
    echo "$log:"
    grep "Booting" "$log" | head -1
done
```

### Tip 6: Git Integration

```bash
# Create .gitignore for logs
cat > .gitignore << 'EOF'
logs/
build/
*.log
*.hex
*.bin
*.elf
*.map
EOF

# Commit only source code
git add src/ prj.conf CMakeLists.txt *.overlay
git commit -m "Feature: Add sensor data logging"

# Don't commit build artifacts or logs
```

### Tip 7: Version Tracking

```bash
# Record SDK version in project
echo "NCS v3.2.1-d8887f6f32df" > .ncs_version
echo "Zephyr v4.2.99-ec78104f1569" >> .ncs_version

# Record build date
date > .build_date

# Check version
cat .ncs_version
cat .build_date
```

---

## Quick Reference Commands

### Essential Commands (Cheat Sheet)

```bash
# Build
west build -b nrf52840dk/nrf52840 .           # First build
west build                                     # Incremental
west build -b nrf52840dk/nrf52840 . -p always # Clean rebuild

# Flash
west flash --snr 683247800                   # Specific device
timeout 60s west flash --snr 683247800       # With timeout
west flash --erase --snr 683247800           # With erase

# Device Management
nrfjprog --ids                               # List devices
nrfjprog --reset -s 683247800               # Reset device
nrfjprog --eraseall -s 683247800           # Erase flash
pkill -9 JLink                              # Kill J-Link
pkill -9 nrfutil                             # Kill nrfutil

# Log Capture (UART)
timeout 10s cat /dev/ttyACM0 > logs/test.log # Simple
timeout 20s sh -c 'nrfjprog --reset && sleep 1 && cat /dev/ttyACM0 > boot.log' # Reset & Cat

# Log Capture (RTT)
JLinkRTTLogger -Device nRF52840_xxAA -If SWD -SerialNo 683247800 -RTTCh 0 > logs/rtt.log &

# Analysis
grep "keyword" logs/*.log                    # Search logs
grep -c "Connected" logs/*.log              # Count occurrences
grep -E "error|Error" logs/*.log            # Find errors
tail -f logs/central.log                   # Follow logs live
```

---

## Summary

### Key Takeaways

1. **Always use nRF Connect terminal** - Regular terminal lacks SDK environment
2. **Kill processes before operations** - Prevents J-Link/nrfutil conflicts
3. **Use --snr flag** - Always specify target device when multiple boards connected
4. **Reset before log capture** - Ensures complete boot sequence is captured
5. **Use immediate logging mode** - Prevents log loss on crash
6. **Check RF configuration** - TX power and physical proximity matter for BLE
7. **Document board mapping** - Track which serial/USB corresponds to which board
8. **Use correct board name** - `nrf52840dk/nrf52840`, not just `nrf52840dk`
9. **Timeout long operations** - Prevents hangs on flash/log capture
10. **Verify with grep** - Always check logs for errors and expected patterns

### Recommended Workflow

```
Setup → Kill processes → Check devices → Build → Flash → Reset → Capture logs → Analyze
  ↓        ↓                ↓             ↓       ↓       ↓         ↓          ↓
  ↓        pkill -9         nrfjprog      west    west    nrfjprog   cat       grep
  ↓        JLink            --ids         build   flash   --reset    > logs   error
  ↓        nrfutil          ls /dev/              --snr     sleep 1   2>&1
  ↓                                         683247800
```

---

**Document Version:** 1.0  
**Created:** January 29, 2026  
**Based On:** Real debugging session with nRF52840 DK + nRF Connect SDK v3.2.1  
**Author:** AI Senior Embedded Firmware Engineer (Nordic/Zephyr Specialist)