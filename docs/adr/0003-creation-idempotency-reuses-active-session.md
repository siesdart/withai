# Creation Idempotency reuses the active Game Session

A Creation Idempotency Key is atomically bound to the Game Session returned by its first successful request, including a pre-existing active session. For 24 hours from first use, the same key and request therefore return that same session's latest projection without consuming additional Guest Play Allowance; a request with the same key and a different payload conflicts. This favors stable game identity over replaying an obsolete byte-for-byte HTTP response.
