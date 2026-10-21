FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HUAWEN_ZHIXING_RUNTIME=node \
    DATABASE_URL=file:/data/huawen-zhixing.db \
    UPLOAD_DIR=/data/uploads
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist/client ./dist/client
COPY --from=builder /app/dist/node/index.mjs ./dist/node/index.mjs
COPY package.json ./
COPY scripts/start-docker.mjs scripts/check-docker-health.mjs ./scripts/
RUN mkdir -p /data/uploads
USER root
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "scripts/check-docker-health.mjs"]
CMD ["node", "scripts/start-docker.mjs"]
