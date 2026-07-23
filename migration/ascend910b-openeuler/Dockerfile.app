FROM node:22-bookworm-slim AS build

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

COPY server ./server
RUN npm install --no-save esbuild@0.25.10 bytenode@1.5.7 \
    && ./node_modules/.bin/esbuild server/postgres-app.js \
         --bundle \
         --platform=node \
         --target=node22 \
         --format=cjs \
         --external:sharp \
         --minify \
         --outfile=/build/server.bundle.cjs \
    && ./node_modules/.bin/bytenode --compile /build/server.bundle.cjs

FROM node:22-bookworm-slim AS runtime

ARG APP_VERSION=dev

LABEL org.opencontainers.image.title="Det Dashboard" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.description="Det Dashboard ARM64 packaged runtime"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund bytenode@1.5.7 sharp@0.35.2 \
    && npm cache clean --force

COPY --from=build --chown=node:node /build/dist /app/dist
COPY --from=build --chown=node:node /build/server.bundle.jsc /app/server/server.bundle.jsc
COPY --chown=node:node migration/ascend910b-openeuler/launcher.cjs /app/server/launcher.cjs

ENV NODE_ENV=production \
    APP_ROOT=/app \
    DIST_ROOT=/app/dist \
    HOST=0.0.0.0 \
    PORT=5173 \
    TRAINING_WORKER_ENABLED=false \
    INFERENCE_WORKER_ENABLED=false

EXPOSE 5173

USER node

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5173/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "/app/server/launcher.cjs"]
