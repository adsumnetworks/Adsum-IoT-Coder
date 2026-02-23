# Contributing to nRF AI Debugger

We're thrilled you're interested in contributing to the **nRF AI Debugger**! Whether you're fixing a bug, adding a feature, or improving our docs, every contribution helps make debugging on nRF devices smarter and easier.


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
   git clone https://github.com/adsumnetworks/AIDebug-Agent.git
   ```

2. **Open the project in VSCode:**
   ```bash
   cd AIDebug-Agent
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
   - This will launch a new VS Code Extension Development Host window with the nRF AI Debugger loaded.

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

By submitting a pull request, you agree that your contributions will be licensed under the same license as the project ([Apache 2.0](LICENSE)).

Let's build something amazing together! 🚀
