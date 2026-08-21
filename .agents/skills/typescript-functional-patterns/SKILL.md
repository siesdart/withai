---
name: typescript-functional-patterns
description: Apply a coherent TypeScript style built around Remeda for data transformation, neverthrow for typed recoverable failures, and ts-pattern for exhaustive domain branching. Use automatically when creating, modifying, or reviewing TypeScript code; preserve existing project conventions and add these dependencies automatically only for genuinely new projects.
---

# TypeScript Functional Patterns

Write TypeScript around three complementary ideas: **transform**, **result**, and
**match**. Remeda makes data flow readable and inference-friendly; neverthrow
makes expected failure explicit in a function's type; ts-pattern makes finite
state and union decisions exhaustive. Use the idea that solves the local problem,
then compose the ideas at boundaries. The goal is a small, honest API surface—not
functional-looking syntax everywhere.

Read [PATTERNS.md](references/PATTERNS.md) when implementing or reviewing a
non-trivial pipeline, error boundary, or discriminated-union decision.

## Process

### 1. Establish the dependency and style context

Inspect `package.json`, lockfiles, TypeScript configuration, scripts, and nearby
code before editing.

- Treat a directory as a **new project** only when it has no established package
  manifest/lockfile and no existing application or library source to preserve.
- In a new project, add `remeda`, `neverthrow`, and `ts-pattern` using the
  project's package manager, then use them in the implementation.
- In an existing project, use an installed library when it is already present;
  preserve the project's equivalent conventions when it is absent. Report a
  possible dependency addition instead of silently changing the dependency
  graph.
- Follow the project's module system, strictness, formatting, naming, runtime,
  and test conventions. Never introduce a second functional style merely to
  force a library into one file.

Completion criterion: the project status, available dependencies, relevant
compiler settings, and validation commands are known, and the dependency policy
has been applied without guessing.

### 2. Name the problem before choosing the abstraction

Classify each meaningful piece of logic:

- **Transform**: normalize, select, filter, group, sort, aggregate, or project
  data. Prefer Remeda's data-last functions inside `pipe`; use data-first form
  for a short isolated operation.
- **Result**: an operation can fail in a known, caller-relevant way. Return
  `Result<T, E>` or `ResultAsync<T, E>` and compose it instead of hiding the
  failure in `throw`, `null`, a sentinel, or an untyped rejected promise.
- **Match**: a finite union, state machine, protocol message, or nested tagged
  structure determines behavior. Prefer ts-pattern and finish with
  `.exhaustive()` when the type is intended to enumerate all cases.
- **Effect**: I/O, mutation, logging, time, or framework integration. Keep it at
  the edge; make the transformation, result composition, and decision logic
  pure where practical.

Do not add a library call just to demonstrate the library. A plain expression is
better when it is clearer and has no meaningful pipeline, recoverable error, or
finite union to model.

Completion criterion: every non-trivial branch or transformation has a named
reason for its chosen representation, and the core logic is separable from
effects.

### 3. Build transformations as typed data flow

Use Remeda to express a sequence as a left-to-right pipeline:

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
results instead of throwing from a Remeda callback.

Completion criterion: the pipeline has a clear input-to-output story, no stage
silently swallows invalid data, and its complexity is lower than the equivalent
nested or mutation-heavy code.

### 4. Model and compose recoverable failures

Use neverthrow at boundaries such as parsing, validation, filesystem/database
access, HTTP calls, and domain commands where the caller can reasonably recover
or present an error.

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

### 5. Make domain decisions exhaustive

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

For a single boolean or a trivial two-way check, an `if` is often the clearer
choice. The value of ts-pattern is compile-time completeness and structural
clarity, not replacing every conditional.

Completion criterion: adding a new union variant would produce a useful compile
failure at every closed decision, and every branch returns the same intentional
output type.

### 6. Compose the three layers at boundaries

Use this default flow when it fits the use case:

1. Convert an external input into a typed domain value, returning a `Result` on
   validation or parsing failure.
2. Transform valid collections and records with Remeda pipelines.
3. Chain fallible operations with `map` and `andThen`; normalize errors with
   `mapErr` at ownership boundaries.
4. Use ts-pattern to turn the resulting state or domain union into a response,
   command, view model, or effect.
5. Terminally `match` the `Result` at the caller/effect boundary.

Do not force all five stages into one expression. Split at a meaningful domain
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
- Are side effects at the edge and translated into domain-level results once?
- Did any helper exist only to satisfy a library style, or did it earn its
  interface through domain meaning, reuse, or a test seam?
- Do the project's formatter, type checker, linter, and focused tests pass?

If a library's current API or type behavior is uncertain, consult its official
documentation before inventing a workaround. Treat compiler feedback as part
of the design: fix widened unions, unhandled variants, and mixed error types at
their source rather than silencing them with casts.
