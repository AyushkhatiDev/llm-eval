"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

function AnimatedCounter({ value, duration = 1.5 }) {
  const [display, setDisplay] = useState(0);
  const numVal = typeof value === "number" ? value : parseFloat(value) || 0;

  useEffect(() => {
    const start = 0;
    const end = numVal;

    const startTime = performance.now();
    let frameId;
    const step = (currentTime) => {
      const elapsed = (currentTime - startTime) / (duration * 1000);
      const progress = Math.min(elapsed, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;
      setDisplay(current);
      if (progress < 1) frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [numVal, duration]);

  const isPercent = typeof value === "string" && value.includes("%");
  const isFloat = !Number.isInteger(numVal);

  return (
    <span>
      {isFloat ? display.toFixed(1) : Math.round(display)}
      {isPercent ? "%" : ""}
    </span>
  );
}

export default function KpiCard({ icon, label, value, change, changeDir, color = "purple", delay = 0 }) {
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
        <AnimatedCounter value={value} />
      </div>
      {change && (
        <span className={`kpi-card-change ${changeDir || "up"}`}>
          {changeDir === "down" ? "↓" : "↑"} {change}
        </span>
      )}
    </motion.div>
  );
}
