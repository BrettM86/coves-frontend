# Base image pinned by digest (multi-arch index — covers linux/amd64 + linux/arm64).
# Dependabot (.github/dependabot.yml) bumps it; to bump manually:
#   docker buildx imagetools inspect node:22-alpine   # copy the top-level Digest
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

# Build stage — installs with the committed pnpm lockfile for reproducible builds
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN npm install -g pnpm@10.28.2
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN ADAPTER=node pnpm run build
# Drop devDependencies so the runtime image only ships production deps
RUN pnpm prune --prod

# Runtime stage
#
# Runtime environment (ORIGIN, PUBLIC_INSTANCE_URL, PUBLIC_INTERNAL_INSTANCE,
# ALLOW_HTTP_INTERNAL_INSTANCE, ...) is documented in docs/ENVIRONMENT.md.
FROM ${NODE_IMAGE} AS node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "build/index.js"]
