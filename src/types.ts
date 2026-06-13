export type ScanMode = "scan" | "fix" | "enforce" | "pr";

export interface PRConfig {
  create: boolean;
  branchPrefix: string;
  title: string;
  labels: string[];
  reviewers: string[];
  assignees: string[];
  bodyTemplate?: string;
}

export interface EnforcementConfig {
  enabled: boolean;
  failOnUnpinned: boolean;
  allowActions: string[];
  exceptions: EnforcementException[];
}

export interface EnforcementException {
  action: string;
  ref?: string;
  workflow?: string;
  reason?: string;
  justification?: string;
  expiresAt?: string;
}

export interface DependabotConfig {
  addVersionComments: boolean;
  generateConfigSnippet: boolean;
}

export interface OrgConfig {
  name?: string;
  type?: "org" | "user";
  includePrivate: boolean;
  includeArchived: boolean;
}

export interface PinActionsConfig {
  mode: ScanMode;
  include: string[];
  exclude: string[];
  repos: string[];
  includeRepos: string[];
  excludeActions: string[];
  excludeRepos: string[];
  org: OrgConfig;
  pr: PRConfig;
  enforcement: EnforcementConfig;
  dependabot: DependabotConfig;
  githubApiUrl?: string;
  useNetrc?: boolean;
}

export type ActionRefKind =
  | "pinned-sha"
  | "tag-or-branch"
  | "local"
  | "docker"
  | "invalid";

export interface ActionReference {
  filePath: string;
  line: number;
  column?: number;
  raw: string;
  action: string;
  ref?: string;
  kind: ActionRefKind;
}

export interface ResolutionResult {
  original: string;
  sha: string;
  comment: string;
  sourceRepo: string;
  resolutionMethod: string;
  resolvedAt: string;
}

export interface PinEvidence {
  filePath: string;
  line: number;
  originalRef: string;
  resolvedSha: string;
  sourceRepo: string;
  resolutionMethod: string;
  resolvedAt: string;
}

export interface FilePatch {
  filePath: string;
  originalContent: string;
  updatedContent: string;
  referencesUpdated: ActionReference[];
  evidence: PinEvidence[];
}

export interface ScanResult {
  summary: ScanSummary;
  references: ActionReference[];
  unpinned: ActionReference[];
}

export interface ScanSummary {
  filesScanned: number;
  referencesFound: number;
  unpinnedFound: number;
}

export type EnforcementFindingOutcome = "allowed" | "violation";
export type EnforcementFindingReason =
  | "allowlist"
  | "exception"
  | "unpinned"
  | "expired-exception"
  | "invalid-exception";
export type EnforcementExceptionIssueReason =
  | "expired"
  | "invalid-action"
  | "invalid-ref"
  | "invalid-workflow"
  | "invalid-expiry";

export interface EnforcementFinding extends ActionReference {
  outcome: EnforcementFindingOutcome;
  reason: EnforcementFindingReason;
  message: string;
  exception?: EnforcementException;
  matchedPattern?: string;
}

export interface EnforcementExceptionIssue {
  index: number;
  reason: EnforcementExceptionIssueReason;
  message: string;
  exception: EnforcementException;
}

export interface EnforcementSummary extends ScanSummary {
  allowedCount: number;
  violationCount: number;
  invalidExceptionCount: number;
}

export interface EnforcementResult {
  summary: EnforcementSummary;
  references: ActionReference[];
  allowed: EnforcementFinding[];
  violations: EnforcementFinding[];
  invalidExceptions: EnforcementExceptionIssue[];
  compliant: boolean;
}


export interface MultiRepoEnforcementEntry {
  repository: string;
  defaultBranch: string;
  scan: ScanResult;
  enforcement: EnforcementResult;
}

export interface MultiRepoEnforcementResult {
  repositories: MultiRepoEnforcementEntry[];
  summary: {
    repositoriesScanned: number;
    repositoriesWithViolations: number;
    filesScanned: number;
    referencesFound: number;
    unpinnedFound: number;
    allowedCount: number;
    violationCount: number;
    invalidExceptionCount: number;
  };
  invalidExceptions: EnforcementExceptionIssue[];
  compliant: boolean;
}

export interface ResolutionErrorDetails {
  ref: string;
  reason: string;
  suggestions?: string[];
  retryDetails?: {
    attempts: number;
    maxAttempts: number;
    lastError?: string;
  };
}

export class AmbiguousRefError extends Error {
  public readonly details: ResolutionErrorDetails & {
    matchingShas: Array<{ sha: string; source: string }>;
  };

  constructor(
    ref: string,
    matchingShas: Array<{ sha: string; source: string }>
  ) {
    const details = {
      ref,
      reason: "Ambiguous ref resolved to multiple SHAs",
      matchingShas,
      suggestions: [
        "Use pinning logic to explicitly specify the target SHA",
        "Use explicit flags to disambiguate the reference"
      ]
    };
    super(`Ambiguous ref: ${ref} resolved to ${matchingShas.length} SHAs`);
    this.name = "AmbiguousRefError";
    this.details = details;
  }
}

export class UnresolvedRefError extends Error {
  public readonly details: ResolutionErrorDetails;

  constructor(ref: string, attempts: number, maxAttempts: number, lastError?: string) {
    const details = {
      ref,
      reason: "Could not resolve ref after retries",
      suggestions: [
        "Verify the ref exists in the repository",
        "For private repositories, use a least-privilege token with Contents: Read (or classic repo scope only if fine-grained tokens are not available)",
        "Add Pull requests: Write only when you are using PR creation features",
        "Use --continue-on-error to skip this reference"
      ],
      retryDetails: {
        attempts,
        maxAttempts,
        lastError
      }
    };
    super(`Failed to resolve ${ref} after ${attempts} attempts: ${lastError}`);
    this.name = "UnresolvedRefError";
    this.details = details;
  }
}
