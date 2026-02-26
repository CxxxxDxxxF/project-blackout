#!/usr/bin/env python3
"""
AirLLM FastAPI Server — Ollama-compatible HTTP API wrapper.

Exposes an Ollama-compatible API on port 11435 so the Accomplish app can
treat AirLLM-backed Hugging Face models as a local provider alongside Ollama.

Usage:
    pip install -r requirements.txt
    python server.py [--port 11435] [--host 127.0.0.1]

Endpoints (Ollama wire format):
    GET  /health          — liveness probe
    GET  /api/tags        — list available/loaded models
    POST /api/generate    — text generation
    POST /api/chat        — chat generation
    POST /api/load        — load a model by HF repo id
"""

import argparse
import asyncio
import json
import shutil
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import uvicorn
import huggingface_hub
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# AirLLM import
# ---------------------------------------------------------------------------
VENDOR_PATH = Path(__file__).parent / "vendor" / "airllm" / "air_llm"
if VENDOR_PATH.exists():
    sys.path.insert(0, str(VENDOR_PATH))

try:
    from airllm import AutoModel  # type: ignore
    AIRLLM_AVAILABLE = True
except ImportError:
    # Fall back to pip-installed airllm if present
    try:
        from airllm import AutoModel  # type: ignore
        AIRLLM_AVAILABLE = True
    except ImportError:
        AIRLLM_AVAILABLE = False
        AutoModel = None  # type: ignore

# ---------------------------------------------------------------------------
# App state
# ---------------------------------------------------------------------------
class ModelState:
    def __init__(self) -> None:
        self.model: Any = None
        self.model_id: Optional[str] = None
        self.loading: bool = False
        self.download: dict[str, Any] = {
            "active": False,
            "phase": "idle",
            "model": None,
            "status": "idle",
            "downloadedBytes": 0,
            "totalBytes": None,
            "percent": None,
            "etaSeconds": None,
        }

    def is_loaded(self) -> bool:
        return self.model is not None and not self.loading


state = ModelState()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # startup
    yield
    # shutdown: release model memory
    if state.model is not None:
        del state.model
        state.model = None


app = FastAPI(title="AirLLM Server", version="1.0.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Request / Response models (Ollama wire format)
# ---------------------------------------------------------------------------
class GenerateRequest(BaseModel):
    model: str
    prompt: str
    stream: bool = False
    max_new_tokens: int = 256
    temperature: float = 0.7
    options: Optional[dict] = None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    max_new_tokens: int = 256
    options: Optional[dict] = None


class LoadRequest(BaseModel):
    model: str  # HuggingFace repo id, e.g. "meta-llama/Llama-3.2-1B"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _require_airllm() -> None:
    if not AIRLLM_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="airllm package is not installed. Run: pip install airllm",
        )


def _load_model(model_id: str) -> None:
    """Load a model into state. Blocking — call from background task."""
    _require_airllm()
    state.loading = True
    try:
        for attempt in range(2):
            try:
                local_model_path = _download_model_to_local_dir(model_id)
                state.download = {
                    **state.download,
                    "active": True,
                    "phase": "loading-model",
                    "model": model_id,
                    "status": "Loading model into AirLLM",
                }
                state.model = AutoModel.from_pretrained(str(local_model_path))
                state.model_id = model_id
                state.download = {
                    **state.download,
                    "active": False,
                    "phase": "done",
                    "status": "Ready",
                    "percent": 100,
                    "etaSeconds": 0,
                }
                return
            except FileNotFoundError as err:
                # Recover once from partially/corrupt HF snapshots by removing
                # the current snapshot directory and forcing a clean re-download.
                cleared = _clear_corrupt_hf_snapshot(err)
                if attempt == 0 and cleared is not None:
                    print(
                        f"[AirLLM Server] Removed corrupt HF snapshot: {cleared}",
                        flush=True,
                    )
                    continue
                if attempt == 0:
                    _clear_local_model_dir(model_id)
                    continue
                raise RuntimeError(
                    f"Model cache appears incomplete for '{model_id}'. "
                    "Please retry model load."
                ) from err
            except Exception as err:
                raise RuntimeError(f"Failed to load model '{model_id}': {err}") from err
    finally:
        state.loading = False
        if state.download.get("active"):
            state.download = {**state.download, "active": False, "phase": "error"}


def _clear_corrupt_hf_snapshot(err: FileNotFoundError) -> Optional[Path]:
    missing = Path(err.filename) if err.filename else None
    if missing is None:
        return None

    parts = missing.parts
    if "snapshots" not in parts:
        return None

    idx = parts.index("snapshots")
    if idx + 1 >= len(parts):
        return None

    snapshot_dir = Path(*parts[: idx + 2])
    if not snapshot_dir.exists():
        return None

    try:
        shutil.rmtree(snapshot_dir)
        return snapshot_dir
    except Exception:
        return None


def _model_id_to_dir_name(model_id: str) -> str:
    return model_id.replace("/", "--")


def _local_model_base_dir() -> Path:
    return Path.home() / ".accomplish" / "airllm-models"


def _clear_local_model_dir(model_id: str) -> None:
    target = _local_model_base_dir() / _model_id_to_dir_name(model_id)
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)


def _download_model_to_local_dir(model_id: str) -> Path:
    base = _local_model_base_dir()
    base.mkdir(parents=True, exist_ok=True)
    local_dir = base / _model_id_to_dir_name(model_id)
    print(f"[AirLLM Server] Ensuring local model download: {model_id} -> {local_dir}", flush=True)
    total_bytes = _get_repo_total_bytes(model_id)
    initial_bytes = _dir_size(local_dir)
    started_at = time.time()
    state.download = {
        "active": True,
        "phase": "downloading",
        "model": model_id,
        "status": "Downloading model files",
        "downloadedBytes": 0,
        "totalBytes": total_bytes,
        "percent": None,
        "etaSeconds": None,
        "startedAt": started_at,
    }

    stop_monitor = threading.Event()
    monitor_thread = threading.Thread(
        target=_monitor_download_progress,
        args=(local_dir, initial_bytes, total_bytes, started_at, stop_monitor),
        daemon=True,
    )
    monitor_thread.start()
    huggingface_hub.snapshot_download(
        repo_id=model_id,
        local_dir=str(local_dir),
    )
    stop_monitor.set()
    monitor_thread.join(timeout=1.0)
    final_bytes = max(_dir_size(local_dir) - initial_bytes, 0)
    final_percent = None
    if total_bytes and total_bytes > 0:
        final_percent = min(100, round((final_bytes / total_bytes) * 100, 1))
    state.download = {
        **state.download,
        "active": False,
        "phase": "downloaded",
        "status": "Download complete",
        "downloadedBytes": final_bytes,
        "totalBytes": total_bytes,
        "percent": final_percent if final_percent is not None else 100,
        "etaSeconds": 0,
    }
    return local_dir


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for f in path.rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
            except Exception:
                continue
    return total


def _get_repo_total_bytes(model_id: str) -> Optional[int]:
    try:
        api = huggingface_hub.HfApi()
        info = api.model_info(model_id)
        total = 0
        for sibling in info.siblings or []:
            size = getattr(sibling, "size", None)
            if isinstance(size, int) and size > 0:
                total += size
        return total if total > 0 else None
    except Exception:
        return None


def _monitor_download_progress(
    local_dir: Path,
    initial_bytes: int,
    total_bytes: Optional[int],
    started_at: float,
    stop_event: threading.Event,
) -> None:
    while not stop_event.is_set():
        current_total = _dir_size(local_dir)
        downloaded = max(current_total - initial_bytes, 0)
        elapsed = max(time.time() - started_at, 1e-6)
        rate = downloaded / elapsed
        eta_seconds = None
        percent = None
        if total_bytes and total_bytes > 0:
            remaining = max(total_bytes - downloaded, 0)
            eta_seconds = int(remaining / rate) if rate > 0 else None
            percent = min(100, round((downloaded / total_bytes) * 100, 1))

        state.download = {
            **state.download,
            "active": True,
            "phase": "downloading",
            "status": "Downloading model files",
            "downloadedBytes": downloaded,
            "totalBytes": total_bytes,
            "percent": percent,
            "etaSeconds": eta_seconds,
        }
        stop_event.wait(1.0)


def _build_generate_response(model_id: str, text: str, prompt_tokens: int, gen_tokens: int) -> dict:
    return {
        "model": model_id,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "response": text,
        "done": True,
        "done_reason": "stop",
        "prompt_eval_count": prompt_tokens,
        "eval_count": gen_tokens,
    }


def _run_inference(prompt: str, max_new_tokens: int) -> tuple[str, int, int]:
    """Run inference synchronously. Returns (output_text, prompt_tokens, gen_tokens)."""
    if not state.is_loaded():
        raise HTTPException(status_code=503, detail="No model loaded. Call POST /api/load first.")

    import torch  # type: ignore

    tokenizer = state.model.tokenizer
    inputs = tokenizer(
        [prompt],
        return_tensors="pt",
        return_attention_mask=False,
        truncation=True,
        max_length=512,
        padding=True,
    )

    prompt_tokens = inputs["input_ids"].shape[-1]

    try:
        generation = state.model.generate(
            inputs["input_ids"].to(state.model.device if hasattr(state.model, "device") else "cpu"),
            max_new_tokens=max_new_tokens,
            use_cache=True,
            return_dict_in_generate=True,
        )
        output_ids = generation.sequences[0][prompt_tokens:]
        output_text = tokenizer.decode(output_ids, skip_special_tokens=True)
        gen_tokens = len(output_ids)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {e}") from e

    return output_text.strip(), prompt_tokens, gen_tokens


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({
        "status": "ok",
        "airllm_available": AIRLLM_AVAILABLE,
        "model_loaded": state.is_loaded(),
        "model_id": state.model_id,
        "loading": state.loading,
    })


@app.get("/api/tags")
def list_tags() -> JSONResponse:
    """Ollama-compatible model list."""
    models = []
    if state.model_id:
        models.append({
            "name": state.model_id,
            "model": state.model_id,
            "modified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "size": 0,
            "digest": "",
            "details": {
                "format": "airllm",
                "family": "huggingface",
                "families": ["huggingface"],
                "parameter_size": "unknown",
                "quantization_level": "none",
            },
        })
    return JSONResponse({"models": models})


@app.get("/api/download-status")
def download_status() -> JSONResponse:
    return JSONResponse(state.download)


@app.post("/api/load")
async def load_model(req: LoadRequest) -> JSONResponse:
    """Load (or swap to) a HuggingFace model."""
    _require_airllm()
    if state.loading:
        raise HTTPException(status_code=409, detail="A model is already loading. Try again shortly.")

    if state.model_id == req.model and state.is_loaded():
        return JSONResponse({"status": "already_loaded", "model": req.model})

    # Release current model first
    if state.model is not None:
        del state.model
        state.model = None
        state.model_id = None

    # Run heavy model load in a worker thread so status endpoints stay responsive.
    try:
        await asyncio.to_thread(_load_model, req.model)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
    return JSONResponse({"status": "loaded", "model": req.model})


@app.post("/api/generate")
async def generate(req: GenerateRequest) -> Any:
    _require_airllm()
    options = req.options or {}
    max_new_tokens = options.get("num_predict", req.max_new_tokens)

    # Auto-load if a different model is specified and none is loaded
    if not state.is_loaded() or state.model_id != req.model:
        try:
            await asyncio.to_thread(_load_model, req.model)
        except Exception as err:
            raise HTTPException(status_code=500, detail=str(err)) from err

    output, prompt_tokens, gen_tokens = await asyncio.to_thread(
        _run_inference, req.prompt, max_new_tokens
    )
    response_body = _build_generate_response(req.model, output, prompt_tokens, gen_tokens)

    if req.stream:
        # Emit a single chunk then done (true streaming requires generator refactor)
        async def stream_response() -> AsyncGenerator[bytes, None]:
            yield (json.dumps({**response_body, "done": False}) + "\n").encode()
            yield (json.dumps({**response_body, "done": True}) + "\n").encode()
        return StreamingResponse(stream_response(), media_type="application/x-ndjson")

    return JSONResponse(response_body)


@app.post("/api/chat")
async def chat(req: ChatRequest) -> Any:
    _require_airllm()
    # Flatten messages into a single prompt
    prompt_parts = []
    for msg in req.messages:
        role = msg.role.capitalize()
        prompt_parts.append(f"{role}: {msg.content}")
    prompt_parts.append("Assistant:")
    prompt = "\n".join(prompt_parts)

    options = req.options or {}
    max_new_tokens = options.get("num_predict", req.max_new_tokens)

    if not state.is_loaded() or state.model_id != req.model:
        try:
            await asyncio.to_thread(_load_model, req.model)
        except Exception as err:
            raise HTTPException(status_code=500, detail=str(err)) from err

    output, prompt_tokens, gen_tokens = await asyncio.to_thread(
        _run_inference, prompt, max_new_tokens
    )

    response_body = {
        "model": req.model,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "message": {"role": "assistant", "content": output},
        "done": True,
        "done_reason": "stop",
        "prompt_eval_count": prompt_tokens,
        "eval_count": gen_tokens,
    }

    if req.stream:
        async def stream_response() -> AsyncGenerator[bytes, None]:
            yield (json.dumps({**response_body, "done": False}) + "\n").encode()
            yield (json.dumps({**response_body, "done": True}) + "\n").encode()
        return StreamingResponse(stream_response(), media_type="application/x-ndjson")

    return JSONResponse(response_body)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AirLLM Ollama-compatible server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=11435, help="Bind port (default: 11435)")
    args = parser.parse_args()

    print(f"[AirLLM Server] Starting on http://{args.host}:{args.port}", flush=True)
    print(f"[AirLLM Server] airllm available: {AIRLLM_AVAILABLE}", flush=True)

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
