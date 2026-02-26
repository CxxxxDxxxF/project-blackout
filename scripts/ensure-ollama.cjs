const { spawn } = require('child_process');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CHECK_ENDPOINT = `${OLLAMA_URL.replace(/\/+$/, '')}/api/tags`;
const CHECK_ONLY = process.argv.includes('--check');
const START_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isOllamaReachable() {
  try {
    const res = await fetch(CHECK_ENDPOINT, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function commandExists(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function waitForOllama(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOllamaReachable()) {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function startOllamaDetached() {
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function main() {
  if (await isOllamaReachable()) {
    console.log(`[ollama] Running at ${OLLAMA_URL}`);
    process.exit(0);
  }

  if (CHECK_ONLY) {
    console.error(`[ollama] Not reachable at ${OLLAMA_URL}`);
    process.exit(1);
  }

  if (!(await commandExists('ollama'))) {
    console.error('[ollama] CLI not found. Install from https://ollama.com/download');
    process.exit(1);
  }

  console.log(`[ollama] Starting ollama serve for ${OLLAMA_URL}...`);
  try {
    startOllamaDetached();
  } catch (error) {
    console.error(
      `[ollama] Failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  const ready = await waitForOllama(START_TIMEOUT_MS);
  if (!ready) {
    console.error(
      `[ollama] Start timed out after ${Math.round(START_TIMEOUT_MS / 1000)}s. ` +
        'Run "ollama serve" manually and retry.',
    );
    process.exit(1);
  }

  console.log(`[ollama] Ready at ${OLLAMA_URL}`);
}

void main();
