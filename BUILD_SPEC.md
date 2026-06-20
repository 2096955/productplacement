# BUILD SPEC — HSBC SSR Concept Lab (conference demo, production-shaped)

A UK retail-bank **synthetic consumer research** demo. Free-text persona elicitation →
embedding-cosine SSR → Likert probability distributions (not point estimates) → segment
rankings, themes, and verbatims. Single Cloud Run service: the **backend serves the built
frontend**. Method after Maier et al. (2025), arXiv:2510.08338.

Project root: `/Users/anthonylui/ssr-banking-concept-lab`

## Already authored (DO NOT recreate or modify — build against these)
- `server/src/domain.ts` and `web/src/domain.ts` — **identical** canonical module: types,
  `CONCEPTS`, `SEGMENTS`, `ANCHORS`, `CUSTOM_BASE`, `gaussianPmf`, `aggregate`, `ssrProxy`
  (lexical SSR fallback), `makeRng`, `sampleSegment`, `samplePanel`, and the API types
  `PanelRequest` / `PanelResponse` / `RespondentResult` / `SegmentResult`.
- `web/src/theme.ts` — HSBC theme tokens: `BRAND`, `INK/MUTED/LINE/PAPER/ACCENT`,
  `LIKERT_COLORS`, fonts, `DISCLAIMER`, `BRAND_NAME`, `PRODUCT_NAME`, `PRODUCT_KICKER`.

**Import the data/logic from `domain.ts`. Never hardcode concepts/segments/anchors again.**

## API contract (single source of truth)
All under `/api`, same-origin (no CORS in prod).

- `GET /api/health` → `{ "status":"ok", "vertex": <bool>, "ssr": "embedding"|"lexical", "ms": <number> }`
  - `vertex` = whether Vertex creds + anchor embeddings initialised successfully.
- `GET /api/config` → `{ concepts: Concept[], segments: Segment[], anchors: string[] }` (from domain.ts).
- `POST /api/panel` (body = `PanelRequest`) → `PanelResponse`.
  - If `live:false` → server runs `samplePanel(req)` (offline) and returns it (mode `"sample"`).
  - If `live:true` → server attempts Vertex elicitation + embedding SSR per segment.
    On ANY error/timeout (per segment or globally) it must fall back to `sampleSegment`/`samplePanel`
    and set `fellBack:true`, `mode:"sample"` (or keep `mode:"live"` with `meta.note` if only SSR fell back).
    **The endpoint must NEVER return 5xx for an LLM failure** — it degrades to sample data.
- `POST /api/ssr` (body `{ "text": string }`) → `{ pmf:number[], mean:number, ssr:"embedding"|"lexical" }`.
  Maps one free-text verbatim to a Likert pmf (embedding cosine if available, else `ssrProxy`).
  Powers the Method tab "try it live" box.

`PanelResponse.perSegment` is keyed by segment id; each value is a `SegmentResult`
(`responses[]`, `pmf`, `mean`, `applyShare`). Shapes MUST match `domain.ts` exactly so the
frontend renders live and sample identically.

## Vertex AI specifics (backend)
- SDK: **`@google/genai`** with `new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION })`.
  Auth = Application Default Credentials (Cloud Run service account). **No API keys in code.**
- Generation: `ai.models.generateContent({ model: GEMINI_MODEL, contents, config: { temperature: 0.5, topP: 0.9, responseMimeType: "application/json", responseSchema } })`.
  - `responseSchema` = an ARRAY of objects `{ text: string, driver: string }`, exactly `nPer` items.
  - System/prompt: impersonate `nPer` DISTINCT UK consumers in the segment (use `segment.brief`),
    shown the concept `desc`; each answers "How likely would you be to apply for / open this?"
    in first-person natural British English (1–3 sentences), specific to the concept's features
    and the persona's finances. **Must NOT output any numeric rating.** Vary intent realistically;
    include genuine objections where the persona warrants. `driver` = 2–4 word key driver.
- SSR mapping (`server/src/ssr.ts`):
  1. At startup embed the 5 `ANCHORS` once with `EMBED_MODEL` (`gemini-embedding-001`) →
     cache `anchorVecs`. If this fails, `vertex=false` and everything uses `ssrProxy`.
  2. Per verbatim: embed text → `v`; `sims[i] = cosine(v, anchorVecs[i])`.
  3. Baseline-subtract: `sims' = sims - min(sims)`; `pmf = softmax(sims' / T)` with `T = SSR_TEMPERATURE` (default 1.0).
  4. `mean = Σ pmf[i]*(i+1)`, `applyShare = pmf[3]+pmf[4]`.
  - Expose `T` (and an optional epsilon floor) via env; document them.
- Timeouts: wrap every Vertex call in `Promise.race` with `VERTEX_TIMEOUT_MS` (default 8000).
  On timeout/throw → fall back. Embeddings may be batched.
- Env vars (all optional; sensible defaults; app must run with NONE set → pure sample mode):
  `PORT` (default 8080), `VERTEX_PROJECT`, `VERTEX_LOCATION` (default `us-central1`),
  `GEMINI_MODEL` (default `gemini-2.0-flash`), `EMBED_MODEL` (default `gemini-embedding-001`),
  `SSR_TEMPERATURE` (default 1.0), `VERTEX_TIMEOUT_MS` (default 8000),
  `ENABLE_VERTEX` (default "true"; "false" forces sample mode).

## Backend requirements (`server/`)
- TypeScript + Express 4. Files: `src/index.ts` (boot + static serve + listen on `0.0.0.0:PORT`),
  `src/routes.ts`, `src/vertex.ts` (genai client + elicitation), `src/ssr.ts` (embeddings + cosine),
  `src/panel.ts` (orchestration: per-segment, fan-out with `Promise.allSettled`, fallback).
- Serve the built frontend: static-serve `../web/dist` (path resolved relative to compiled output;
  in the container it will be `web/dist` next to `server/dist` — make the path configurable via
  `WEB_DIST` env, default to the sibling `web/dist`). SPA fallback: non-`/api` GET → `index.html`.
- `package.json` scripts: `dev` (tsx watch), `build` (`tsc -p tsconfig.json`), `start` (`node dist/index.js`),
  `typecheck` (`tsc --noEmit`). Target Node 20, ESM or CJS — your call, but it must `tsc` clean and run.
- Health must report whether Vertex initialised. Log clearly at boot which mode is active.
- **You MUST run `npm install && npm run typecheck && npm run build` and confirm it passes before returning.**
  Report the exact commands run and their result.

## Frontend requirements (`web/`)
- Vite + React 18 + TypeScript + Tailwind CSS v3.4 (real config: `tailwind.config.js`, `postcss.config.js`,
  `src/index.css` with the three `@tailwind` directives). `vite.config.ts` aliases `@`→`./src` and
  proxies `/api` → `http://localhost:8080` for dev.
- Port the provided React prototype (it is described below) into `src/App.tsx` + small components,
  **re-themed to HSBC** using `theme.ts`. Keep the three tabs: **Panel**, **Method**, **Deploy**.
  Keep the Likert spectrum, KPIs, segment ranking, overall + per-segment pmf bars, theme cards
  (top objections / appeals), and synthetic verbatims with per-respondent pmf strips.
- HSBC look: header shows a red hexagon device + `BRAND_NAME` wordmark + `PRODUCT_NAME`; primary
  buttons use `ACCENT` (HSBC red); footer renders `DISCLAIMER` verbatim. Tasteful, not garish.
- Data flow:
  - On load, optionally `GET /api/config` (fall back to local `domain.ts` `CONCEPTS/SEGMENTS` if it fails).
  - "Run panel": `POST /api/panel` with `{conceptId|conceptText, segments, nPer, live}`.
    On network error/timeout (use `AbortController`, ~12s), run **`samplePanel(req)` locally** from
    `domain.ts` so the UI NEVER dies on stage. Show a subtle notice when any fallback occurred
    (server `fellBack` OR local fallback).
  - Method tab: a text box → `POST /api/ssr` to show free-text → live pmf (fall back to `ssrProxy`).
- Aggregation/summary (ranking, top objections/appeals, KPIs) computed from `PanelResponse` —
  reuse the prototype's summary logic, reading `perSegment`.
- The Deploy tab content: keep the GCP architecture / agent-swarm / demo-script copy from the prototype
  (update branding to HSBC; keep it accurate to THIS build: single Cloud Run service, Vertex Gemini Flash
  + gemini-embedding-001, ADC auth).
- **You MUST run `npm install && npm run build` and confirm `dist/` is produced before returning.**
  Report commands + result.

### Prototype behaviour to preserve (the source artifact)
- Concepts: Aurora Cashback Card, Boost Saver, FlexPay Personal Loan + "bring your own concept".
- 5 segments (GENZ/YPRO/FAM/AFFL/SQZ), toggleable; respondents-per-segment slider 4–10.
- Live toggle. KPIs: mean PI, would-apply % (4–5 mass), strongest/weakest segment.
- Per-respondent FULL pmf (not a single forced rating) → realistic spread, doesn't collapse to "3".
- Verbatims are one glance from every quantitative view (objections/appeals come from real driver tags).

## Deploy requirements (`/`, `deploy/`)
- Multi-stage `Dockerfile` at repo root:
  1. build web (`web` → `npm ci && npm run build` → `web/dist`),
  2. build server (`server` → `npm ci && npm run build` → `server/dist`),
  3. runtime `node:20-slim`: copy `server/dist`, `server/node_modules` (prod deps), and `web/dist`;
     `ENV PORT=8080 WEB_DIST=/app/web/dist`; `CMD ["node","server/dist/index.js"]`; `EXPOSE 8080`.
  - Must run as non-root where practical; small image; `.dockerignore` excludes node_modules, dist, .git.
- `deploy/deploy.sh` — parameterised, idempotent:
  `gcloud run deploy "$SERVICE" --source . --region "$REGION" --project "$PROJECT" --allow-unauthenticated
   --set-env-vars VERTEX_PROJECT=$PROJECT,VERTEX_LOCATION=$VERTEX_LOCATION,GEMINI_MODEL=...,EMBED_MODEL=...`
  Defaults via env with sane fallbacks; print the resulting URL. Include a commented note on granting
  the Cloud Run runtime service account `roles/aiplatform.user`.
- `deploy/cloudbuild.yaml` — optional CI variant doing the same.
- Root `README.md` — what it is, the SSR method (1 paragraph), local dev (`npm install`/`dev` in each,
  or `docker build`/`run`), env vars table, the deploy command, the disclaimer, and the 4-minute demo script.
- `docker-compose.yml` (optional) for one-command local run.
- **You MUST `docker build` the image locally and confirm it succeeds (and ideally `docker run` + curl
  `/api/health`) before returning.** Report commands + result. If Docker buildx is unavailable, say so.

## Acceptance criteria
1. `server` typechecks + builds; `web` builds to `dist/`; root `docker build` succeeds.
2. With NO env vars, the app runs in pure sample mode and `/api/panel` returns valid `PanelResponse`.
3. With Vertex env vars + ADC, live mode returns real verbatims mapped via embedding SSR; any failure
   degrades silently to sample (no 5xx, UI never blank).
4. No secrets or API keys in client code or the repo. Vertex uses ADC only.
5. HSBC theming applied; `DISCLAIMER` shown; British English; GBP/AER/APR/FSCS/Section 75 intact.
