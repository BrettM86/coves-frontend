# Coves Frontend

Web frontend for [Coves](https://github.com/BrettM86/coves), a forum-style social platform built on [atProto](https://atproto.com/).

Based on [Photon](https://github.com/Xyphyn/photon) by [Xyphyn](https://github.com/Xyphyn) — a Svelte-based Lemmy client — adapted for the Coves AppView and atProto identity.

## Development

```sh
pnpm install
pnpm dev          # start dev server
pnpm check        # TypeScript + Svelte type checking
pnpm lint         # ESLint
pnpm test         # Vitest
pnpm build        # production build (ADAPTER=node for the Docker image)
```

Built with [SvelteKit](https://svelte.dev/docs/kit), Svelte 5, and Tailwind CSS.

Configuration (environment variables) is documented in
[.github/README.md](.github/README.md); the production container's required
runtime env is documented in the [Dockerfile](Dockerfile).

## License

[AGPL-3.0](LICENSE), same as the upstream Photon project.
