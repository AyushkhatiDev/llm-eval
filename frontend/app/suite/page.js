"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SUITE_STATE_KEY = "llm-eval-suite-state";

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
  const [endpoint, setEndpoint] = useState(initialSuiteState.endpoint || "groq");
  const [suiteVersion, setSuiteVersion] = useState(initialSuiteState.suiteVersion || "v1");
  const [judgeMode, setJudgeMode] = useState(initialSuiteState.judgeMode || "fast");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(initialSuiteState.results || []);
  const [totalTests, setTotalTests] = useState(initialSuiteState.totalTests || 0);
  const [runId, setRunId] = useState(initialSuiteState.runId || null);

  function saveSuiteState(nextState) {
    localStorage.setItem(SUITE_STATE_KEY, JSON.stringify({
      endpoint,
      suiteVersion,
      judgeMode,
      runId,
      totalTests,
      results,
      ...nextState,
    }));
  }

  async function runSuite() {
    setRunning(true);
    setResults([]);
    setTotalTests(0);
    setRunId(null);

    try {
      const suite = await api.getSuiteTests();
      const tests = suite.tests || [];
      const run = await api.createRun({
        model_endpoint: endpoint,
        suite_version: `${suiteVersion}-${judgeMode}`,
      });

      setRunId(run.id);
      setTotalTests(tests.length);
      saveSuiteState({
        runId: run.id,
        totalTests: tests.length,
        results: [],
      });

      const completed = [];
      for (const test of tests) {
        const expectedBehavior = {
          ...test.expected_behavior,
          skip_llm_judge: judgeMode === "fast",
        };
        const result = await api.triggerEval({
          prompt: test.prompt,
          model_endpoint: endpoint,
          expected_behavior: expectedBehavior,
          model: endpoint === "groq" ? "llama-3.1-8b-instant" : undefined,
          run_id: run.id,
          test_id: test.test_id,
          suite_version: `${suiteVersion}-${judgeMode}`,
        });

        const normalized = {
          ...result,
          test_id: test.test_id,
          suite_version: `${suiteVersion}-${judgeMode}`,
        };
        completed.push(normalized);
        setResults([...completed]);
        saveSuiteState({
          runId: run.id,
          totalTests: tests.length,
          results: completed,
        });

        if (endpoint.toLowerCase().includes("groq") && completed.length < tests.length) {
          await delay(judgeMode === "smart" ? 4500 : 2300);
        }
      }
    } catch (err) {
      alert("Failed to run suite: " + err.message);
    } finally {
      setRunning(false);
    }
  }

  const completedCount = results.length;
  const totalCount = totalTests || results.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <>
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1>Run Test Suite</h1>
        <p>Execute all curated test cases against a model endpoint in one click.</p>
      </motion.div>

      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ marginBottom: 24 }}
      >
        <div className="card-header">
          <h3 className="card-title">⚙️ Configuration</h3>
        </div>
        <div className="card-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="form-group">
              <label className="form-label">Model Endpoint</label>
              <input
                className="form-input"
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="groq"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Suite Version</label>
              <input
                className="form-input"
                type="text"
                value={suiteVersion}
                onChange={(e) => setSuiteVersion(e.target.value)}
                placeholder="v1"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Scoring Mode</label>
              <select
                className="form-select"
                value={judgeMode}
                onChange={(e) => setJudgeMode(e.target.value)}
                disabled={running}
              >
                <option value="fast">Fast - rules only</option>
                <option value="smart">Smart - LLM judge when uncertain</option>
              </select>
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
        >
          <div className="card-header">
            <h3 className="card-title">📊 Suite Results</h3>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {completedCount} / {totalCount} completed{runId ? ` · ${runId.substring(0, 8)}...` : ""}
            </span>
          </div>
          <div className="card-body">
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
                {results.map((result, i) => {
                  const testId = result.test_id || `test-${i + 1}`;
                  const status = result.passed ? "SUCCESS" : "FAILURE";

                  return (
                    <motion.div
                      key={testId}
                      className="task-item"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                    >
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: "var(--radius-md)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 20,
                          background: result.passed
                            ? "var(--accent-success-glow)"
                            : "var(--accent-danger-glow)",
                        }}
                      >
                        {result.passed ? "✅" : "❌"}
                      </div>
                      <div className="task-item-info">
                        <div className="task-item-id">{testId}</div>
                        <div className="task-item-prompt">
                          {result.error
                            ? `Error: ${result.error}`
                            : `Score: ${Math.round((result.score || 0) * 100)}% · ${result.latency_ms}ms`}
                        </div>
                      </div>
                      <span className={`status-badge ${result.passed ? "success" : "failure"}`}>
                        <span className="status-dot" />
                        {status}
                      </span>
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 800,
                          color: result.passed ? "var(--accent-success)" : "var(--accent-danger)",
                          minWidth: 50,
                          textAlign: "right",
                        }}
                      >
                        {Math.round((result.score || 0) * 100)}%
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
}
