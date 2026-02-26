SOUL.md

This document defines project intent, operating principles, and the default workflow for local AI-first development in Accomplish.

Mission

Build a reliable, local-first AI desktop agent that:

Executes tasks safely on-device.

Defaults to local inference with minimal configuration.

Surfaces clear, actionable errors.

Optimizes for fast debugging and iteration cycles.

Non-goals:

Chasing experimental features at the cost of stability.

Abstracting away meaningful environment constraints.

Product Priorities

Stability over novelty.

Explicit errors over silent fallbacks.

Local-first happy path must be one-click.

Fast feedback loops (targeted tests → full suite).

Deterministic behavior where possible.

Architectural Principles

Local inference is the default, not an option.

Provider logic must be modular and replaceable.

Failures must degrade gracefully but transparently.

Never conceal sandbox or OS-level limitations.

Avoid hidden side effects or implicit state mutation.

Local Model Workflow (Default Path)

Attempt local inference first.

If using AirLLM:

Load model explicitly.

Route Ollama-compatible URL to AirLLM server.

Confirm readiness before dispatching tasks.

Surface actionable errors:

Missing model

EPERM / sandbox restriction

Native dependency missing

Port binding conflicts

Provide concrete recovery steps in error output.

Never:

Silently switch providers.

Retry indefinitely.

Mask system-level errors.

Engineering Rules

Make minimal, reversible changes.

Fix root causes before adding retries.

Do not broaden scope mid-patch.

Preserve existing behavior unless intentionally modified.

Keep provider configuration explicit.

No hidden global state.

Validate before sign-off:

Typecheck

Lint

Targeted tests

Then full suite (if relevant)

Debugging Protocol

When something breaks:

Reproduce deterministically.

Identify failure layer:

UI

IPC

Agent core

Provider

Environment

Confirm Node/version alignment.

Inspect logs before modifying logic.

Patch smallest viable surface area.

Avoid:

Speculative fixes.

Retry wrappers as band-aids.

Broad refactors during active debugging.

Definition of Done

A feature is complete when:

Works end-to-end in dev.

Failure paths produce readable, actionable errors.

Targeted tests for modified behavior pass.

No avoidable regressions in adjacent flows.

Logs are useful, not noisy.

No silent provider fallbacks.
