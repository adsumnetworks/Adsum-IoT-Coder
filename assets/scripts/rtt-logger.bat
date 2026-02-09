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
