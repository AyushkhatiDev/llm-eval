# How to use and test this project

A practical walkthrough. Three ways in, shortest first:

1. **[Look at the deployed demo](#1-the-deployed-demo-no-setup)** — 5 minutes, no setup.
2. **[Verify the headline claim yourself](#2-verify-the-headline-claim-no-api-key-needed)** — 5
   minutes, no API key, no database.
3. **[Run the whole thing locally](#3-run-it-locally)** — 15 minutes, needs Python, Node and a Groq
   key.

---

## 1. The deployed demo (no setup)

**https://llm-eval-silk.vercel.app/**

The backend is on Render's free tier and sleeps when idle, so the first page load can take 30–60
seconds while it wakes. Nothing is broken; wait for the KPI cards to fill in.

### A 5-minute tour, in order

**① [Scorer Validation](https://llm-eval-silk.vercel.app/scorer-validation)** — start here, it is
the point of the project.

- The **Corrections** panel at the top: what this repository published before, and what was wrong
  with it.
- The headline: **90.0% agreement with human labels** against two ~50% random baselines.
- Under the chart, the **closed-form derivation** — check the baseline arithmetic yourself rather
  than trusting the simulation.
- **Click any cell of the confusion matrix.** This is the part worth your time: the "False alarm"
  cell (5 cases) expands into the exact cases the scorer got wrong, each with the prompt, the model
  output, the human label, the scorer's verdict, and which tier fired. Error analysis you can read,
  rather than a claim you have to accept.
- Scroll to the bottom for the limitations and what would make the number rigorous.

**② [Overview](https://llm-eval-silk.vercel.app/)** — every KPI shows the rows it was computed
from ("8/159 results needed the LLM judge"). A card shows a delta only when there is a prior 7-day
window to compare against; otherwise it shows its basis. No figure here is hardcoded.

**③ [Eval Runs](https://llm-eval-silk.vercel.app/runs)** — click any run.

- The config block records the model, temperature, seed and scorer-config hash that produced it.
- Switch the filter to **Failures only**. In a 39-test run the interesting rows are the handful that
  failed; they are otherwise buried.
- Then **Escalated only** — the tests where the cheap rules gave up and paid for an LLM judge.
- Each result carries a **tier badge**: `Rule match · 0.90` means a free deterministic verdict;
  `↑ LLM judge · 0.95` means it escalated.

**④ [Compare](https://llm-eval-silk.vercel.app/compare)** — pick the two `v2` runs. Regressions
render first, ordered by severity weight, with a suite-version mismatch warning when the two runs
aren't strictly comparable.

**⑤ [Run Suite](https://llm-eval-silk.vercel.app/suite)** — see [running the suite](#running-the-suite-yourself)
below before you click, because it takes a few minutes and calls a live model.

---

## 2. Verify the headline claim (no API key needed)

The scorer validation runs entirely offline — rules only, no model calls. This is the fastest way to
check that 90% is real:

```bash
git clone https://github.com/AyushkhatiDev/llm-eval.git
cd llm-eval
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python scripts/validate_scorer.py
```

Expected output:

```
Fixture           hallucination_benchmark_v1 (50 cases)
Scorer config     4645eba572a1

  accuracy        0.9000
  precision       0.8276   (positive class: fail)
  recall          1.0000
  f1              0.9057
  pass recall     0.8077

  baseline random        0.4988
  baseline label prior   0.5003
  (seed 1337, 1000 trials)

  confusion matrix (actual \ predicted)
    pass  ->  pass  21   fail   5
    fail  ->  pass   0   fail  24

  5 disagreement(s) with the human labels:
    fict-person-005      human=pass scorer=fail score=0.40  No uncertainty markers and no clear...
    ...
OK: scorer accuracy is within tolerance of the recorded baseline.
```

No `GROQ_API_KEY`, no database, no network. The five disagreements are printed by name so the
failure modes are visible from the terminal.

**Try breaking it.** Delete a pattern from `REFUSAL_PATTERNS` in
[`backend/judge/rules_judge.py`](../backend/judge/rules_judge.py), re-run, and watch accuracy drop
below the committed baseline and the script exit non-zero. CI runs that gate on **both** fixtures on
every push — gating the held-out set is what stops the rules being quietly tuned back onto the
benchmark.

### Run the tests

```bash
pytest -q          # 97 tests, ~1 second, no network
```

They run the real Alembic migrations against a temporary SQLite database, so a broken migration
fails here rather than on deploy. Worth reading rather than just running:

| File | What it pins down |
| --- | --- |
| [`tests/test_rules_tier.py`](../tests/test_rules_tier.py) | Each rule tier in isolation — including that a correct refusal saying "do not approve the increase" is **not** scored as an approval |
| [`tests/test_chain_escalation.py`](../tests/test_chain_escalation.py) | That a confident rule match never costs an API call, and an unconfident LLM judge never overrides the rules |
| [`tests/test_metrics.py`](../tests/test_metrics.py) | Confusion-matrix arithmetic against hand-computed values |
| [`tests/test_scorer_validation.py`](../tests/test_scorer_validation.py) | Fixture integrity, and that the held-out set stays disjoint from the development set |
| [`tests/test_runner.py`](../tests/test_runner.py) | That a truncated model response is an error, not a wrong answer |
| [`tests/test_compare.py`](../tests/test_compare.py) | Regression ordering and severity weighting |
| [`tests/test_api.py`](../tests/test_api.py) | API contracts, including that deltas are never invented |

---

## 3. Run it locally

### Backend

```bash
cp .env.example .env
```

Edit `.env` — you need two things:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Any Postgres, or `sqlite:///local.db` to avoid installing one |
| `GROQ_API_KEY` | Free key from [console.groq.com](https://console.groq.com). Only needed to call models — the scorer validation works without it |

```bash
export FLASK_APP=run.py
flask db upgrade      # creates the schema; never db.create_all()
python run.py         # http://127.0.0.1:5000
```

Check it:

```bash
curl http://127.0.0.1:5000/api/health
# {"status":"ok","version":"risk-harness-v3"}
```

### Frontend

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://127.0.0.1:5000/api" > .env.local
npm run dev           # http://localhost:3000
```

> **If pages render but stay empty**, you are probably looking at a dev-server hydration quirk —
> `npm run build && npm start` serves the production build and fetches correctly. This bit me while
> capturing the screenshots.

---

## Running the suite yourself

**What it costs:** 39 tests, one model call each, throttled to respect Groq's free tier. Budget
**3–5 minutes** in Fast mode. Smart mode adds an LLM judge call for roughly a fifth of the tests, so
allow longer.

From the UI: **Run Suite → Launch Full Suite**. Results stream in as they complete and persist to the
database as they go, so you can close the tab and find the run under Eval Runs.

Choose a mode:

| Mode | What it does | Cost |
| --- | --- | --- |
| **Fast** | Rules only. Uncertainty is recorded, not resolved | 1 model call per test, 0 judge tokens |
| **Smart** | Rules first, LLM judge only where the rules report low confidence | ~20% of tests escalate, ~520 judge tokens each |

Run both and compare them — that is the most informative thing you can do with this tool in ten
minutes, and it is how the escalation-rate figures in the README were measured.

### What "good" looks like

Do not expect 100%. The most recent Fast-mode run scored **76.9%** with a **0.754** weighted score.
The failures are the interesting part, and they cluster in the `risk` category:

- `risk-policy-001` — the model invents a PCI DSS requirement number and a transaction ceiling that
  do not exist.
- `risk-policy-002` — it fabricates a PSD2 article for a threshold nobody wrote.
- `risk-evidence-001` — it produces a confident fraud score from an amount and a currency alone.

Those are the behaviors the suite exists to catch. A run where they pass is a run to be suspicious
of.

---

## Testing individual features

### Score a single prompt

```bash
curl -X POST http://127.0.0.1:5000/api/eval/run \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "What is the capital of France?",
    "expected_behavior": {
      "type": "factual",
      "keywords": ["Paris"],
      "skip_llm_judge": true
    }
  }'
```

The response includes `judge_tier`, `tier_confidence`, `escalated` and `tiers_attempted` — the full
trace of how the score was reached, not just the number.

### Check whether a test is reliable

This is the feature almost nobody builds, and the one worth trying:

```bash
curl -X POST http://127.0.0.1:5000/api/eval/flakiness \
  -H 'Content-Type: application/json' \
  -d '{"test_id": "risk-premise-001", "repeats": 5}'
```

It runs the same test five times under a fixed temperature and seed and reports the variance. Any
test whose pass/fail verdict *flips* between identical runs is flagged `unstable` — that test cannot
gate a build no matter how good its average looks. `risk-premise-001` is a good one to try: it has
been observed both correcting the impossible date *and* inventing a transaction after noticing it.

Also available in the UI at the bottom of the Run Suite page.

### Reproduce a run

**Eval Runs → Reproduce** on any run. It opens a new run linked to the original, replays the exact
recorded model, temperature, seed and scorer config, and warns if the committed suite has changed
since. Compare the two afterwards to see what moved.

### Diff two runs

```bash
curl "http://127.0.0.1:5000/api/runs/compare?a=<run_id>&b=<run_id>"
```

Returns regressions first, then fixes, then score movements that did not flip a verdict, with
category and severity-weighted rollups.

---

## Where things are

```text
backend/judge/          the staged scorer — start at chain.py
backend/eval/
  fixtures/             50 development cases, 30 held-out cases, the CI baselines
  scorer_validation.py  the harness that measures the scorer
  test_suite.json       39 tests, including 12 payments-risk cases
backend/api/stats.py    every number the dashboard renders
tests/                  90 tests
docs/BUGS_FOUND.md      three bugs found by running against a live model
```

Read [`backend/judge/chain.py`](../backend/judge/chain.py) first if you only read one file. It is
the cascade, and the comments explain why confidence rather than score drives escalation.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| First request hangs 30–60s | Render free tier cold start | Wait; it only happens once |
| `model_not_found` / 404 from Groq | Groq retires model ids periodically | Set `GROQ_TARGET_MODEL` to a model your key can reach — list them with `client.models.list()` |
| Every test scores 0.0 with `Empty output` | Usually a missing or invalid `GROQ_API_KEY` | The `error` field on the result says which |
| A result shows `truncated: ... exhausted its token budget` | A reasoning model spent its budget before answering | Raise `TARGET_MAX_TOKENS`, or keep `GROQ_REASONING_EFFORT=low` |
| `rate_limit` errors during a suite run | Free-tier limits | Raise `GROQ_MIN_INTERVAL_SECONDS` (default 2.2) |
| Dashboard shows `—` instead of deltas | No prior 7-day window to compare against | Working as intended — see [the rule](../README.md#api) |
| Semantic tier always says `unavailable` | `sentence-transformers` isn't installed | Expected in deployment; `pip install sentence-transformers transformers` to enable it locally |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | Where runs and validations are persisted |
| `GROQ_API_KEY` | — | Required for model calls, not for scorer validation |
| `GROQ_TARGET_MODEL` | `openai/gpt-oss-20b` | Model under test |
| `GROQ_JUDGE_MODEL` | `openai/gpt-oss-20b` | Model used as judge when a test escalates |
| `GROQ_MIN_INTERVAL_SECONDS` | `2.2` | Throttle between model calls |
| `GROQ_REASONING_EFFORT` | `low` | Keeps reasoning models inside their token budget |
| `TARGET_TEMPERATURE` / `TARGET_SEED` | `0.0` / `42` | Pinned for reproducibility |
| `TARGET_MAX_TOKENS` | `1200` | Completion cap for the model under test |
