# ESP32 Platform Rule: Environment Routing (rules/esp-terminal.md)

**ALL ESP-IDF build, flash, and monitor commands MUST be executed in an environment where the ESP-IDF tools are sourced.**

Unlike standard environments, ESP-IDF relies heavily on Python virtual environments and absolute paths defined in its `export.sh` script.

## The Mandatory Prefix

Before running an `idf.py` command, you MUST source the export script in the identical bash line you run the command in.

```bash
# Correct Usage
. /home/omar/esp/v5.5.2/esp-idf/export.sh && idf.py build

# Correct Usage
. /home/omar/esp/v5.5.2/esp-idf/export.sh && idf.py -p /dev/ttyUSB0 flash
```

**CRITICAL RULE:**
DO NOT run `. /home/omar/esp/v5.5.2/esp-idf/export.sh` on one line and then `idf.py build` on the next. The environment variables are lost between separate command executions if they are not chained.

## Commands that require the prefix
- `idf.py build`
- `idf.py set-target`
- `idf.py menuconfig`
- `idf.py flash`
- `idf.py monitor`
- Any `esptool.py` command

## Commands that DO NOT require the prefix
- Standard Git operations
- General file manipulation
- File reading/writing (use built-in tools instead of shell commands)
