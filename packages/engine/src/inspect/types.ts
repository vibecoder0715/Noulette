export type Stage = 'security' | 'logic' | 'feasibility' | 'legal';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type Fixability = 'code' | 'human' | 'both';
export type FindingStatus = 'open' | 'fixed' | 'needs_you' | 'failed' | 'dismissed';

/** One normalised problem, whatever raised it (scanner or agent). */
export interface Finding {
  id: string;
  stage: Stage;
  /** Which tool raised it. Verification re-runs this same source. */
  source: 'gitleaks' | 'osv' | 'opengrep' | 'license' | 'mock' | 'dast' | 'builtin' | 'agent';
  rule: string;
  severity: FindingSeverity;
  labelId: string;
  title: string;
  tldr: string;
  file: string | null;
  line: number | null;
  evidence: string | null;
  fixability: Fixability;
  /** What a human must do (rotate key, choose stack, legal decision). */
  humanAction: string | null;
  fix: string | null;
  details: Record<string, unknown>;
  fingerprint: string;
  status: FindingStatus;
}

export interface ScannerStatus {
  name: string;
  ok: boolean;
  ran: boolean;
  findings: number;
  note?: string;
  ms: number;
}
