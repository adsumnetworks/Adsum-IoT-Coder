@echo off
REM check_env.bat - Verify Python and pyserial are available for nrf_logger.py (Windows)
REM Run this once before using the logging tools.

echo === nRF Tools Environment Check ===
echo.

REM Check Python
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
    echo [OK] Python found: %PYTHON_VERSION%
    set PYTHON_CMD=python
) else (
    echo [ERROR] Python not found!
    echo   Install Python 3.x from https://www.python.org/
    exit /b 1
)

REM Check pyserial
%PYTHON_CMD% -c "import serial" 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] pyserial is installed
) else (
    echo [MISSING] pyserial not found. Installing...
    %PYTHON_CMD% -m pip install pyserial
    if %ERRORLEVEL% equ 0 (
        echo [OK] pyserial installed successfully
    ) else (
        echo [ERROR] Failed to install pyserial
        echo   Try: pip install pyserial
        exit /b 1
    )
)

REM Check nrfjprog (optional but recommended)
where nrfjprog >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%i in ('nrfjprog --version 2^>^&1') do set NRFJPROG_VERSION=%%i
    echo [OK] nrfjprog found
) else (
    echo [WARN] nrfjprog not found (optional, needed for device reset)
    echo   Install nRF Command Line Tools from Nordic Semiconductor
)

echo.
echo === Environment check complete ===
echo You can now use: python nrf-tools\nrf_logger.py --help
