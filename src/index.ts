#!/usr/bin/env node

async function main() {
  if (process.env.GITHUB_ACTIONS === "true" && process.env.INPUT_MODE) {
    const { runActionMode } = await import("./action-mode.js");
    await runActionMode();
    return;
  }

  const { runCli } = await import("./cli.js");
  await runCli();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
