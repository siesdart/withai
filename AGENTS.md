# WithAI

## TypeScript: ALWAYS read docs before coding

- Before any TypeScript work, find and read the relevant doc in `/typescript-functional-patterns`.

## React: ALWAYS read docs before coding

- Before any React work, find and read the relevant doc in `/react-best-practices` and `/react-view-logic-boundaries`.
- Use `/design-taste-frontend` and `/gpt-taste` as the only sources of design rules.

## shadcn/ui: ALWAYS read docs before coding

- Before any shadcn/ui work, find and read the relevant doc in `/shadcn`.
- Before working on the UI, check if there are appropriate components in shadcn/ui, and if so, install and use those components first.
- When installing new shadcn/ui components, do so to the `ui` package.

## Zustand

- Always use Zustand when writing state management code.

## Tanstack Query: ALWAYS read docs before coding

- Always use TanStack Query when writing server-state code.
- Before any Tanstack Query work, find and read the relevant doc in `/router-query`.

## Linting and formatting

- After making code changes, run `npx oxlint --fix`, then run `npx oxfmt`.
- Before finishing, run `npx oxlint --deny-warnings --format=agent`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `siesdart/withai`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a multi-context repository: use `CONTEXT-MAP.md` to locate relevant context glossaries, with system-wide and context-specific ADRs. See `docs/agents/domain.md`.
