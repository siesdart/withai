---
name: canonical-package-layout
description: Design or review a capability-oriented monorepo layout with apps, features, core, and platform packages. Use when deciding where applications, product capabilities, shared contracts/UI, or reusable integrations belong across Node.js, Dart, TypeScript, Python, or other stacks.
---

# Canonical Package Layout

Use a **capability-oriented, boundary-first** layout for monorepos. The layout
is a packaging strategy, not a framework convention: choose boundaries by
ownership, public API, independent change, lifecycle, consumers, and release
needs.

## Canonical topology

```text
/
├── apps/
│   ├── product_app/
│   └── admin_app/
├── packages/
│   ├── features/
│   │   ├── auth/
│   │   └── profile/
│   ├── core/
│   │   ├── app_core/
│   │   └── design_system/
│   └── platform/
│       ├── networking/
│       └── storage/
└── workspace configuration and lockfiles
```

Treat the directories as navigational and organizational groups. The package
manager, not the directory name, defines package identity and import or
dependency coordinates. A path such as `packages/features/auth` may therefore
contain a package named `auth`, subject to the stack's naming rules.

Use the groups this way:

- `apps/*` contains executable products and owns product composition, routes,
  deployment configuration, and product-specific wiring.
- `packages/features/*` contains cohesive product capabilities such as auth,
  billing, or profile. A feature is internal by default; extract it for reuse
  only when independent consumers or a stable boundary justify that cost.
- `packages/core/*` contains genuinely shared, stable contracts or cross-cutting
  product foundations such as application primitives or a design system. Keep
  product-specific behavior out of core.
- `packages/platform/*` contains reusable integrations with external systems,
  operating-system capabilities, infrastructure, or data sources when their
  ownership, lifecycle, API, or consumers make reuse a real concern.

## Boundary rules

Keep each package deep: a small public interface should hide meaningful
implementation complexity. A directory is not a boundary merely because it is
named `domain`, `application`, `data`, `services`, or `components`.

Inside a feature, keep collaborating roles co-located when they serve one
capability and callers do not need to distinguish them. Split them only when
the split protects a real dependency direction, independent change, public API,
lifecycle, consumer, or release seam. Use these tests before adding a package,
folder, or file:

- **Deletion test:** does removing the proposed unit eliminate a meaningful
  boundary, or only move the same complexity into neighbouring units?
- **Interface test:** is its public surface materially smaller than the
  behavior it hides?
- **Locality test:** can a change to one concept be understood and tested mostly
  within the unit?
- **Seam test:** is there a real ownership or dependency seam? One adapter is a
  hypothesis; multiple genuinely different consumers or implementations are
  stronger evidence.

Prefer a few deep capability packages over many shallow role-shaped packages.
The target is not a symmetrical tree or the fewest files; it is a legible set
of boundaries that keeps related decisions local and gives consumers leverage.

## Layering and release posture

Treat architecture labels such as presentation, application, domain, and data
as roles, not mandatory package directories. Keep those roles together inside a
feature unless an independent package boundary is justified by the rules above.

Use one-way dependency direction as a default:

```text
app → feature → core contract
app → feature → platform adapter
```

Keep app composition in `apps/*`. Place an abstraction with the innermost
consumer that needs the capability rather than with the outer implementation.
Promote a package to an independently releasable artifact only when it has real
independent consumers, a stable public API, and a release or lifecycle reason.
Do not generalize an app-only feature to make the directory tree look uniform.

## Process and completion criteria

1. Inventory existing applications, packages, dependency edges, public entry
   points, workspace configuration, and release settings. Completion criterion:
   every proposed move has a known owner, consumer set, and dependency impact.
2. Classify each unit as an app, feature, core foundation, platform integration,
   or an intentional exception. Completion criterion: every classification is
   justified by capability, ownership, lifecycle, or consumer evidence.
3. Draw the intended one-way package graph and identify accidental reverse edges,
   cycles, and leaked implementation details. Completion criterion: the graph
   has no unexplained cycle or app-owned capability hidden in shared packages.
4. Apply the deletion, interface, locality, and seam tests to every new package
   or internal split. Completion criterion: every retained boundary hides
   meaningful complexity and no unit exists solely to mirror a layer label.
5. Validate package-manager resolution, imports, tests, build checks, and any
   standalone release checks required by the repository. Completion criterion:
   all relevant checks pass, or each exception is recorded with an owner and
   follow-up condition.

