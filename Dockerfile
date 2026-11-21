# Stage 1: Build shared, server, and web workspaces
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/server/package.json apps/server/tsconfig.json apps/server/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/

RUN npm install

COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY apps/web/index.html apps/web/vite.config.ts apps/web/
COPY apps/web/public apps/web/public
COPY apps/web/src apps/web/src

RUN npm run build --workspace=@syncreel/shared \
 && npm run build --workspace=@syncreel/server \
 && npm run build --workspace=@syncreel/web

# Stage 2: Minimal production runtime
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

RUN npm install --omit=dev --workspace=@syncreel/shared --workspace=@syncreel/server --include-workspace-root

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/server/dist apps/server/dist
COPY --from=builder /app/apps/web/dist apps/web/dist

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
