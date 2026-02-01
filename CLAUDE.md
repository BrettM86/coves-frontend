**Project**: Coves Frontend (Kelp) - A fork of Photon, building the web frontend for Coves, a forum-like atproto social media platform.

**Related Projects**:
- Backend: `/home/bretton/Code/Coves`
- Mobile: `/home/bretton/Code/coves-mobile`

## Tech Stack
**Framework**: SvelteKit 2 + Svelte 5 (runes)
**Styling**: Tailwind CSS 4
**Language**: TypeScript (strict mode)
**Build**: Vite
**Testing**: Vitest

## Builder Mindset
- Ship working features today, refactor tomorrow
- Security is built-in, not bolted-on
- TDD for stores, utilities, load functions, form actions, and any pure logic
- ASK QUESTIONS about requirements - DON'T ASSUME
- Follow YAGNI, DRY, KISS principles

## No Stubs, No Shortcuts
- **NEVER** use `unimplemented!()`, `todo!()`, or stub implementations
- **NEVER** leave placeholder code or incomplete implementations
- **NEVER** skip functionality because it seems complex
- Every function must be fully implemented and working
- Every feature must be complete before moving on

## Svelte 5 Requirements

**CRITICAL**: Always use the `svelte:svelte-file-editor` agent when creating or editing any `.svelte` file or `.svelte.ts`/`.svelte.js` module. This ensures Svelte 5 patterns are followed correctly.

### Runes (NOT Stores)
- Use `$state` for reactive state, NOT writable stores
- Use `$derived` for computed values, NOT `$:` reactive statements
- Use `$effect` for side effects, NOT `onMount` with reactive dependencies
- Use `$props` for component props, NOT `export let`
- Use `$bindable` for two-way binding props

### Component Patterns
- Prefer `{#snippet}` over slots for content projection
- Use `{@render}` to render snippets
- Event handlers use `onclick` not `on:click`
- Spread props with `{...restProps}` pattern

## TypeScript Guidelines

### Type Safety
- Prefer `unknown` over `any` - safer handling of dynamic types
- Use explicit return types on public functions
- Prefer interfaces over type aliases for object shapes
- Use `readonly` for immutable data structures
- Prefer `const` assertions for literal types
- Use discriminated unions over optional properties for state

### Code Quality
- Prefer `const` and `let` over `var`
- Use nullish coalescing (`??`) over logical OR for defaults
- Use optional chaining (`?.`) for nested property access
- Prefer `map`/`filter`/`reduce` over manual loops
- Use template literals over string concatenation

### Avoid
- Don't use `@ts-ignore` - fix the type instead
- Don't use non-null assertions (`!`) without validation
- Don't use `Function` type - specify signature instead
- Don't leave unused variables - remove or prefix with `_`

## Tailwind CSS Guidelines

### Organization
- Define design tokens in `tailwind.config.js` for consistency
- Use `@apply` sparingly - prefer utility classes in templates
- Use `@layer` directives for custom base/component styles
- Keep class strings readable - break long strings across lines

### Performance
- Ensure content paths in config are correct for purging
- Prefer built-in utilities over arbitrary values `[]`
- Use container queries for component-level responsiveness

### Avoid
- Don't duplicate giant class strings - extract to components
- Don't use arbitrary values for design-token-able properties
- Don't forget accessibility - Tailwind doesn't handle `alt`, `aria-*`
- Don't mix inline styles with Tailwind classes

## Commands
```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm check        # TypeScript + Svelte type checking
pnpm lint         # ESLint
pnpm format       # Prettier
pnpm test         # Vitest
```

## Pre-Commit Checklist
1. `pnpm check` passes without errors
2. `pnpm lint` passes without warnings
3. No `any` types without justification
4. Svelte 5 runes used (no legacy stores/reactive statements)
5. Components use proper TypeScript typing

## Project Structure
```
src/
├── lib/
│   ├── api/        # API clients (Lemmy, PieFed)
│   ├── feature/    # Feature modules (post, comment, community, etc.)
│   ├── ui/         # UI components
│   │   └── shared/ # mono-svelte component library
│   └── settings/   # App settings and theme
├── routes/         # SvelteKit routes
└── app.html        # HTML template
```

## Success Metrics
Your code is ready when:
- [ ] `pnpm check` passes
- [ ] `pnpm lint` passes
- [ ] Uses Svelte 5 runes correctly
- [ ] TypeScript strict mode satisfied
- [ ] No accessibility regressions

Remember: We're building a working product. Perfect is the enemy of shipped, but the ultimate goal is **production-quality frontend code, not a prototype.**

Every line of code should be something you'd be proud to ship in a production system. Quality over speed. Completeness over convenience.
