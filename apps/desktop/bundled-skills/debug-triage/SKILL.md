---
name: debug-triage
description: Triage runtime failures quickly by isolating root cause, collecting logs, and proposing minimal fixes.
command: /debug-triage
verified: true
---

# Debug Triage

Use this skill when a feature fails in dev/prod and you need a fast, structured diagnosis.

## Triage Flow

1. Reproduce the issue with the smallest path.
2. Capture exact error text and stack trace.
3. Identify failing layer: UI, preload, IPC, service, core, external runtime.
4. Propose smallest fix that addresses root cause.
5. Re-run targeted verification before full suite.

## Output

- Repro steps
- Root cause
- Patch summary
- Verification status
- Any environment limits or residual risk
