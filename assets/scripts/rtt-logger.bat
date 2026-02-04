@echo off
REM RTT Logger Wrapper Script (Windows)
REM Provides a consistent interface for the RTT logging tool

setlocal enabledelayedexpansion

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set PYTHON_SCRIPT=%SCRIPT_DIR%nrf_rtt_logger.py

REM Check if Python script exists
if not exist "%PYTHON_SCRIPT%" (
    echo ERROR: nrf_rtt_logger.py not found at %PYTHON_SCRIPT%
    exit /b 1
)

REM Execute Python script with all arguments passed through
python3 "%PYTHON_SCRIPT%" %*
exit /b !errorlevel!
