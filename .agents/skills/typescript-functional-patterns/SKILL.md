---
name: typescript-functional-patterns
description: Apply Transform, Result, Match, and dependency-aware async effect patterns in TypeScript with Remeda, neverthrow, ts-pattern, and better-all; add each dependency only where code or a public type API uses it.
---

# TypeScript Functional Patterns

Write TypeScript around three complementary ideas: **transform**, **result**, and
**match**. Remeda makes data flow readable and inference-friendly; neverthrow
makes expected failure explicit in a function's type; ts-pattern makes finite
state and union decisions exhaustive. Use better-all as an optional effect-layer
tool when named asynchronous tasks form a dependency graph and independent work
should overlap. Use the idea that solves the local problem, then compose the
ideas at boundaries. The goal is a small, honest API surface—not
functional-looking syntax everywhere.

Read [PATTERNS.md](references/PATTERNS.md) when implementing or reviewing a
non-trivial pipeline, error boundary, or discriminated-union decision.

## Process

### 1. Establish and enforce the project baseline

Inspect `package.json`, lockfiles, TypeScript configuration, scripts, and nearby
code before editing. This skill establishes a project-wide behavioral baseline,
not a package-wide dependency baseline.

- Add `remeda`, `neverthrow`, `ts-pattern`, or `better-all` with the project's
  package manager only to a package whose source imports it or whose exported
  type declarations reference it. In a workspace, inspect each package
  independently and keep dependencies in the package that owns the import or
  public type.
- Remove a direct dependency after confirming that the package has no source or
  public declaration reference to it. Respect the existing package manager,
  lockfile, workspace layout, version policy, and dependency section; do not
  install a second copy or bypass the lockfile.
- Apply the style to new TypeScript code and migrate touched code toward it. Do
  not preserve an equivalent legacy utility/error/branching style merely because
  it predates this skill.
- Follow the project's module system, strictness, formatting, naming, runtime,
  and test conventions around this functional baseline.

Completion criterion: the project status, package ownership of every library
reference, relevant compiler settings, and validation commands are known; every
direct dependency has a source or public-type owner.

### 2. Name the problem before choosing the abstraction

Classify each meaningful piece of logic:

- **Transform**: normalize, select, filter, group, sort, aggregate, or project
  data. Use the corresponding Remeda function for every such collection or
  record transformation; use its data-first form for one operation and its
  data-last form inside a multi-operation `pipe`.
- **Result**: an operation can fail in a known, caller-relevant way. Return
  `Result<T, E>` or `ResultAsync<T, E>` and compose it instead of hiding the
  failure in `throw`, `null`, a sentinel, or an untyped rejected promise.
- **Match**: a finite union, state machine, protocol message, or nested tagged
  structure determines behavior. Prefer ts-pattern and finish with
  `.exhaustive()` when the type is intended to enumerate all cases.
- **Concurrency**: named asynchronous effects form a dependency graph and
  independent work should overlap. Use better-all's `all()` to express task
  dependencies through `this.$.taskName`; keep the task graph at the effect
  boundary and return a typed `ResultAsync` to the domain caller.
- **Effect**: I/O, mutation, logging, time, or framework integration. Keep it at
  the edge; make the transformation, result composition, and decision logic
  pure where practical.

The three functional libraries are project defaults; better-all is an optional
effect-layer tool, not a demand to wrap unrelated expressions in library calls.
A local omission is valid only when the corresponding construct does not exist.
Use better-all for a meaningful dependency graph, not for a simple independent
`Promise.all` that is already clear. When a Remeda equivalent exists, native
collection methods are not an omission: use Remeda instead. When omitting one in
a substantial TypeScript area, state the reason in the change summary or
code-level design note.

Completion criterion: every non-trivial branch or transformation has a named
reason for its chosen representation, and the core logic is separable from
effects.

### 3. Build transformations as typed data flow

Use Remeda's direct data-first call for exactly one operation:

```ts
const summary = pick(user, ["id", "name"]);
```

The **single-stage rule** is strict: do not write `pipe(value, fn(args))` when
`fn` is the only transformation. Use `pipe` only when there are at least two
data transformations to read from left to right:

```ts
const names = pipe(users, filter(isActive), map(toName));
```

The only local exceptions are when the function has no usable data-first form,
or when a unary function is deliberately being passed to another higher-order
API. In those cases, keep the exception local and make the reason apparent.

This applies to native collection methods as well. Replace equivalent calls
such as `items.filter(predicate)`, `items.map(transform)`, `items.reduce(step,
initial)`, `items.find(predicate)`, and `items.some(predicate)` with the
corresponding Remeda function, even when there is only one operation:

```ts
const activeUsers = filter(users, isActive);
const firstAdmin = find(users, isAdmin);
```

Do not use a native method merely because it is a single step or because it is
shorter. Keep native collection methods only when Remeda has no equivalent or
when a project/runtime constraint is recorded.

For multi-stage work, use Remeda to express a sequence as a left-to-right
pipeline:

- Start with the input and use data-last operators for subsequent stages.
- Keep each stage a named, total transformation when the stage has domain
  meaning; avoid callbacks that both transform and perform unrelated effects.
- Prefer one pipeline over temporary variables or nested array methods when it
  makes the intermediate shapes easier to follow.
- Use Remeda's lazy pipeline behavior for bounded or short-circuiting work such
  as `take`, `takeWhile`, or `first`; do not assume every pipeline is lazy or
  free of iteration costs.
- Use explicit type annotations at a boundary when inference would widen a
  domain type or conceal an accidental `unknown`; do not annotate every stage
  by reflex.

If a transformation can fail, keep the failure visible: parse/validate before
the successful pipeline, or make the stage return a `Result` and compose the
results instead of throwing from a Remeda callback. In a touched module, replace
the old collection transformation style with Remeda where the operation has a
corresponding Remeda primitive.

Completion criterion: the pipeline has a clear input-to-output story, no stage
silently swallows invalid data, and its complexity is lower than the equivalent
nested or mutation-heavy code. Every one-operation Remeda use is a direct
data-first call unless an explicit exception applies.

### 4. Model and compose recoverable failures

Use neverthrow at boundaries such as parsing, validation, filesystem/database
access, HTTP calls, and domain commands. Expected failure in a touched module
must be represented as `Result`/`ResultAsync`, even when the old code used
exceptions, nullable values, or an untyped rejected promise.

- Define an error union or discriminated error type that carries actionable
  context. Avoid `Result<T, Error>` when callers need to distinguish cases.
- Convert foreign failures at the boundary with `ResultAsync.fromPromise` or an
  equivalent constructor and map the caught value to the domain error type.
- Use `map` for a successful value transformation, `mapErr` for error
  normalization, and `andThen` for the next operation that can fail.
- Use `orElse` only for an intentional recovery or fallback; do not use it to
  erase an error that should be propagated.
- Handle a result at the application/effect boundary with `match`, or use
  `isOk`/`isErr` when control flow genuinely needs a local guard. Prefer a
  single terminal handling point over repeated unwrapping.
- Keep `ResultAsync` asynchronous until the boundary. Do not wrap a promise in
  several layers of `ResultAsync`, and do not mix `await`/`try`/`catch` with
  result composition without a clear foreign-effect boundary.
- Unwrap only when failure is impossible by construction and that invariant is
  local, checked, and worth enforcing. Otherwise return the result to the
  caller.

Use exceptions for programmer errors, violated invariants, cancellation or
failures that the surrounding framework explicitly models as exceptions. The
criterion is recoverability and ownership, not a blanket ban on `throw`.

Completion criterion: every expected failure has a typed owner, each error is
translated exactly once at the appropriate boundary, and callers can observe or
recover without inspecting exception strings.

### 5. Schedule dependent async effects

Use better-all's `all()` when several named async effects have dependencies and
the independent branches should run concurrently. A task reads another task's
result by awaiting `this.$.taskName`; better-all infers both the task result
types and the final result object.

- Define one task per meaningful external effect or effect-level composition
  step. Keep pure normalization and projection outside the task graph where
  possible.
- Express dependencies by awaiting `this.$.taskName` instead of manually
  staging `await` and `Promise.all` blocks. This makes the graph visible and
  lets the scheduler overlap independent branches.
- Pass `this.$signal` to cancellable operations such as `fetch` or database
  clients. A failed task aborts the shared signal; cleanup only happens when
  each operation honors that signal.
- Treat task rejection as a foreign effect failure. Wrap the `all()` promise in
  `ResultAsync.fromPromise` at the owning boundary and translate the rejection
  into the domain error union exactly once.
- Keep a simple `Promise.all` when there is no dependency graph and its
  concurrency policy is already obvious. Do not add better-all merely to make
  every async operation use the same library.

Completion criterion: the task graph names its dependencies, independent work
can overlap, cancellable effects receive the shared signal, and callers see a
typed result rather than an unowned rejected promise.

### 6. Make domain decisions exhaustive

Represent finite states and variants as discriminated unions with stable literal
tags. Use ts-pattern when a decision has multiple structural cases, nested
variants, guards, or more than one consumer:

- Match on the smallest domain value that owns the decision.
- Put more specific patterns before broad patterns because the first matching
  case wins.
- Use `P.select` or a handler parameter to extract values rather than repeating
  casts or property checks.
- Use `.returnType<T>()` when the output contract matters and inference alone
  is not sufficiently visible.
- Finish with `.exhaustive()` for closed unions. Use `.otherwise()` only when an
  actual domain default exists; do not use it to bypass a missing case.
- Use `when` for a predicate that is truly part of the branch condition, while
  keeping the predicate named and testable if it carries domain meaning.

For a single boolean or a trivial two-way check, an `if` may remain clearer, but
all finite domain unions in touched TypeScript code must use ts-pattern or have
an explicit design note explaining the incompatibility. The value of ts-pattern
is compile-time completeness and structural clarity, not decorative syntax.

Completion criterion: adding a new union variant would produce a useful compile
failure at every closed decision, and every branch returns the same intentional
output type.

### 7. Compose the layers at boundaries

Use this default flow when it fits the use case:

1. Convert an external input into a typed domain value, returning a `Result` on
   validation or parsing failure.
2. Transform valid collections and records with Remeda pipelines.
3. Schedule independent, dependency-aware effects with better-all at the effect
   boundary when the operation has a meaningful task graph.
4. Chain fallible operations with `map` and `andThen`; normalize errors with
   `mapErr` at ownership boundaries.
5. Use ts-pattern to turn the resulting state or domain union into a response,
   command, view model, or effect.
6. Terminally `match` the `Result` at the caller/effect boundary.

Do not force all six stages into one expression. Split at a meaningful domain
boundary when names, tests, or ownership become clearer.

Completion criterion: data transformations, fallible effects, domain decisions,
and terminal effects are visibly distinct, yet the call path remains easy to
trace from input to outcome.

## Review gate

Before declaring TypeScript work complete, check:

- Is the function's failure vocabulary visible in its return type?
- Are union decisions exhaustive where the domain is closed?
- Are collection transformations readable as data flow rather than callback
  nesting or mutation?
- Do all collection transformations use Remeda when an equivalent exists,
  including single-step `filter`/`map`/`find`/`reduce`/`some` calls?
- Does every one-operation Remeda transformation avoid a one-stage `pipe`?
- Are side effects at the edge and translated into domain-level results once?
- Did any helper exist only to satisfy a library style, or did it earn its
  interface through domain meaning, reuse, or a test seam?
- Do the project's formatter, type checker, linter, and focused tests pass?

If a library's current API or type behavior is uncertain, consult its official
documentation before inventing a workaround. Treat compiler feedback as part
of the design: fix widened unions, unhandled variants, and mixed error types at
their source rather than silencing them with casts.
