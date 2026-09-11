# Game Sessions API tests

This folder is the test module for API-owned Game Session behavior. Put a suite in the seam it exercises:

- `http/` — Nest HTTP and SSE entry points.
- `application/` — API orchestration, lifecycle, and session commands.
- `agents/` — Agent decisions and scheduled Agent Action orchestration.
- `durability/` — Redis authority, snapshot, recovery, and CAS behavior.

Keep Jest configuration and commands in `apps/api`. Mafia rules belong beside the Mafia Game Module in `packages/mafia/src` and run with that package's Vitest command.
