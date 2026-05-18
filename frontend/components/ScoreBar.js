"use client";
import { motion } from "framer-motion";

export default function ScoreBar({ score, label, maxScore = 1 }) {
  const pct = Math.round((score / maxScore) * 100);
  const tier = pct >= 75 ? "high" : pct >= 40 ? "medium" : "low";
  const color =
    tier === "high"
      ? "var(--accent-success)"
      : tier === "medium"
      ? "var(--accent-primary)"
      : "var(--accent-danger)";

  return (
    <div style={{ marginBottom: 8 }}>
      {label && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 4,
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          <span>{label}</span>
          <span style={{ fontWeight: 700, color }}>{pct}%</span>
        </div>
      )}
      <div className="score-bar">
        <motion.div
          className={`score-bar-fill ${tier}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
