---
name: model-routing
description: Configure and validate local model routing between Ollama and AirLLM for one-click load-and-run flows.
command: /model-routing
verified: true
---

# Model Routing

Use this skill when setting up or debugging local model execution paths.

## Goals

- Ensure selected model is actually loaded.
- Ensure requests are routed to the intended local server.
- Ensure users get clear status and recovery guidance.

## Workflow

1. Verify server status endpoints (`/health`, model list).
2. Trigger model load and capture exact response.
3. Update provider URL/config after successful load.
4. Confirm end-to-end generation request succeeds.
5. Report concrete next steps if model cache/runtime is broken.

## Common Checks

- AirLLM server URL is reachable.
- Ollama base URL points to expected engine.
- UI success state matches backend loaded model.
