# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT-MAP.md` at the repo root: it points at the relevant `CONTEXT.md` files. Read each one relevant to the topic.
- `docs/adr/`: read system-wide ADRs that touch the area being explored.
- Context-specific `docs/adr/` directories alongside each context's `CONTEXT.md`: read decisions specific to that context.

If any of these files don't exist, proceed silently. The `/domain-modeling` skill creates them lazily when terms or decisions are resolved.

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in the relevant `CONTEXT.md`. If the concept is not defined, note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding.
