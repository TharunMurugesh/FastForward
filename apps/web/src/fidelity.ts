/** Shape of fidelity/latest.json, written by the fidelity suite (plan Task 14 step 2b). Shapes and statuses only. */
export interface FidelityCheck {
  endpoint: string;
  method: string;
  /** Which step of the suite this was, when the same endpoint is called more than once. */
  step?: string;
  sandboxStatus: number;
  twinStatus: number;
  shapeMatch: boolean;
  specMatch: boolean;
  allowedDiffs: { field: string; reason: string }[];
}

export interface FidelityFile {
  ranAt: string;
  sandboxBase: string;
  checks: FidelityCheck[];
}
