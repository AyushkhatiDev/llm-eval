"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

export default function SuitePage() {
  const [endpoint, setEndpoint] = useState("http://localhost:11434/api/generate");
  const [suiteVersion, setSuiteVersion] = useState("v1");
  const [running, setRunning] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [results, setResults] = useState({});
  const pollRef = useRef(null);

  async function runSuite() {
    setRunning(true);
    setTasks([]);
    setResults({});
    try {
      const data = await api.runSuite({
        model_endpoint: endpoint,
        suite_version: suiteVersion,
      });
      setTasks(data.task_ids);
      startPolling(data.task_ids);
    } catch (err) {
      alert("Failed to start suite: " + err.message);
      setRunning(false);
    }
  }

  function startPolling(taskList) {
    pollRef.current = setInterval(async () => {
      let allDone = true;
      const updated = { ...results };

      for (const task of taskList) {
        const taskId = task.task_id || task;
        if (updated[taskId]?.status === "SUCCESS" || updated[taskId]?.status === "FAILURE") {
          continue;
        }
        try {
          const status = await api.getTaskStatus(taskId);
          updated[taskId] = status;
          if (status.status !== "SUCCESS" && status.status !== "FAILURE") {
            allDone = false;
          }
        } catch {
          allDone = false;
        }
      }

      setResults({ ...updated });

      if (allDone) {
        clearInterval(pollRef.current);
        setRunning(false);
      }
    }, 2000);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const completedCount = Object.values(results).filter(
    (r) => r.status === "SUCCESS" || r.status === "FAILURE"
  ).length;
  const totalCount = tasks.length;
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
                placeholder="http://localhost:11434/api/generate"
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

      {/* Progress & Results */}
      {tasks.length > 0 && (
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="card-header">
            <h3 className="card-title">📊 Suite Progress</h3>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {completedCount} / {totalCount} completed
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
                {tasks.map((task, i) => {
                  const taskId = task.task_id || task;
                  const testId = task.test_id || `test-${i + 1}`;
                  const result = results[taskId];
                  const status = result?.status || "PENDING";

                  return (
                    <motion.div
                      key={taskId}
                      className="task-item"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.08 }}
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
                          background:
                            status === "SUCCESS"
                              ? "var(--accent-success-glow)"
                              : status === "FAILURE"
                              ? "var(--accent-danger-glow)"
                              : "var(--accent-warning-glow)",
                        }}
                      >
                        {status === "SUCCESS"
                          ? "✅"
                          : status === "FAILURE"
                          ? "❌"
                          : "⏳"}
                      </div>
                      <div className="task-item-info">
                        <div className="task-item-id">{testId}</div>
                        <div className="task-item-prompt">
                          Task: {taskId.substring(0, 16)}...
                        </div>
                      </div>
                      <span
                        className={`status-badge ${
                          status === "SUCCESS"
                            ? "success"
                            : status === "FAILURE"
                            ? "failure"
                            : status === "STARTED"
                            ? "running"
                            : "pending"
                        }`}
                      >
                        <span className="status-dot" />
                        {status}
                      </span>
                      {result?.result && status === "SUCCESS" && (
                        <div
                          style={{
                            fontSize: 20,
                            fontWeight: 800,
                            color: "var(--accent-success)",
                            minWidth: 50,
                            textAlign: "right",
                          }}
                        >
                          {typeof result.result === "object" && result.result.overall_score
                            ? (result.result.overall_score * 100).toFixed(0) + "%"
                            : "✓"}
                        </div>
                      )}
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
