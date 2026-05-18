# LLM Eval Frontend

This directory contains the Next.js dashboard for the LLM Eval project.

For full setup, architecture, deployment, and API documentation, see the root [README.md](../README.md).

## Development

```bash
npm install
npm run dev
```

The app runs on:

```text
http://localhost:3000
```

Set `NEXT_PUBLIC_API_URL` to point the dashboard at a local or deployed backend:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:5000/api
```
