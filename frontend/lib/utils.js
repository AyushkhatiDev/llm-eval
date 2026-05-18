/**
 * Derives a display status from an EvalRun object.
 * The backend model has no `status` field — it has `passed`, `failed`, `total_tests`, `pass_rate`.
 */
export function getRunStatus(run) {
  if (!run) return { label: "unknown", badge: "pending" };

  if (run.total_tests === 0) {
    return { label: "pending", badge: "pending" };
  }

  if (run.failed > 0 && run.passed === 0) {
    return { label: "failed", badge: "failure" };
  }

  if (run.pass_rate >= 0.7) {
    return { label: "passed", badge: "success" };
  }

  if (run.pass_rate > 0) {
    return { label: "partial", badge: "pending" };
  }

  return { label: "failed", badge: "failure" };
}

/**
 * Compute a synthetic avg score from pass_rate (the model doesn't store avg_score).
 */
export function getRunScore(run) {
  if (!run) return null;
  return run.pass_rate != null ? run.pass_rate : null;
}
