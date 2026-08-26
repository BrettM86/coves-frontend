# Kelp

Kelp is the web frontend for [Coves](https://coves.social), a forum-like social platform built on the AT Protocol.

Originally forked from [Photon](https://github.com/Xyphyn/photon) by Xylight (AGPL-3.0).

## Development

```bash
pnpm install
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm check        # TypeScript + Svelte type checking
pnpm lint         # ESLint
pnpm test         # Vitest
```

## Configuration

Every environment variable, its default and who reads it is documented in
[docs/ENVIRONMENT.md](../docs/ENVIRONMENT.md). The two you must set are
`PUBLIC_INSTANCE_URL` (the backend the browser talks to) and, behind a proxy,
`ORIGIN`. `.env.example` is a production-shaped starting point.

## License

AGPL-3.0-only
