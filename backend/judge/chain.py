"""
4-tier judge chain:
  Tier 1   — Semantic similarity  (fast, no GPU)
  Tier 1.5 — NLI hallucination    (entailment / contradiction check)
  Tier 2   — Local LLM via Ollama (slow, high quality)
  Tier 3   — Regex fallback       (always works)
"""
from backend.judge.semantic_judge import semantic_score, nli_score
from backend.judge.ollama_judge import ollama_score
from backend.judge.regex_judge import regex_score


SEMANTIC_CONFIDENCE_THRESHOLD = 0.85
NLI_CONTRADICTION_PENALTY = 0.3
LLM_CONFIDENCE_THRESHOLD = 0.65


def judge_output(output: str, expected: dict) -> tuple[float, str]:
    """
    Returns (score: float 0-1, reason: str).
    Falls through tiers until one is confident enough.
    """
    if not output or not output.strip():
        return 0.0, "Empty output"

    # --- Tier 1: Semantic similarity ---
    try:
        sim_score = semantic_score(output, expected)
        if sim_score >= SEMANTIC_CONFIDENCE_THRESHOLD:
            return round(sim_score, 4), f"Semantic match: {sim_score:.3f}"
    except Exception as e:
        pass  # fall through

    # --- Tier 1.5: NLI hallucination check ---
    reference = expected.get("reference") or expected.get("description", "")
    if reference:
        try:
            nli_result = nli_score(output, reference)
            verdict = nli_result["verdict"]

            if verdict == "contradiction":
                # Hard fail: model contradicts the known fact
                return round(NLI_CONTRADICTION_PENALTY, 4), \
                    f"NLI contradiction detected (confidence {nli_result['score']:.3f})"

            if verdict == "entailment" and nli_result["score"] >= 0.85:
                # High-confidence entailment — output is factually aligned
                return round(nli_result["score"], 4), \
                    f"NLI entailment confirmed (confidence {nli_result['score']:.3f})"
        except Exception as e:
            pass  # fall through to tier 2

    # --- Tier 2: LLM judge via Ollama ---
    try:
        llm_result = ollama_score(output, expected)
        if llm_result["confidence"] >= LLM_CONFIDENCE_THRESHOLD:
            return round(llm_result["score"], 4), llm_result["reason"]
    except Exception as e:
        pass  # fall through to tier 3

    # --- Tier 3: Regex fallback ---
    reg_score, reg_reason = regex_score(output, expected)
    return round(reg_score, 4), f"Regex fallback: {reg_reason}"