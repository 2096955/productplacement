/* ============================================================
   index.ts — boot the HSBC SSR Concept Lab backend.

   - Create the Vertex client (if enabled + configured) and embed the
     anchors once at startup to determine SSR mode.
   - Mount /api routes.
   - Static-serve the built frontend (WEB_DIST, default sibling web/dist),
     with SPA fallback: any non-/api GET returns index.html.
   - Listen on 0.0.0.0:(PORT||8080) and log the active mode.

   With ZERO env vars set, the app runs in pure offline sample mode.
   ============================================================ */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { createApiRouter } from "./routes.js";
import { createVertexClient, VERTEX_CONFIG } from "./vertex.js";
import { initAnchors, ssrMode, SSR_CONFIG } from "./ssr.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";

// Process-level safety net. A stray rejection or throw on a best-effort
// background path (e.g. an aborted Vertex call settling late) must not take the
// demo down — log and keep serving, in keeping with the never-die contract.
// (Boot failures remain fatal via main().catch below; tighten uncaughtException
// to process.exit(1) if you prefer crash-and-restart over continue-serving.)
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[process] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[process] uncaughtException:", err);
});

/**
 * Resolve the static web dist directory.
 * Default: sibling web/dist relative to the compiled server output.
 *   compiled file: <root>/server/dist/index.js  ->  <root>/web/dist
 * Override with WEB_DIST (absolute path, e.g. /app/web/dist in the container).
 */
function resolveWebDist(): string {
  if (process.env.WEB_DIST && process.env.WEB_DIST.trim()) {
    return path.resolve(process.env.WEB_DIST.trim());
  }
  // dist/index.js -> dist -> server -> root -> web/dist
  return path.resolve(__dirname, "..", "..", "web", "dist");
}

async function main(): Promise<void> {
  // --- Vertex / SSR init (best effort; never fatal) ---
  const ai = createVertexClient();
  let vertexReady = false;
  if (ai) {
    vertexReady = await initAnchors(ai);
    if (!vertexReady) {
      // anchors failed: keep elicitation possible, but SSR is lexical.
      // (ssr.ts already logged the reason.)
    }
  }

  const app = express();
  app.disable("x-powered-by");
  // Cloud Run sits behind a proxy; trust it so the rate limiter sees real client IPs.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));

  // Throttle the billable, Vertex-backed endpoints on the public service.
  // A 429 is not a 5xx — the frontend treats it as a failed call and shows the
  // local offline sample, so the demo still never dies.
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.RATE_LIMIT_PER_MIN) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests — please slow down." },
  });
  app.use(["/api/panel", "/api/ssr", "/api/chat", "/api/ask"], apiLimiter);

  // Resilient body parsing: a malformed JSON body must not kill a demo run.
  // Treat a parse failure as an empty body and let the route apply its
  // defaults (so /api/panel still returns a valid sample PanelResponse).
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const isParseError =
      err instanceof SyntaxError &&
      "status" in (err as object) &&
      (err as { status?: number }).status === 400 &&
      "body" in (err as object);
    if (isParseError) {
      // eslint-disable-next-line no-console
      console.warn(`[body] ignoring malformed JSON body on ${req.method} ${req.path}`);
      (req as Request & { body: unknown }).body = {};
      return next();
    }
    return next(err);
  });

  // --- API ---
  app.use("/api", createApiRouter());

  // Unmatched /api request -> JSON 404 (keeps the API surface JSON-only instead
  // of falling through to the SPA fallback or Express's default HTML 404).
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // --- Static frontend + SPA fallback ---
  const webDist = resolveWebDist();
  const indexHtml = path.join(webDist, "index.html");
  const hasWeb = fs.existsSync(indexHtml);

  if (hasWeb) {
    app.use(express.static(webDist));
    // SPA fallback: any non-/api GET returns index.html. The negative lookahead
    // excludes both "/api/..." and the bare "/api" path.
    app.get(/^\/(?!api(?:\/|$)).*/, (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET") return next();
      res.sendFile(indexHtml);
    });
  } else {
    // No built frontend present (e.g. running server in isolation).
    app.get("/", (_req: Request, res: Response) => {
      res
        .status(200)
        .type("text/plain")
        .send(
          "HSBC SSR Concept Lab API is running. Frontend not found at " +
            webDist +
            " — build web/ or set WEB_DIST. API is under /api."
        );
    });
  }

  // Final safety net: anything that escapes a route or static handler lands here
  // rather than Express's default handler. JSON for the API surface, plain text
  // otherwise. NODE_ENV=production already suppresses stack traces in responses.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(`[error] ${req.method} ${req.path}:`, (err as Error)?.message ?? err);
    if (res.headersSent) return;
    if (req.path.startsWith("/api")) {
      res.status(500).json({ error: "Internal error" });
    } else {
      res.status(500).type("text/plain").send("Internal error");
    }
  });

  // --- Boot logging ---
  const mode = ai ? (vertexReady ? "LIVE (Vertex + embedding SSR)" : "LIVE (Vertex; lexical SSR)") : "SAMPLE (offline)";
  app.listen(PORT, HOST, () => {
    /* eslint-disable no-console */
    console.log("============================================================");
    console.log(" HSBC SSR Concept Lab — backend");
    console.log(`  listening   : http://${HOST}:${PORT}`);
    console.log(`  mode        : ${mode}`);
    console.log(`  vertex      : ${ai ? "client created" : "disabled / not configured"}`);
    if (ai) {
      console.log(`  project     : ${VERTEX_CONFIG.project}`);
      console.log(`  location    : ${VERTEX_CONFIG.location}`);
      console.log(`  geminiModel : ${VERTEX_CONFIG.geminiModel}`);
      console.log(`  embedModel  : ${SSR_CONFIG.embedModel}`);
      console.log(`  ssr         : ${ssrMode()} (T=${SSR_CONFIG.temperature})`);
    }
    console.log(`  webDist     : ${hasWeb ? webDist : "(none — API only)"}`);
    console.log("============================================================");
    /* eslint-enable no-console */
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[boot] fatal error:", err);
  process.exit(1);
});
