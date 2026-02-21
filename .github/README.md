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
- `PUBLIC_INTERNAL_INSTANCE` `string`: The domain the server uses for API requests (only relevant with SSR).
- `PUBLIC_THEME` `JSON`: A default theme for users, exported from the theme settings.

## License

AGPL-3.0-only
