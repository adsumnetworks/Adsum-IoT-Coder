# Device Identity Rule (rules/device-identity.md)

**STRICT — Always enforced. No exceptions.**

## Role Assignment Policy

1. **Never guess from hardware:** An nRF52840 is NOT inherently a central. An nRF52832 is NOT inherently a peripheral.
2. **Role Proof:** You can ONLY assign a role (`central`, `peripheral`) if you have proof:
   - Config (`CONFIG_BT_CENTRAL=y`) **AND** you know exactly which serial number it was flashed to.
   - Logs clearly state the role (e.g., `"Bluetooth Central started"`).
3. **Multi-Device Loophole (STRICT):** If you have multiple devices connected AND multiple projects open, **you DO NOT KNOW which serial number runs which firmware.**
   - **NEVER** arbitrarily map project roles to hardware serial numbers.
   - You **MUST ALWAYS** use generic labels (`device1`, `device2`) for the first capture of multiple devices.
4. **Correction:** If logs disprove a role label, immediately correct all references.
