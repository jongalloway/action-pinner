const REGEX_SPECIAL = /[|\\{}()[\]^$+?.]/g;

export interface PatternMatchOptions {
  caseInsensitive?: boolean;
}

function toRegex(pattern: string, options: PatternMatchOptions = {}): RegExp {
  const flags = options.caseInsensitive === false ? "u" : "iu";
  return new RegExp(`^${globToRegex(pattern)}$`, flags);
}

function globToRegex(pattern: string): string {
  const normalized = pattern.replace(/\\/g, "/");
  let output = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*") {
      if (next === "*") {
        const nextNext = normalized[index + 2];
        if (nextNext === "/") {
          output += "(?:.*/)?";
          index += 2;
        } else {
          output += ".*";
          index += 1;
        }
      } else {
        output += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      output += "[^/]";
      continue;
    }

    if (char === "{") {
      const closeIndex = normalized.indexOf("}", index + 1);
      if (closeIndex !== -1) {
        const body = normalized.slice(index + 1, closeIndex);
        const parts = body.split(",").map((part) => escapeRegex(part));
        output += `(?:${parts.join("|")})`;
        index = closeIndex;
        continue;
      }
    }

    output += escapeRegex(char);
  }

  return output;
}

function escapeRegex(value: string): string {
  return value.replace(REGEX_SPECIAL, "\\$&");
}

export function matchesPattern(
  value: string,
  pattern: string,
  options: PatternMatchOptions = {}
): boolean {
  return toRegex(pattern, options).test(value);
}

export function matchesAnyPattern(
  value: string,
  patterns: string[],
  options: PatternMatchOptions = {}
): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => matchesPattern(value, pattern, options));
}
