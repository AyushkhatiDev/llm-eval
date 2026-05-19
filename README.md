# LLM Eval Dashboard

A full-stack LLM evaluation dashboard for running factual, safety, hallucination, adversarial, and reasoning tests against an LLM endpoint. The app includes a polished Next.js dashboard, a Flask API, persisted eval runs, progressive suite execution, and two scoring modes designed to balance quality with API rate limits.

## Live Demo

- Frontend: https://llm-eval-silk.vercel.app/
- Backend health: https://llm-eval-55pg.onrender.com/api/health

The deployed demo uses Groq as the default model endpoint. Render free-tier services can cold start, so the first API call may take a few seconds.

## Research Note

- [Hallucination Scoring vs. Random Baselines](./FINDINGS.md)

## Features

- Run a curated 27-test suite covering:
  - factual accuracy
  - safety refusals
  - hallucination resistance
  - adversarial prompt resistance
  - reasoning questions
- Run single prompt evaluations from the UI.
- Persist eval runs and individual test results in Postgres.
- Browse run history with pass rate, test counts, status, latency, and detailed result inspection.
- View model outputs, judge reasons, failure types, and per-test scores.
- Compare runs for regression analysis.
- Use progressive suite execution so results appear as tests complete.
- Choose between two suite scoring modes:
  - **Fast**: rule-based scoring only, lowest API usage.
  - **Smart**: regex first, LLM judge only when uncertain.
- Groq-aware throttling to reduce free-tier rate-limit errors.
- Responsive dashboard UI with desktop and mobile navigation.

## Architecture

```mermaid
flowchart LR
  User["User Browser"] --> Vercel["Next.js Frontend on Vercel"]
  Vercel --> API["Flask API on Render"]
  API --> Groq["Groq API"]
  API --> DB["Postgres Database"]
  API --> Judge["Rule + Optional LLM Judge"]
  Judge --> Groq
```

## Tech Stack

### Frontend

- Next.js App Router
- React
- Framer Motion
- Recharts
- CSS modules/global design system
- Vercel deployment

### Backend

- Flask
- Flask-SQLAlchemy
- Flask-Migrate
- Gunicorn
- Groq SDK
- PostgreSQL
- Render deployment

### Optional / Legacy

The repository still includes Celery/Redis-related files from the original async-worker design. The deployed free-tier flow currently runs evaluations synchronously through Flask and uses client-side sequential suite execution to avoid needing a paid Render background worker.

## Repository Structure

```text
.
├── backend/
│   ├── api/              # Flask API routes
│   ├── eval/             # Test suite and eval runner
│   ├── judge/            # Rule-based, semantic, and LLM judge logic
│   ├── models/           # SQLAlchemy models
│   ├── app.py            # Flask app factory
│   ├── config.py         # Runtime config
│   └── extensions.py     # db/migrate/cors extensions
├── frontend/
│   ├── app/              # Next.js pages
│   ├── components/       # Dashboard components
│   ├── lib/              # API client and utilities
│   └── package.json
├── workers/              # Legacy Celery worker modules
├── docker-compose.yml    # Local Postgres/Redis helper
├── render.yaml           # Render web service config
├── vercel.json           # Vercel frontend build config
├── requirements.txt      # Backend dependencies
└── run.py                # Local Flask entrypoint
```

## How Evaluation Works

1. The frontend requests the test suite metadata from `/api/eval/suite/tests`.
2. The suite page creates a persisted run via `POST /api/runs`.
3. Each test is executed sequentially through `POST /api/eval/run`.
4. The backend calls the target model:
   - `model_endpoint = "groq"` uses the Groq chat completions API.
   - Any HTTP URL is treated as a custom model endpoint.
5. The backend scores the output.
6. Each result is saved to `eval_results`.
7. The parent `eval_runs` row is updated after every test.
8. The frontend progressively displays results and restores them from localStorage if you navigate away.

## Scoring Modes

### Fast - rules only

Fast mode uses Groq to generate model answers, then scores with local rules/regex only. This is the most reliable mode for free-tier demos because it typically uses one Groq request per test.

Best for:

- demos
- avoiding rate limits
- quick pass/fail feedback

### Smart - LLM judge when uncertain

Smart mode scores with rules first. If the rule-based judge cannot confidently decide, it falls back to the Groq-powered judge.

Best for:

- more nuanced scoring
- ambiguous factual or hallucination responses
- deeper inspection when rate limits are not a concern

Smart mode may use additional Groq calls, so it can be slower and more likely to hit free-tier limits if rerun repeatedly.

## API Overview

### Health

```bash
GET /api/health
```

Returns:

```json
{
  "status": "ok",
  "version": "groq-target-v2"
}
```

### List Suite Tests

```bash
GET /api/eval/suite/tests
```

Returns the curated test suite used by the Run Suite page.

### Run Single Eval

```bash
POST /api/eval/run
```

Example body:

```json
{
  "prompt": "What is 2 + 2?",
  "model_endpoint": "groq",
  "expected_behavior": {
    "description": "correctly answer basic arithmetic",
    "reference": "The answer is 4",
    "type": "factual",
    "keywords": ["4", "four"]
  }
}
```

### Create Persisted Run

```bash
POST /api/runs
```

Example body:

```json
{
  "model_endpoint": "groq",
  "suite_version": "v1-fast"
}
```

### List Runs

```bash
GET /api/runs
```

### Get Run Details

```bash
GET /api/runs/<run_id>
```

## Local Development

### Prerequisites

- Python 3.11 recommended
- Node.js 20+ recommended
- PostgreSQL
- Groq API key

### 1. Clone the repository

```bash
git clone https://github.com/AyushkhatiDev/llm-eval.git
cd llm-eval
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Update `.env`:

```env
SECRET_KEY=your-secret-key
DATABASE_URL=postgresql://postgres:password@localhost:5432/llm_eval
GROQ_API_KEY=your-groq-api-key
GROQ_TARGET_MODEL=llama-3.1-8b-instant
GROQ_MIN_INTERVAL_SECONDS=2.2
```

### 3. Start Postgres locally

You can use Docker Compose:

```bash
docker compose up -d postgres
```

The compose file also defines Redis and legacy worker services, but they are not required for the current free-tier synchronous eval flow.

### 4. Install backend dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 5. Initialize the database

If migrations are configured in your local environment:

```bash
flask --app run.py db upgrade
```

If you are iterating locally and need a quick development database, create the tables from the app context:

```bash
python - <<'PY'
from backend.app import create_app
from backend.extensions import db

app = create_app()
with app.app_context():
    db.create_all()
PY
```

### 6. Start the backend

```bash
python run.py
```

Backend runs on:

```text
http://127.0.0.1:5000
```

### 7. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on:

```text
http://localhost:3000
```

By default the frontend points to the deployed Render backend. For local backend development, set:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:5000/api
```

## Deployment

### Backend on Render

`render.yaml` defines a Python web service:

```bash
gunicorn --timeout 180 -w ${WEB_CONCURRENCY:-2} -b 0.0.0.0:$PORT "backend.app:create_app()"
```

Required Render environment variables:

```env
DATABASE_URL=postgresql://...
GROQ_API_KEY=...
PYTHONPATH=.
```

Optional:

```env
GROQ_TARGET_MODEL=llama-3.1-8b-instant
GROQ_MIN_INTERVAL_SECONDS=2.2
SUITE_CONCURRENCY=1
```

### Frontend on Vercel

`vercel.json` tells Vercel to build the Next.js app in `frontend/`:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "frontend/package.json",
      "use": "@vercel/next"
    }
  ]
}
```

Recommended Vercel environment variable:

```env
NEXT_PUBLIC_API_URL=https://llm-eval-55pg.onrender.com/api
```

## Rate Limits and Demo Notes

Groq free-tier limits can affect full-suite runs if many people use the demo at the same time.

Recommendations:

- Use **Fast** mode for public demos.
- Use **Smart** mode when you want more nuanced judging and can tolerate extra latency.
- Avoid repeatedly launching suites back-to-back.
- If sharing publicly, mention that the backend may cold start and the model provider may rate-limit.

## Current Limitations

- The deployed architecture is optimized for free-tier hosting, not high-concurrency production use.
- Celery/Redis worker files are present but not used in the current Render free-tier deployment.
- Fast scoring is intentionally rule-based and may miss subtle correctness issues.
- Smart scoring can consume additional Groq requests.
- The test suite is curated and small; it is intended as a demo and starting point, not a comprehensive benchmark.

## Roadmap

- Add authenticated workspaces and private projects.
- Add custom test-suite upload/editing.
- Add run export as CSV/JSON.
- Add richer regression reports between two runs.
- Add model/provider presets for Groq, OpenAI-compatible endpoints, Ollama, and custom HTTP endpoints.
- Add background workers for paid production deployments.
- Add charts based on real category-level persisted results.

## License

This project currently does not declare a license. Add a license before using or distributing it in a commercial context.

## Author

Built by [AyushkhatiDev](https://github.com/AyushkhatiDev).
