# Contributing to Adsum IoT Coder

We're thrilled you're interested in contributing to the **Adsum IoT Coder**! Whether you're fixing a bug, adding a feature, or improving our docs, every contribution helps make debugging on nRF devices smarter and easier.


## Reporting Bugs or Issues

Bug reports help make the extension better for everyone! Before creating a new issue, please search existing ones on GitHub to avoid duplicates. When you're ready to report a bug, open a new issue and include:
- A clear description of the problem
- Steps to reproduce
- What version of the nRF Connect SDK you are using
- Device/Board information (if applicable)

## Before Contributing

For features and large contributions:
- Please open an issue first to discuss the idea with the maintainers.
- This ensures your work aligns with the project's direction and prevents wasted effort.
- Once approved, feel free to begin working on a PR!

## Development Setup

### Local Build Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/adsumnetworks/SoC-AI-Debugger.git
   ```

2. **Open the project in VSCode:**
   ```bash
   cd SoC-AI-Debugger
   code .
   ```

3. **Install Dependencies:**
   ```bash
   npm run install:all
   ```

4. **Generate Protocol Buffer files** (Required before the first build):
   ```bash
   npm run protos
   ```

5. **Launch the Extension:**
   - Press `F5` (or go to `Run` -> `Start Debugging`) in VS Code.
   - This will launch a new VS Code Extension Development Host window with the Adsum IoT Coder loaded.

*Note: You must have the official Nordic `nRF Connect for VS Code` extension installed in your development host for all features to work correctly.*

## Writing and Submitting Code

1. **Keep Pull Requests Focused**
   - Limit PRs to a single feature or bug fix.
   - Split larger changes into smaller, related PRs.

2. **Code Quality**
   - Run `npm run lint` to check code style.
   - Run `npm run format:fix` to automatically format code using Biome.
   - Follow TypeScript best practices.

3. **Testing**
   - Run `npm test` to ensure unit tests pass.
   - Verify changes manually in the Extension Development Host (`F5`).

4. **Pull Request Guidelines**
   - Rebase your branch on the latest `main` before submitting.
   - Write clear, descriptive commit messages.
   - Include steps to test the changes in your PR description.
   - Add screenshots for any UI changes inside the webview.

## Contribution Agreement

Adsum IoT Coder is **open-core**: the extension **code** is [Apache-2.0](LICENSE), bundled **knowledge content** (`iot-knowledge/`) is [CC-BY-SA-4.0](iot-knowledge/LICENSE), and some bits ship under Adsum Networks' proprietary terms. **Code** contributions are accepted under Apache-2.0. Because of the multi-license model, **knowledge-content** contributions require a Contributor License Agreement (CLA) that is **not yet in place** — until it is, we don't merge external PRs that add or modify content under `iot-knowledge/` or the registry. (Draft CLA pending review.)

Let's build something amazing together! 🚀
