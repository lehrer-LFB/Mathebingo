# Mathebingo – Typ B (statische App mit kleinem Node-Dienst), siehe ARCHITEKTUR.md im Portal-Repo.
# Gebaut auf dem Mac (arm64), übertragen per docker save | ssh docker load. Keine DB, daher keine tools-Stufe.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Letzte Stufe: run
FROM node:24-alpine AS run
ENV NODE_ENV=production \
    PORT=3000 \
    BASE_PATH=/mathebingo
WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY package.json index.html ./
COPY server ./server
COPY css ./css
COPY js ./js
COPY vendor ./vendor
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH}/health" >/dev/null || exit 1
CMD ["node", "server/index.mjs"]
