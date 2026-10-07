# App de Estudio TFG (server Fastify + web estática). El worker LaTeX va aparte (worker/).
# docker compose --profile app up -d --build

# --- web: Vite → web/dist ---
FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- server: dependencias (tsx está en dependencies; se ejecuta TS directamente) ---
FROM node:24-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- final ---
FROM node:24-slim
# git: necesario para «Crear memoria desde la plantilla» (repo propio de la memoria)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && git config --system --add safe.directory '*' \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787
WORKDIR /app
COPY --from=server-deps /app/server/node_modules server/node_modules
COPY server/package.json server/tsconfig.json server/
COPY server/src server/src
COPY scripts scripts
COPY templates templates
COPY --from=web /app/web/dist web/dist
RUN mkdir -p /data/notes /data/memoria /data/app/builds && chown -R node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/status').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
WORKDIR /app/server
CMD ["node_modules/.bin/tsx", "src/index.ts"]
