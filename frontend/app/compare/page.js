"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";

const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const signed = (v, digits = 2) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

const TIER_LABELS = {
  empty_check: "Empty check",
  semantic: "Semantic",
  rules: "Rule match",
  llm_judge: "LLM judge",
};

function runLabel(run) {
  const date = run.created_at ? new Date(run.created_at).toLocaleString() : "unknown date";
  return `${run.id.substring(0, 8)} — ${run.suite_version || "v1"} — ${date}`;
}

export default function ComparePage() {
  const [runs, setRuns] = useState([]);
  const [runA, setRunA] = useState("");
  const [runB, setRunB] = useState("");
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listRuns().then(setRuns).catch((err) => setError(err.message));
  }, []);

  async function compare() {
    setLoading(true);
    setError(null);
    setDiff(null);
    try {
      setDiff(await api.compareRuns(runA, runB));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const summary = diff?.summary;
  const verdictClass = useMemo(() => {
    if (!diff) return "";
    return diff.verdict === "regression"
      ? "failure"
      : diff.verdict === "improvement"
      ? "success"
      : "pending";
  }, [diff]);

  return (
    <>
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1>Compare Runs</h1>
        <p>
          Per-test diff between two runs. Regressions come first — that is what a compare view is
          for.
        </p>
      </motion.div>

      {error && <div className="alert alert-danger">{error}</div>}

      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ marginBottom: 24 }}
      >
        <div className="card-header">
          <h3 className="card-title">🔀 Select Runs</h3>
        </div>
        <div className="card-body">
          {runs.length < 2 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔀</div>
              <h3>Need at least 2 runs</h3>
              <p>Complete at least two eval runs to use the comparison tool.</p>
            </div>
          ) : (
            <>
              <div className="compare-picker-grid">
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Baseline Run (A)</label>
                  <select
                    className="form-select"
                    value={runA}
                    onChange={(e) => setRunA(e.target.value)}
                  >
                    <option value="">Select run...</option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {runLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="compare-arrow">→</div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Compare Run (B)</label>
                  <select
                    className="form-select"
                    value={runB}
                    onChange={(e) => setRunB(e.target.value)}
                  >
                    <option value="">Select run...</option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {runLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                className="btn btn-primary btn-lg"
                onClick={compare}
                disabled={loading || !runA || !runB || runA === runB}
                style={{ marginTop: 20 }}
              >
                {loading ? "Comparing..." : "🔍 Compare Runs"}
              </button>
              {runA && runA === runB && (
                <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-muted)" }}>
                  Pick two different runs.
                </p>
              )}
            </>
          )}
        </div>
      </motion.div>

      {diff && (
        <>
          {diff.warnings?.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 24 }}>
              {diff.warnings.map((warning) => (
                <div key={warning.code} className="alert alert-warning">
                  <strong>{warning.code.replace(/_/g, " ")}</strong>
                  <p>{warning.message}</p>
                </div>
              ))}
            </motion.div>
          )}

          <motion.div
            className="card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: 24 }}
          >
            <div className="card-header">
              <h3 className="card-title">📊 Summary</h3>
              <span className={`status-badge ${verdictClass}`}>
                <span className="status-dot" />
                {diff.verdict}
              </span>
            </div>
            <div className="card-body">
              <div className="diff-summary-grid">
                <div className="diff-summary-item danger">
                  <span>Regressions</span>
                  <strong>{summary.regressions}</strong>
                  <small>pass → fail</small>
                </div>
                <div className="diff-summary-item success">
                  <span>Fixes</span>
                  <strong>{summary.fixes}</strong>
                  <small>fail → pass</small>
                </div>
                <div className="diff-summary-item">
                  <span>Score moved</span>
                  <strong>{summary.score_changed}</strong>
                  <small>same verdict, different score</small>
                </div>
                <div className="diff-summary-item">
                  <span>Unchanged</span>
                  <strong>{summary.unchanged}</strong>
                  <small>of {summary.shared_tests} shared tests</small>
                </div>
                <div className="diff-summary-item">
                  <span>Pass rate</span>
                  <strong>{signed(summary.pass_rate_delta * 100, 1)}pp</strong>
                  <small>
                    {pct(diff.run_a.pass_rate)} → {pct(diff.run_b.pass_rate)}
                  </small>
                </div>
                <div className="diff-summary-item">
                  <span>Weighted score</span>
                  <strong>{signed(summary.weighted_score_delta)}</strong>
                  <small>severity-weighted mean</small>
                </div>
                <div className="diff-summary-item">
                  <span>Avg latency</span>
                  <strong>{signed(summary.avg_latency_delta_ms, 0)}ms</strong>
                  <small>per test</small>
                </div>
                <div className="diff-summary-item">
                  <span>Tier changes</span>
                  <strong>{summary.tier_changes}</strong>
                  <small>different tier settled the result</small>
                </div>
              </div>

              <div className="severity-callout">
                <strong>Severity-weighted impact.</strong> Regressions carry{" "}
                {diff.by_severity.regression_weight} of{" "}
                {diff.by_severity.total_weight} total weight (
                {pct(diff.by_severity.regression_weight_share)} of the suite), and the
                highest-severity test that regressed is weighted{" "}
                {diff.by_severity.highest_severity_regression || 0}.
              </div>
            </div>
          </motion.div>

          <DiffSection
            title="🔴 Regressions"
            subtitle="worst severity first"
            entries={diff.regressions}
            emptyMessage="No test went from passing to failing."
            tone="danger"
          />

          <DiffSection
            title="🟢 Fixes"
            subtitle="fail → pass"
            entries={diff.fixes}
            emptyMessage="No previously failing test started passing."
            tone="success"
          />

          <motion.div className="card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="card-header">
              <h3 className="card-title">🗂️ By category</h3>
            </div>
            <div className="card-body">
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Tests</th>
                      <th>Regressions</th>
                      <th>Fixes</th>
                      <th>Avg score Δ</th>
                      <th>Weighted score Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.by_category.map((row) => (
                      <tr key={row.category}>
                        <td data-label="Category">{row.category}</td>
                        <td data-label="Tests">{row.tests}</td>
                        <td
                          data-label="Regressions"
                          className={row.regressions ? "text-danger" : undefined}
                          style={{ fontWeight: row.regressions ? 700 : 400 }}
                        >
                          {row.regressions}
                        </td>
                        <td data-label="Fixes" className={row.fixes ? "text-success" : undefined}>
                          {row.fixes}
                        </td>
                        <td data-label="Avg score Δ">{signed(row.avg_score_delta)}</td>
                        <td data-label="Weighted score Δ">{signed(row.weighted_score_delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </>
  );
}

function DiffSection({ title, subtitle, entries, emptyMessage, tone }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ marginBottom: 24 }}
    >
      <div className="card-header">
        <h3 className="card-title">{title}</h3>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {entries.length ? subtitle : ""}
        </span>
      </div>
      <div className="card-body">
        {entries.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>{emptyMessage}</p>
        ) : (
          <div className="diff-list">
            {entries.map((entry) => (
              <div key={entry.test_id} className={`diff-item ${tone}`}>
                <div className="diff-item-header">
                  <span className="diff-item-id">{entry.test_id}</span>
                  <span className="diff-item-tags">
                    <span className="tier-badge">{entry.category}</span>
                    <span className="tier-badge severity">severity {entry.severity}</span>
                    <span className={`status-badge ${tone === "danger" ? "failure" : "success"}`}>
                      {entry.score_before?.toFixed(2)} → {entry.score_after?.toFixed(2)}
                    </span>
                  </span>
                </div>
                <p className="diff-item-prompt">{entry.prompt}</p>
                <div className="diff-item-reasons">
                  <div>
                    <span>Run A judge</span>
                    <p>{entry.judge_reason_before || "—"}</p>
                  </div>
                  <div>
                    <span>Run B judge</span>
                    <p>{entry.judge_reason_after || "—"}</p>
                  </div>
                </div>
                <div className="diff-item-meta">
                  <span>latency {signed(entry.latency_delta_ms, 0)}ms</span>
                  {entry.tier_change && (
                    <span>
                      tier {TIER_LABELS[entry.tier_change.from] || entry.tier_change.from} →{" "}
                      {TIER_LABELS[entry.tier_change.to] || entry.tier_change.to}
                    </span>
                  )}
                  {entry.failure_type && <span>failure: {entry.failure_type}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
