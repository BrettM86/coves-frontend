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

- `PUBLIC_INSTANCE_URL` `string`: The domain which the browser will send API requests to.
- `PUBLIC_SSR_ENABLED` `boolean`: Enable server-side rendering for SEO and non-JS usage.
  **Leave unset in production for now.** Enabling SSR activates two known issues:
  a cross-request locale race in `src/routes/+layout.server.ts` (translations load
  into shared module state, so concurrent requests can render each other's
  language), and logged-in users receive guest-rendered HTML with a client-side
  flicker on hydration. Fix both before turning this on.
- `PUBLIC_INTERNAL_INSTANCE` `string`: Internal backend URL used by server-side code — auth validation in `hooks.server.ts` and the `/api/proxy` upstream — regardless of SSR (e.g. `http://appview:8080` on a Docker network). Falls back to `PUBLIC_INSTANCE_URL`.
- `PUBLIC_THEME` `JSON`: A default theme for users, exported from the theme settings.

## License

AGPL-3.0-only
