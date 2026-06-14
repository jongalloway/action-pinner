#!/usr/bin/env node

import { runActionMode } from "./action-mode.js";
import { runCli } from "./cli.js";

async function main() {
  if (process.env.GITHUB_ACTIONS === "true" && process.env.INPUT_MODE) {
    await runActionMode();
    return;
  }

  await runCli();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
