"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { getRunStatus } from "@/lib/utils";
import ScoreBar from "@/components/ScoreBar";
import Modal from "@/components/Modal";
import TierBadge from "@/components/TierBadge";

const REPRODUCE_KEY = "llm-eval-reproduce";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "failures", label: "Failures only" },
  { id: "escalated", label: "Escalated only" },
];

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState(null);
  const [runDetails, setRunDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadRuns() {
    try {
      setRuns(await api.listRuns());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function viewRun(runId) {
    setSelectedRun(runId);
    setFilter("all");
    setDetailsLoading(true);
    try {
      setRunDetails(await api.getRun(runId));
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function reproduceRun(runId) {
    setBusy(runId);
    setError(null);
    try {
      const plan = await api.reproduceRun(runId);
      localStorage.setItem(REPRODUCE_KEY, JSON.stringify(plan));
      router.push("/suite");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteRun(runId) {
    if (!window.confirm(`Delete run ${runId.substring(0, 8)} and all of its results?`)) return;
    setBusy(runId);
    setError(null);
    try {
      await api.deleteRun(runId);
      if (selectedRun === runId) {
        setSelectedRun(null);
        setRunDetails(null);
      }
      await loadRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const results = runDetails?.results ?? [];
  const visibleResults = results.filter((r) => {
    if (filter === "failures") return !r.passed;
    if (filter === "escalated") return r.escalated;
    return true;
  });
  const failureCount = results.filter((r) => !r.passed).length;
  const escalatedCount = results.filter((r) => r.escalated).length;

  return (
    <>
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1>Eval Runs</h1>
        <p>Browse and inspect evaluation runs, their configuration, and every scored result.</p>
      </motion.div>

      {error && <div className="alert alert-danger">{error}</div>}

      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="card-header">
          <h3 className="card-title">📋 All Runs</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadRuns}>
            🔄 Refresh
          </button>
        </div>
        <div className="card-body">
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 56, borderRadius: 8 }} />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <h3>No runs found</h3>
              <p>Run a test suite or single eval to see results here.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Run ID</th>
                    <th>Suite</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Pass Rate</th>
                    <th>Weighted</th>
                    <th>Escalated</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {runs.map((run, i) => {
                      const status = getRunStatus(run);
                      return (
                        <motion.tr
                          key={run.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: Math.min(i * 0.04, 0.4) }}
                          style={{ cursor: "pointer" }}
                          onClick={() => viewRun(run.id)}
                        >
                          <td
                            data-label="Run ID"
                            style={{ fontFamily: "monospace", color: "var(--text-accent)" }}
                          >
                            {run.id?.substring(0, 8)}
                            {run.reproduced_from && (
                              <span className="repro-tag" title={`Reproduction of ${run.reproduced_from}`}>
                                repro
                              </span>
                            )}
                          </td>
                          <td data-label="Suite">
                            <span className="status-badge running">{run.suite_version || "v1"}</span>
                          </td>
                          <td data-label="Model" style={{ fontSize: 13 }}>
                            {run.config?.target_model || run.model_endpoint || "—"}
                          </td>
                          <td data-label="Status">
                            <span className={`status-badge ${status.badge}`}>
                              <span className="status-dot" />
                              {status.label}
                            </span>
                          </td>
                          <td data-label="Pass Rate" style={{ fontWeight: 700 }}>
                            {run.pass_rate != null ? `${(run.pass_rate * 100).toFixed(0)}%` : "—"}
                          </td>
                          <td data-label="Weighted">
                            {run.weighted_score ? run.weighted_score.toFixed(2) : "—"}
                          </td>
                          <td data-label="Escalated">
                            {run.total_tests ? `${run.escalated_count ?? 0}/${run.total_tests}` : "—"}
                          </td>
                          <td data-label="Created" style={{ fontSize: 13, color: "var(--text-muted)" }}>
                            {run.created_at ? new Date(run.created_at).toLocaleDateString() : "—"}
                          </td>
                          <td data-label="Actions">
                            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                              <button className="btn btn-primary btn-sm" onClick={() => viewRun(run.id)}>
                                View
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => reproduceRun(run.id)}
                                disabled={busy === run.id || !run.config?.scorer_config_hash}
                                title={
                                  run.config?.scorer_config_hash
                                    ? "Re-run with the exact recorded configuration"
                                    : "This run predates config capture"
                                }
                              >
                                Reproduce
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => deleteRun(run.id)}
                                disabled={busy === run.id}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </motion.div>

      <Modal
        isOpen={!!selectedRun}
        onClose={() => {
          setSelectedRun(null);
          setRunDetails(null);
        }}
        title="Run Details"
      >
        {detailsLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 80, borderRadius: 8 }} />
            ))}
          </div>
        ) : runDetails ? (
          <div>
            <div className="run-config-grid">
              <ConfigField label="Run ID" value={runDetails.run?.id} mono />
              <ConfigField label="Pass rate" value={`${((runDetails.run?.pass_rate ?? 0) * 100).toFixed(0)}%`} />
              <ConfigField
                label="Weighted score"
                value={runDetails.run?.weighted_score?.toFixed(2) ?? "—"}
              />
              <ConfigField
                label="Escalation rate"
                value={`${((runDetails.run?.escalation_rate ?? 0) * 100).toFixed(0)}%`}
              />
              <ConfigField label="Target model" value={runDetails.run?.config?.target_model} />
              <ConfigField label="Judge model" value={runDetails.run?.config?.judge_model || "none (fast mode)"} />
              <ConfigField label="Temperature" value={runDetails.run?.config?.temperature} />
              <ConfigField label="Seed" value={runDetails.run?.config?.seed} />
              <ConfigField label="Scorer config" value={runDetails.run?.config?.scorer_config_hash} mono />
              <ConfigField label="Suite" value={runDetails.run?.config?.suite_fixture_version} />
              <ConfigField
                label="Prompt template"
                value={runDetails.run?.config?.prompt_template_version}
              />
              <ConfigField label="Judge tokens" value={runDetails.run?.judge_tokens_used ?? 0} />
            </div>

            <div className="filter-bar">
              {FILTERS.map((option) => {
                const count =
                  option.id === "failures"
                    ? failureCount
                    : option.id === "escalated"
                    ? escalatedCount
                    : results.length;
                return (
                  <button
                    key={option.id}
                    className={`filter-chip ${filter === option.id ? "active" : ""}`}
                    onClick={() => setFilter(option.id)}
                  >
                    {option.label} <span>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="result-cards">
              {visibleResults.length > 0 ? (
                visibleResults.map((result, i) => (
                  <motion.div
                    key={result.id || i}
                    className="result-card"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  >
                    <div className="result-card-header">
                      <span className="result-card-testid">
                        {result.test_id || `test-${i + 1}`}
                      </span>
                      <span className="result-card-tags">
                        <TierBadge
                          tier={result.judge_tier}
                          confidence={result.tier_confidence}
                          escalated={result.escalated}
                        />
                        {result.severity > 1 && (
                          <span className="tier-badge severity">severity {result.severity}</span>
                        )}
                        <span className={`status-badge ${result.passed ? "success" : "failure"}`}>
                          {result.passed ? "✓ Pass" : "✗ Fail"}
                        </span>
                      </span>
                    </div>
                    {result.prompt && <div className="result-card-prompt">{result.prompt}</div>}
                    <ScoreBar score={result.score || 0} label="Score" />
                    <div className="result-card-details">
                      {result.judge_reason && (
                        <div>
                          <span>Judge</span>
                          <p>{result.judge_reason}</p>
                        </div>
                      )}
                      {result.tiers_attempted?.length > 0 && (
                        <div>
                          <span>Tier trace</span>
                          <p className="case-card-trace">
                            {result.tiers_attempted
                              .map(
                                (t) =>
                                  `${t.label}: ${t.outcome}${
                                    t.confidence != null ? ` (${t.confidence.toFixed(2)})` : ""
                                  }`
                              )
                              .join("  →  ")}
                          </p>
                        </div>
                      )}
                      {result.failure_type && (
                        <div>
                          <span>Failure</span>
                          <p>{result.failure_type}</p>
                        </div>
                      )}
                      {result.output && (
                        <div>
                          <span>Model Output</span>
                          <pre>{result.output}</pre>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  {results.length === 0
                    ? "No individual results available."
                    : `No results match the "${FILTERS.find((f) => f.id === filter)?.label}" filter.`}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p style={{ color: "var(--text-muted)" }}>No data available.</p>
        )}
      </Modal>
    </>
  );
}

function ConfigField({ label, value, mono }) {
  return (
    <div className="run-config-field">
      <span>{label}</span>
      <strong style={mono ? { fontFamily: "monospace", fontSize: 12 } : undefined}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </strong>
    </div>
  );
}
