FROM node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4 AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM build AS test

COPY server ./server
COPY test/unit ./test/unit
RUN npm test

FROM node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4 AS runtime

ARG APP_VERSION=dev

LABEL org.opencontainers.image.title="Det-DashBoard" \
      org.opencontainers.image.description="Local visual dataset management dashboard" \
      org.opencontainers.image.version="${APP_VERSION}"

WORKDIR /app

# Python is the portable baseline for built-in workers. Larger CUDA/ML
# environments remain mounted, versioned assets rather than image-global state.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server ./server
COPY --from=test --chown=node:node /app/dist ./dist

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4177

EXPOSE 4177

USER node

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:4177/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/postgres-app.js"]
