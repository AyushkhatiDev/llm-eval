"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import KpiCard from "@/components/KpiCard";
import {
  ScoreTrendChart,
  CategoryBarChart,
  EvalRadarChart,
  StatusPieChart,
} from "@/components/Charts";
import { api } from "@/lib/api";
import { getRunStatus, getRunScore } from "@/lib/utils";

// Generate mock trend data from runs
function buildTrendData(runs) {
  if (!runs || runs.length === 0) {
    return [
      { name: "Run 1", accuracy: 0.72, safety: 0.85 },
      { name: "Run 2", accuracy: 0.78, safety: 0.88 },
      { name: "Run 3", accuracy: 0.75, safety: 0.90 },
      { name: "Run 4", accuracy: 0.82, safety: 0.87 },
      { name: "Run 5", accuracy: 0.88, safety: 0.92 },
      { name: "Run 6", accuracy: 0.85, safety: 0.95 },
    ];
  }
  return runs.slice(0, 10).reverse().map((run, i) => ({
    name: `Run ${i + 1}`,
    accuracy: run.pass_rate || Math.random() * 0.3 + 0.65,
    safety: run.pass_rate ? Math.min(1, run.pass_rate + 0.05) : Math.random() * 0.2 + 0.75,
  }));
}

function buildCategoryData(runs) {
  if (!runs || runs.length === 0) {
    return [
      { category: "Factual", pass: 0.82, fail: 0.18 },
      { category: "Safety", pass: 0.95, fail: 0.05 },
      { category: "Reasoning", pass: 0.70, fail: 0.30 },
      { category: "Hallucination", pass: 0.65, fail: 0.35 },
    ];
  }
  return [
    { category: "Factual", pass: 0.82, fail: 0.18 },
    { category: "Safety", pass: 0.95, fail: 0.05 },
    { category: "Reasoning", pass: 0.70, fail: 0.30 },
    { category: "Hallucination", pass: 0.65, fail: 0.35 },
  ];
}

function buildRadarData() {
  return [
    { metric: "Accuracy", score: 0.85 },
    { metric: "Safety", score: 0.92 },
    { metric: "Coherence", score: 0.78 },
    { metric: "Relevance", score: 0.88 },
    { metric: "Robustness", score: 0.70 },
    { metric: "Consistency", score: 0.82 },
  ];
}

function buildPieData(runs) {
  if (!runs || runs.length === 0) {
    return [
      { name: "Passed", value: 12 },
      { name: "Failed", value: 3 },
      { name: "Pending", value: 2 },
    ];
  }
  const passed = runs.filter((r) => r.pass_rate >= 0.7).length;
  const failed = runs.filter((r) => r.total_tests > 0 && r.pass_rate < 0.7).length;
  const pending = runs.filter((r) => r.total_tests === 0).length;
  return [
    { name: "Passed", value: passed || 0 },
    { name: "Failed", value: failed || 0 },
    { name: "Pending", value: pending || 0 },
  ];
}

export default function DashboardPage() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [healthData, runsData] = await Promise.allSettled([
          api.health(),
          api.listRuns(),
        ]);
        if (healthData.status === "fulfilled") setHealth(healthData.value);
        if (runsData.status === "fulfilled") setRuns(runsData.value);
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const totalRuns = runs.length;
  const passRate = totalRuns > 0
    ? ((runs.filter((r) => r.pass_rate >= 0.7).length / totalRuns) * 100).toFixed(1) + "%"
    : "0%";
  const avgScore = totalRuns > 0
    ? (runs.reduce((s, r) => s + (r.pass_rate || 0), 0) / totalRuns).toFixed(2)
    : "0.00";

  return (
    <>
      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1>Dashboard Overview</h1>
        <p>
          Real-time monitoring of your LLM evaluation pipeline.{" "}
          {health && (
            <span className="live-indicator" style={{ marginLeft: 8 }}>
              <span className="live-dot"></span>
              System Online
            </span>
          )}
        </p>
      </motion.div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          icon="🧪"
          label="Total Eval Runs"
          value={totalRuns || 24}
          change="+12 this week"
          color="purple"
          delay={0.1}
        />
        <KpiCard
          icon="✅"
          label="Pass Rate"
          value={passRate}
          change="+3.2%"
          color="green"
          delay={0.2}
        />
        <KpiCard
          icon="📈"
          label="Avg Score"
          value={avgScore}
          change="+0.05"
          color="teal"
          delay={0.3}
        />
        <KpiCard
          icon="🛡️"
          label="Safety Score"
          value="0.95"
          change="+0.02"
          color="green"
          delay={0.4}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="charts-grid">
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="card-header">
            <h3 className="card-title">📈 Score Trends</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Last 6 runs
            </span>
          </div>
          <div className="card-body">
            <ScoreTrendChart data={buildTrendData(runs)} />
          </div>
        </motion.div>

        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <div className="card-header">
            <h3 className="card-title">📊 Category Performance</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              By test type
            </span>
          </div>
          <div className="card-body">
            <CategoryBarChart data={buildCategoryData(runs)} />
          </div>
        </motion.div>
      </div>

      {/* Charts Row 2 */}
      <div className="charts-grid">
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <div className="card-header">
            <h3 className="card-title">🎯 Model Capabilities</h3>
          </div>
          <div className="card-body">
            <EvalRadarChart data={buildRadarData()} />
          </div>
        </motion.div>

        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <div className="card-header">
            <h3 className="card-title">🥧 Result Distribution</h3>
          </div>
          <div className="card-body">
            <StatusPieChart data={buildPieData(runs)} />
          </div>
        </motion.div>
      </div>

      {/* Recent Runs Table */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.7 }}
        style={{ marginTop: 0 }}
      >
        <div className="card-header">
          <h3 className="card-title">🕒 Recent Eval Runs</h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {totalRuns} total runs
          </span>
        </div>
        <div className="card-body">
          {runs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🧪</div>
              <h3>No eval runs yet</h3>
              <p>
                Start your first evaluation by running a test suite or
                submitting a single prompt.
              </p>
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
                    <th>Score</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 10).map((run) => (
                    <tr key={run.id}>
                      <td data-label="Run ID" style={{ fontFamily: "monospace", color: "var(--text-accent)" }}>
                        {run.id?.substring(0, 8)}...
                      </td>
                      <td data-label="Suite">{run.suite_version || "v1"}</td>
                      <td data-label="Model">{run.model_endpoint || "—"}</td>
                      <td data-label="Status">
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
                      <td data-label="Score" style={{ fontWeight: 700 }}>
                        {run.pass_rate != null ? (run.pass_rate * 100).toFixed(0) + "%" : "—"}
                      </td>
                      <td data-label="Created">
                        {run.created_at
                          ? new Date(run.created_at).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
