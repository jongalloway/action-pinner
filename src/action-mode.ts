import { runCli } from "./cli.js";

export async function runActionMode(): Promise<void> {
  const mode = process.env.INPUT_MODE ?? "scan";
  const config = process.env.INPUT_CONFIG ?? ".pin-actions.json";
  const pathInput = process.env.INPUT_PATH?.trim();
  const args = pathInput ? [mode, "--config", config, "--path", pathInput] : [mode, "--config", config];
  await runCli(args);
}
