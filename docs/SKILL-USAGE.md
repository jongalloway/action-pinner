# Consuming the pin-actions skill

Other repositories can reuse the `pin-actions` skill in either of these ways:

1. Copy `.github/skills/pin-actions/SKILL.md` from this repository into the target repository's `.github/skills/pin-actions/SKILL.md`.
2. Or paste / reference the skill contents from that file inside your Copilot custom instructions or other agent instructions.

This works with GitHub Copilot, Copilot CLI, and other AI agents that read repository skill files or custom instruction documents.

Recommended flow for consumers:

- add the skill file
- ask the agent to use the `pin-actions` skill when auditing or fixing GitHub Actions workflow pins
- run `npx pin-actions@latest scan --json` first, then `fix`, `enforce`, or `pr` as needed
