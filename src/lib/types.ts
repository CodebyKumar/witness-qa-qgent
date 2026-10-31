export type Severity = "critical" | "high" | "medium" | "low";
export type Verdict = "PASS" | "FAIL" | "BLOCKED" | "ERROR";
export type CaseStatus = "queued" | "running" | "verifying" | "done" | "cancelled";
export type RunControl = "running" | "paused" | "stopped" | "finished";

export interface TestCase {
  id: string;
  title: string;
  steps: string[];
  expected: string;
  severity: Severity;
  destructive: boolean;
  allowSubmit?: boolean; // user opted in to the final order/pay/delete click
  autoAdded?: boolean;
  testData?: string;
  clarification?: string;
}

export interface Observation {
  steps: { step_number: number; action: string; observation: string; completed: boolean }[];
  final_url?: string;
  final_page_state: string;
  visible_errors?: string[];
  stopped_early: boolean;
  stop_reason?: string | null;
  blocked_by: "none" | "captcha" | "login_wall" | "bot_block" | "site_down" | "other";
  off_task_notes?: string | null;
}

export interface TestResult {
  caseId: string;
  status: CaseStatus;
  tinyfishRunId?: string;
  streamingUrl?: string;
  progress: { at: string; text: string }[];
  observation?: Observation | null;
  tfStatus?: string;
  tfError?: string;
  numSteps?: number;
  shots?: { id: string; action: string }[]; // steps whose screenshot is saved under data/shots/<tinyfishRunId>/
  videoUrl?: string;
  verdict?: Verdict;
  reason?: string;
  expectedText?: string;
  observedText?: string;
  reproSteps?: string[];
  likelyCause?: string;
  checkedScreenshot?: boolean; // the verifier read the final screenshot, not just the agent's words
  startedAt?: string;
  finishedAt?: string;
}

export interface Run {
  id: string;
  url: string;
  createdAt: string;
  control: RunControl;
  cases: TestCase[];
  results: Record<string, TestResult>;
}
