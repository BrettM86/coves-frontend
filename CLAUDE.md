# Coves frontend (Kelp)

SvelteKit web client for Coves, forked from Photon for its UI and data models. Coves-only: no Lemmy or PiFed compatibility is kept. Global working rules are in `~/.claude/CLAUDE.md`; this file is project facts only.

Backend: `~/Code/coves`. Mobile: `~/Code/coves-mobile`.

## Stack

SvelteKit 2, Svelte 5 runes, TypeScript strict, Tailwind CSS 4, Vite, Vitest. Package manager is pnpm.

```bash
pnpm dev      # Vite dev server
pnpm check    # svelte-check, error threshold
pnpm lint     # ESLint, zero warnings allowed
pnpm test     # Vitest
pnpm format   # Prettier
```

`pnpm check` and `pnpm lint` must pass before a commit. TDD stores, utilities, load functions, form actions, and other pure logic.

## Svelte 5, not Svelte 4

- `$state`, `$derived`, `$effect`, `$props`, `$bindable`. No writable stores for component state, no `$:` statements, no `export let`.
- `{#snippet}` and `{@render}` instead of slots. `onclick`, not `on:click`.
- Design tokens live in the `@theme` block of `src/app.css`. There is no `tailwind.config.js`.
- No `@ts-ignore`, no unchecked non-null `!`. Fix the type.

## Layout

```
src/lib/
├── api/        # Coves API client, sort/image-proxy mappings (bottom layer)
├── app/
│   ├── state/  # auth, settings, instance, session, theme, i18n
│   └── util/   # pure helpers, one concern per file
│               # (util/log and util/request-event hold server-installed singletons)
├── ui/         # presentational components; may use app/ + api/, never feature/
│   └── kit/    # hard fork of mono-svelte; imports nothing from app/feature/api
├── feature/    # feature modules (post, comment, community, markdown, shell…)
├── server/     # server-only code
└── types/      # shared types, importable from every layer
```

Layering is enforced by `no-restricted-imports` in `eslint.config.js`: `routes → feature → ui → app → api`, with `ui/kit` as a leaf below `ui`. Kit components take app state via props and snippets, never by importing it. Import the kit as `$lib/ui/kit`; there is no `mono-svelte` alias.

## Browser testing (Playwright MCP)

- Use Firefox. Chrome is not installed.
- Dev runs at `http://localhost:8080` (Caddy) with the Go backend on `:8081` and Vite on `:5173`. Start it with `make run-web` in the backend repo.
