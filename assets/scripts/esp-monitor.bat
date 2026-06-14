@echo off
REM ESP-IDF Monitor Capture Wrapper (Windows)
REM Isolates the interpreter from user-site .pth conflicts (PYTHONNOUSERSITE=1).

set PYTHONNOUSERSITE=1
python "%~dp0esp_monitor_logger.py" %*
