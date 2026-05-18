const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000/api";

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

  getTaskStatus: (taskId) => request(`/eval/status/${taskId}`),

  // Runs
  listRuns: () => request("/runs"),
  getRun: (runId) => request(`/runs/${runId}`),

  // Regression
  compareRuns: (runAId, runBId) => request(`/regression/${runAId}/${runBId}`),
};
