#!/bin/bash
# Coves Frontend Deployment Script
# Usage: ./scripts/deploy.sh [--pull]
#
#   ./scripts/deploy.sh          # Build the current checkout and recreate the container
#   ./scripts/deploy.sh --pull   # Fast-forward main from git first, then deploy
#
# This project has exactly one service (`frontend`). It is a separate compose
# project from the backend (/opt/coves); it only shares the Docker network the
# backend owns, so the backend stack must already be running.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
SERVICE="frontend"
CONTAINER="coves-prod-frontend"
NETWORK="coves-prod-network"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

PULL_GIT=false
for arg in "$@"; do
    case $arg in
        --pull) PULL_GIT=true ;;
        *) error "Unknown argument: $arg (this project has a single service; usage: $0 [--pull])" ;;
    esac
done

cd "$PROJECT_DIR"

# ── Preconditions ───────────────────────────────────────────────────────────
[ -f ".env.prod" ] || error ".env.prod not found! Copy from .env.prod.example and configure (see docs/ENVIRONMENT.md)."

# The compose file declares the network as external; without it `up` fails
# with a less obvious message after a multi-minute build.
if ! docker network inspect "$NETWORK" > /dev/null 2>&1; then
    error "Docker network '$NETWORK' does not exist. Start the backend stack first: cd /opt/coves && docker compose -f docker-compose.prod.yml up -d --no-deps appview"
fi

# Every variable the app refuses to boot without (docs/ENVIRONMENT.md). Checked
# here so a typo fails in seconds instead of after the build, in a crash loop.
for required in ORIGIN PUBLIC_INSTANCE_URL ADDRESS_HEADER; do
    if ! grep -qE "^${required}=." .env.prod; then
        error "$required is not set in .env.prod"
    fi
done

if [ "$PULL_GIT" = true ]; then
    log "Pulling latest code from git (fast-forward only)..."
    git fetch origin
    git pull --ff-only origin main
fi

# Tag the image with the commit being deployed so `docker image ls` on the box
# says exactly what is running (compose defaults to :latest).
export VERSION="${VERSION:-$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo latest)}"
log "Frontend image tag: coves/frontend:$VERSION"

# ── Build + recreate ────────────────────────────────────────────────────────
log "Building $SERVICE (pnpm install + SvelteKit build inside Docker; a few minutes)..."
docker compose -f "$COMPOSE_FILE" build "$SERVICE"

log "Recreating $SERVICE..."
# --no-deps out of habit and consistency with the backend script: this project
# has no dependencies, but the flag is what keeps a compose deploy scoped to
# the named container.
docker compose -f "$COMPOSE_FILE" up -d --no-deps "$SERVICE"

# ── Verify ──────────────────────────────────────────────────────────────────
# The image HEALTHCHECK probes /healthz every 30s with a 15s start period, so
# "healthy" can take ~45s. Poll docker's own verdict rather than a fixed sleep.
log "Waiting for $CONTAINER to report healthy..."
healthy=false
for i in $(seq 1 60); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
    if [ "$status" = "healthy" ]; then healthy=true; break; fi
    if [ "$status" = "missing" ]; then error "Container $CONTAINER not found after up -d"; fi
    sleep 2
done
if [ "$healthy" = true ]; then
    log "✅ $CONTAINER is healthy (/healthz)"
else
    warn "⚠️  $CONTAINER did not become healthy in 120s — check: docker logs $CONTAINER"
fi

# Confirm exactly one frontend container exists — a compose project started
# from the wrong directory would fork a duplicate on the same network.
count="$(docker ps -a --filter "name=^${CONTAINER}$" --format '{{.Names}}' | wc -l | tr -d ' ')"
if [ "$count" != "1" ]; then
    warn "⚠️  Expected exactly one $CONTAINER container, found $count"
fi

# End-to-end through the edge. The app-owned CSP carrying a per-request nonce
# is the launch gate from docs/ENVIRONMENT.md: if it is missing, Caddy is
# either not routing to this container or is overriding its headers.
ORIGIN_URL="$(grep -E '^ORIGIN=' .env.prod | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -n "$ORIGIN_URL" ]; then
    log "Checking $ORIGIN_URL through the reverse proxy..."
    headers="$(curl -sS -I -m 10 -H 'Accept: text/html' "$ORIGIN_URL/" 2>/dev/null || true)"
    if echo "$headers" | grep -qi "^content-security-policy:.*'nonce-"; then
        log "✅ App CSP with nonce is served at $ORIGIN_URL/ (Caddy → frontend wiring OK)"
    else
        warn "⚠️  No nonce'd Content-Security-Policy at $ORIGIN_URL/ — Caddy may not be routing to $CONTAINER yet (see .claude/commands/deploy.md, Caddy section)"
    fi
fi

log "Deployment complete!"
log ""
log "Useful commands:"
log "  View logs:     docker compose -f docker-compose.prod.yml logs -f frontend"
log "  Check status:  docker compose -f docker-compose.prod.yml ps"
log "  Rollback:      git checkout <previous-sha> && ./scripts/deploy.sh"
