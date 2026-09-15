# WithAI

## TypeScript: ALWAYS read docs before coding

- Before any TypeScript work, find and read the relevant doc in `/typescript-functional-patterns` and install and use those packages if necessary.
- Use `ky` package instead of native `fetch`.
- Use `dayjs` first when doing time-related work.

## React: ALWAYS read docs before coding

- Before any React work, find and read the relevant doc in `/vercel-react-best-practices`.
- Do not over-list hooks at the top of your components. Use the `/react-view-logic-boundaries` skill to separate them into custom hooks appropriately.
- Use `/design-taste-frontend` and `/gpt-taste` as the only sources of design rules.
- Since this application is primarily intended for mobile, prioritize a mobile-first approach when designing the UI.

## Tailwind CSS

- When using conditional statements inside className, always use the `cn` function from the `ui` package to place the common class first, followed by the conditional class.

## shadcn/ui: ALWAYS read docs before coding

- Before any shadcn/ui work, find and read the relevant doc in `/shadcn`.
- Before working on the UI, check if there are appropriate components in shadcn/ui, and if so, install and use those components first.
- When installing new shadcn/ui components, do so to the `ui` package.
- Avoid modifying the installed shadcn/ui component file itself. Prioritize overwriting it via props in the places where the component is used.

## Zustand

- Always use Zustand when writing state management code.

## Tanstack Router: ALWAYS read docs before coding

- Before any Tanstack Router work, find and read the relevant doc in `/router-core`, `/react-router`, and `/router-query`.

## Tanstack Query: ALWAYS read docs before coding

- Always use TanStack Query when writing server-state code.
- Before any Tanstack Query work, find and read the relevant doc in `/router-query`.

## Tanstack AI: ALWAYS read docs before coding

- Before any Tanstack AI work, find and read the relevant doc in `/ai-core`.

## Valibot: ALWAYS read docs before coding

- Before any Valibot work, find and read the relevant doc in `/valibot`.
- Always use Valibot instead of Zod.

## Gemini structured output

- Define Gemini response schemas with its supported OpenAPI subset only: use object fields, `enum` values via `v.picklist`, arrays, scalar constraints, and `anyOf` where needed.
- `v.literal` and `v.variant` serialize to `const` and `oneOf`; model discriminator values with `v.picklist` and restore conditional requirements after response validation.
- Keep provider-facing schemas flat when a conditional field is needed; instruct the model to return neutral values for inactive fields, then normalize them in application code.

## Nest.js

- When creating or changing API endpoints, reflect them in the Scalar API Reference.

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
