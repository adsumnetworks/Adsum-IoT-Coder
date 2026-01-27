# Nordic E2E Test Workspace

This workspace simulates a Nordic/Zephyr project for E2E testing.

## Structure
- `prj.conf` - Kconfig configuration
- `CMakeLists.txt` - Build system
- `src/main.c` - Application code

## Test Scenarios
Used by `nordic.test.ts` to verify:
1. Agent uses `trigger_nordic_action` for builds
2. Agent suggests `west boards` for board discovery
3. Agent handles prj.conf configuration
