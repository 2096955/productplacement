# ============================================================
# HSBC SSR Concept Lab — multi-stage production image.
#
# Stage 1 (web-build):    build the Vite/React frontend  -> web/dist
# Stage 2 (server-build): build the Express/TS backend   -> server/dist
#                         (and prune to production node_modules)
# Stage 3 (runtime):      node:20-slim with only the built
#                         artefacts + server prod deps + web/dist.
#
# Resulting layout in the container (matches server/src/index.ts
# WEB_DIST default and the BUILD_SPEC):
#   /app/server/dist/index.js
#   /app/server/node_modules
#   /app/web/dist/index.html
# ============================================================

# Base image pinned by multi-arch index digest for reproducible, scannable builds.
# To update: `docker buildx imagetools inspect node:20-slim --format '{{.Manifest.Digest}}'`
# then replace the sha256 on all three stages.
# ---------- Stage 1: build the frontend ----------
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS web-build
WORKDIR /app/web

# Install deps with a reproducible, cache-friendly layer.
COPY web/package.json web/package-lock.json ./
RUN npm ci

# Build the SPA -> /app/web/dist
COPY web/ ./
RUN npm run build

# ---------- Stage 2: build the backend ----------
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS server-build
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci

# Compile TypeScript -> /app/server/dist
COPY server/ ./
RUN npm run build

# Drop dev dependencies so only production deps are carried forward.
RUN npm prune --omit=dev

# ---------- Stage 3: runtime ----------
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web/dist

WORKDIR /app

# Copy compiled backend, its production node_modules, and the built frontend.
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/package.json ./server/package.json
COPY --from=web-build /app/web/dist ./web/dist

# Run as the unprivileged "node" user shipped with the base image.
RUN chown -R node:node /app
USER node

EXPOSE 8080

# Cloud Run / docker run honour ENV PORT; the server listens on 0.0.0.0:$PORT.
CMD ["node", "server/dist/index.js"]
