# Project Blackout

Project Blackout is a desktop-first AI automation app that combines:

- `apps/desktop` (Electron shell, IPC, local process orchestration)
- `apps/web` (React renderer UI)
- `packages/agent-core` (task execution core, storage, provider/config handling, MCP tooling)

It supports both cloud and local LLM workflows, including Ollama and AirLLM.

## Core Features

- Task execution pipeline with streaming updates, checkpoints, summaries, and status tracking
- Model/provider management across major LLM providers (cloud + local)
- Skills system with bundled skills and custom skill support
- Connectors + tools workflow support inside task runs
- Voice input/transcription support
- Settings UX for providers, skills, connectors, voice, and about/profile controls
- Secure API key handling and app settings persistence
- SQLite-backed task history and app state migrations
- Desktop+Web development setup in a single monorepo

## Supported Providers

Project Blackout includes broad provider support (15 total): Anthropic, OpenAI, Google, xAI, DeepSeek, Moonshot, ZAI, Bedrock, Azure Foundry, Ollama, OpenRouter, LiteLLM, MiniMax, LM Studio, and Custom.

## What Changed In This Branch

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
- Added additional bundled skills and vendored helper tooling required for local model workflows.

## Quick Start

```bash
git clone https://github.com/CxxxxDxxxF/project-blackout.git
cd project-blackout
pnpm install
pnpm dev:ollama
```

`pnpm dev:ollama` ensures Ollama is reachable at `http://127.0.0.1:11434` before launching the app stack.

If you want the web renderer only:

```bash
pnpm dev:web
```

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

## Settings Areas

- Providers
- Skills
- Connectors
- Voice Input
- About (`SOUL.md`, name, and system prompt)

## Architecture Notes

- Main architecture doc: `docs/architecture.md`
- Desktop main process owns IPC, task runtime integration, local services (including AirLLM), and persistence wiring.
- Web renderer owns settings/forms, task UI, progress surfaces, and user interaction flows.
- Agent-core owns task logic, storage/migrations, provider/model logic, and shared types/utilities.

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

## Full Verification

```bash
pnpm lint
pnpm format:check
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
- `docs` architecture and implementation references

## Notes

- Initial AirLLM model downloads can be large and slow; progress is shown in Settings.
- If a model is unavailable in Ollama registry, use a known Ollama tag or load via AirLLM with a Hugging Face repo ID.
