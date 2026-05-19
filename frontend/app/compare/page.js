"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";

export default function ComparePage() {
  const [runs, setRuns] = useState([]);
  const [runA, setRunA] = useState("");
  const [runB, setRunB] = useState("");
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listRuns().then(setRuns).catch(console.error);
  }, []);

  async function compare() {
    if (!runA || !runB) return alert("Select two runs to compare");
    setLoading(true);
    setDiff(null);
    try {
      const data = await api.compareRuns(runA, runB);
      setDiff(data);
    } catch (err) {
      alert("Comparison failed: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <motion.div className="page-header" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Compare Runs</h1>
        <p>Diff two eval runs to detect regressions and improvements.</p>
      </motion.div>

      <motion.div className="card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ marginBottom: 24 }}>
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
                  <select className="form-select" value={runA} onChange={(e) => setRunA(e.target.value)}>
                    <option value="">Select run...</option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id?.substring(0, 8)} — {r.suite_version || "v1"} — {new Date(r.created_at).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="compare-arrow">→</div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Compare Run (B)</label>
                  <select className="form-select" value={runB} onChange={(e) => setRunB(e.target.value)}>
                    <option value="">Select run...</option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id?.substring(0, 8)} — {r.suite_version || "v1"} — {new Date(r.created_at).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="btn btn-primary btn-lg" onClick={compare} disabled={loading || !runA || !runB} style={{ marginTop: 20 }}>
                {loading ? "Comparing..." : "🔍 Compare Runs"}
              </button>
            </>
          )}
        </div>
      </motion.div>

      {diff && (
        <motion.div className="card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="card-header">
            <h3 className="card-title">📊 Regression Report</h3>
          </div>
          <div className="card-body">
            <pre style={{ background: "var(--bg-tertiary)", padding: 20, borderRadius: 8, fontSize: 13, lineHeight: 1.6, overflow: "auto", maxHeight: 500, color: "var(--text-secondary)", border: "1px solid var(--bg-glass-border)" }}>
              {JSON.stringify(diff, null, 2)}
            </pre>
          </div>
        </motion.div>
      )}
    </>
  );
}
