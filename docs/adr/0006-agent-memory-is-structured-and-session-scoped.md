# Agent Memory is structured and session-scoped

Agents retain a durable, structured Agent Memory throughout an in-progress Game Session so their decisions can remain coherent across authorized Personal Snapshots. We deliberately do not retain raw model reasoning or prompts, and delete this memory when the Game Session completes or is abandoned; this preserves in-session continuity without making opaque provider reasoning replayable or durable user data.
