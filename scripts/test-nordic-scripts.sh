#!/bin/bash
# test-nordic-scripts.sh - Auto-test Nordic logger scripts before build
# Validates Python syntax, shell scripts, and wrapper functionality

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$SCRIPT_DIR/assets/scripts"

PASS=0
FAIL=0
WARN=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Nordic Logger Scripts Auto-Test Suite                 ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================================
# Test 1: Python Syntax Validation
# ============================================================================

echo "Test 1: Python Syntax Validation"
echo "─────────────────────────────────"

for py_file in "$ASSETS_DIR"/*.py; do
    if [ -f "$py_file" ]; then
        filename=$(basename "$py_file")
        if python3 -m py_compile "$py_file" 2>/dev/null; then
            echo -e "${GREEN}✓${NC} $filename: Syntax OK"
            ((PASS++))
        else
            echo -e "${RED}✗${NC} $filename: Syntax ERROR"
            python3 -m py_compile "$py_file"
            ((FAIL++))
        fi
    fi
done
echo ""

# ============================================================================
# Test 2: Python Imports
# ============================================================================

echo "Test 2: Python Import Validation"
echo "─────────────────────────────────"

for py_file in "$ASSETS_DIR"/*.py; do
    if [ -f "$py_file" ]; then
        filename=$(basename "$py_file")
        
        # Check for critical imports
        if grep -q "^import atexit" "$py_file"; then
            echo -e "${GREEN}✓${NC} $filename: Has atexit import"
            ((PASS++))
        else
            echo -e "${YELLOW}⚠${NC} $filename: Missing atexit import"
            ((WARN++))
        fi
        
        if grep -q "^import sys" "$py_file"; then
            echo -e "${GREEN}✓${NC} $filename: Has sys import"
            ((PASS++))
        else
            echo -e "${RED}✗${NC} $filename: Missing sys import"
            ((FAIL++))
        fi
    fi
done
echo ""

# ============================================================================
# Test 3: Shell Script Validation
# ============================================================================

echo "Test 3: Shell Script Validation"
echo "───────────────────────────────"

for sh_file in "$ASSETS_DIR"/{rtt,uart}-logger; do
    if [ -f "$sh_file" ]; then
        filename=$(basename "$sh_file")
        if bash -n "$sh_file" 2>/dev/null; then
            echo -e "${GREEN}✓${NC} $filename: Shell syntax OK"
            ((PASS++))
        else
            echo -e "${RED}✗${NC} $filename: Shell syntax ERROR"
            bash -n "$sh_file"
            ((FAIL++))
        fi
    fi
done
echo ""

# ============================================================================
# Test 4: Batch Script Validation (Windows wrappers)
# ============================================================================

echo "Test 4: Batch Script Validation (Windows)"
echo "──────────────────────────────────────────"

for bat_file in "$ASSETS_DIR"/*.bat; do
    if [ -f "$bat_file" ]; then
        filename=$(basename "$bat_file")
        
        # Check critical patterns in batch file
        if grep -q "@echo off" "$bat_file"; then
            echo -e "${GREEN}✓${NC} $filename: Has @echo off"
            ((PASS++))
        else
            echo -e "${RED}✗${NC} $filename: Missing @echo off"
            ((FAIL++))
        fi
        
        if grep -q "python3" "$bat_file"; then
            echo -e "${GREEN}✓${NC} $filename: Calls python3"
            ((PASS++))
        else
            echo -e "${RED}✗${NC} $filename: Missing python3 call"
            ((FAIL++))
        fi
        
        if grep -q "exit /b" "$bat_file"; then
            echo -e "${GREEN}✓${NC} $filename: Has exit code handling"
            ((PASS++))
        else
            echo -e "${YELLOW}⚠${NC} $filename: Missing exit code handling"
            ((WARN++))
        fi
    fi
done
echo ""

# ============================================================================
# Test 5: File Existence Checks
# ============================================================================

echo "Test 5: File Existence Checks"
echo "──────────────────────────────"

REQUIRED_FILES=(
    "nrf_rtt_logger.py"
    "nrf_uart_logger.py"
    "rtt-logger"
    "uart-logger"
    "rtt-logger.bat"
    "uart-logger.bat"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$ASSETS_DIR/$file" ]; then
        echo -e "${GREEN}✓${NC} $file: Exists"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} $file: MISSING"
        ((FAIL++))
    fi
done
echo ""

# ============================================================================
# Test 6: Python Cross-Platform Detection
# ============================================================================

echo "Test 6: Python Cross-Platform Logic"
echo "────────────────────────────────────"

for py_file in "$ASSETS_DIR"/*.py; do
    if [ -f "$py_file" ]; then
        filename=$(basename "$py_file")
        
        if grep -q 'sys.platform == "win32"' "$py_file"; then
            echo -e "${GREEN}✓${NC} $filename: Has Windows detection"
            ((PASS++))
        else
            echo -e "${YELLOW}⚠${NC} $filename: Missing Windows detection"
            ((WARN++))
        fi
        
        if grep -q "taskkill\|pkill" "$py_file"; then
            echo -e "${GREEN}✓${NC} $filename: Has cross-platform cleanup"
            ((PASS++))
        else
            echo -e "${YELLOW}⚠${NC} $filename: Missing cleanup logic"
            ((WARN++))
        fi
    fi
done
echo ""

# ============================================================================
# Test 7: Handler TypeScript Compilation
# ============================================================================

echo "Test 7: TypeScript Handler Validation"
echo "─────────────────────────────────────"

HANDLER_FILE="$SCRIPT_DIR/src/core/task/tools/handlers/TriggerNordicActionHandler.ts"
if [ -f "$HANDLER_FILE" ]; then
    if grep -q 'process.platform === "win32"' "$HANDLER_FILE"; then
        echo -e "${GREEN}✓${NC} TriggerNordicActionHandler: Has Windows detection"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} TriggerNordicActionHandler: Missing Windows detection"
        ((FAIL++))
    fi
    
    if grep -q '.bat' "$HANDLER_FILE"; then
        echo -e "${GREEN}✓${NC} TriggerNordicActionHandler: Has .bat extension logic"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} TriggerNordicActionHandler: Missing .bat extension logic"
        ((FAIL++))
    fi
else
    echo -e "${RED}✗${NC} TriggerNordicActionHandler.ts: File not found"
    ((FAIL++))
fi
echo ""

# ============================================================================
# Summary
# ============================================================================

TOTAL=$((PASS + FAIL + WARN))

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                       Test Summary                            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}✓ Passed: $PASS${NC}"
echo -e "${YELLOW}⚠ Warnings: $WARN${NC}"
echo -e "${RED}✗ Failed: $FAIL${NC}"
echo "─────────────────────────────────────────────────────────────────"
echo "Total Tests: $TOTAL"
echo ""

if [ $FAIL -gt 0 ]; then
    echo -e "${RED}RESULT: FAILED - Please fix errors before pushing${NC}"
    exit 1
elif [ $WARN -gt 0 ]; then
    echo -e "${YELLOW}RESULT: PASSED WITH WARNINGS - Review above before pushing${NC}"
    exit 0
else
    echo -e "${GREEN}RESULT: ALL TESTS PASSED ✓${NC}"
    exit 0
fi
