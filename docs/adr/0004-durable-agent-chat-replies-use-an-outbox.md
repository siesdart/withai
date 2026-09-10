# Durable Agent Chat Replies use an Outbox

An Agent's reactive chat reply is first recorded as a Scheduled Agent Action with its decided message payload in the authoritative Game Session snapshot. The Human Player's chat event and the pending reply are committed together. Applying the reply removes that pending action in the same compare-and-set write that appends the Agent's public event.

The Human Player's already-committed chat request remains successful if a reply cannot be applied. Recovery attempts the pending reply immediately, retries it with bounded exponential backoff after a durability failure, and restores the retry on active-session recovery; read requests do not consume pending work. This chooses an outbox in the session snapshot over propagating a misleading request failure or regenerating replies after recovery. It preserves the decided Agent utterance and lets competing replicas safely converge through snapshot CAS.
