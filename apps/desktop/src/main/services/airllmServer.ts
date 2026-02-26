/**
 * AirLLM Python server lifecycle manager.
 *
 * Spawns and monitors the FastAPI server at tools/airllm-server/server.py.
 * Exposes a singleton via getAirLLMServer() so IPC handlers and the app
 * lifecycle both share the same process handle.
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 11435;
const HEALTH_URL = `http://${SERVER_HOST}:${SERVER_PORT}/health`;

interface AirLLMStatus {
  running: boolean;
  pid?: number;
  modelLoaded?: boolean;
  modelId?: string | null;
}

interface StartResult {
  success: boolean;
  error?: string;
}

class AirLLMServer {
  private process: ChildProcess | null = null;
  private loadedModelId: string | null = null;

  getStatus(): AirLLMStatus {
    return {
      running: this.process !== null && !this.process.killed,
      pid: this.process?.pid,
      modelLoaded: this.loadedModelId !== null,
      modelId: this.loadedModelId,
    };
  }

  setLoadedModel(modelId: string | null): void {
    this.loadedModelId = modelId;
  }

  async start(): Promise<StartResult> {
    if (this.process && !this.process.killed) {
      return { success: true };
    }

    const python = await this.findPython();
    if (!python) {
      return {
        success: false,
        error: 'python3 not found on PATH. Install Python 3.10+ to use AirLLM.',
      };
    }

    return new Promise((resolve) => {
      const serverScript = this.resolveServerScriptPath();
      if (!fs.existsSync(serverScript)) {
        resolve({ success: false, error: `AirLLM server script not found: ${serverScript}` });
        return;
      }
      this.process = spawn(
        python,
        [serverScript, '--host', SERVER_HOST, '--port', String(SERVER_PORT)],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        },
      );

      this.process.stdout?.on('data', (chunk: Buffer) => {
        console.log('[AirLLM]', chunk.toString().trim());
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        console.error('[AirLLM]', chunk.toString().trim());
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[AirLLM] Server exited (code=${code}, signal=${signal})`);
        this.loadedModelId = null;
        this.process = null;
      });

      this.process.on('error', (err) => {
        console.error('[AirLLM] Failed to spawn server:', err.message);
        this.loadedModelId = null;
        this.process = null;
        resolve({ success: false, error: err.message });
      });

      // Wait for the health endpoint to become available
      this.waitForHealth(10000)
        .then(() => resolve({ success: true }))
        .catch((err: Error) => resolve({ success: false, error: err.message }));
    });
  }

  async stop(): Promise<void> {
    if (!this.process || this.process.killed) return;
    this.process.kill('SIGTERM');
    // Give it 3s then force-kill
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 3000);
      this.process?.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.loadedModelId = null;
    this.process = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private isPackagedRuntime(): boolean {
    return process.defaultApp !== true;
  }

  private resolveServerScriptPath(): string {
    const packagedScript = path.join(process.resourcesPath, 'airllm-server', 'server.py');
    const devScript = path.resolve(__dirname, '../../../../tools/airllm-server/server.py');
    return this.isPackagedRuntime() ? packagedScript : devScript;
  }

  private async findPython(): Promise<string | null> {
    const venvPython = this.isPackagedRuntime()
      ? path.join(process.resourcesPath, 'airllm-server', '.venv', 'bin', 'python')
      : path.resolve(__dirname, '../../../../tools/airllm-server/.venv/bin/python');
    const venvPythonWindows = this.isPackagedRuntime()
      ? path.join(process.resourcesPath, 'airllm-server', '.venv', 'Scripts', 'python.exe')
      : path.resolve(__dirname, '../../../../tools/airllm-server/.venv/Scripts/python.exe');
    const candidates =
      process.platform === 'win32'
        ? [venvPythonWindows, venvPython, 'python', 'python3']
        : [venvPython, venvPythonWindows, 'python3', 'python'];
    for (const candidate of candidates) {
      try {
        const { execSync } = await import('child_process');
        execSync(`"${candidate}" --version`, { stdio: 'ignore' });
        return candidate;
      } catch {
        // not found, try next
      }
    }
    return null;
  }

  private waitForHealth(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const check = async () => {
        if (Date.now() >= deadline) {
          reject(new Error(`AirLLM server did not start within ${timeoutMs}ms`));
          return;
        }
        try {
          const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
          if (res.ok) {
            resolve();
            return;
          }
        } catch {
          // not ready yet
        }
        setTimeout(check, 500);
      };
      setTimeout(check, 500);
    });
  }
}

// Singleton
let _server: AirLLMServer | null = null;

export function getAirLLMServer(): AirLLMServer {
  if (!_server) {
    _server = new AirLLMServer();
  }
  return _server;
}
