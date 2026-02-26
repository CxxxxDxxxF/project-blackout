# AirLLM Server

FastAPI wrapper that exposes AirLLM (Hugging Face models) via an Ollama-compatible HTTP API on port `11435`.

## What it does

Runs large language models layer-by-layer using [AirLLM](https://github.com/lyogavin/airllm), which allows 70B+ models to run on limited memory (including Apple Silicon via MLX). Exposes the same HTTP wire format as Ollama so the Accomplish app treats it as a local provider.

## Prerequisites

- Python 3.10+
- pip

## Setup

```bash
cd tools/airllm-server
pip install -r requirements.txt
```

## Running

```bash
python server.py
# default: http://127.0.0.1:11435
```

Options:

```
--host  Bind host (default: 127.0.0.1)
--port  Bind port (default: 11435)
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + model status |
| GET | `/api/tags` | List loaded models (Ollama format) |
| POST | `/api/load` | Load a HuggingFace model by repo ID |
| POST | `/api/generate` | Text generation (Ollama format) |
| POST | `/api/chat` | Chat inference (Ollama format) |

## Using in Accomplish

Once running, set the Ollama server URL in Settings to `http://localhost:11435`. The app will connect and use whichever model is currently loaded.

To load a model, use the Local Model Manager in Settings or call:

```bash
curl -X POST http://localhost:11435/api/load \
  -H "Content-Type: application/json" \
  -d '{"model": "meta-llama/Llama-3.2-1B"}'
```

## Vendor

AirLLM source is vendored at `vendor/airllm/` (shallow clone, Apache-2.0 license).
