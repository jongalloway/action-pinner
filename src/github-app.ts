export interface AppModeOptions {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

export async function runGitHubAppMode(_options: AppModeOptions): Promise<void> {
  throw new Error(
    "GitHub App mode is scaffolded but not yet implemented. Use CLI or Action mode."
  );
}
