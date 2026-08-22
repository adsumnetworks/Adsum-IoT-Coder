@echo off
REM nRF Sniffer Wrapper Script (Windows) - over-the-air BLE capture via "nrfutil ble-sniffer sniff".
REM Keep this file PURE ASCII: under a UTF-8 console (PowerShell) cmd mis-parses multibyte chars in a
REM REM line and spills a fragment as a command ('M' is not recognized ...). Confirmed on real hardware.

setlocal enabledelayedexpansion

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set PYTHON_SCRIPT=%SCRIPT_DIR%nrf_sniffer.py

REM Check if Python script exists
if not exist "%PYTHON_SCRIPT%" (
    echo ERROR: nrf_sniffer.py not found at %PYTHON_SCRIPT%
    exit /b 1
)

REM Isolate from user-site .pth conflicts (PYTHONNOUSERSITE rule)
set PYTHONNOUSERSITE=1

REM Detect available Python (Windows convention: python > python3 > py -3)
set PYTHON_CMD=
where /q python.exe && set PYTHON_CMD=python
if "%PYTHON_CMD%"=="" where /q python3.exe && set PYTHON_CMD=python3
if "%PYTHON_CMD%"=="" where /q py.exe && set PYTHON_CMD=py -3

if "%PYTHON_CMD%"=="" (
    echo ERROR: Python not found. Please ensure Python is in PATH.
    exit /b 1
)

REM Execute Python script with all arguments passed through
%PYTHON_CMD% "%PYTHON_SCRIPT%" %*
exit /b !errorlevel!
