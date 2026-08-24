---
name: react-view-logic-boundaries
description: Apply React View–Logic separation when creating, modifying, or refactoring components with multiple state variables, event handlers, Effects, async flows, or UI policy. Extract cohesive custom Hooks around meaningful use cases while preserving state ownership, minimal contracts, and readable JSX; do not split merely to reduce Hook count or create generic lifecycle wrappers.
---

# React View–Logic Boundaries

Treat View–Logic separation as a boundary design problem, not a file-count or
Hook-count exercise. The View should make the rendered structure and user
intent easy to read. A custom Hook should own a meaningful stateful use case,
state transition, or external-system lifecycle behind a small contract.

Read the project's existing conventions before choosing filenames, folders,
data-fetching patterns, or test commands. Preserve established library and
server/client boundaries.

## 1. Establish the component's change axes

Inspect the component, its props, context, state, Effects, event handlers,
derived values, async operations, tests, stories, and nearby components. Record
the following before extracting anything:

- Which values are inputs, local state, shared state, or derived data?
- Which transitions are user-intent or domain-policy decisions?
- Which Effects synchronize with a network, browser API, subscription, timer,
  DOM node, or other non-React system?
- Which logic is pure calculation, validation, or transformation?
- Which changes are visual-only, behavior-only, data-only, or cross-cutting?

Use the **ownership test**: each state value has one owner that can maintain its
invariant for all consumers. Lift shared state to the nearest common owner;
extracting the same Hook in multiple places does not share state.

Use the **change-axis test**: a boundary earns its cost when the logic inside it
changes for reasons that travel together and the logic outside it usually does
not. A long component is not automatically a problem, and a short component is
not automatically a good boundary.

Completion criterion: every non-trivial state value, Effect, event path, and
derived value has a stated owner and purpose, and the likely change axes are
known.

## 2. Remove false complexity before extracting

Keep pure work as ordinary functions. Extract sorting, filtering, mapping,
validation, normalization, and domain calculations into named functions when
that improves their independent testability or explains a domain concept. A
function that does not call Hooks should remain an ordinary function; reserve
the `use` prefix for functions that call Hooks or intentionally form a Hook
contract.

Re-check every Effect. Effects synchronize with external systems. Put render
derivations in render, event-specific work in event handlers, and state
coordination in state transitions. Keep Effects separate when they synchronize
different external systems or have different lifecycles.

Avoid redundant or contradictory state before designing a Hook. Prefer one
source of truth and derive values during rendering when possible.

Completion criterion: no proposed Hook exists only to hide a pure calculation,
unnecessary Effect, duplicated state, or a one-line primitive Hook wrapper.

## 3. Choose the Hook boundary

Extract a custom Hook when at least one of these is true and the resulting name
describes a concrete responsibility:

1. Several state values and transitions form one user or domain use case.
2. An external system has a distinct connection, subscription, cleanup, or
   synchronization lifecycle.
3. Repeated stateful logic appears in multiple components with the same meaning
   and contract.
4. The component is dominated by orchestration rather than rendering, and the
   orchestration can be expressed through a stable input/output contract.
5. The extracted seam creates a meaningful independent test or story setup.

Use a **feature/use-case boundary** by default. Names such as
`useCheckoutForm`, `useOrderSubmission`, `useChatRoom`, and
`useIntersectionObserver` communicate intent. Prefer these to technical names
such as `useComponentLogic` or `useEffectOnce`. A screen-level
`useXxxViewModel` is acceptable only when it genuinely coordinates the whole
screen and its contract remains small.

Do not extract merely because a component has many Hook calls. Do not combine
unrelated Effects or state machines into a "general" Hook. Do not create
`useMount`, `useEffectOnce`, or similar lifecycle aliases. A broad options bag
or a Hook with many escape hatches is evidence that the boundary is not yet
cohesive.

Completion criterion: the proposed Hook has one concrete nameable purpose,
one ownership story, and a contract that hides meaningful policy without
hiding the direction of data flow.

## 4. Design the Hook contract

The Hook receives reactive values and policy owned by its caller, and returns
the smallest contract the View needs:

1. Values the View renders.
2. Derived display state that is expensive, stateful, or policy-bearing enough
   to have a named owner.
3. Intent-oriented handlers such as `selectItem`, `submitForm`, `retry`, or
   `closeDialog`.
4. Raw setters only when the component is intentionally controlled or the
   setter is part of an explicit low-level contract.

Prefer explicit parameters or a narrowly scoped options object. Keep the input
and output directions visible at the call site. Do not return internal state,
dispatch details, mutable refs, or library-specific machinery unless the View
actually owns that contract.

Keep state transitions and their invariants together. Keep an external-system
Effect in the Hook that owns its lifecycle. Split a Hook again only when a
sub-unit has an independent lifecycle, invariant, concrete use case, or
meaningful independent test boundary. Hook size or primitive Hook count alone
is not a split signal.

Completion criterion: the View can render and wire events from the returned
contract without knowing the Hook's internal state shape, Effect dependencies,
or library implementation.

## 5. Place files and handle reuse

Use the smallest location that improves discovery and cohesion:

- Keep a small View and its local Hook together when the separation would add
  navigation cost without adding a useful seam.
- Split into `Component.tsx` and a responsibility-named `useXxx.ts` when the
  View is obscured by meaningful orchestration or the Hook has an independent
  test boundary.
- Keep feature policy local to the feature. Promote a Hook to shared scope only
  when multiple consumers have the same semantics, contract, and change reason.
- If consumers only share mechanics but differ in policy, keep separate local
  Hooks or extract a lower-level primitive with an honest, narrow contract.

Do not wrap a library Hook automatically. Use React Query/SWR, form, or state
library Hooks directly when their public contract already expresses the
feature's intent. Add a feature Hook when it composes multiple libraries,
encodes product policy, or provides a deliberate replacement boundary.

Completion criterion: the file location and reuse scope follow ownership and
discoverability, with no abstraction justified only by a possible future
consumer.

## 6. Respect React runtime boundaries

Call Hooks only at the top level of React components or custom Hooks. Preserve
the existing dependency-array, cleanup, memoization, and cancellation behavior
when moving code. A refactor must not change when an Effect starts, stops, or
re-synchronizes without an explicit behavior change.

In React Server Components, keep server data access and composition on the
server side. Put state, browser APIs, subscriptions, and Effects only behind an
appropriate client boundary. Design the serialized server-to-client contract
before extracting client Hooks.

For async data, forms, and global state, first identify the library's owner and
cache/store lifecycle. A custom Hook is an adapter or policy boundary, not a
mandatory wrapper around every library call.

Completion criterion: Rules of Hooks, server/client boundaries, Effect cleanup,
dependency semantics, and state ownership remain valid after the change.

## 7. Refactor in a vertical slice

Apply the smallest useful extraction:

1. Inventory state, Effects, events, pure functions, and render states.
2. Remove unnecessary Effects and redundant state.
3. Extract pure functions where their names or tests add value.
4. Extract one cohesive use case into a responsibility-named Hook.
5. Replace the View's implementation details with the minimal contract.
6. Run the existing typecheck, lint, tests, and focused UI verification.
7. Continue only if the View is materially clearer and the contract remains
   smaller than the implementation it hides.

Stop or revert the extraction when indirection increases, the Hook name needs
an explanation longer than its responsibility, the View still coordinates the
same policy, state ownership becomes ambiguous, or tests require more setup
than before. The completion condition is improved intent, locality, and
verification—not fewer lines in the component.

Completion criterion: behavior is preserved, the View reads as rendering plus
intent wiring, the Hook owns a coherent logic boundary, and project-native
validation passes.

## Reference rules

- Custom Hooks share stateful logic, not state itself.
- Specific high-level Hook names are preferable to generic lifecycle wrappers.
- Effects are for external synchronization, not general data flow.
- State should have a single owner; shared state is lifted rather than duplicated.
- Pure functions are not Hooks.
- Isolation is evidence of a useful seam, not a mandate to split every file.

Research basis: [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks), [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect), [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure), [Sharing State Between Components](https://react.dev/learn/sharing-state-between-components), [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)
