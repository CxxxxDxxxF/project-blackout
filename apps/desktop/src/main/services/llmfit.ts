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

function getLlmfitCandidates(): string[] {
  const home = os.homedir();
  const candidates = new Set<string>();
  const exe = process.platform === 'win32' ? 'llmfit.exe' : 'llmfit';

  // Prefer command lookup first (PATH on all platforms).
  candidates.add(exe);
  candidates.add('llmfit');

  // Common user-local install locations.
  candidates.add(path.join(home, '.local', 'bin', 'llmfit'));
  candidates.add(path.join(home, '.local', 'bin', 'llmfit.exe'));

  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE ?? home;
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(userProfile, 'AppData', 'Local');
    const appData = process.env.APPDATA ?? path.join(userProfile, 'AppData', 'Roaming');
    const pythonVersions = ['Python313', 'Python312', 'Python311', 'Python310', 'Python39'];

    for (const py of pythonVersions) {
      candidates.add(path.join(localAppData, 'Programs', 'Python', py, 'Scripts', 'llmfit.exe'));
      candidates.add(path.join(appData, 'Python', py, 'Scripts', 'llmfit.exe'));
    }
  }

  return Array.from(candidates);
}

function getEnvWithUserLocalBin(): NodeJS.ProcessEnv {
  const userLocalBin = path.join(os.homedir(), '.local', 'bin');
  const delimiter = path.delimiter;
  const existingPath = process.env.PATH ?? '';
  const mergedPath = existingPath.includes(userLocalBin)
    ? existingPath
    : `${existingPath}${existingPath ? delimiter : ''}${userLocalBin}`;
  return {
    ...process.env,
    PATH: mergedPath,
  };
}

function runLlmfitCommand(
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const candidates = getLlmfitCandidates();
  const env = getEnvWithUserLocalBin();

  return new Promise((resolve) => {
    const tryAt = (index: number) => {
      if (index >= candidates.length) {
        resolve({ ok: false, error: 'llmfit binary not found on PATH' });
        return;
      }

      const bin = candidates[index];
      const child = spawn(bin, args, { env });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', () => {
        tryAt(index + 1);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true, stdout });
          return;
        }
        if (code === 127 && index + 1 < candidates.length) {
          tryAt(index + 1);
          return;
        }
        resolve({
          ok: false,
          error: stderr.trim() || `llmfit exited with code ${code ?? 'unknown'}`,
        });
      });
    };

    tryAt(0);
  });
}

export async function checkLlmfitInstalled(): Promise<{ installed: boolean; version?: string }> {
  const result = await runLlmfitCommand(['--version']);
  if (!result.ok) {
    return { installed: false };
  }
  return { installed: true, version: result.stdout.trim().replace('llmfit', '').trim() };
}

export async function runLlmfit(useAirllmMemoryProvider?: boolean): Promise<LlmfitScanResult> {
  const args = ['--json', 'recommend'];
  if (useAirllmMemoryProvider) {
    args.unshift('--memory', '512G');
  }

  const result = await runLlmfitCommand(args);
  if (!result.ok) {
    return { success: false, error: result.error };
  }

  try {
    const raw = JSON.parse(result.stdout) as RawLlmfitOutput;
    return {
      success: true,
      models: mapModels(raw.models),
      hardware: mapHardware(raw.system),
    };
  } catch {
    return { success: false, error: 'Failed to parse JSON output' };
  }
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
