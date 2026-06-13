import type {
  ActionReference,
  EnforcementException,
  EnforcementExceptionIssue,
  EnforcementFinding,
  EnforcementResult,
  MultiRepoEnforcementEntry,
  MultiRepoEnforcementResult,
  ScanResult
} from "./types.js";
import type { MultiRepoScanResult } from "./multi-repo-scanner.js";
import { matchesPattern } from "./pattern-match.js";
import { toDisplayPath } from "./workflow-paths.js";

export interface EnforcementPolicy {
  allowActions: string[];
  exceptions: EnforcementException[];
}

export interface EnforcementEvaluationOptions {
  now?: Date;
}

interface ValidEnforcementException {
  index: number;
  exception: EnforcementException;
  justification?: string;
}

interface ExceptionValidationResult {
  validExceptions: ValidEnforcementException[];
  issues: EnforcementExceptionIssue[];
}

export function evaluateEnforcement(
  result: ScanResult,
  policy: EnforcementPolicy,
  options: EnforcementEvaluationOptions = {}
): EnforcementResult {
  const now = options.now ?? new Date();
  const validation = validateExceptions(policy.exceptions, now);
  return evaluateEnforcementWithValidation(result, policy.allowActions, validation);
}

export function evaluateMultiRepoEnforcement(
  result: MultiRepoScanResult,
  policy: EnforcementPolicy,
  options: EnforcementEvaluationOptions = {}
): MultiRepoEnforcementResult {
  const validation = validateExceptions(policy.exceptions, options.now ?? new Date());
  const repositories: MultiRepoEnforcementEntry[] = result.repositories.map((entry) => ({
    ...entry,
    enforcement: evaluateEnforcementWithValidation(entry.scan, policy.allowActions, validation)
  }));

  return {
    repositories,
    summary: {
      repositoriesScanned: repositories.length,
      repositoriesWithViolations: repositories.filter(
        (entry) => entry.enforcement.violations.length > 0
      ).length,
      filesScanned: repositories.reduce((sum, entry) => sum + entry.scan.summary.filesScanned, 0),
      referencesFound: repositories.reduce(
        (sum, entry) => sum + entry.scan.summary.referencesFound,
        0
      ),
      unpinnedFound: repositories.reduce(
        (sum, entry) => sum + entry.scan.summary.unpinnedFound,
        0
      ),
      allowedCount: repositories.reduce(
        (sum, entry) => sum + entry.enforcement.summary.allowedCount,
        0
      ),
      violationCount: repositories.reduce(
        (sum, entry) => sum + entry.enforcement.summary.violationCount,
        0
      ),
      invalidExceptionCount: validation.issues.length
    },
    invalidExceptions: validation.issues,
    compliant:
      validation.issues.length === 0 &&
      repositories.every((entry) => entry.enforcement.violations.length === 0)
  };
}

function evaluateEnforcementWithValidation(
  result: ScanResult,
  allowActionPatterns: string[],
  validation: ExceptionValidationResult
): EnforcementResult {
  const allowActions = allowActionPatterns.map((value) => value.trim()).filter(Boolean);

  const allowed: EnforcementFinding[] = [];
  const violations: EnforcementFinding[] = [];

  for (const reference of result.unpinned) {
    const matchingAllowAction = allowActions.find((pattern) =>
      matchesActionPattern(reference.action, pattern)
    );
    if (matchingAllowAction) {
      allowed.push({
        ...reference,
        outcome: "allowed",
        reason: "allowlist",
        message: `Allowed by enforcement.allowActions pattern '${matchingAllowAction}'.`,
        matchedPattern: matchingAllowAction
      });
      continue;
    }

    const matchingException = validation.validExceptions.find(({ exception }) =>
      matchesException(reference, exception)
    );
    if (matchingException) {
      allowed.push({
        ...reference,
        outcome: "allowed",
        reason: "exception",
        message: buildExceptionAllowanceMessage(matchingException),
        exception: matchingException.exception,
        matchedPattern: buildExceptionPattern(matchingException.exception)
      });
      continue;
    }

    const matchingIssue = validation.issues.find((issue) =>
      matchesException(reference, issue.exception)
    );
    if (matchingIssue) {
      violations.push({
        ...reference,
        outcome: "violation",
        reason: matchingIssue.reason === "expired" ? "expired-exception" : "invalid-exception",
        message: `${matchingIssue.message} This reference remains a violation until the exception is fixed or removed.`,
        exception: matchingIssue.exception,
        matchedPattern: buildExceptionPattern(matchingIssue.exception)
      });
      continue;
    }

    violations.push({
      ...reference,
      outcome: "violation",
      reason: "unpinned",
      message: "Unpinned action reference is not covered by an allowlist entry or valid exception."
    });
  }

  return {
    summary: {
      ...result.summary,
      allowedCount: allowed.length,
      violationCount: violations.length,
      invalidExceptionCount: validation.issues.length
    },
    references: result.references,
    allowed,
    violations,
    invalidExceptions: validation.issues,
    compliant: allowed.length + violations.length === 0
      ? validation.issues.length === 0
      : violations.length === 0 && validation.issues.length === 0
  };
}

export function applyEnforcementExceptions(
  result: ScanResult,
  exceptions: EnforcementException[],
  options: EnforcementEvaluationOptions = {}
): ScanResult {
  const validExceptions = validateExceptions(exceptions, options.now ?? new Date()).validExceptions;
  if (validExceptions.length === 0) {
    return result;
  }

  const unpinned = result.unpinned.filter(
    (entry) => !validExceptions.some(({ exception }) => matchesException(entry, exception))
  );

  return {
    ...result,
    summary: {
      ...result.summary,
      unpinnedFound: unpinned.length
    },
    unpinned
  };
}

function validateExceptions(
  exceptions: EnforcementException[],
  now: Date
): ExceptionValidationResult {
  const validExceptions: ValidEnforcementException[] = [];
  const issues: EnforcementExceptionIssue[] = [];

  exceptions.forEach((exception, index) => {
    const action = exception.action.trim();
    const ref = exception.ref?.trim();
    const workflow = exception.workflow?.trim();
    const justification = normalizeJustification(exception);
    const expiresAt = exception.expiresAt?.trim();

    if (!action) {
      issues.push({
        index,
        reason: "invalid-action",
        message: `Exception #${index + 1} is malformed: 'action' must not be empty.`,
        exception
      });
      return;
    }

    if (exception.ref !== undefined && !ref) {
      issues.push({
        index,
        reason: "invalid-ref",
        message: `Exception #${index + 1} is malformed: 'ref' must not be empty when provided.`,
        exception
      });
      return;
    }

    if (exception.workflow !== undefined && !workflow) {
      issues.push({
        index,
        reason: "invalid-workflow",
        message: `Exception #${index + 1} is malformed: 'workflow' must not be empty when provided.`,
        exception
      });
      return;
    }

    if (exception.expiresAt !== undefined) {
      if (!expiresAt) {
        issues.push({
          index,
          reason: "invalid-expiry",
          message: `Exception #${index + 1} is malformed: 'expiresAt' must not be empty when provided.`,
          exception
        });
        return;
      }

      const expiresAtTime = Date.parse(expiresAt);
      if (Number.isNaN(expiresAtTime)) {
        issues.push({
          index,
          reason: "invalid-expiry",
          message: `Exception #${index + 1} is malformed: 'expiresAt' must be a valid ISO-8601 date or date-time.`,
          exception
        });
        return;
      }

      if (expiresAtTime <= now.getTime()) {
        issues.push({
          index,
          reason: "expired",
          message: `Exception #${index + 1} expired at ${expiresAt}.`,
          exception
        });
        return;
      }
    }

    validExceptions.push({
      index,
      exception: {
        ...exception,
        action,
        ref,
        workflow,
        justification,
        expiresAt
      },
      justification
    });
  });

  return {
    validExceptions,
    issues: issues.sort((left, right) => left.index - right.index)
  };
}

function matchesException(reference: ActionReference, exception: EnforcementException): boolean {
  if (!matchesActionPattern(reference.action, exception.action)) {
    return false;
  }

  if (exception.ref && (!reference.ref || !matchesPattern(reference.ref, exception.ref))) {
    return false;
  }

  if (exception.workflow && !matchesPattern(toDisplayPath(reference.filePath), exception.workflow)) {
    return false;
  }

  return true;
}

function matchesActionPattern(action: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return false;
  }

  const target = normalizedPattern.includes("/") ? action : action.split("/")[1] ?? action;
  return matchesPattern(target, normalizedPattern, { caseInsensitive: true });
}

function normalizeJustification(exception: EnforcementException): string | undefined {
  const value = exception.justification ?? exception.reason;
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function buildExceptionAllowanceMessage(exception: ValidEnforcementException): string {
  const details = [`Allowed by enforcement exception #${exception.index + 1}`];
  const metadata: string[] = [];

  if (exception.justification) {
    metadata.push(`justification: ${exception.justification}`);
  }

  if (exception.exception.expiresAt) {
    metadata.push(`expiresAt: ${exception.exception.expiresAt}`);
  }

  if (metadata.length === 0) {
    return `${details[0]}.`;
  }

  return `${details[0]} (${metadata.join(", ")}).`;
}

function buildExceptionPattern(exception: EnforcementException): string {
  return [exception.action, exception.ref ? `@${exception.ref}` : "", exception.workflow ? `::${exception.workflow}` : ""].join("");
}
