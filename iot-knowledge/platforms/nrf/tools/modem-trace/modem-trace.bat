@echo off
REM Modem Trace Wrapper Script (Windows)

setlocal enabledelayedexpansion

REM Isolate the interpreter from user-site .pth conflicts (see CLAUDE.md, bug B1).
REM Set inside setlocal so it never leaks into the user's shell.
set PYTHONNOUSERSITE=1

set SCRIPT_DIR=%~dp0
set PYTHON_SCRIPT=%SCRIPT_DIR%modem_trace.py

if not exist "%PYTHON_SCRIPT%" (
    echo ERROR: modem_trace.py not found at %PYTHON_SCRIPT%
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

%PYTHON_CMD% "%PYTHON_SCRIPT%" %*
exit /b !errorlevel!
