"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import TierBadge from "@/components/TierBadge";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SUITE_STATE_KEY = "llm-eval-suite-state";
const REPRODUCE_KEY = "llm-eval-reproduce";

/**
 * Read once during initial render rather than in an effect: a reproduction
 * plan is handed over through localStorage by the runs page, and the config
 * fields must already be populated on the first paint.
 */
function getReproducePlan() {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(REPRODUCE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    localStorage.removeItem(REPRODUCE_KEY);
    return null;
  }
}

function getSavedSuiteState() {
  if (typeof window === "undefined") return {};
  const saved = localStorage.getItem(SUITE_STATE_KEY);
  if (!saved) return {};
  try {
    return JSON.parse(saved);
  } catch {
    localStorage.removeItem(SUITE_STATE_KEY);
    return {};
  }
}

export default function SuitePage() {
  const [initialSuiteState] = useState(getSavedSuiteState);
  const [initialPlan] = useState(getReproducePlan);
  const [reproducePlan, setReproducePlan] = useState(initialPlan);
  const [endpoint, setEndpoint] = useState(
    initialPlan?.config?.model_endpoint || initialSuiteState.endpoint || "groq"
  );
  const [suiteVersion, setSuiteVersion] = useState(
    initialPlan?.config?.suite_version || initialSuiteState.suiteVersion || "v2"
  );
  const [judgeMode, setJudgeMode] = useState(
    initialPlan?.config?.judge_mode || initialSuiteState.judgeMode || "fast"
  );
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(initialSuiteState.results || []);
  const [totalTests, setTotalTests] = useState(initialSuiteState.totalTests || 0);
  const [runId, setRunId] = useState(initialSuiteState.runId || null);
  const [suiteMeta, setSuiteMeta] = useState(null);
  const [error, setError] = useState(null);

  // Flakiness check
  const [flakyTestId, setFlakyTestId] = useState("");
  const [flakyRepeats, setFlakyRepeats] = useState(5);
  const [flakyReport, setFlakyReport] = useState(null);
  const [flakyRunning, setFlakyRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .getSuiteTests()
      .then((suite) => {
        if (cancelled) return;
        setSuiteMeta(suite);
        setFlakyTestId((current) => current || suite.tests[0]?.test_id || "");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function saveSuiteState(nextState) {
    localStorage.setItem(
      SUITE_STATE_KEY,
      JSON.stringify({ endpoint, suiteVersion, judgeMode, runId, totalTests, results, ...nextState })
    );
  }

  async function runSuite() {
    setRunning(true);
    setError(null);
    setResults([]);
    setTotalTests(0);
    setRunId(null);

    try {
      const suite = await api.getSuiteTests();
      const tests = suite.tests || [];
      setSuiteMeta(suite);

      // A reproduction replays into the run the API already opened for it, so
      // the new run stays linked to the original.
      const run = reproducePlan?.run
        ? reproducePlan.run
        : await api.createRun({
            model_endpoint: endpoint,
            suite_version: `${suiteVersion}-${judgeMode}`,
            judge_mode: judgeMode,
          });

      setRunId(run.id);
      setTotalTests(tests.length);
      saveSuiteState({ runId: run.id, totalTests: tests.length, results: [] });

      // A reproduction replays the recorded scoring mode. Replaying with a
      // different one is not a reproduction — and it used to produce a run
      // carrying the source's label while escalating like Smart mode.
      const effectiveMode = reproducePlan?.config?.judge_mode || judgeMode;

      const completed = [];
      for (const test of tests) {
        const expectedBehavior = {
          ...test.expected_behavior,
          severity: test.severity ?? 1.0,
          skip_llm_judge: effectiveMode === "fast",
        };
        const result = await api.triggerEval({
          prompt: test.prompt,
          messages: test.messages,
          model_endpoint: endpoint,
          expected_behavior: expectedBehavior,
          model: reproducePlan?.config?.model,
          temperature: reproducePlan?.config?.temperature,
          seed: reproducePlan?.config?.seed,
          run_id: run.id,
          test_id: test.test_id,
          category: test.category,
          severity: test.severity,
          suite_version: `${suiteVersion}-${judgeMode}`,
        });

        completed.push({
          ...result,
          test_id: test.test_id,
          category: test.category,
          subcategory: test.subcategory,
          severity: test.severity,
        });
        setResults([...completed]);
        saveSuiteState({ runId: run.id, totalTests: tests.length, results: completed });

        if (endpoint.toLowerCase().includes("groq") && completed.length < tests.length) {
          await delay(effectiveMode === "smart" ? 4500 : 2300);
        }
      }

      localStorage.removeItem(REPRODUCE_KEY);
      setReproducePlan(null);
    } catch (err) {
      setError(`Failed to run suite: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }

  async function runFlakinessCheck() {
    setFlakyRunning(true);
    setFlakyReport(null);
    setError(null);
    try {
      setFlakyReport(
        await api.checkFlakiness({
          test_id: flakyTestId,
          repeats: Number(flakyRepeats),
          model_endpoint: endpoint,
          judge_mode: judgeMode,
        })
      );
    } catch (err) {
      setError(`Flakiness check failed: ${err.message}`);
    } finally {
      setFlakyRunning(false);
    }
  }

  const completedCount = results.length;
  const totalCount = totalTests || results.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = completedCount - passedCount;
  const escalatedCount = results.filter((r) => r.escalated).length;
  const suitePassRate = completedCount > 0 ? Math.round((passedCount / completedCount) * 100) : 0;
  const weightedScore = (() => {
    const weight = results.reduce((sum, r) => sum + (r.severity ?? 1), 0);
    if (!weight) return null;
    return results.reduce((sum, r) => sum + (r.score ?? 0) * (r.severity ?? 1), 0) / weight;
  })();

  return (
    <>
      <motion.div className="page-header" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Run Test Suite</h1>
        <p>
          Execute every case against a model endpoint. Tests run sequentially and results persist as
          they complete, so a free-tier run can be watched or resumed.
        </p>
      </motion.div>

      {error && <div className="alert alert-danger">{error}</div>}

      {reproducePlan && (
        <div className="alert alert-info">
          <strong>Reproducing run {reproducePlan.reproduced_from.id.substring(0, 8)}</strong>
          <p>
            Model {reproducePlan.config.model || reproducePlan.config.model_endpoint} · temperature{" "}
            {reproducePlan.config.temperature} · seed {reproducePlan.config.seed} · scorer config{" "}
            {reproducePlan.config.scorer_config_hash}
          </p>
          {reproducePlan.warnings?.map((warning) => (
            <p key={warning} className="alert-warning-line">
              ⚠ {warning}
            </p>
          ))}
        </div>
      )}

      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ marginBottom: 24 }}
      >
        <div className="card-header">
          <h3 className="card-title">⚙️ Configuration</h3>
          {suiteMeta && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              suite {suiteMeta.suite_version} · {suiteMeta.total} tests ·{" "}
              {suiteMeta.prompt_template_version}
            </span>
          )}
        </div>
        <div className="card-body">
          <div className="config-grid">
            <div className="form-group">
              <label className="form-label">Model Endpoint</label>
              <input
                className="form-input"
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="groq"
                disabled={running}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Suite Version</label>
              <input
                className="form-input"
                type="text"
                value={suiteVersion}
                onChange={(e) => setSuiteVersion(e.target.value)}
                placeholder="v2"
                disabled={running}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Scoring Mode</label>
              <select
                className="form-select"
                value={judgeMode}
                onChange={(e) => setJudgeMode(e.target.value)}
                disabled={running || !!reproducePlan}
              >
                <option value="fast">Fast — rules only, no judge calls</option>
                <option value="smart">Smart — LLM judge when rules are unsure</option>
              </select>
              {reproducePlan && (
                <span className="form-hint">
                  Locked to the recorded mode — changing it would not be a reproduction.
                </span>
              )}
            </div>
          </div>
          <button
            className="btn btn-primary btn-lg"
            onClick={runSuite}
            disabled={running || !endpoint}
            style={{ marginTop: 8 }}
          >
            {running ? (
              <>
                <span className="live-dot" style={{ background: "white" }}></span>
                Running Suite...
              </>
            ) : reproducePlan ? (
              <>🔁 Run Reproduction</>
            ) : (
              <>🚀 Launch Full Suite</>
            )}
          </button>
        </div>
      </motion.div>

      {(results.length > 0 || running) && (
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ marginBottom: 24 }}
        >
          <div className="card-header">
            <h3 className="card-title">📊 Suite Results</h3>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {completedCount} / {totalCount} completed{runId ? ` · ${runId.substring(0, 8)}` : ""}
            </span>
          </div>
          <div className="card-body">
            <div className="suite-summary-grid">
              <div className="suite-summary-item">
                <span className="suite-summary-label">Pass Rate</span>
                <strong>{suitePassRate}%</strong>
              </div>
              <div className="suite-summary-item">
                <span className="suite-summary-label">Weighted</span>
                <strong>{weightedScore == null ? "—" : weightedScore.toFixed(2)}</strong>
              </div>
              <div className="suite-summary-item">
                <span className="suite-summary-label">Passed</span>
                <strong className="text-success">{passedCount}</strong>
              </div>
              <div className="suite-summary-item">
                <span className="suite-summary-label">Failed</span>
                <strong className="text-danger">{failedCount}</strong>
              </div>
              <div className="suite-summary-item">
                <span className="suite-summary-label">Escalated</span>
                <strong>{escalatedCount}</strong>
              </div>
            </div>
            {running && completedCount < totalCount && (
              <div className="suite-current">
                <span className="live-dot"></span>
                Running test {completedCount + 1} of {totalCount}
              </div>
            )}
            <div className="suite-progress">
              <motion.div
                className="suite-progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>

            <div className="task-list">
              <AnimatePresence>
                {results.map((result, i) => (
                  <motion.div
                    key={result.test_id || i}
                    className="task-item"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  >
                    <div className={`task-item-status ${result.passed ? "pass" : "fail"}`}>
                      {result.passed ? "✅" : "❌"}
                    </div>
                    <div className="task-item-info">
                      <div className="task-item-id">
                        {result.test_id}
                        {result.subcategory && (
                          <span className="tier-badge subtle">
                            {result.subcategory.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                      <div className="task-item-prompt">
                        {result.error
                          ? `Error: ${result.error}`
                          : result.reason || `${result.latency_ms}ms`}
                      </div>
                    </div>
                    <TierBadge
                      tier={result.judge_tier}
                      confidence={result.tier_confidence}
                      escalated={result.escalated}
                    />
                    <div
                      className="task-item-score"
                      style={{
                        color: result.passed ? "var(--accent-success)" : "var(--accent-danger)",
                      }}
                    >
                      {Math.round((result.score || 0) * 100)}%
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Flakiness check ──────────────────────────────────────── */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="card-header">
          <h3 className="card-title">🎲 Flakiness Check</h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            same test, N times, same config
          </span>
        </div>
        <div className="card-body">
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16 }}>
            Temperature and seed are pinned on every run, but providers are not fully
            deterministic. Repeating one test measures what variance is left — a test whose verdict
            flips between identical runs cannot be used as a regression gate.
          </p>
          <div className="config-grid">
            <div className="form-group">
              <label className="form-label">Test</label>
              <select
                className="form-select"
                value={flakyTestId}
                onChange={(e) => setFlakyTestId(e.target.value)}
                disabled={flakyRunning}
              >
                {(suiteMeta?.tests ?? []).map((test) => (
                  <option key={test.test_id} value={test.test_id}>
                    {test.test_id}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Repeats</label>
              <input
                className="form-input"
                type="number"
                min="2"
                max="10"
                value={flakyRepeats}
                onChange={(e) => setFlakyRepeats(e.target.value)}
                disabled={flakyRunning}
              />
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={runFlakinessCheck}
            disabled={flakyRunning || !flakyTestId}
          >
            {flakyRunning ? "Running repeats..." : "🎲 Check stability"}
          </button>

          {flakyReport && (
            <div className={`flaky-report ${flakyReport.unstable ? "unstable" : "stable"}`}>
              <div className="flaky-report-header">
                <span className={`status-badge ${flakyReport.unstable ? "failure" : "success"}`}>
                  {flakyReport.unstable ? "⚠ Unreliable" : "✓ Stable"}
                </span>
                <span>
                  {flakyReport.test_id} · {flakyReport.repeats} runs
                </span>
              </div>
              {flakyReport.unstable_reason && (
                <p className="flaky-report-reason">{flakyReport.unstable_reason}</p>
              )}
              <div className="suite-summary-grid">
                <div className="suite-summary-item">
                  <span className="suite-summary-label">Mean score</span>
                  <strong>{flakyReport.mean_score.toFixed(2)}</strong>
                </div>
                <div className="suite-summary-item">
                  <span className="suite-summary-label">Std dev</span>
                  <strong>{flakyReport.stdev.toFixed(3)}</strong>
                </div>
                <div className="suite-summary-item">
                  <span className="suite-summary-label">Range</span>
                  <strong>
                    {flakyReport.min_score.toFixed(2)}–{flakyReport.max_score.toFixed(2)}
                  </strong>
                </div>
                <div className="suite-summary-item">
                  <span className="suite-summary-label">Passed</span>
                  <strong>
                    {flakyReport.pass_count}/{flakyReport.repeats}
                  </strong>
                </div>
              </div>
              <div className="flaky-runs">
                {flakyReport.runs.map((run) => (
                  <div key={run.iteration} className="flaky-run">
                    <span>#{run.iteration}</span>
                    <span className={run.passed ? "text-success" : "text-danger"}>
                      {run.score.toFixed(2)}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>{run.latency_ms}ms</span>
                    <span style={{ color: "var(--text-muted)" }}>{run.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
