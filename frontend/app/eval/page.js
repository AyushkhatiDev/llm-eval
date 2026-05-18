"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";

export default function EvalPage() {
  const [form, setForm] = useState({
    prompt: "",
    model_endpoint: "http://localhost:11434/api/generate",
    description: "",
    reference: "",
    type: "factual",
    keywords: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [evalResult, setEvalResult] = useState(null);

  async function submitEval() {
    setSubmitting(true);
    setEvalResult(null);
    try {
      const payload = {
        prompt: form.prompt,
        model_endpoint: form.model_endpoint,
        expected_behavior: {
          description: form.description,
          reference: form.reference,
          type: form.type,
          keywords: form.keywords ? form.keywords.split(",").map((k) => k.trim()) : [],
        },
      };
      const data = await api.triggerEval(payload);
      setEvalResult(data);
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <motion.div className="page-header" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1>New Evaluation</h1>
        <p>Submit a single prompt for evaluation against a model endpoint.</p>
      </motion.div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <motion.div className="card" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
          <div className="card-header"><h3 className="card-title">⚡ Configuration</h3></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Prompt</label>
              <textarea className="form-textarea" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Enter the prompt..." rows={4} />
            </div>
            <div className="form-group">
              <label className="form-label">Model Endpoint</label>
              <input className="form-input" value={form.model_endpoint} onChange={(e) => setForm({ ...form, model_endpoint: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Expected Behavior</label>
              <input className="form-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g., correctly answer arithmetic" />
            </div>
            <div className="form-group">
              <label className="form-label">Reference Answer</label>
              <input className="form-input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g., The answer is 4" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="factual">Factual</option>
                  <option value="safety">Safety</option>
                  <option value="reasoning">Reasoning</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Keywords (comma-sep)</label>
                <input className="form-input" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="4, four" />
              </div>
            </div>
            <button className="btn btn-primary btn-lg" onClick={submitEval} disabled={submitting || !form.prompt} style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>
              {submitting ? "Submitting..." : "⚡ Run Evaluation"}
            </button>
          </div>
        </motion.div>
        <motion.div className="card" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
          <div className="card-header">
            <h3 className="card-title">📋 Result</h3>
            {submitting && <span className="live-indicator"><span className="live-dot"></span>Running...</span>}
          </div>
          <div className="card-body">
            {!evalResult ? (
              <div className="empty-state"><div className="empty-state-icon">⚡</div><h3>No evaluation submitted</h3><p>Fill the form and click Run Evaluation.</p></div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Status</div>
                  <span className={`status-badge ${evalResult.passed ? "success" : "failure"}`} style={{ fontSize: 14, padding: "6px 16px" }}>
                    <span className="status-dot" />{evalResult.passed ? "PASSED" : "FAILED"}
                  </span>
                </div>
                <pre style={{ background: "var(--bg-tertiary)", padding: 16, borderRadius: 8, fontSize: 13, lineHeight: 1.6, overflow: "auto", maxHeight: 400, color: "var(--text-secondary)", border: "1px solid var(--bg-glass-border)" }}>
                  {JSON.stringify(evalResult, null, 2)}
                </pre>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
