---
name: test-stabilization
description: Stabilize failing tests by fixing mocks/contracts, scoping regressions, and documenting environment-limited failures.
command: /test-stabilization
verified: true
---

# Test Stabilization

Use this skill for blocker-focused test recovery without broad refactors.

## Process

1. Run failing targeted tests first.
2. Fix test contract drift (mock/API shape, import/export mismatches, stale assertions).
3. Keep product behavior unchanged unless bug is confirmed.
4. Re-run targeted tests, then workspace suite.
5. Document environment-limited failures separately (for example port-bind EPERM).

## Guardrails

- Do not hide real regressions with broad excludes.
- Exclude only known environment artifacts.
- Keep patches small and directly related to failing paths.
