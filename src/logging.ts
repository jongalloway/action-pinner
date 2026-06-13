export interface SafeLogRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export const SAFE_LOG_RULES: SafeLogRule[] = [
  {
    name: "token_parameter",
    pattern: /token=[^\s&"']+/gi,
    replacement: "token=***REDACTED***"
  },
  {
    name: "authorization_header",
    pattern: /Authorization:\s*Bearer\s+[^\s]+/gi,
    replacement: "Authorization: Bearer ***REDACTED***"
  },
  {
    name: "github_token_env",
    pattern: /GITHUB_TOKEN=[^\s"']+/gi,
    replacement: "GITHUB_TOKEN=***REDACTED***"
  },
  {
    name: "url_with_credentials",
    pattern: /https?:\/\/[^:]+:[^\s@]+@/gi,
    replacement: "https://***REDACTED***:***REDACTED***@"
  },
  {
    name: "personal_access_token",
    pattern: /gh[pousr]_[A-Za-z0-9_]+/g,
    replacement: "***REDACTED_TOKEN***"
  }
];

export function redactToken(str: string): string {
  let result = str;
  for (const rule of SAFE_LOG_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

export function safeLog(message: string): string {
  return redactToken(message);
}
