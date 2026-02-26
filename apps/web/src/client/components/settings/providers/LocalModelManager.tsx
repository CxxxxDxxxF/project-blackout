import { useState, useEffect, useCallback, useRef } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { HardwareAdvisor, type LlmfitModel } from './HardwareAdvisor';

interface OllamaModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  modifiedAt: string;
}

interface PullProgress {
  status?: string;
  completed?: number;
  total?: number;
}

interface AirLLMStatus {
  running: boolean;
  pid?: number;
  modelId?: string | null;
}

interface AirLLMDownloadStatus {
  active: boolean;
  phase?: string;
  model?: string | null;
  status?: string;
  downloadedBytes?: number;
  totalBytes?: number | null;
  percent?: number | null;
  etaSeconds?: number | null;
}

interface LocalModelManagerProps {
  serverUrl: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Ollama Model List + Pull + Delete
// ---------------------------------------------------------------------------
function OllamaModelManager({
  serverUrl,
  incomingPullName,
  onIncomingConsumed,
}: {
  serverUrl: string;
  incomingPullName?: { name: string; ts: number } | null;
  onIncomingConsumed?: () => void;
}) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  const mapModelError = useCallback(
    (raw: string) => {
      const message = raw.toLowerCase();
      if (
        message.includes('econnrefused') ||
        message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('fetch failed')
      ) {
        return `Cannot reach Ollama at ${serverUrl}. Start Ollama with "ollama serve" and retry.`;
      }
      if (message.includes('404')) {
        return `Connected to ${serverUrl}, but this endpoint is not Ollama. Check your URL.`;
      }
      if (message.includes('manifest') || message.includes('not found')) {
        return `Model not found in Ollama registry. Try a known tag like "llama3.2:3b" or switch to "Load to AirLLM" for Hugging Face repos.`;
      }
      return raw;
    },
    [serverUrl],
  );

  const fetchModels = useCallback(async () => {
    const accomplish = getAccomplish();
    const result = await accomplish.ollamaListModels(serverUrl);
    if (result.success && result.models) {
      setModels(result.models);
      setDeleteError(null);
    } else if (!result.success && result.error) {
      setDeleteError(mapModelError(result.error));
    }
  }, [mapModelError, serverUrl]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchModels();
    setLoading(false);
  }, [fetchModels]);

  useEffect(() => {
    void (async () => {
      await fetchModels();
    })();
  }, [fetchModels]);

  useEffect(() => {
    const accomplish = getAccomplish();
    if (!accomplish.onOllamaPullProgress) return;

    const unsubscribe = accomplish.onOllamaPullProgress((data) => {
      setPullProgress({ status: data.status, completed: data.completed, total: data.total });
    });
    return unsubscribe;
  }, []);

  const handleDelete = useCallback(
    async (name: string) => {
      setDeleteError(null);
      const accomplish = getAccomplish();
      const result = await accomplish.ollamaDeleteModel(name, serverUrl);
      if (result.success) {
        await refresh();
      } else {
        setDeleteError(mapModelError(result.error ?? 'Delete failed'));
      }
    },
    [mapModelError, refresh, serverUrl],
  );

  const pullModelByName = useCallback(
    async (targetName: string) => {
      const target = targetName.trim();
      if (!target) return;
      setPulling(true);
      setPullError(null);
      setPullProgress(null);
      const accomplish = getAccomplish();
      const result = await accomplish.ollamaPullModel(target, serverUrl);
      setPulling(false);
      setPullProgress(null);
      if (result.success) {
        setPullName('');
        await refresh();
      } else {
        setPullError(mapModelError(result.error ?? 'Pull failed'));
      }
    },
    [mapModelError, refresh, serverUrl],
  );

  const handlePull = useCallback(
    async (overrideName?: string) => {
      await pullModelByName(overrideName || pullName);
    },
    [pullModelByName, pullName],
  );

  useEffect(() => {
    if (incomingPullName?.name) {
      const timer = window.setTimeout(() => {
        void pullModelByName(incomingPullName.name);
        onIncomingConsumed?.();
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [incomingPullName?.name, incomingPullName?.ts, onIncomingConsumed, pullModelByName]);

  return (
    <div className="space-y-4">
      {/* Installed models */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-foreground">Installed Models</h4>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {models.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground py-2">No models installed. Pull one below.</p>
        )}

        <div className="space-y-1.5">
          {models.map((m) => (
            <div
              key={m.name}
              className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-mono text-foreground">{m.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{formatBytes(m.size)}</span>
              </div>
              <button
                onClick={() => void handleDelete(m.name)}
                className="ml-4 text-xs text-red-400 hover:text-red-300 transition-colors flex-shrink-0"
                title={`Delete ${m.name}`}
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        {deleteError && <p className="mt-2 text-xs text-red-400">{deleteError}</p>}
      </div>

      {/* Pull new model */}
      <div className="space-y-2 border-t border-border pt-4">
        <h4 className="text-sm font-medium text-foreground">Download Model</h4>
        <p className="text-xs text-muted-foreground">
          Enter an Ollama model name, e.g.{' '}
          <code className="font-mono bg-muted px-1 rounded">llama3.2:3b</code>
        </p>
        <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
          Need setup help? Run{' '}
          <code className="font-mono rounded bg-muted px-1">ollama serve</code>, then{' '}
          <code className="font-mono rounded bg-muted px-1">ollama pull llama3.2:3b</code>.
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !pulling && void handlePull()}
            placeholder="llama3.2:3b"
            disabled={pulling}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
          />
          <button
            onClick={() => void handlePull()}
            disabled={pulling || !pullName.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            {pulling ? 'Downloading…' : 'Pull'}
          </button>
        </div>

        {pulling && pullProgress && (
          <div className="space-y-1.5 bg-muted/20 p-3 rounded-md border border-border mt-3">
            <div className="flex justify-between items-center">
              <p className="text-xs font-medium text-foreground">{pullProgress.status}</p>
              {pullProgress.total != null && pullProgress.total > 0 && (
                <span className="text-xs font-mono text-primary">
                  {Math.round(((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%
                </span>
              )}
            </div>
            {pullProgress.total != null && pullProgress.total > 0 && (
              <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden border border-border/50">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.round(((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {pullError && <p className="text-xs text-red-400">{pullError}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AirLLM Section
// ---------------------------------------------------------------------------
function AirLLMSection({
  incomingModelId,
  onIncomingConsumed,
}: {
  incomingModelId?: { name: string; ts: number } | null;
  onIncomingConsumed?: () => void;
}) {
  const [status, setStatus] = useState<AirLLMStatus>({ running: false });
  const [modelId, setModelId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingTarget, setLoadingTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<AirLLMDownloadStatus | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const refreshStatus = useCallback(async () => {
    const accomplish = getAccomplish();
    const s = await accomplish.airllmStatus();
    setStatus(s);
  }, []);

  const stopDownloadPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchDownloadStatus = useCallback(async () => {
    const status = await getAccomplish().airllmDownloadStatus();
    setDownloadStatus(status);
  }, []);

  const startDownloadPolling = useCallback(() => {
    stopDownloadPolling();
    void fetchDownloadStatus();
    pollTimerRef.current = window.setInterval(() => {
      void fetchDownloadStatus();
    }, 1000);
  }, [fetchDownloadStatus, stopDownloadPolling]);

  useEffect(() => {
    void (async () => {
      const accomplish = getAccomplish();
      const currentStatus = await accomplish.airllmStatus();
      setStatus(currentStatus);
      const { url } = await accomplish.airllmServerUrl();
      setServerUrlState(url);
    })();
  }, []);

  const handleStart = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getAccomplish().airllmStart();
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Failed to start AirLLM server');
    } else {
      await refreshStatus();
    }
  }, [refreshStatus]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    await getAccomplish().airllmStop();
    setLoading(false);
    await refreshStatus();
  }, [refreshStatus]);

  const loadModelById = useCallback(
    async (targetModelId: string) => {
      const target = targetModelId.trim();
      if (!target) return;
      setLoading(true);
      setLoadingTarget(target);
      setError(null);
      setSuccessMessage(null);
      setDownloadStatus({
        active: true,
        phase: 'starting',
        model: target,
        status: 'Preparing download…',
      });
      startDownloadPolling();
      const result = await getAccomplish().airllmLoadModel(target);
      stopDownloadPolling();
      await fetchDownloadStatus();
      setLoadingTarget(null);
      setLoading(false);
      if (!result.success) {
        setError(result.error ?? 'Failed to load model');
      } else {
        try {
          const accomplish = getAccomplish();
          if (serverUrl) {
            const current = await accomplish.getOllamaConfig();
            await accomplish.setOllamaConfig({
              baseUrl: serverUrl,
              enabled: true,
              lastValidated: Date.now(),
              models: current?.models,
            });
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : 'Model loaded, but failed to update Ollama URL',
          );
        }
        setSuccessMessage('Model loaded and routed to AirLLM.');
        setModelId('');
        await refreshStatus();
      }
    },
    [fetchDownloadStatus, refreshStatus, serverUrl, startDownloadPolling, stopDownloadPolling],
  );

  const handleLoadModel = useCallback(
    async (overrideName?: string) => {
      await loadModelById(overrideName || modelId);
    },
    [loadModelById, modelId],
  );

  useEffect(() => {
    if (incomingModelId?.name) {
      const timer = window.setTimeout(() => {
        void loadModelById(incomingModelId.name);
        onIncomingConsumed?.();
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [incomingModelId?.name, incomingModelId?.ts, loadModelById, onIncomingConsumed]);

  useEffect(() => {
    return () => {
      stopDownloadPolling();
    };
  }, [stopDownloadPolling]);

  const etaLabel =
    downloadStatus?.etaSeconds != null
      ? downloadStatus.etaSeconds > 120
        ? `~${Math.ceil(downloadStatus.etaSeconds / 60)} min remaining`
        : `~${downloadStatus.etaSeconds}s remaining`
      : null;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">AirLLM</h4>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            status.running
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-muted text-muted-foreground border border-border'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${status.running ? 'bg-green-400' : 'bg-muted-foreground'}`}
          />
          {status.running ? 'Running' : 'Stopped'}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Run Hugging Face models with minimal GPU/CPU memory.{' '}
        {serverUrl && (
          <span>
            Server: <code className="font-mono bg-muted px-1 rounded">{serverUrl}</code>
          </span>
        )}
      </p>

      <div className="flex gap-2">
        {!status.running ? (
          <button
            onClick={() => void handleStart()}
            disabled={loading}
            className="rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {loading ? 'Starting…' : 'Start Server'}
          </button>
        ) : (
          <button
            onClick={() => void handleStop()}
            disabled={loading}
            className="rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {loading ? 'Stopping…' : 'Stop Server'}
          </button>
        )}
      </div>

      {status.running && (
        <div className="space-y-2">
          {status.modelId && (
            <p className="text-xs text-muted-foreground">
              Loaded: <code className="font-mono bg-muted px-1 rounded">{status.modelId}</code>
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && void handleLoadModel()}
              placeholder="meta-llama/Llama-3.2-1B"
              disabled={loading}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            />
            <button
              onClick={() => void handleLoadModel()}
              disabled={loading || !modelId.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {loading ? 'Loading…' : 'Load Model'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Enter a Hugging Face repo ID. First load will download the model. To use it, set Ollama
            URL to <code className="font-mono bg-muted px-1 rounded">{serverUrl}</code>.
          </p>

          {loadingTarget && (
            <div className="space-y-2 bg-muted/20 p-3 rounded-md border border-border mt-3">
              <p className="text-xs font-medium text-foreground flex items-center gap-2">
                <span className="animate-pulse">⏳</span> Downloading & Loading {loadingTarget}...
              </p>
              <p className="text-[10px] text-muted-foreground">
                {downloadStatus?.status || 'Preparing model download...'}
              </p>
              {downloadStatus && (
                <p className="text-[10px] text-muted-foreground">
                  {downloadStatus.downloadedBytes != null
                    ? `${formatBytes(downloadStatus.downloadedBytes)}`
                    : '0 B'}
                  {downloadStatus.totalBytes
                    ? ` / ${formatBytes(downloadStatus.totalBytes)}`
                    : ' downloaded'}
                  {downloadStatus.percent != null ? ` (${downloadStatus.percent.toFixed(1)}%)` : ''}
                  {etaLabel ? ` • ${etaLabel}` : ''}
                </p>
              )}
              {downloadStatus?.downloadedBytes === 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Initializing Hugging Face download metadata. This can take 10-60 seconds before
                  bytes start moving.
                </p>
              )}
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden border border-border/50">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{
                    width:
                      downloadStatus?.percent != null
                        ? `${Math.max(2, Math.min(100, downloadStatus.percent))}%`
                        : '15%',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      {successMessage && <p className="text-xs text-green-400">{successMessage}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combined manager
// ---------------------------------------------------------------------------
export function LocalModelManager({ serverUrl }: LocalModelManagerProps) {
  const [incomingOllama, setIncomingOllama] = useState<{ name: string; ts: number } | null>(null);
  const [incomingAirllm, setIncomingAirllm] = useState<{ name: string; ts: number } | null>(null);

  const handleAdvisorLoad = (model: LlmfitModel, isAirllm: boolean) => {
    const ts = Date.now();
    if (isAirllm || !model.ollamaName) {
      setIncomingAirllm({ name: model.name, ts }); // HuggingFace repo ID
    } else {
      setIncomingOllama({ name: model.ollamaName, ts });
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 mt-4">
      <h3 className="text-sm font-semibold text-foreground">Local Model Manager</h3>
      <HardwareAdvisor onLoadModel={handleAdvisorLoad} />
      <OllamaModelManager
        serverUrl={serverUrl}
        incomingPullName={incomingOllama}
        onIncomingConsumed={() => setIncomingOllama(null)}
      />
      <AirLLMSection
        incomingModelId={incomingAirllm}
        onIncomingConsumed={() => setIncomingAirllm(null)}
      />
    </div>
  );
}
