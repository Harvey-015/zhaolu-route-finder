FROM node:24-bookworm-slim AS build

RUN npm install --global pnpm@11.9.0
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build \
  && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    ZHAOLU_DATABASE_PATH=/app/data/zhaolu.sqlite \
    ZHAOLU_BACKUP_DIRECTORY=/app/backups \
    ZHAOLU_STATIC_ROOT=/app/web-dist

WORKDIR /app
RUN mkdir -p /app/data /app/backups \
  && chown node:node /app/data /app/backups

COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/web-dist ./web-dist
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package.json ./package.json

USER node
EXPOSE 8787
VOLUME ["/app/data", "/app/backups"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/v1/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "dist/runtime/main.js"]
