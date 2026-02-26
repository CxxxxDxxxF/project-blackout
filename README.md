# Project Blackout

Project Blackout is a desktop-first AI automation app built with:

- `apps/desktop` (Electron shell + IPC + local services)
- `apps/web` (React renderer UI)
- `packages/agent-core` (shared core logic, storage, provider/config handling)

It is designed to run local model workflows on your machine using Ollama and AirLLM.

## New In This Update

- Added `Local Model Manager` in Provider settings:
  - list installed Ollama models
  - pull/delete models from UI
  - stream pull progress
- Added `Hardware Advisor` (LLMFit-backed):
  - scans hardware
  - recommends model candidates
  - quick actions to load to Ollama or AirLLM
- Added AirLLM integration end-to-end:
  - desktop-managed AirLLM server lifecycle
  - model load API + download progress polling
  - improved timeout/error handling for large first downloads
- Added startup hardening for local Ollama flows:
  - `pnpm dev:ollama` script
  - `scripts/ensure-ollama.cjs` for reachability/start checks
  - clearer setup and error messages in provider UI
- Added About/identity settings support:
  - editable `SOUL.md`
  - `Your Name`
  - `System Prompt`
- Added local favicon fallback for localhost/private hosts to avoid noisy favicon fetch errors.

## Quick Start

```bash
git clone https://github.com/CxxxxDxxxF/project-blackout.git
cd project-blackout
pnpm install
pnpm dev:ollama
```

`pnpm dev:ollama` ensures Ollama is reachable at `http://127.0.0.1:11434` before launching the app stack.

## First-Time Local Model Setup

If Ollama is not already running:

```bash
ollama serve
```

Pull at least one local Ollama model:

```bash
ollama pull llama3.2:3b
```

Then in app Settings -> Providers:

1. Connect Ollama URL (default: `http://localhost:11434`)
2. Use `Local Model Manager` to pull/manage models
3. Optionally start AirLLM and load a Hugging Face model
4. Use Hardware Advisor for recommendations

## Architecture Notes

- Desktop main process owns:
  - provider IPC handlers
  - AirLLM process/service management
  - persisted settings and secure key workflows
- Web renderer owns:
  - provider forms and local-model UX
  - About tab (`SOUL.md`, Name, System Prompt)
  - progress/status display for long-running downloads

## Useful Commands

```bash
# Development
pnpm dev
pnpm dev:web
pnpm dev:ollama

# Validation
pnpm typecheck
pnpm lint:eslint
pnpm format:check

# Workspace tests
pnpm -F @accomplish/web test
pnpm -F @accomplish/desktop test
pnpm -F @accomplish_ai/agent-core test
```

## Repository Structure

- `apps/desktop` Electron app (main, preload, packaging scripts)
- `apps/web` React renderer UI and integration tests
- `packages/agent-core` provider/core/storage logic
- `tools/airllm-server` AirLLM FastAPI bridge used by desktop integration
- `tools/llmfit` hardware-based recommendation tooling
- `scripts` project helper scripts (including Ollama checks)

## Notes

- Initial AirLLM model downloads can be large and slow; progress is shown in Settings.
- If a model is unavailable in Ollama registry, use a known Ollama tag or load via AirLLM with a Hugging Face repo ID.
