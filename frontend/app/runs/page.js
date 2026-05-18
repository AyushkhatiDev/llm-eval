"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { getRunStatus } from "@/lib/utils";
import ScoreBar from "@/components/ScoreBar";
import Modal from "@/components/Modal";

export default function RunsPage() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState(null);
  const [runDetails, setRunDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadRuns() {
    try {
      const data = await api.listRuns();
      setRuns(data);
    } catch (err) {
      console.error("Failed to load runs:", err);
    } finally {
      setLoading(false);
    }
  }

  async function viewRun(runId) {
    setSelectedRun(runId);
    setDetailsLoading(true);
    try {
      const data = await api.getRun(runId);
      setRunDetails(data);
    } catch (err) {
      console.error("Failed to load run details:", err);
    } finally {
      setDetailsLoading(false);
    }
  }

  return (
    <>
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1>Eval Runs</h1>
        <p>Browse and inspect all evaluation runs and their results.</p>
      </motion.div>

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
                    <th>Suite Version</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Avg Score</th>
                    <th>Tests</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {runs.map((run, i) => (
                      <motion.tr
                        key={run.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        style={{ cursor: "pointer" }}
                        onClick={() => viewRun(run.id)}
                      >
                        <td style={{ fontFamily: "monospace", color: "var(--text-accent)" }}>
                          {run.id?.substring(0, 8)}...
                        </td>
                        <td>
                          <span className="status-badge running">
                            {run.suite_version || "v1"}
                          </span>
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {run.model_endpoint
                            ? run.model_endpoint.replace("http://", "").substring(0, 30)
                            : "—"}
                        </td>
                        <td>
                          {(() => {
                            const s = getRunStatus(run);
                            return (
                              <span className={`status-badge ${s.badge}`}>
                                <span className="status-dot" />
                                {s.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {run.pass_rate != null ? (run.pass_rate * 100).toFixed(0) + "%" : "—"}
                        </td>
                        <td>{run.total_tests || "—"}</td>
                        <td style={{ fontSize: 13, color: "var(--text-muted)" }}>
                          {run.created_at
                            ? new Date(run.created_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              viewRun(run.id);
                            }}
                          >
                            View
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </motion.div>

      {/* Run Detail Modal */}
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
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Run ID
              </div>
              <div style={{ fontFamily: "monospace", color: "var(--text-accent)", fontSize: 13 }}>
                {runDetails.run?.id}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Status</div>
                {(() => {
                  const s = getRunStatus(runDetails.run);
                  return (
                    <span className={`status-badge ${s.badge}`}>
                      <span className="status-dot" />
                      {s.label}
                    </span>
                  );
                })()}
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Pass Rate</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>
                  {runDetails.run?.pass_rate != null ? (runDetails.run.pass_rate * 100).toFixed(0) + "%" : "—"}
                </div>
              </div>
            </div>

            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--text-secondary)" }}>
              Individual Results
            </h4>
            <div className="result-cards">
              {runDetails.results?.length > 0 ? (
                runDetails.results.map((result, i) => (
                  <motion.div
                    key={i}
                    className="result-card"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="result-card-header">
                      <span className="result-card-testid">
                        {result.test_id || `test-${i + 1}`}
                      </span>
                      <span
                        className={`status-badge ${
                          result.passed ? "success" : "failure"
                        }`}
                      >
                        {result.passed ? "✓ Pass" : "✗ Fail"}
                      </span>
                    </div>
                    {result.prompt && (
                      <div className="result-card-prompt">
                        {result.prompt}
                      </div>
                    )}
                    <ScoreBar
                      score={result.score || 0}
                      label="Overall Score"
                    />
                    {(result.judge_reason || result.output || result.failure_type) && (
                      <div className="result-card-details">
                        {result.judge_reason && (
                          <div>
                            <span>Judge</span>
                            <p>{result.judge_reason}</p>
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
                    )}
                  </motion.div>
                ))
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  No individual results available.
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
