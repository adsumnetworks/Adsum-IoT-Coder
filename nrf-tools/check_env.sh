#!/bin/bash
# check_env.sh - Verify Python and pyserial are available for nrf_logger.py
# Run this once before using the logging tools.

echo "=== nRF Tools Environment Check ==="
echo ""

# Check Python (prioritize python3)
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    # Check if 'python' is actually Python 3
    PY_VERSION=$(python --version 2>&1 | grep -oE '[0-9]+' | head -1)
    if [ "$PY_VERSION" -ge 3 ]; then
        PYTHON_CMD="python"
    fi
fi

if [ -z "$PYTHON_CMD" ]; then
    echo "[ERROR] Python 3 not found!"
    echo "  Install Python 3.7+ from https://www.python.org/"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1)
echo "[OK] Python found: $PYTHON_VERSION"

# Verify Python version >= 3.7
PY_MINOR=$($PYTHON_CMD -c "import sys; print(sys.version_info.minor)")
PY_MAJOR=$($PYTHON_CMD -c "import sys; print(sys.version_info.major)")
if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 7 ]); then
    echo "[ERROR] Python 3.7+ required. Found: $PYTHON_VERSION"
    echo "  Please install a newer Python version."
    exit 1
fi

# Check pyserial
if $PYTHON_CMD -c "import serial" 2>/dev/null; then
    echo "[OK] pyserial is installed"
else
    echo "[MISSING] pyserial not found. Installing..."
    $PYTHON_CMD -m pip install pyserial
    if [ $? -eq 0 ]; then
        echo "[OK] pyserial installed successfully"
    else
        echo "[ERROR] Failed to install pyserial"
        echo "  Try: pip install pyserial"
        exit 1
    fi
fi

# Check nrfjprog (optional but recommended)
if command -v nrfjprog &> /dev/null; then
    NRFJPROG_VERSION=$(nrfjprog --version 2>&1 | head -1)
    echo "[OK] nrfjprog found: $NRFJPROG_VERSION"
else
    echo "[WARN] nrfjprog not found (optional, needed for device reset)"
    echo "  Install nRF Command Line Tools from Nordic Semiconductor"
fi

echo ""
echo "=== Environment check complete ==="
echo "You can now use: python nrf-tools/nrf_logger.py --help"
