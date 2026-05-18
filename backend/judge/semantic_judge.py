"""
Uses Sentence-Transformers to compute cosine similarity between
the model output and the expected reference text.

Also includes Natural Language Inference (NLI) via facebook/bart-large-mnli
to detect entailment, contradiction, or neutrality — enabling hallucination scoring.
"""

_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def semantic_score(output: str, expected: dict) -> float:
    """
    Returns a 0-1 cosine similarity score.
    Uses expected['reference'] if present, else expected['description'].
    """
    reference = expected.get("reference") or expected.get("description", "")
    if not reference:
        return 0.5  # no reference to compare against

    model = _get_model()
    from sentence_transformers import util

    emb_output = model.encode(output, convert_to_tensor=True)
    emb_ref = model.encode(reference, convert_to_tensor=True)
    similarity = util.cos_sim(emb_output, emb_ref).item()
    return float(similarity)


# ─── NLI Hallucination Scorer ───────────────────────────────────

_nli_model = None


def _get_nli():
    global _nli_model
    if _nli_model is None:
        from transformers import pipeline

        _nli_model = pipeline(
            "text-classification",
            model="facebook/bart-large-mnli"
        )
    return _nli_model


def nli_score(output: str, reference: str) -> dict:
    """
    Returns whether output entails, contradicts, or is neutral to reference.
    Uses facebook/bart-large-mnli for Natural Language Inference.

    - entailment:    the output is consistent with the reference (high score)
    - contradiction: the output contradicts the reference (score = 0.0)
    - neutral:       the output is unrelated to the reference (score = 0.5)
    """
    nli = _get_nli()
    result = nli(f"{reference} [SEP] {output}", truncation=True)[0]
    label = result["label"].lower()  # entailment / contradiction / neutral
    score = result["score"]

    if label == "entailment":
        return {"score": score, "verdict": "entailment"}
    elif label == "contradiction":
        return {"score": 0.0, "verdict": "contradiction"}
    else:
        return {"score": 0.5, "verdict": "neutral"}
