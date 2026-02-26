---
name: release-notes
description: Generate concise release notes from merged changes with user impact, migration notes, and verification status.
command: /release-notes
verified: true
---

# Release Notes

Use this skill to produce high-signal release notes from recent code changes.

## Format

1. Highlights
2. User-facing changes
3. Fixes
4. Breaking/risky changes
5. Validation summary

## Requirements

- Reference concrete files/features changed.
- Distinguish behavior changes from internal refactors.
- Include known limitations and environment-specific caveats.
- Keep it concise and readable.
