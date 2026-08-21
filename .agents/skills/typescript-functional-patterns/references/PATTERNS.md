# Canonical patterns

These examples are decision aids, not templates to copy mechanically. Adapt
imports and exact APIs to the installed versions and repository style.

## Remeda: pipeline as a shape narrative

```ts
import { filter, map, pipe, sortBy } from "remeda";

const visibleNames = pipe(
  users,
  filter((user) => user.active),
  map((user) => ({ id: user.id, name: user.name.trim() })),
  sortBy([(user) => user.name, "asc"]),
);
```

The useful property is not fewer characters. Each stage states the new shape and
the pipeline makes ordering visible. Use a named function for a domain stage:

```ts
const toVisibleUser = (user: User): VisibleUser => ({
  id: user.id,
  name: user.name.trim(),
});

const visibleUsers = pipe(users, filter(isActive), map(toVisibleUser));
```

When the operation is one step, data-first form is often clearer:

```ts
const activeCount = countBy(users, (user) => user.active);
```

The exact operator signature varies by Remeda version; use the installed
version's type checker and documentation rather than forcing a remembered
signature.

## neverthrow: errors as a typed protocol

```ts
type LoadUserError =
  | { type: "invalid-id"; id: string }
  | { type: "not-found"; id: string }
  | { type: "unavailable"; cause: unknown };

const loadUser = (id: string): ResultAsync<User, LoadUserError> =>
  validateId(id)
    .andThen((validId) => fetchUser(validId))
    .mapErr((error): LoadUserError => translateUserError(id, error));
```

`map` changes a successful value without changing the failure vocabulary;
`andThen` sequences a second fallible operation; `mapErr` translates an error
without pretending the operation succeeded. At the boundary:

```ts
return loadUser(id).match(
  (user) => respondOk(user),
  (error) => match(error)
    .with({ type: "invalid-id" }, () => respondBadRequest())
    .with({ type: "not-found" }, () => respondNotFound())
    .with({ type: "unavailable" }, () => respondUnavailable())
    .exhaustive(),
);
```

This pairing gives the error protocol and the response decision different jobs:
neverthrow preserves the fact of failure; ts-pattern decides what each known
failure means here.

## ts-pattern: closed decisions, not conditional decoration

```ts
import { match, P } from "ts-pattern";

type CheckoutState =
  | { type: "idle" }
  | { type: "submitting" }
  | { type: "failed"; message: string }
  | { type: "completed"; orderId: string };

const label = (state: CheckoutState) =>
  match(state)
    .returnType<string>()
    .with({ type: "idle" }, () => "Ready")
    .with({ type: "submitting" }, () => "Submitting…")
    .with({ type: "failed", message: P.select() }, (message) => message)
    .with({ type: "completed", orderId: P.select() }, (orderId) => `Order ${orderId}`)
    .exhaustive();
```

The union is the source of truth. Avoid a broad `otherwise` when the product
needs a distinct behavior for every state; it turns future additions into a
runtime surprise instead of a compile-time task.

## Composition heuristic

```text
external input
    ↓ validate/parse → Result<T, E>
    ↓ map           → transformed T
    ↓ andThen       → ResultAsync<U, E | E2>
    ↓ match         → finite domain decision with ts-pattern
    ↓ effect        → response/log/persist
```

Keep the arrows as named functions when a stage has a domain name or a separate
test surface. The diagram is a heuristic: a read-only pure transformation does
not need a Result, and a closed decision may happen before an async operation.
