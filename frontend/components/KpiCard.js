"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

function AnimatedCounter({ value, format }) {
  const numeric = typeof value === "number" ? value : NaN;
  const [display, setDisplay] = useState(Number.isNaN(numeric) ? 0 : numeric);

  useEffect(() => {
    if (Number.isNaN(numeric)) return undefined;
    const startTime = performance.now();
    const duration = 1200;
    let frameId;
    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(numeric * eased);
      if (progress < 1) frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [numeric]);

  if (Number.isNaN(numeric)) return <span>{value ?? "—"}</span>;
  return <span>{format ? format(display) : Math.round(display)}</span>;
}

/**
 * A KPI card renders a delta only when the API supplied one. A missing delta
 * means there was no prior window to compare against — so nothing is shown,
 * rather than a plausible-looking number.
 */
export default function KpiCard({
  icon,
  label,
  value,
  format,
  delta,
  deltaLabel,
  deltaFormat,
  invertDelta = false,
  basis,
  color = "purple",
  delay = 0,
}) {
  const hasDelta = delta !== null && delta !== undefined && delta !== 0;
  const isUp = hasDelta && delta > 0;
  const isGood = invertDelta ? !isUp : isUp;

  return (
    <motion.div
      className={`kpi-card ${color}`}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <div className="kpi-card-header">
        <div className="kpi-card-icon">{icon}</div>
        <span className="kpi-card-label">{label}</span>
      </div>
      <div className="kpi-card-value">
        {value === null || value === undefined ? (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ) : (
          <AnimatedCounter value={value} format={format} />
        )}
      </div>
      {hasDelta ? (
        <span className={`kpi-card-change ${isGood ? "up" : "down"}`}>
          {isUp ? "↑" : "↓"}{" "}
          {deltaFormat ? deltaFormat(Math.abs(delta)) : Math.abs(delta)}
          {deltaLabel ? ` ${deltaLabel}` : ""}
        </span>
      ) : (
        <span className="kpi-card-basis">{basis || "no comparison window yet"}</span>
      )}
    </motion.div>
  );
}
