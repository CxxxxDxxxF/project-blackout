import { useState, useEffect, useCallback, useRef } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { motion, AnimatePresence } from 'framer-motion';
import { type LlmfitModel } from './HardwareAdvisor';
import type { LocalSetupErrorCode } from '@accomplish_ai/agent-core/common';

// ── Types ────────────────────────────────────────────────────────────────────

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

interface LlmfitScanResult {
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

interface LocalModelManagerProps {
  serverUrl: string;
  onModelsChange?: (models: OllamaModel[]) => void;
  onAirllmRouted?: (url: string) => void;
}

function isAirllmDependencyError(
  message: string | null,
  code?: LocalSetupErrorCode | null,
): boolean {
  if (code === 'AIRLLM_DEPS_MISSING') {
    return true;
  }
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return (
    normalized.includes('airllm package is not installed') ||
    normalized.includes('airllm dependencies are missing') ||
    normalized.includes('modulenotfounderror') ||
    normalized.includes('no module named')
  );
}

function mapAirllmError(
  code: LocalSetupErrorCode | undefined,
  message: string,
  serverUrl: string,
): string {
  if (code === 'AIRLLM_DEPS_MISSING') {
    return 'AirLLM dependencies are missing. Install dependencies below, then retry.';
  }
  if (code === 'AIRLLM_SERVER_UNREACHABLE') {
    return `AirLLM server is unreachable at ${serverUrl}. Start or restart AirLLM, then retry.`;
  }
  if (code === 'AIRLLM_MODEL_LOAD_FAILED') {
    return message || 'AirLLM model load failed. Retry the load action.';
  }
  return message;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function FitBadge({ fit }: { fit: string }) {
  const styles: Record<string, string> = {
    Perfect: 'bg-green-500/20 text-green-400 border-green-500/30',
    Good: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    Marginal: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };
  const cls = styles[fit] ?? 'bg-red-500/20 text-red-400 border-red-500/30';
  return (
    <span
      className={`border px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {fit}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function LocalModelManager({
  serverUrl,
  onModelsChange,
  onAirllmRouted,
}: LocalModelManagerProps) {
  // Ollama
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  // AirLLM
  const [airllmStatus, setAirllmStatus] = useState<AirLLMStatus>({ running: false });
  const [airllmModelId, setAirllmModelId] = useState('');
  const [airllmLoading, setAirllmLoading] = useState(false);
  const [airllmLoadingTarget, setAirllmLoadingTarget] = useState<string | null>(null);
  const [airllmError, setAirllmError] = useState<string | null>(null);
  const [airllmErrorCode, setAirllmErrorCode] = useState<LocalSetupErrorCode | null>(null);
  const [airllmSuccess, setAirllmSuccess] = useState<string | null>(null);
  const [airllmServerUrl, setAirllmServerUrl] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<AirLLMDownloadStatus | null>(null);
  const [installingDeps, setInstallingDeps] = useState(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [showAirllm, setShowAirllm] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  // FitLLM / Hardware Advisor
  const [fitInstalled, setFitInstalled] = useState<boolean | null>(null);
  const [fitScanning, setFitScanning] = useState(false);
  const [fitScanTarget, setFitScanTarget] = useState<'ollama' | 'airllm'>('ollama');
  const [fitResult, setFitResult] = useState<LlmfitScanResult | null>(null);
  const [fitRankMap, setFitRankMap] = useState<Map<string, LlmfitModel>>(new Map());

  // ── Ollama Logic ─────────────────────────────────────────────────────────────

  const mapModelError = useCallback(
    (raw: string) => {
      const msg = raw.toLowerCase();
      if (
        msg.includes('econnrefused') ||
        msg.includes('failed to fetch') ||
        msg.includes('fetch failed')
      )
        return `Cannot reach Ollama at ${serverUrl}. Run "ollama serve" to start it.`;
      if (msg.includes('404'))
        return `Connected to ${serverUrl}, but this doesn't look like Ollama. Check the URL.`;
      if (msg.includes('manifest') || msg.includes('not found'))
        return `Model not found in Ollama registry. Try a known tag like "llama3.2:3b".`;
      return raw;
    },
    [serverUrl],
  );

  const fetchOllamaModels = useCallback(async () => {
    const result = await getAccomplish().ollamaListModels(serverUrl);
    if (result.success && result.models) {
      setOllamaModels(result.models);
      onModelsChange?.(result.models);
      setDeleteError(null);
    } else if (!result.success && result.error) {
      setDeleteError(mapModelError(result.error));
    }
  }, [mapModelError, onModelsChange, serverUrl]);

  const refreshOllama = useCallback(async () => {
    setOllamaLoading(true);
    await fetchOllamaModels();
    setOllamaLoading(false);
  }, [fetchOllamaModels]);

  useEffect(() => {
    void fetchOllamaModels();
  }, [fetchOllamaModels]);

  useEffect(() => {
    const accomplish = getAccomplish();
    if (!accomplish.onOllamaPullProgress) return;
    return accomplish.onOllamaPullProgress((data) => {
      setPullProgress({ status: data.status, completed: data.completed, total: data.total });
    });
  }, []);

  const handleDelete = useCallback(
    async (name: string) => {
      setDeleteError(null);
      const result = await getAccomplish().ollamaDeleteModel(name, serverUrl);
      if (result.success) await refreshOllama();
      else setDeleteError(mapModelError(result.error ?? 'Delete failed'));
    },
    [mapModelError, refreshOllama, serverUrl],
  );

  const pullModel = useCallback(
    async (name: string) => {
      const target = name.trim();
      if (!target) return;
      setPulling(true);
      setPullError(null);
      setPullProgress(null);
      const result = await getAccomplish().ollamaPullModel(target, serverUrl);
      setPulling(false);
      setPullProgress(null);
      if (result.success) {
        setPullName('');
        await refreshOllama();
      } else {
        setPullError(mapModelError(result.error ?? 'Pull failed'));
      }
    },
    [mapModelError, refreshOllama, serverUrl],
  );

  // ── AirLLM Logic ────────────────────────────────────────────────────────────

  const stopPoll = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchDlStatus = useCallback(async () => {
    setDownloadStatus(await getAccomplish().airllmDownloadStatus());
  }, []);

  const startPoll = useCallback(() => {
    stopPoll();
    void fetchDlStatus();
    pollTimerRef.current = window.setInterval(() => void fetchDlStatus(), 1000);
  }, [fetchDlStatus, stopPoll]);

  const refreshAirllm = useCallback(async () => {
    setAirllmStatus(await getAccomplish().airllmStatus());
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshAirllm();
      const { url } = await getAccomplish().airllmServerUrl();
      setAirllmServerUrl(url);
    })();
  }, [refreshAirllm]);

  useEffect(() => {
    const accomplish = getAccomplish();
    if (!accomplish.onAirllmInstallProgress) return;
    return accomplish.onAirllmInstallProgress((data) => {
      setInstallLogs((prev) => [...prev.slice(-120), data.message]);
    });
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const handleInstallDeps = useCallback(async () => {
    setInstallingDeps(true);
    setAirllmError(null);
    setAirllmErrorCode(null);
    setInstallLogs(['Installing AirLLM dependencies...']);
    const result = await getAccomplish().airllmInstallDependencies();
    setInstallingDeps(false);
    if (!result.success) {
      setAirllmErrorCode(result.code ?? null);
      setAirllmError(
        mapAirllmError(result.code, result.error ?? 'Install failed', airllmServerUrl || ''),
      );
    } else {
      setAirllmSuccess('Dependencies installed successfully.');
      setAirllmErrorCode(null);
    }
  }, [airllmServerUrl]);

  const handleAirllmToggle = useCallback(async () => {
    setAirllmLoading(true);
    setAirllmError(null);
    if (airllmStatus.running) {
      await getAccomplish().airllmStop();
    } else {
      const result = await getAccomplish().airllmStart();
      if (!result.success) {
        setAirllmErrorCode(result.code ?? null);
        setAirllmError(
          mapAirllmError(
            result.code,
            result.error ?? 'Failed to start AirLLM',
            airllmServerUrl || '',
          ),
        );
      }
    }
    setAirllmLoading(false);
    await refreshAirllm();
  }, [airllmServerUrl, airllmStatus.running, refreshAirllm]);

  const loadAirllmModel = useCallback(
    async (targetId: string) => {
      const target = targetId.trim();
      if (!target) {
        return;
      }
      setAirllmLoading(true);
      setAirllmLoadingTarget(target);
      setAirllmError(null);
      setAirllmErrorCode(null);
      setAirllmSuccess(null);
      setDownloadStatus({
        active: true,
        phase: 'starting',
        model: target,
        status: 'Preparing download…',
      });
      startPoll();
      const accomplish = getAccomplish();

      if (!airllmStatus.running) {
        const started = await accomplish.airllmStart();
        if (!started.success) {
          stopPoll();
          setAirllmLoadingTarget(null);
          setAirllmLoading(false);
          setAirllmErrorCode(started.code ?? null);
          setAirllmError(
            mapAirllmError(
              started.code,
              started.error ?? 'Failed to start AirLLM',
              airllmServerUrl || '',
            ),
          );
          await refreshAirllm();
          return;
        }
      }

      const result = await accomplish.airllmLoadModel(target);
      stopPoll();
      await fetchDlStatus();
      setAirllmLoadingTarget(null);
      setAirllmLoading(false);
      if (!result.success) {
        setAirllmErrorCode(result.code ?? null);
        setAirllmError(
          mapAirllmError(
            result.code,
            result.error ?? 'Failed to load model',
            airllmServerUrl || '',
          ),
        );
        setShowAirllm(true);
      } else {
        if (airllmServerUrl) {
          const current = await accomplish.getOllamaConfig();
          await accomplish.setOllamaConfig({
            baseUrl: airllmServerUrl,
            enabled: true,
            lastValidated: Date.now(),
            models: current?.models,
          });
          onAirllmRouted?.(airllmServerUrl);
        }
        setAirllmSuccess('Model loaded. Connection routed to AirLLM.');
        setAirllmErrorCode(null);
        setAirllmModelId('');
        await refreshAirllm();
      }
    },
    [
      airllmServerUrl,
      airllmStatus.running,
      fetchDlStatus,
      onAirllmRouted,
      refreshAirllm,
      startPoll,
      stopPoll,
    ],
  );

  // ── FitLLM Logic ────────────────────────────────────────────────────────────

  useEffect(() => {
    getAccomplish()
      .llmfitCheck()
      .then((res) => {
        setFitInstalled(res.installed);
        // Auto-scan hardware on open if fitllm is installed
        if (res.installed) void runFitScan(false);
      })
      .catch(() => setFitInstalled(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runFitScan = useCallback(async (useAirllm: boolean) => {
    setFitScanning(true);
    setFitScanTarget(useAirllm ? 'airllm' : 'ollama');
    setFitResult(null);
    const result: LlmfitScanResult = await getAccomplish()
      .llmfitScan(useAirllm)
      .catch((e: unknown) => ({
        success: false as const,
        error: e instanceof Error ? e.message : 'Unknown error',
      }));
    setFitResult(result);
    // Build a lookup map: ollamaName -> model scored data
    if (result.success && result.models) {
      const map = new Map<string, LlmfitModel>();
      for (const m of result.models) {
        if (m.ollamaName) map.set(m.ollamaName, m);
        map.set(m.name, m);
      }
      setFitRankMap(map);
    }
    setFitScanning(false);
  }, []);

  // Get FitLLM data for an installed ollama model by name
  const getFitData = (modelName: string): LlmfitModel | undefined => {
    // Try exact match, then base name without tag
    return fitRankMap.get(modelName) ?? fitRankMap.get(modelName.split(':')[0]);
  };

  // Suggestions: FitLLM models NOT yet installed
  const installedNames = new Set(ollamaModels.map((m) => m.name));
  const suggestions = fitResult?.success
    ? (fitResult.models ?? []).filter((m) => m.fitLevel !== 'Too Tight').slice(0, 4)
    : [];

  const etaLabel =
    downloadStatus?.etaSeconds != null
      ? downloadStatus.etaSeconds > 120
        ? `~${Math.ceil(downloadStatus.etaSeconds / 60)} min remaining`
        : `~${downloadStatus.etaSeconds}s remaining`
      : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 rounded-xl border border-border bg-card p-4 mt-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Local Model Manager</h3>
        <div className="flex items-center gap-2">
          {fitInstalled && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void runFitScan(false)}
                disabled={fitScanning}
                className="flex items-center gap-1.5 rounded-md bg-primary/10 hover:bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary transition-colors disabled:opacity-50"
              >
                {fitScanning && fitScanTarget === 'ollama' ? (
                  <>
                    <span className="animate-pulse">◉</span> Scanning...
                  </>
                ) : (
                  <>
                    <span>◈</span> Scan for Ollama
                  </>
                )}
              </button>
              <button
                onClick={() => void runFitScan(true)}
                disabled={fitScanning}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors disabled:opacity-50"
              >
                {fitScanning && fitScanTarget === 'airllm' ? (
                  <>
                    <span className="animate-pulse">◉</span> Scanning...
                  </>
                ) : (
                  <>
                    <span>◈</span> Scan for AirLLM
                  </>
                )}
              </button>
            </div>
          )}
          <button
            onClick={() => void refreshOllama()}
            disabled={ollamaLoading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5"
          >
            {ollamaLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Hardware Summary (from FitLLM) ── */}
      <AnimatePresence>
        {fitResult?.success && fitResult.hardware && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-3 text-xs bg-muted/30 px-3 py-2.5 rounded-lg border border-border/50"
          >
            <span className="text-muted-foreground">
              Backend:{' '}
              <span className="text-foreground font-medium">{fitResult.hardware.backend}</span>
            </span>
            <span className="text-border">·</span>
            <span className="text-muted-foreground">
              RAM:{' '}
              <span className="text-foreground font-medium">
                {fitResult.hardware.totalRamGb.toFixed(1)} GB
              </span>
            </span>
            {fitResult.hardware.gpuVramGb > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="text-muted-foreground">
                  VRAM:{' '}
                  <span className="text-foreground font-medium">
                    {fitResult.hardware.gpuVramGb.toFixed(1)} GB
                  </span>
                </span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Installed Models ── */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
          Installed Models
        </h4>

        {ollamaModels.length === 0 && !ollamaLoading && (
          <p className="text-xs text-muted-foreground py-2 italic">
            No models installed yet. Pull a recommended model below.
          </p>
        )}

        <div className="space-y-2">
          {/* Ollama models */}
          {ollamaModels.map((m) => {
            const fit = getFitData(m.name);
            return (
              <div
                key={m.name}
                className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-foreground truncate">{m.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatBytes(m.size)}
                    </span>
                    {fit && <FitBadge fit={fit.fitLevel} />}
                    {fit && (
                      <span className="text-[10px] text-muted-foreground">
                        {fit.estimatedSpeedTps} t/s · {fit.runMode}
                      </span>
                    )}
                  </div>
                  {fit && (
                    <div className="flex gap-2 mt-1">
                      {(['quality', 'speed', 'fit'] as const).map((k) => (
                        <div key={k} className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground capitalize">{k}</span>
                          <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${fit.scores[k]}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void handleDelete(m.name)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-red-400 transition-colors"
                  title={`Delete ${m.name}`}
                >
                  Remove
                </button>
              </div>
            );
          })}

          {/* AirLLM active model */}
          {airllmStatus.running && airllmStatus.modelId && (
            <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-foreground truncate">
                    {airllmStatus.modelId}
                  </span>
                  <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">
                    AirLLM
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  HuggingFace model · Server:{' '}
                  <code className="bg-muted px-1 rounded">{airllmServerUrl}</code>
                </p>
              </div>
            </div>
          )}
        </div>

        {deleteError && <p className="mt-2 text-xs text-red-400">{deleteError}</p>}
      </div>

      {/* ── Recommended Models (FitLLM suggestions not yet installed) ── */}
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2.5"
          >
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Recommended for Your Hardware
            </h4>
            <div className="grid gap-2">
              {suggestions.map((model, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 hover:border-primary/40 px-3 py-2.5 transition-colors"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">{model.name}</span>
                      <FitBadge fit={model.fitLevel} />
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {model.quantization} · {model.estimatedSpeedTps} t/s · {model.runMode}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void loadAirllmModel(model.name)}
                      disabled={airllmLoading}
                      className="shrink-0 rounded-md border border-border bg-muted/40 hover:bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors disabled:opacity-50"
                    >
                      {airllmLoading && airllmLoadingTarget === model.name
                        ? 'Loading…'
                        : 'Load with AirLLM'}
                    </button>
                    {model.ollamaName && !installedNames.has(model.ollamaName) && (
                      <button
                        onClick={() => void pullModel(model.ollamaName!)}
                        disabled={pulling}
                        className="shrink-0 rounded-md bg-primary/10 hover:bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary transition-colors disabled:opacity-50"
                      >
                        {pulling ? 'Pulling…' : 'Install to Ollama'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {airllmError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                <p>{airllmError}</p>
                {isAirllmDependencyError(airllmError, airllmErrorCode) && (
                  <button
                    onClick={() => void handleInstallDeps()}
                    disabled={installingDeps}
                    className="mt-2 rounded-md border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    {installingDeps ? 'Installing dependencies…' : 'Install AirLLM dependencies'}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pull progress */}
      <AnimatePresence>
        {pulling && pullProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-1.5 bg-muted/20 p-3 rounded-md border border-border"
          >
            <div className="flex justify-between items-center">
              <p className="text-xs font-medium text-foreground">{pullProgress.status}</p>
              {pullProgress.total != null && pullProgress.total > 0 && (
                <span className="text-xs font-mono text-primary">
                  {Math.round(((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%
                </span>
              )}
            </div>
            {pullProgress.total != null && pullProgress.total > 0 && (
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.round(((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%`,
                  }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Manual Pull ── */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Pull a Model by Name
        </h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !pulling && void pullModel(pullName)}
            placeholder="e.g. llama3.2:3b or qwen2.5:7b"
            disabled={pulling}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
          />
          <button
            onClick={() => void pullModel(pullName)}
            disabled={pulling || !pullName.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            {pulling ? 'Downloading…' : 'Pull'}
          </button>
        </div>
        {pullError && <p className="text-xs text-red-400">{pullError}</p>}
      </div>

      {/* ── AirLLM (HuggingFace) Section ── */}
      <div className="border-t border-border/60 pt-4 space-y-3">
        <button
          onClick={() => setShowAirllm((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              HuggingFace Models (AirLLM)
            </h4>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                airllmStatus.running
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${airllmStatus.running ? 'bg-green-400' : 'bg-muted-foreground'}`}
              />
              {airllmStatus.running ? 'Running' : 'Stopped'}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{showAirllm ? '▲ Hide' : '▼ Show'}</span>
        </button>

        <AnimatePresence>
          {showAirllm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3 overflow-hidden"
            >
              <p className="text-xs text-muted-foreground">
                Run Hugging Face models with minimal memory via the AirLLM engine.
                {airllmServerUrl && (
                  <>
                    {' '}
                    Server:{' '}
                    <code className="font-mono bg-muted px-1 rounded">{airllmServerUrl}</code>
                  </>
                )}
              </p>

              {/* Step 1: Install deps */}
              <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
                <p className="text-xs font-medium text-foreground">Step 1 — Install Dependencies</p>
                <button
                  onClick={() => void handleInstallDeps()}
                  disabled={installingDeps || airllmLoading}
                  className="rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {installingDeps ? 'Installing…' : 'Install Dependencies'}
                </button>
                {installLogs.length > 0 && (
                  <div className="max-h-24 overflow-y-auto rounded bg-background/70 p-2 font-mono text-[10px] text-muted-foreground">
                    {installLogs.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step 2: Start server */}
              <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
                <p className="text-xs font-medium text-foreground">Step 2 — Start AirLLM Server</p>
                <button
                  onClick={() => void handleAirllmToggle()}
                  disabled={airllmLoading || installingDeps}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    airllmStatus.running
                      ? 'border border-border bg-muted/50 text-foreground hover:bg-muted'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  {airllmLoading
                    ? airllmStatus.running
                      ? 'Stopping…'
                      : 'Starting…'
                    : airllmStatus.running
                      ? 'Stop Server'
                      : 'Start Server'}
                </button>
              </div>

              {/* Step 3: Load model */}
              {airllmStatus.running && (
                <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">
                    Step 3 — Load a HuggingFace Model
                  </p>
                  {airllmStatus.modelId && (
                    <p className="text-xs text-muted-foreground">
                      Active:{' '}
                      <code className="font-mono bg-muted px-1 rounded">
                        {airllmStatus.modelId}
                      </code>
                    </p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={airllmModelId}
                      onChange={(e) => setAirllmModelId(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === 'Enter' && !airllmLoading && void loadAirllmModel(airllmModelId)
                      }
                      placeholder="e.g. meta-llama/Llama-3.2-1B"
                      disabled={airllmLoading}
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                    />
                    <button
                      onClick={() => void loadAirllmModel(airllmModelId)}
                      disabled={airllmLoading || !airllmModelId.trim()}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
                    >
                      {airllmLoading ? 'Loading…' : 'Load'}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    First load downloads the model from HuggingFace. Ollama URL will be auto-set to
                    the AirLLM server.
                  </p>

                  {/* Download progress */}
                  {airllmLoadingTarget && (
                    <div className="space-y-1.5 bg-muted/20 p-3 rounded-md border border-border">
                      <p className="text-xs font-medium text-foreground flex items-center gap-2">
                        <span className="animate-pulse">⏳</span>{' '}
                        {downloadStatus?.status || 'Preparing…'}
                      </p>
                      {downloadStatus && (
                        <p className="text-[10px] text-muted-foreground">
                          {downloadStatus.downloadedBytes != null
                            ? formatBytes(downloadStatus.downloadedBytes)
                            : '0 B'}
                          {downloadStatus.totalBytes
                            ? ` / ${formatBytes(downloadStatus.totalBytes)}`
                            : ''}
                          {downloadStatus.percent != null
                            ? ` (${downloadStatus.percent.toFixed(1)}%)`
                            : ''}
                          {etaLabel ? ` · ${etaLabel}` : ''}
                        </p>
                      )}
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{
                            width:
                              downloadStatus?.percent != null
                                ? `${Math.max(2, Math.min(100, downloadStatus.percent))}%`
                                : '10%',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {airllmError && (
                <div className="space-y-2">
                  <p className="text-xs text-red-400">{airllmError}</p>
                  {isAirllmDependencyError(airllmError, airllmErrorCode) && (
                    <button
                      onClick={() => void handleInstallDeps()}
                      disabled={installingDeps}
                      className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {installingDeps ? 'Installing dependencies…' : 'Install AirLLM dependencies'}
                    </button>
                  )}
                </div>
              )}
              {airllmSuccess && <p className="text-xs text-green-400">{airllmSuccess}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
