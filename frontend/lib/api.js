const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://llm-eval-55pg.onrender.com/api";

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { "Content-Type": "application/json" },
    ...options,
  };

  const res = await fetch(url, config);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Health
  health: () => request("/health"),

  // Eval
  triggerEval: (data) =>
    request("/eval/run", { method: "POST", body: JSON.stringify(data) }),

  triggerAdversarial: (data) =>
    request("/eval/adversarial", { method: "POST", body: JSON.stringify(data) }),

  runSuite: (data) =>
    request("/eval/suite", { method: "POST", body: JSON.stringify(data) }),

  getSuiteTests: () => request("/eval/suite/tests"),

  checkFlakiness: (data) =>
    request("/eval/flakiness", { method: "POST", body: JSON.stringify(data) }),

  // Runs
  createRun: (data) =>
    request("/runs", { method: "POST", body: JSON.stringify(data) }),
  listRuns: () => request("/runs"),
  getRun: (runId) => request(`/runs/${runId}`),
  deleteRun: (runId) => request(`/runs/${runId}`, { method: "DELETE" }),
  reproduceRun: (runId) => request(`/runs/${runId}/reproduce`, { method: "POST" }),

  // Dashboard stats — every KPI on the overview comes from these.
  overviewStats: () => request("/stats/overview"),
  scoreTrend: (limit = 10) => request(`/stats/trend?limit=${limit}`),
  categoryStats: (runId) =>
    request(`/stats/categories${runId ? `?run_id=${runId}` : ""}`),

  // Compare
  compareRuns: (runAId, runBId) =>
    request(`/runs/compare?a=${runAId}&b=${runBId}`),

  // Scorer validation — the harness evaluating itself.
  scorerFixture: () => request("/scorer/fixture"),
  runScorerValidation: (data = {}) =>
    request("/scorer/validate", { method: "POST", body: JSON.stringify(data) }),
  listScorerValidations: (limit = 25) =>
    request(`/scorer/validations?limit=${limit}`),
  latestScorerValidation: () => request("/scorer/validations/latest"),
  getScorerValidation: (id) => request(`/scorer/validations/${id}`),
};
