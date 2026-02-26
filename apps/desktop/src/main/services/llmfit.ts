import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

export interface LlmfitModel {
  name: string;
  provider: string;
  fitLevel: 'Perfect' | 'Good' | 'Marginal' | 'Too Tight';
  runMode: 'GPU' | 'MoE' | 'CPU+GPU' | 'CPU';
  scores: {
    quality: number;
    speed: number;
    fit: number;
    context: number;
    composite: number;
  };
  quantization: string;
  estimatedSpeedTps: number;
  requiredVramGb: number;
  ollamaName?: string;
}

export interface LlmfitScanResult {
  success: boolean;
  models?: LlmfitModel[];
  hardware?: {
    totalRamGb: number;
    availableRamGb: number;
    gpuVramGb: number;
    backend: string;
  };
  error?: string;
}

interface RawLlmfitModel {
  name?: string;
  provider?: string;
  fit_level?: 'Perfect' | 'Good' | 'Marginal' | 'Too Tight';
  run_mode?: 'GPU' | 'MoE' | 'CPU+GPU' | 'CPU';
  score_components?: {
    quality?: number;
    speed?: number;
    fit?: number;
    context?: number;
  };
  score?: number;
  best_quant?: string;
  estimated_tps?: number;
  memory_required_gb?: number;
}

interface RawLlmfitSystem {
  total_ram_gb?: number;
  available_ram_gb?: number;
  gpu_vram_gb?: number;
  backend?: string;
}

interface RawLlmfitOutput {
  models?: RawLlmfitModel[];
  system?: RawLlmfitSystem;
}

export async function checkLlmfitInstalled(): Promise<{ installed: boolean; version?: string }> {
  return new Promise((resolve) => {
    // We explicitly check ~/.local/bin/llmfit because the install script puts it there without sudo
    const binPath = path.join(os.homedir(), '.local', 'bin', 'llmfit');
    const child = spawn(binPath, ['--version'], {
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:${path.join(os.homedir(), '.local', 'bin')}`,
      },
    });

    let stdout = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.on('error', () => {
      // Try global llmfit next if the local bin failed
      const fallbackChild = spawn('llmfit', ['--version']);

      let fallbackStdout = '';
      fallbackChild.stdout.on('data', (data) => {
        fallbackStdout += data.toString();
      });

      fallbackChild.on('error', () => resolve({ installed: false }));
      fallbackChild.on('close', (code) => {
        if (code === 0) {
          resolve({ installed: true, version: fallbackStdout.trim().replace('llmfit', '').trim() });
        } else {
          resolve({ installed: false });
        }
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ installed: true, version: stdout.trim().replace('llmfit', '').trim() });
      } else {
        resolve({ installed: false });
      }
    });
  });
}

export async function runLlmfit(useAirllmMemoryProvider?: boolean): Promise<LlmfitScanResult> {
  return new Promise((resolve) => {
    const binPath = path.join(os.homedir(), '.local', 'bin', 'llmfit');
    const args = ['--json', 'recommend'];
    if (useAirllmMemoryProvider) {
      args.unshift('--memory', '512G');
    }

    const child = spawn(binPath, args, {
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:${path.join(os.homedir(), '.local', 'bin')}`,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', () => {
      // Try global fallback
      const fallbackArgs = ['--json', 'recommend'];
      if (useAirllmMemoryProvider) {
        fallbackArgs.unshift('--memory', '512G');
      }
      const fallbackChild = spawn('llmfit', fallbackArgs);
      let fbStdout = '';
      let fbStderr = '';

      fallbackChild.stdout.on('data', (data) => (fbStdout += data.toString()));
      fallbackChild.stderr.on('data', (data) => (fbStderr += data.toString()));

      fallbackChild.on('error', (fbErr) => resolve({ success: false, error: fbErr.message }));
      fallbackChild.on('close', (code) => {
        if (code !== 0) {
          return resolve({ success: false, error: fbStderr || 'Unknown error' });
        }
        try {
          const raw = JSON.parse(fbStdout) as RawLlmfitOutput;
          resolve({
            success: true,
            models: mapModels(raw.models),
            hardware: mapHardware(raw.system),
          });
        } catch {
          resolve({ success: false, error: 'Failed to parse JSON output' });
        }
      });
    });

    child.on('close', (code) => {
      if (code !== 0 && !stderr) {
        // error handler already fired fallback
        return;
      }
      if (code !== 0) {
        return resolve({ success: false, error: stderr || 'Unknown error' });
      }
      try {
        const raw = JSON.parse(stdout) as RawLlmfitOutput;
        resolve({
          success: true,
          models: mapModels(raw.models),
          hardware: mapHardware(raw.system),
        });
      } catch {
        resolve({ success: false, error: 'Failed to parse JSON output' });
      }
    });
  });
}

function mapModels(models: RawLlmfitModel[] = []): LlmfitModel[] {
  return models.map((m) => ({
    name: m.name || 'unknown',
    provider: m.provider || 'Local',
    fitLevel: m.fit_level || 'Too Tight',
    runMode: m.run_mode || 'CPU',
    scores: {
      quality: m.score_components?.quality || 0,
      speed: m.score_components?.speed || 0,
      fit: m.score_components?.fit || 0,
      context: m.score_components?.context || 0,
      composite: m.score || 0,
    },
    quantization: m.best_quant || 'unknown',
    estimatedSpeedTps: m.estimated_tps || 0,
    requiredVramGb: m.memory_required_gb || 0,
    ollamaName: inferOllamaName(m.name),
  }));
}

function inferOllamaName(modelName?: string): string | undefined {
  if (!modelName) {
    return undefined;
  }
  const trimmed = modelName.trim();
  if (!trimmed) {
    return undefined;
  }

  // Already looks like an Ollama tag (e.g. llama3.2:3b)
  if (!trimmed.includes('/') && trimmed.includes(':')) {
    return trimmed;
  }

  // Common HF -> Ollama mapping for popular Qwen variants.
  const lower = trimmed.toLowerCase();
  const qwenMatch =
    /^qwen\/qwen(?:2(?:\.5)?)?-?(?:coder-)?(\d+(?:\.\d+)?)b(?:-instruct)?(?:-awq)?$/i.exec(trimmed);
  if (qwenMatch) {
    const size = qwenMatch[1];
    const isCoder = lower.includes('coder');
    const isInstruct = lower.includes('instruct');
    let tag = `qwen2.5:${size}b`;
    if (isCoder && isInstruct) {
      tag = `qwen2.5-coder:${size}b-instruct`;
    } else if (isCoder) {
      tag = `qwen2.5-coder:${size}b`;
    } else if (isInstruct) {
      tag = `qwen2.5:${size}b-instruct`;
    }
    return tag;
  }

  return undefined;
}

function mapHardware(
  sys?: RawLlmfitSystem,
): { totalRamGb: number; availableRamGb: number; gpuVramGb: number; backend: string } | undefined {
  if (!sys) return undefined;
  return {
    totalRamGb: sys.total_ram_gb || 0,
    availableRamGb: sys.available_ram_gb || 0,
    gpuVramGb: sys.gpu_vram_gb || 0,
    backend: sys.backend || 'CPU',
  };
}
