"use client";

const TIERS = {
  empty_check: { label: "Empty check", tone: "muted" },
  semantic: { label: "Semantic", tone: "info" },
  rules: { label: "Rule match", tone: "teal" },
  llm_judge: { label: "LLM judge", tone: "purple" },
};

/**
 * Names the tier of the staged scorer that produced a score.
 *
 * The tier is the difference between a free deterministic verdict and a paid
 * model call, so it is shown on every result rather than hidden in a log.
 */
export default function TierBadge({ tier, confidence, escalated }) {
  if (!tier) return null;
  const meta = TIERS[tier] || { label: tier, tone: "muted" };

  return (
    <span
      className={`tier-badge ${meta.tone} ${escalated ? "escalated" : ""}`}
      title={
        escalated
          ? "The cheaper tiers were not confident enough, so this result was escalated to the LLM judge."
          : `Settled by the ${meta.label.toLowerCase()} tier without an LLM call.`
      }
    >
      {escalated && <span className="tier-badge-arrow">↑</span>}
      {meta.label}
      {confidence != null && ` · ${confidence.toFixed(2)}`}
    </span>
  );
}
