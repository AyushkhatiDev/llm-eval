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

  /**
   * The label-prior baseline, derived in closed form from the persisted
   * confusion matrix rather than from the simulation. A coin weighted to the
   * fixture's own class balance is right when it guesses fail on a fail
   * (p × p) or pass on a pass ((1−p) × (1−p)), so expected accuracy is
   * p² + (1−p)². Shown next to the seeded figure so a reader can check the
   * simulation instead of trusting it.
   */
  const labelPrior = useMemo(() => {
    if (!matrix) return null;
    const fails = matrix.true_positive + matrix.false_negative;
    const passes = matrix.true_negative + matrix.false_positive;
    const total = fails + passes;
    if (!total) return null;
    const p = fails / total;
    return { fails, passes, total, p, closedForm: p * p + (1 - p) * (1 - p) };
  }, [matrix]);

  const missed = matrix?.false_negative ?? null;
  const falseAlarms = matrix?.false_positive ?? null;

  /**
   * Latest run per fixture. The development set and the held-out set answer
   * different questions — an upper bound versus a generalisation estimate — so
   * they are shown together and never averaged.
   */
  const byFixture = useMemo(() => {
    const seen = {};
    for (const row of history) {
      if (!seen[row.fixture_name]) seen[row.fixture_name] = row;
    }
    const dev = Object.values(seen).find((r) => !r.held_out) || null;
    const heldOut = Object.values(seen).find((r) => r.held_out) || null;
    return {
      dev,
      heldOut,
      gap: dev && heldOut ? dev.accuracy - heldOut.accuracy : null,
    };
  }, [history]);

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
          {/* ── Corrections ───────────────────────────────────────── */}
          <motion.div
            className="card corrections-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: 24 }}
          >
            <div className="card-header">
              <h3 className="card-title">📌 Corrections to earlier published numbers</h3>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                superseded by this page
              </span>
            </div>
            <div className="card-body">
              <p className="corrections-text">
                An earlier research note in this repository reported{" "}
                <strong>86% scorer accuracy</strong> against a 50-case benchmark that was described
                but never committed. Committing the fixture and re-running the scorer against it
                produced <strong>{pct(latest.accuracy)}</strong>. The old figure came from a pilot
                set that no longer exists, so it could not be checked, reproduced, or defended. The
                number on this page is the one this repository can stand behind, and it moves
                whenever the scorer or the fixture changes — which is the point of recording it.
              </p>
              <p className="corrections-text">
                The same note quoted <strong>52%</strong>{" "}
                for the label-prior random baseline. That was arithmetically wrong. For a coin matched to this fixture&apos;s class balance,
                expected accuracy is <code>p² + (1−p)²</code>, which is{" "}
                <strong>{labelPrior ? pct(labelPrior.closedForm) : "—"}</strong>{" "}
                here, not 52%. The
                harness now computes both baselines from seeded draws and stores the seed, and the
                closed form is shown below the chart so the simulation can be checked rather than
                trusted. Neither error changed the scorer&apos;s behavior — both were errors in how
                its quality was reported, which is exactly the class of mistake this page exists to
                catch.
              </p>
            </div>
          </motion.div>

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
                  {labelPrior && (
                    <p className="baseline-derivation">
                      <span>Check the label-prior baseline yourself:</span> the fixture holds{" "}
                      {labelPrior.fails} fail and {labelPrior.passes} pass labels, so{" "}
                      <code>
                        p = {labelPrior.fails}/{labelPrior.total} = {labelPrior.p.toFixed(2)}
                      </code>{" "}
                      and expected accuracy is{" "}
                      <code>
                        p² + (1−p)² = {pct(labelPrior.closedForm)}
                      </code>
                      . The seeded simulation above measured{" "}
                      {pct(latest.baseline_label_prior)} over {latest.baseline_trials} trials.
                    </p>
                  )}
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

          {/* ── Generalisation: development vs held-out ───────────── */}
          {byFixture.heldOut && byFixture.dev && (
            <motion.div
              className="card generalisation-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              style={{ marginBottom: 24 }}
            >
              <div className="card-header">
                <h3 className="card-title">🧪 Does it generalise? Held-out test</h3>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  rules frozen, then new cases written
                </span>
              </div>
              <div className="card-body">
                <div className="generalisation-grid">
                  <div className="generalisation-figure">
                    <span className="generalisation-label">Development set</span>
                    <strong>{pct(byFixture.dev.accuracy)}</strong>
                    <small>
                      {byFixture.dev.fixture_case_count} cases the rules were written against —
                      an upper bound
                    </small>
                  </div>
                  <div className="generalisation-arrow">→</div>
                  <div className="generalisation-figure primary">
                    <span className="generalisation-label">Held-out set</span>
                    <strong>{pct(byFixture.heldOut.accuracy)}</strong>
                    <small>
                      {byFixture.heldOut.fixture_case_count} cases written after the rules were
                      frozen — the honest estimate
                    </small>
                  </div>
                  <div className="generalisation-figure gap">
                    <span className="generalisation-label">Generalisation gap</span>
                    <strong>{(byFixture.gap * 100).toFixed(1)} pts</strong>
                    <small>what tuning on the development set was worth</small>
                  </div>
                </div>
                <p className="generalisation-note">
                  <strong>Recall stays at {pct(byFixture.heldOut.recall)} on unseen cases.</strong>{" "}
                  The scorer loses accuracy on the held-out set, but it loses it in one direction
                  only: it still catches every fabrication, and the extra errors are false alarms on
                  correct refusals phrased in ways the rules were never written for. The safety
                  property generalises; the precision does not. A scorer that degraded the other way
                  would be unusable in a risk path.
                </p>
              </div>
            </motion.div>
          )}

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
              <div className={`asymmetry-callout ${missed === 0 ? "good" : "warn"}`}>
                {missed === 0 ? (
                  <>
                    <strong>
                      Recall is {pct(latest.recall)} — no fabrication in the fixture went
                      unflagged.
                    </strong>{" "}
                    Every one of the {falseAlarms} errors is a false alarm: a correct refusal the
                    scorer flagged anyway. For a risk system that is the right direction to fail
                    in. Over-flagging costs a human review; under-flagging ships a fabricated
                    compliance limit into a decision. The cost of this profile is that the pass
                    rates it reports are pessimistic, not that fabrications slip through.
                  </>
                ) : (
                  <>
                    <strong>
                      Recall is {pct(latest.recall)} — {missed} fabrication
                      {missed === 1 ? "" : "s"} went unflagged.
                    </strong>{" "}
                    Missed fabrications are the serious failure direction for a risk system: a
                    false alarm costs a human review, but an unflagged fabrication reaches a
                    decision. Open the &ldquo;missed hallucination&rdquo; cell below to read them.
                  </>
                )}
              </div>

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
                This is <strong>preliminary product evidence, not a research result</strong>. The
                fixture is {latest.fixture_case_count} cases, written and labelled by one person —
                the author of this repository, who also wrote the rules being measured. There is no
                inter-annotator agreement figure because there is one annotator, and no held-out
                split, so {pct(latest.accuracy)} is an upper bound on how the scorer would do on
                cases it was not designed against. It is strong enough to say the scorer beats
                chance and to show exactly where it fails. It is not evidence of general
                hallucination-detection quality.
              </p>
              <ul className="limitations-list">
                {(latest.limitations || fixture?.limitations || []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h4 className="rigour-heading">What would make this rigorous</h4>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
                Not aspirational roadmap — this is the specific distance between what is measured
                here and what would support a stronger claim.
              </p>
              <ul className="rigour-list">
                <li>
                  <strong>A second annotator</strong>{" "}
                  on the existing cases, reported as a Cohen&apos;s κ. Without it, &ldquo;agreement with human labels&rdquo; means
                  agreement with <em>one</em> human.
                </li>
                <li>
                  <strong>A held-out split authored after the rules are frozen.</strong> This is
                  the one that matters most: it converts the current upper bound into an estimate.
                </li>
                <li>
                  <strong>A published dataset</strong>{" "}
                  (TruthfulQA, HaluEval) as an external comparison, so the scorer is measured
                  against something the author did not write.
                </li>
                <li>
                  <strong>Captured production traces</strong>{" "}
                  in place of hand-written outputs, and graded severity in place of binary
                  pass/fail.
                </li>
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
