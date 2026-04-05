# Tool Routing Directives

Due to the constraints of embedded ecosystems, standard shell terminals often lack necessary cross-compiler, toolchain, and SDK environment variables.

## Routing Rules
1. **Device Tools vs `execute_command`**
   - **MUST USE Device Tools (e.g. `nrf_device_tool`)** for: 
     - Building firmware (e.g., `west build`, `idf.py build`, `cmake`)
     - Flashing firmware (e.g., `west flash`, `nrfjprog`)
     - Log capture (e.g., UART, RTT listener scripts)
     - Dependency management within the SDK workspace.
   - **MUST USE `execute_command`** for:
     - General host system operations (e.g., `git`, file manipulation, regex searches).
     - Standard package managers for host software (e.g., `npm`, `apt`).

2. **Terminal Switching**
   - You may switch between tools based on the task. However, NEVER assume that a command which worked in `execute_command` will correctly map to a device-specific tool, and vice-versa.
   - Example: A `git commit` belongs in `execute_command`. A `west build` belongs in `nrf_device_tool`.
