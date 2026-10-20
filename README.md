# Coves Frontend

Web frontend for [Coves](https://github.com/BrettM86/coves), a forum-style social platform built on [atProto](https://atproto.com/).

Based on [Photon](https://github.com/Xyphyn/photon) by [Xyphyn](https://github.com/Xyphyn) — a Svelte-based Lemmy client — adapted for the Coves AppView and atProto identity.

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev          # start dev server
pnpm check        # TypeScript + Svelte type checking
pnpm lint         # ESLint
pnpm test         # Vitest
pnpm build        # production build (ADAPTER=node for the Docker image)
```

## Testing

`pnpm run ci` is the merge gate: lint, type check, unit tests, a Node build,
and the SSR tier (`pnpm test:ssr`). It needs no backend or Docker.

The seeded QA entry restores once, fetches the current private manifest and Mari
account, validates the pair, then runs the existing real Firefox `pnpm test:oauth`
tier. Run it from the reviewed QA frontend checkout after verifying the designated
remote DEVELOPMENT stack, local PDS/PLC, saved AppView WEB mode and proxy/Vite
checkout alignment ([setup](docs/ENVIRONMENT.md), [eight-section runbook](docs/QA_LOOP.md)):

```sh
QA_BACKEND_HOST=<dev-host-ssh-alias> \
QA_BACKEND_CHECKOUT='<absolute backend checkout>' \
PDS_URL=http://localhost:3001 \
node scripts/qa-run.mjs
```

Fill in the SSH alias and absolute checkout of the dev backend host. Both backend settings and
`PDS_URL` are required; `OAUTH_WEB_BASE_URL` defaults to
`http://127.0.0.1:8080`. Both origins must be local HTTP origins. The runner resolves
its frontend root from its own location, regardless of the caller's directory.
It writes ignored `.dev-seed/manifest.json` and `.dev-seed/oauth-test-account.json`
(owner-only directory/files, atomic replacement). The account has
`{handle,password,did}` and must match `manifest.accounts.mari`; never put these
contents in documentation or logs. Failed restore/fetch/validation stops before
OAuth; a child failure returns its actual status with private output withheld.
Old files left after a failed refresh are not success evidence.

`pnpm test:oauth` remains the direct real browser tier and is outside
`pnpm run ci`. It does not restore state itself. Actual local OAuth and all eight
QA sections require real infrastructure; a host unit gate does not supply those
results. The next QA invocation restores the baseline again.

Built with [SvelteKit](https://svelte.dev/docs/kit), Svelte 5, and Tailwind CSS.

Configuration (environment variables) is documented in
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## License

[AGPL-3.0-only](LICENSE), same as the upstream Photon project. Attribution and
modification details are in [NOTICE](NOTICE). The app exposes source and licence
links at `/legal`, and the complete licence at `/license`.
