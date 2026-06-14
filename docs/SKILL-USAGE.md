# Consuming the action-pinner skill

Other repositories can reuse the `action-pinner` skill in either of these ways:

1. Copy `.github/skills/action-pinner/SKILL.md` from this repository into the target repository's `.github/skills/action-pinner/SKILL.md`.
2. Or paste / reference the skill contents from that file inside your Copilot custom instructions or other agent instructions.

This works with GitHub Copilot, Copilot CLI, and other AI agents that read repository skill files or custom instruction documents.

Recommended flow for consumers:

- add the skill file
- ask the agent to use the `action-pinner` skill when auditing or fixing GitHub Actions workflow pins
- run `npx action-pinner@latest scan --json` first, then `fix`, `enforce`, or `pr` as needed
