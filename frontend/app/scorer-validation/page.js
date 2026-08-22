"use client";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BaselineBarChart, ValidationHistoryChart } from "@/components/Charts";
import { api } from "@/lib/api";

const CELL_LABELS = {
  actual_pass__predicted_pass: "Correctly left alone",
  actual_pass__predicted_fail: "False alarm",
  actual_fail__predicted_fail: "Correctly caught",
  actual_fail__predicted_pass: "Missed hallucination",
};

const TIER_LABELS = {
  empty_check: "Empty check",
  semantic: "Semantic",
  rules: "Rule match",
  llm_judge: "LLM judge",
};

const pct = (value) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;

function prettyCategory(name) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ScorerValidationPage() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [fixture, setFixture] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [latestRes, historyRes, fixtureRes] = await Promise.allSettled([
        api.latestScorerValidation(),
        api.listScorerValidations(),
        api.scorerFixture(),
      ]);
      if (cancelled) return;
      if (latestRes.status === "fulfilled") setLatest(latestRes.value);
      if (historyRes.status === "fulfilled") setHistory(historyRes.value);
      if (fixtureRes.status === "fulfilled") setFixture(fixtureRes.value);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runValidation() {
    setRunning(true);
    setError(null);
    try {
      const result = await api.runScorerValidation({ notes: "Run from the dashboard" });
      setLatest(result);
      setSelectedCell(null);
      setHistory(await api.listScorerValidations());
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const matrix = latest?.confusion_matrix;

  const baselineData = useMemo(() => {
    if (!latest) return [];
    return [
      { name: "Random 50/50", accuracy: latest.baseline_random },
      { name: "Label prior", accuracy: latest.baseline_label_prior },
      { name: "This scorer", accuracy: latest.accuracy, isScorer: true },
    ];
  }, [latest]);

  const historyData = useMemo(
    () =>
      [...history].reverse().map((row) => ({
        name: new Date(row.created_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        accuracy: row.accuracy,
        baseline: Math.max(row.baseline_random ?? 0, row.baseline_label_prior ?? 0),
      })),
    [history]
  );

  const selectedCases = useMemo(() => {
    if (!latest?.case_results || !selectedCell) return [];
    return latest.case_results.filter((c) => c.cell === selectedCell);
  }, [latest, selectedCell]);

  const lift = latest
    ? latest.accuracy - Math.max(latest.baseline_random, latest.baseline_label_prior)
    : null;

  return (
    <>
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1>Scorer Validation</h1>
        <p>
          The rest of this app evaluates models. This page evaluates the scorer: it replays a
          hand-labelled fixture through the production scoring path and measures how often the
          scorer agrees with a human.
        </p>
      </motion.div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          ))}
        </div>
      ) : !latest ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <div className="empty-state-icon">🔬</div>
              <h3>No validation recorded yet</h3>
              <p>
                Run the scorer against the {fixture?.case_count ?? 50}-case fixture to measure
                its accuracy against random baselines.
              </p>
              <button className="btn btn-primary btn-lg" onClick={runValidation} disabled={running}>
                {running ? "Validating..." : "🔬 Run validation"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ── Headline ──────────────────────────────────────────── */}
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: 24 }}
          >
            <div className="card-header">
              <h3 className="card-title">🎯 Scorer accuracy vs random baselines</h3>
              <button className="btn btn-secondary btn-sm" onClick={runValidation} disabled={running}>
                {running ? "Validating..." : "Re-run validation"}
              </button>
            </div>
            <div className="card-body">
              <div className="validation-headline">
                <div className="validation-headline-figure">
                  <span className="validation-headline-value">{pct(latest.accuracy)}</span>
                  <span className="validation-headline-label">agreement with human labels</span>
                  <span className="validation-headline-lift">
                    +{(lift * 100).toFixed(1)} points over the best random baseline
                  </span>
                  <p className="validation-headline-note">
                    {latest.fixture_case_count} cases · fixture {latest.fixture_version} · scorer
                    config <code>{latest.scorer_config_hash}</code> · baselines seeded with{" "}
                    {latest.baseline_seed} over {latest.baseline_trials} trials
                  </p>
                </div>
                <div className="validation-headline-chart">
                  <BaselineBarChart data={baselineData} />
                </div>
              </div>

              <div className="metric-strip">
                <div className="metric-strip-item">
                  <span>Precision</span>
                  <strong>{pct(latest.precision)}</strong>
                  <small>of the cases it flagged, this many really were fabrications</small>
                </div>
                <div className="metric-strip-item">
                  <span>Recall</span>
                  <strong>{pct(latest.recall)}</strong>
                  <small>of the real fabrications, this many were caught</small>
                </div>
                <div className="metric-strip-item">
                  <span>F1</span>
                  <strong>{pct(latest.f1)}</strong>
                  <small>harmonic mean of precision and recall</small>
                </div>
                <div className="metric-strip-item">
                  <span>Pass recall</span>
                  <strong>{pct(latest.pass_recall)}</strong>
                  <small>of the correct refusals, this many were left alone</small>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Confusion matrix ──────────────────────────────────── */}
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            style={{ marginBottom: 24 }}
          >
            <div className="card-header">
              <h3 className="card-title">🧮 Confusion matrix</h3>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                click a cell to read those cases
              </span>
            </div>
            <div className="card-body">
              <div className="confusion-grid">
                <div className="confusion-corner">actual \ predicted</div>
                <div className="confusion-heading">Scorer said pass</div>
                <div className="confusion-heading">Scorer said fail</div>

                <div className="confusion-heading side">Human said pass</div>
                <ConfusionCell
                  cell="actual_pass__predicted_pass"
                  count={matrix.actual_pass.predicted_pass}
                  tone="good"
                  selected={selectedCell}
                  onSelect={setSelectedCell}
                />
                <ConfusionCell
                  cell="actual_pass__predicted_fail"
                  count={matrix.actual_pass.predicted_fail}
                  tone="warn"
                  selected={selectedCell}
                  onSelect={setSelectedCell}
                />

                <div className="confusion-heading side">Human said fail</div>
                <ConfusionCell
                  cell="actual_fail__predicted_pass"
                  count={matrix.actual_fail.predicted_pass}
                  tone="bad"
                  selected={selectedCell}
                  onSelect={setSelectedCell}
                />
                <ConfusionCell
                  cell="actual_fail__predicted_fail"
                  count={matrix.actual_fail.predicted_fail}
                  tone="good"
                  selected={selectedCell}
                  onSelect={setSelectedCell}
                />
              </div>

              <AnimatePresence mode="wait">
                {selectedCell && (
                  <motion.div
                    key={selectedCell}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <div className="case-list-header">
                      <h4>
                        {CELL_LABELS[selectedCell]} — {selectedCases.length} case
                        {selectedCases.length === 1 ? "" : "s"}
                      </h4>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSelectedCell(null)}
                      >
                        Close
                      </button>
                    </div>
                    {selectedCases.length === 0 ? (
                      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                        No cases fell into this cell.
                      </p>
                    ) : (
                      <div className="case-list">
                        {selectedCases.map((c) => (
                          <CaseCard key={c.id} caseResult={c} />
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* ── Per-category ──────────────────────────────────────── */}
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            style={{ marginBottom: 24 }}
          >
            <div className="card-header">
              <h3 className="card-title">📚 Per-pattern breakdown</h3>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                five hallucination patterns
              </span>
            </div>
            <div className="card-body">
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Pattern</th>
                      <th>Cases</th>
                      <th>Correct</th>
                      <th>Accuracy</th>
                      <th>Precision</th>
                      <th>Recall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(latest.per_category_breakdown || {}).map(([category, row]) => (
                      <tr key={category}>
                        <td data-label="Pattern">{prettyCategory(category)}</td>
                        <td data-label="Cases">{row.cases}</td>
                        <td data-label="Correct">{row.correct}</td>
                        <td data-label="Accuracy">
                          <span
                            className={`status-badge ${
                              row.accuracy >= 0.9
                                ? "success"
                                : row.accuracy >= 0.7
                                ? "pending"
                                : "failure"
                            }`}
                          >
                            {pct(row.accuracy)}
                          </span>
                        </td>
                        <td data-label="Precision">{pct(row.precision)}</td>
                        <td data-label="Recall">{pct(row.recall)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>

          {/* ── History ───────────────────────────────────────────── */}
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            style={{ marginBottom: 24 }}
          >
            <div className="card-header">
              <h3 className="card-title">📉 Validation history</h3>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {history.length} recorded validation{history.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="card-body">
              {history.length < 2 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  A trend appears once the scorer has been validated more than once. Every rule
                  change should be followed by a validation run, so a regression in the scorer
                  shows up here the same way a regression in a model shows up on the compare page.
                </p>
              ) : (
                <ValidationHistoryChart data={historyData} />
              )}
              <div className="table-wrapper" style={{ marginTop: 16 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Accuracy</th>
                      <th>F1</th>
                      <th>Config</th>
                      <th>Fixture</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td data-label="When">{new Date(row.created_at).toLocaleString()}</td>
                        <td data-label="Accuracy" style={{ fontWeight: 700 }}>
                          {pct(row.accuracy)}
                        </td>
                        <td data-label="F1">{pct(row.f1)}</td>
                        <td data-label="Config" style={{ fontFamily: "monospace", fontSize: 12 }}>
                          {row.scorer_config_hash}
                        </td>
                        <td data-label="Fixture">{row.fixture_version}</td>
                        <td data-label="Notes" style={{ color: "var(--text-muted)" }}>
                          {row.notes || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>

          {/* ── Limitations ───────────────────────────────────────── */}
          <motion.div
            className="card limitations-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <div className="card-header">
              <h3 className="card-title">⚠️ What this number does not prove</h3>
            </div>
            <div className="card-body">
              <p style={{ color: "var(--text-secondary)", marginBottom: 16, fontSize: 14 }}>
                This is a small, self-authored benchmark. It is strong enough to say the scorer
                beats chance and to show where it fails. It is not evidence of general
                hallucination-detection quality.
              </p>
              <ul className="limitations-list">
                {(latest.limitations || fixture?.limitations || []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </motion.div>
        </>
      )}
    </>
  );
}

function ConfusionCell({ cell, count, tone, selected, onSelect }) {
  const isSelected = selected === cell;
  return (
    <button
      type="button"
      className={`confusion-cell ${tone} ${isSelected ? "selected" : ""}`}
      onClick={() => onSelect(isSelected ? null : cell)}
      disabled={count === 0}
    >
      <span className="confusion-cell-count">{count}</span>
      <span className="confusion-cell-label">{CELL_LABELS[cell]}</span>
    </button>
  );
}

function CaseCard({ caseResult }) {
  const trace = (caseResult.tiers_attempted || []).filter(
    (t) => t.outcome === "decided" || t.outcome === "declined"
  );

  return (
    <div className="case-card">
      <div className="case-card-header">
        <span className="case-card-id">{caseResult.id}</span>
        <span className="case-card-tags">
          <span className="tier-badge">
            {TIER_LABELS[caseResult.judge_tier] || caseResult.judge_tier}
            {caseResult.tier_confidence != null
              ? ` · ${caseResult.tier_confidence.toFixed(2)}`
              : ""}
          </span>
          <span
            className={`status-badge ${
              caseResult.human_label === "pass" ? "success" : "failure"
            }`}
          >
            human: {caseResult.human_label}
          </span>
          <span
            className={`status-badge ${
              caseResult.predicted_label === "pass" ? "success" : "failure"
            }`}
          >
            scorer: {caseResult.predicted_label}
          </span>
        </span>
      </div>

      <div className="case-card-field">
        <span>Prompt</span>
        <p>{caseResult.prompt}</p>
      </div>
      <div className="case-card-field">
        <span>Model output</span>
        <p>{caseResult.model_output}</p>
      </div>
      <div className="case-card-field">
        <span>Why it was labelled {caseResult.human_label}</span>
        <p>{caseResult.label_rationale}</p>
      </div>
      <div className="case-card-field">
        <span>Scorer reason (score {caseResult.score.toFixed(2)})</span>
        <p>{caseResult.judge_reason}</p>
      </div>
      {trace.length > 0 && (
        <div className="case-card-field">
          <span>Tiers attempted</span>
          <p className="case-card-trace">
            {trace
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
    </div>
  );
}
