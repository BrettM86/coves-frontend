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

## Testing

`pnpm run ci` is the merge gate: lint, type check, unit tests, a Node build,
and the SSR tier (`pnpm test:ssr`). It needs no backend or Docker.

`pnpm test:oauth` is a manual pre-merge tier that is not part of `pnpm run ci`.
It drives a real Firefox login against the local PDS/PLC stack, so start the
backend's local infrastructure and `make run-web` first (see
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)). Set `OAUTH_TEST_ACCOUNT_FILE` to a
private JSON file, kept outside the repo, containing the `handle`, `password`,
and `did` of a disposable account on that local PDS. `OAUTH_WEB_BASE_URL`
overrides the default browser origin of `http://127.0.0.1:8080`.

Built with [SvelteKit](https://svelte.dev/docs/kit), Svelte 5, and Tailwind CSS.

Configuration (environment variables) is documented in
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## License

[AGPL-3.0-only](LICENSE), same as the upstream Photon project. Attribution and
modification details are in [NOTICE](NOTICE). The app exposes source and licence
links at `/legal`, and the complete licence at `/license`.
