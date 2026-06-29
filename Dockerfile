# syntax=docker/dockerfile:1
# ---- build the web client ----
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- install server deps (native better-sqlite3 needs a toolchain) ----
FROM node:22-slim AS server-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---- final runtime image (no build tools) ----
FROM node:22-slim
LABEL org.opencontainers.image.title="NoteBit" \
      org.opencontainers.image.description="A clean, self-hostable workspace for docs, boards, and team knowledge." \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8200 \
    WIKI_DB=/data/notebit.db
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
RUN mkdir -p /data
VOLUME /data
EXPOSE 8200
CMD ["node", "server.js"]
