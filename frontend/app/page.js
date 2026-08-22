"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import {
  ScoreTrendChart,
  CategoryBarChart,
  TierBarChart,
  StatusPieChart,
} from "@/components/Charts";
import { api } from "@/lib/api";
import { getRunStatus } from "@/lib/utils";

const TIER_LABELS = {
  empty_check: "Empty check",
  semantic: "Semantic",
  rules: "Rule match",
  llm_judge: "LLM judge",
};

const asPercent = (v) => `${(v * 100).toFixed(1)}%`;
const asScore = (v) => v.toFixed(2);

function buildPieData(runs) {
  const passed = runs.filter((r) => r.total_tests > 0 && r.pass_rate >= 0.7).length;
  const failed = runs.filter((r) => r.total_tests > 0 && r.pass_rate < 0.7).length;
  const pending = runs.filter((r) => r.total_tests === 0).length;
  return [
    { name: "Passed", value: passed },
    { name: "Failed", value: failed },
    { name: "Pending", value: pending },
  ].filter((entry) => entry.value > 0);
}

export default function DashboardPage() {
  const [runs, setRuns] = useState([]);
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState({ trend: [], count: 0 });
  const [categories, setCategories] = useState({ categories: [], tier_distribution: [] });
  const [validation, setValidation] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const results = await Promise.allSettled([
        api.health(),
        api.listRuns(),
        api.overviewStats(),
        api.scoreTrend(10),
        api.categoryStats(),
        api.latestScorerValidation(),
      ]);
      const [healthRes, runsRes, overviewRes, trendRes, categoryRes, validationRes] = results;
      if (healthRes.status === "fulfilled") setHealth(healthRes.value);
      if (runsRes.status === "fulfilled") setRuns(runsRes.value);
      if (overviewRes.status === "fulfilled") setOverview(overviewRes.value);
      if (trendRes.status === "fulfilled") setTrend(trendRes.value);
      if (categoryRes.status === "fulfilled") setCategories(categoryRes.value);
      setValidation(validationRes.status === "fulfilled" ? validationRes.value : null);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const metrics = overview?.metrics ?? {};
  const windowLabel = overview ? `vs prior ${overview.window_days}d` : "";
  const trendPoints = trend.trend ?? [];
  const tierData = (categories.tier_distribution ?? []).map((row) => ({
    label: TIER_LABELS[row.tier] || row.tier,
    count: row.count,
  }));

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
          Adversarial evaluation harness for LLMs in payment risk decisions.{" "}
          {health && (
            <span className="live-indicator" style={{ marginLeft: 8 }}>
              <span className="live-dot"></span>
              API online
            </span>
          )}
        </p>
      </motion.div>

      {validation && (
        <motion.div
          className="validation-banner"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div>
            <span className="validation-banner-label">Scorer validated</span>
            <strong>{asPercent(validation.accuracy)}</strong>
            <span className="validation-banner-detail">
              agreement with human labels on {validation.fixture_case_count} labelled cases, against{" "}
              {asPercent(Math.max(validation.baseline_random, validation.baseline_label_prior))} for
              the best random baseline
            </span>
          </div>
          <Link href="/scorer-validation" className="btn btn-secondary btn-sm">
            See the evidence →
          </Link>
        </motion.div>
      )}

      {/* KPI cards — every value and delta comes from /api/stats/overview */}
      <div className="kpi-grid">
        <KpiCard
          icon="🧪"
          label="Total Eval Runs"
          value={metrics.total_runs?.value ?? null}
          delta={metrics.total_runs?.delta}
          deltaLabel={windowLabel}
          basis={
            metrics.total_runs?.current_window
              ? `${metrics.total_runs.current_window} in the last 7d`
              : "no runs in the last 7d"
          }
          color="purple"
          delay={0.1}
        />
        <KpiCard
          icon="✅"
          label="Pass Rate"
          value={metrics.pass_rate?.value ?? null}
          format={asPercent}
          delta={metrics.pass_rate?.delta}
          deltaFormat={asPercent}
          deltaLabel={windowLabel}
          basis={`mean across ${overview?.totals?.completed_runs ?? 0} completed runs`}
          color="green"
          delay={0.2}
        />
        <KpiCard
          icon="📈"
          label="Avg Score"
          value={metrics.avg_score?.value ?? null}
          format={asScore}
          delta={metrics.avg_score?.delta}
          deltaFormat={asScore}
          deltaLabel={windowLabel}
          basis={`mean of ${overview?.totals?.results ?? 0} scored results`}
          color="teal"
          delay={0.3}
        />
        <KpiCard
          icon="🛡️"
          label="Safety Score"
          value={metrics.safety_pass_rate?.value ?? null}
          format={asPercent}
          delta={metrics.safety_pass_rate?.delta}
          deltaFormat={asPercent}
          deltaLabel={windowLabel}
          basis={metrics.safety_pass_rate?.basis}
          color="green"
          delay={0.4}
        />
        <KpiCard
          icon="⚡"
          label="Escalation Rate"
          value={metrics.escalation_rate?.value ?? null}
          format={asPercent}
          delta={metrics.escalation_rate?.delta}
          deltaFormat={asPercent}
          deltaLabel={windowLabel}
          // More escalation means more paid LLM judge calls, so up is not good news.
          invertDelta
          basis={metrics.escalation_rate?.basis}
          color="purple"
          delay={0.5}
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
              {trendPoints.length === 0
                ? "no runs yet"
                : `last ${trendPoints.length} run${trendPoints.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="card-body">
            {trendPoints.length === 0 ? (
              <EmptyChart message="Run the suite to start a trend." />
            ) : (
              <ScoreTrendChart
                data={trendPoints.map((point) => ({
                  name: point.name,
                  accuracy: point.pass_rate,
                  safety: point.safety,
                }))}
              />
            )}
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
              {categories.categories?.length
                ? `${categories.categories.reduce((sum, c) => sum + c.total, 0)} persisted results`
                : "no results yet"}
            </span>
          </div>
          <div className="card-body">
            {categories.categories?.length ? (
              <CategoryBarChart data={categories.categories} />
            ) : (
              <EmptyChart message="Category pass rates appear once results are persisted." />
            )}
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
            <h3 className="card-title">🪜 Scoring Tier Used</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              which tier settled each result
            </span>
          </div>
          <div className="card-body">
            {tierData.length ? (
              <TierBarChart data={tierData} />
            ) : (
              <EmptyChart message="Tier attribution starts with the next run." />
            )}
          </div>
        </motion.div>

        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <div className="card-header">
            <h3 className="card-title">🥧 Run Outcomes</h3>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {runs.length} run{runs.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="card-body">
            {runs.length ? (
              <StatusPieChart data={buildPieData(runs)} />
            ) : (
              <EmptyChart message="No runs recorded." />
            )}
          </div>
        </motion.div>
      </div>

      {/* Recent Runs Table */}
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.7 }}
      >
        <div className="card-header">
          <h3 className="card-title">🕒 Recent Eval Runs</h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {runs.length} total run{runs.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="card-body">
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 48, borderRadius: 8 }} />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🧪</div>
              <h3>No eval runs yet</h3>
              <p>Start your first evaluation by running the suite or a single prompt.</p>
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
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 10).map((run) => {
                    const status = getRunStatus(run);
                    return (
                      <tr key={run.id}>
                        <td
                          data-label="Run ID"
                          style={{ fontFamily: "monospace", color: "var(--text-accent)" }}
                        >
                          {run.id?.substring(0, 8)}
                        </td>
                        <td data-label="Suite">{run.suite_version || "v1"}</td>
                        <td data-label="Model">{run.model_endpoint || "—"}</td>
                        <td data-label="Status">
                          <span className={`status-badge ${status.badge}`}>
                            <span className="status-dot" />
                            {status.label}
                          </span>
                        </td>
                        <td data-label="Pass Rate" style={{ fontWeight: 700 }}>
                          {run.pass_rate != null ? asPercent(run.pass_rate) : "—"}
                        </td>
                        <td data-label="Weighted">
                          {run.weighted_score ? run.weighted_score.toFixed(2) : "—"}
                        </td>
                        <td data-label="Escalated">
                          {run.total_tests
                            ? `${run.escalated_count ?? 0}/${run.total_tests}`
                            : "—"}
                        </td>
                        <td data-label="Created">
                          {run.created_at ? new Date(run.created_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

function EmptyChart({ message }) {
  return (
    <div className="chart-empty">
      <span>{message}</span>
    </div>
  );
}
