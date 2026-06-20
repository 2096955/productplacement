# HSBC SSR Concept Lab

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)
![Stack](https://img.shields.io/badge/stack-Express%20%C2%B7%20React%20%C2%B7%20Vertex%20AI-444)

A UK retail-bank **synthetic consumer research** demo, shaped like a production
service. You describe a product concept and pick a few consumer segments (or
bring your own personas); the app elicits free-text reactions in natural British
English, then maps every verbatim to a **Likert probability distribution** (not
a single forced rating) so the spread looks like real research rather than
collapsing to a flat "3". Results roll up into unit rankings, KPIs, top
objection/appeal themes, and quotable verbatims. A single Cloud Run service runs
everything: the backend serves the built frontend and calls Vertex AI directly.

> **Independent technical demonstration.** Not affiliated with, endorsed by, or
> representing HSBC Holdings plc. "HSBC" and the hexagon device are trademarks of
> their respective owner, used here illustratively only. Personas and responses
> are synthetic — no customer data is used.

Two ideas make it feel like real research rather than a toy:

1. **SSR** — ratings are *inferred from the meaning of free text*, never prompted as a number.
2. **It reacts to the product** — change the fee, the cashback, or the rate and the scores move, with or without a live LLM.

---

## The SSR method (one paragraph)

**Semantic Similarity Rating (SSR)** turns open-ended text into a rating
distribution without ever asking the model for a number. Five Likert *anchor*
statements (from "I would definitely not apply" through "I'd definitely apply as
soon as it's available") are embedded once at startup with `gemini-embedding-001`.
For each respondent verbatim we embed the text, take the cosine similarity to
each anchor, baseline-subtract (`sims − min(sims)`), and apply a softmax with
temperature `T` to get a 5-point probability mass function (pmf). The mean is
`Σ pmf[i]·(i+1)` and the "would-apply" share is `pmf[4]+pmf[5]`. Because the
rating is inferred from meaning rather than prompted, distributions stay
realistic and respondents who hedge land in the middle. Method after Maier et
al. (2025), [arXiv:2510.08338](https://arxiv.org/abs/2510.08338). When Vertex is
unavailable the app uses a lexical proxy (`ssrProxy`) so it always runs.

## It reacts to the product

Editing the concept's numbers changes the panel — both with a live LLM and in
the deterministic offline path:

- **Live mode** feeds the full concept description to Gemini, which reasons about
  the actual figures when writing each reaction; SSR then maps those reactions.
- **Offline / fallback mode** scores each persona with a transparent,
  deterministic heuristic (`heuristicIntent` in `domain.ts`) that is
  **magnitude-aware**: the annual-fee amount is weighed against each persona's
  estimated disposable income, cashback % rewards intent, and a savings AER /
  credit APR shifts it versus a baseline. The per-respondent "modelled reasoning"
  shown in the UI cites the actual numbers (e.g. *"the £500 fee is about 6% of
  yearly disposable income; 2% cashback sweetens it a little"*).

So raising a fee £95 → £500, or cashback 2% → 8%, visibly moves Mean PI and the
would-apply share on every run — not just when Vertex is configured. Scoring is
pure and seed-stable, so a given seed reproduces identical results.

**Persona Studio.** Catalogue archetypes can be light-edited inline, and you can
**bring your own personas** (up to three, run as extra units) and **bring your
own concept** (free-text product). BYO concepts derive their own
objection/appeal themes from the text you type.

## Architecture

```
Browser ──HTTP──▶  Cloud Run service (single container, :8080)
                     ├─ Express backend  (server/dist/index.js)
                     │    ├─ /api/health, /api/config
                     │    ├─ /api/panel  (elicitation + SSR, per-unit fan-out)
                     │    ├─ /api/ssr    (one verbatim → pmf)
                     │    ├─ /api/chat   (interview one respondent)
                     │    └─ /api/ask    (broadcast one question to the panel)
                     ├─ Static SPA       (web/dist, served by the backend)
                     └─ Vertex AI (ADC)  Gemini Flash + gemini-embedding-001
```

Same origin in production (no CORS). **No API keys** — Vertex auth is Application
Default Credentials via the Cloud Run runtime service account. Any LLM error or
timeout degrades silently to deterministic offline sample data: the API never
returns 5xx for an LLM failure, and the UI never goes blank.

`server/src/domain.ts` is the framework-agnostic core (types, SSR proxy, persona
scoring, unit resolution) and is kept **byte-identical** with `web/src/domain.ts`
so the browser can run the exact same offline fallback.

## Project layout

```
server/        Express + Vertex backend (TypeScript)
  src/
    index.ts     boot: Vertex/SSR init, static serve, listen
    routes.ts    /api surface (request parsing, caps, never-5xx contract)
    panel.ts     panel run orchestration over units (live + fallback)
    domain.ts    canonical core: types, SSR proxy, persona scoring  ← shared
    ssr.ts       embedding-cosine SSR (Vertex) + lexical fallback
    vertex.ts    Vertex client, persona-reasoning prompt, chat/ask
    chat.ts      offline chat replies
web/           React 19 + Vite + Tailwind SPA
  src/
    App.tsx      Panel / Method / Deploy tabs
    domain.ts    byte-identical copy of server/src/domain.ts
    components/  PersonaForm, visuals (pmf bars/strips), tabs, drawer
    theme.ts     brand tokens + fonts
deploy/        deploy.sh (Cloud Run) + cloudbuild.yaml
Dockerfile, docker-compose.yml
```

## Local development

You need Node 20+. Three ways to run it.

### Option A — run the two dev servers

```bash
# Terminal 1: backend on :8080 (sample mode unless Vertex env vars are set)
cd server && npm install && npm run dev

# Terminal 2: frontend on :5173, proxying /api → :8080
cd web && npm install && npm run dev
```

Open http://localhost:5173.

### Option B — build once and serve from the backend

```bash
cd web && npm install && npm run build       # → web/dist
cd ../server && npm install && npm run build  # → server/dist
cd .. && WEB_DIST="$PWD/web/dist" node server/dist/index.js
```

Open http://localhost:8080.

### Option C — Docker (closest to production)

```bash
docker build -t ssr-concept-lab .
docker run --rm -p 8080:8080 ssr-concept-lab
# or:
docker compose up --build
```

Open http://localhost:8080. With no Vertex env vars this is pure SAMPLE mode —
ideal for an offline laptop demo (the magnitude-aware scoring still works).

## Environment variables

All are optional. With **none** set, the app runs in pure offline SAMPLE mode.

| Variable            | Default               | Purpose |
|---------------------|-----------------------|---------|
| `PORT`              | `8080`                | Port the server listens on (`0.0.0.0:PORT`). |
| `WEB_DIST`          | sibling `web/dist`    | Absolute path to the built frontend. `/app/web/dist` in the container. |
| `ENABLE_VERTEX`     | `true`                | Set to `false` to force SAMPLE mode even if Vertex is configured. |
| `VERTEX_PROJECT`    | (unset)               | GCP project for Vertex AI. Required for LIVE mode. |
| `VERTEX_LOCATION`   | `us-central1`         | Vertex AI region. |
| `GEMINI_MODEL`      | `gemini-2.5-flash`    | Generation model for persona elicitation. |
| `EMBED_MODEL`       | `gemini-embedding-001`| Embedding model for SSR anchor/verbatim cosine. |
| `SSR_TEMPERATURE`   | `0.05`                | Softmax temperature `T` for the SSR pmf (calibrated for gemini-embedding-001 so it does not collapse to 3). |
| `VERTEX_TIMEOUT_MS` | `20000`               | Per-call Vertex timeout; on timeout it falls back. |
| `RATE_LIMIT_PER_MIN`| `20`                  | Per-IP request cap on `/api/panel` and `/api/ssr`. |

Vertex uses **Application Default Credentials only** — no API keys in code or in
the repo. Locally, `gcloud auth application-default login` provides ADC.

## Deploy to Cloud Run

```bash
PROJECT=your-gcp-project ./deploy/deploy.sh
```

This builds the image from the repo `Dockerfile`, deploys the single
`ssr-concept-lab` service (public, `--allow-unauthenticated`), wires the Vertex
env vars, and prints the URL. Override defaults via env, e.g.:

```bash
PROJECT=acme REGION=europe-west2 VERTEX_LOCATION=europe-west2 ./deploy/deploy.sh
```

For **LIVE mode** (real Gemini + embeddings), enable the Vertex AI API and grant
the Cloud Run runtime service account `roles/aiplatform.user`:

```bash
gcloud services enable aiplatform.googleapis.com --project "$PROJECT"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

Without it the service still works — it degrades to SAMPLE mode. A CI equivalent
lives in `deploy/cloudbuild.yaml`. Health check after deploy:

```bash
curl -s https://<service-url>/api/health
# live:    {"status":"ok","vertex":true,"ssr":"embedding","ms":1}
# offline: {"status":"ok","vertex":false,"ssr":"lexical","ms":0}
```

## License

[MIT](./LICENSE) — see `LICENSE`. The HSBC branding is illustrative only (see the
disclaimer above and in the app footer); the trademark is not licensed.

## Disclaimer

Independent technical demonstration. Not affiliated with, endorsed by, or
representing HSBC Holdings plc; "HSBC" and the hexagon device are trademarks of
their respective owner, used here illustratively only. Personas and responses are
synthetic — no customer data is used. Indicative only — not FCA Consumer Duty
outcomes testing. Method after Maier et al. (2025), arXiv:2510.08338.
