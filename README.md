# HSBC SSR Concept Lab

A UK retail-bank **synthetic consumer research** demo, shaped like a production
service. You describe a product concept and pick a few consumer segments; the
app elicits free-text reactions in natural British English, then maps every
verbatim to a **Likert probability distribution** (not a single forced rating)
so the spread looks like real research rather than collapsing to a flat "3".
Results roll up into segment rankings, KPIs, top objections/appeals themes, and
quotable verbatims. A single Cloud Run service runs everything: the backend
serves the built frontend and calls Vertex AI directly.

> Independent technical demonstration. Not affiliated with, endorsed by, or
> representing HSBC Holdings plc.

## The SSR method (one paragraph)

**Semantic Similarity Rating (SSR)** turns open-ended text into a rating
distribution without ever asking the model for a number. Five Likert *anchor*
statements (from "I would definitely not apply" through "I'd definitely apply
as soon as it's available") are embedded once at startup with
`gemini-embedding-001`. For each respondent verbatim, we embed the text, take
the cosine similarity to each anchor, baseline-subtract (`sims − min(sims)`),
and apply a softmax with temperature `T` to get a 5-point probability mass
function (pmf). The mean is `Σ pmf[i]·(i+1)` and the "would-apply" share is
`pmf[4]+pmf[5]`. Because the rating is *inferred from meaning* rather than
prompted, distributions stay realistic and respondents who hedge land in the
middle. Method after Maier et al. (2025), arXiv:2510.08338. When Vertex is
unavailable the app uses a lexical proxy (`ssrProxy`) so it always runs.

## Architecture

```
Browser ──HTTP──▶  Cloud Run service (single container, :8080)
                     ├─ Express backend  (server/dist/index.js)
                     │    ├─ /api/health, /api/config
                     │    ├─ /api/panel  (elicitation + SSR, per-segment fan-out)
                     │    └─ /api/ssr    (one verbatim → pmf)
                     ├─ Static SPA       (web/dist, served by the backend)
                     └─ Vertex AI (ADC)  Gemini Flash + gemini-embedding-001
```

No CORS in production (same origin). No API keys: Vertex auth is
Application Default Credentials via the Cloud Run runtime service account. Any
LLM error or timeout degrades silently to deterministic offline sample data —
the API never returns 5xx for an LLM failure, and the UI never goes blank.

## Local development

You need Node 20+. Two ways to run it.

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
cd web && npm install && npm run build      # → web/dist
cd ../server && npm install && npm run build # → server/dist
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
ideal for an offline laptop demo.

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

Vertex uses **Application Default Credentials only** — no API keys in code or
in the repo. Locally, `gcloud auth application-default login` provides ADC.

## Deploy to Cloud Run

```bash
PROJECT=your-gcp-project ./deploy/deploy.sh
```

This builds the image from the repo `Dockerfile`, deploys the single
`ssr-concept-lab` service, wires the Vertex env vars, and prints the URL.
Override defaults via env, e.g.:

```bash
PROJECT=acme REGION=europe-west2 VERTEX_LOCATION=europe-west2 \
  GEMINI_MODEL=gemini-2.5-flash EMBED_MODEL=gemini-embedding-001 \
  ./deploy/deploy.sh
```

For LIVE mode, grant the Cloud Run runtime service account
`roles/aiplatform.user` and enable the Vertex AI API (commands are in
`deploy/deploy.sh`). A CI equivalent lives in `deploy/cloudbuild.yaml`:

```bash
gcloud builds submit --config deploy/cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_VERTEX_LOCATION=us-central1
```

Health check after deploy:

```bash
curl -s https://<service-url>/api/health
# {"status":"ok","vertex":true,"ssr":"embedding","ms":1}
```

## 4-minute demo script

1. **(0:00) Frame it.** "Synthetic consumer research for UK retail banking. We
   ask synthetic personas how likely they'd be to apply for a concept — and we
   never ask them for a number." Show the **Panel** tab with *Aurora Cashback
   Card* selected and all five segments toggled on.
2. **(0:30) Run a panel.** Set respondents-per-segment to ~6, keep **Live** on,
   press **Run panel**. Talk through the KPIs as they land: mean purchase
   intent, would-apply %, strongest vs weakest segment.
3. **(1:30) Read the spread.** Point at the overall and per-segment Likert bars:
   "These are full probability distributions, not averages — the *Squeezed
   budget* segment sits low because of the £95 fee; *Mass affluent* skews high."
   Open a couple of **verbatims** and show the per-respondent pmf strip.
4. **(2:30) Show the themes.** Highlight the top objections (annual fee,
   break-even maths) and appeals (flat cashback, FX-free spend) — each tag comes
   from a real driver in the synthetic responses, one glance from the numbers.
5. **(3:00) Explain the method.** Switch to the **Method** tab. Type a sentence
   like "I'd probably sign up — 2% back on everything is great" into the *try it
   live* box and show the free text turn into a pmf via embedding-cosine SSR.
   One line on the maths: anchors embedded once, cosine, softmax.
6. **(3:30) Productionise it.** Switch to the **Deploy** tab. "One Cloud Run
   service, Vertex Gemini Flash plus gemini-embedding-001, ADC auth, no keys. If
   the LLM ever blips it degrades to sample data — the demo can't die on stage."
   Close on the disclaimer in the footer.

## Disclaimer

Independent technical demonstration. Not affiliated with, endorsed by, or
representing HSBC Holdings plc; "HSBC" and the hexagon device are trademarks of
their respective owner, used here illustratively only. Personas and responses
are synthetic — no customer data is used. Indicative only — not FCA Consumer
Duty outcomes testing. Method after Maier et al. (2025), arXiv:2510.08338.
