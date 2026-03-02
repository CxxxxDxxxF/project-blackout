import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import type {
  ConnectedProvider,
  LocalErrorRecord,
  LocalHealthReport,
  LocalSetupErrorCode,
  OllamaCredentials,
  ToolSupportStatus,
} from '@accomplish_ai/agent-core/common';

type SetupStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface GuidedRecommendation {
  id: string;
  name: string;
  ollamaName?: string;
  source: 'fitllm' | 'fallback';
}

interface OllamaModel {
  id: string;
  name: string;
  toolSupport?: ToolSupportStatus;
}

interface UseLocalSetupFlowParams {
  serverUrl: string;
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onModelChange: (modelId: string) => void;
  onModelsSynced?: (models: OllamaModel[]) => void;
}

const LOCAL_ENGINE_PREF_KEY = 'accomplish-local-engine-preference';
const LOCAL_HEALTH_REPORT_V2 =
  import.meta.env.DEV || import.meta.env.VITE_LOCAL_HEALTH_REPORT_V2 === '1';
const LOCAL_ERROR_CODES_V1 =
  import.meta.env.DEV || import.meta.env.VITE_LOCAL_ERROR_CODES_V1 === '1';
const AIRLLM_SERVER_URL = 'http://127.0.0.1:11435';
const FALLBACK_RECOMMENDATIONS: GuidedRecommendation[] = [
  {
    id: 'meta-llama/Llama-3.2-1B',
    name: 'Llama 3.2 1B',
    ollamaName: 'llama3.2:1b',
    source: 'fallback',
  },
  {
    id: 'meta-llama/Llama-3.2-3B',
    name: 'Llama 3.2 3B',
    ollamaName: 'llama3.2:3b',
    source: 'fallback',
  },
  {
    id: 'Qwen/Qwen2.5-3B-Instruct',
    name: 'Qwen 2.5 3B',
    ollamaName: 'qwen2.5:3b',
    source: 'fallback',
  },
];

function normalizeModelId(modelName: string): string {
  return modelName.startsWith('ollama/') ? modelName : `ollama/${modelName}`;
}

function readRoutingPreference(): 'ollama' | 'airllm' {
  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== 'function') {
      return 'ollama';
    }
    const stored = storage.getItem(LOCAL_ENGINE_PREF_KEY);
    return stored === 'airllm' ? 'airllm' : 'ollama';
  } catch {
    return 'ollama';
  }
}

function mapLocalSetupError(
  code: LocalSetupErrorCode | undefined,
  fallbackMessage: string,
  context: { ollamaUrl: string; airllmUrl: string },
): string {
  if (!code) {
    return fallbackMessage;
  }

  if (code === 'AIRLLM_DEPS_MISSING') {
    return 'AirLLM dependencies are missing. Install dependencies in Advanced options, then retry.';
  }
  if (code === 'AIRLLM_SERVER_UNREACHABLE') {
    return `AirLLM server is unreachable at ${context.airllmUrl}. Start AirLLM and retry.`;
  }
  if (code === 'AIRLLM_MODEL_LOAD_FAILED') {
    return fallbackMessage || 'AirLLM model load failed. Retry the load action.';
  }
  if (code === 'OLLAMA_UNREACHABLE') {
    return `Cannot reach Ollama at ${context.ollamaUrl}. Start Ollama ("ollama serve") and retry.`;
  }
  if (code === 'OLLAMA_WRONG_ENDPOINT') {
    return `Connected to ${context.ollamaUrl}, but this endpoint is not an Ollama server.`;
  }
  if (code === 'OLLAMA_NO_MODELS') {
    return 'Ollama is connected but has no local models yet. Install one model and retry.';
  }
  if (code === 'FITLLM_UNAVAILABLE') {
    return 'FitLLM is unavailable. Fallback recommendations are shown instead.';
  }
  return fallbackMessage;
}

export function useLocalSetupFlow({
  serverUrl,
  connectedProvider,
  onConnect,
  onModelChange,
  onModelsSynced,
}: UseLocalSetupFlowParams) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ollamaReachable, setOllamaReachable] = useState(false);
  const [ollamaModelCount, setOllamaModelCount] = useState(0);
  const [airllmRunning, setAirllmRunning] = useState(false);
  const [airllmModelId, setAirllmModelId] = useState<string | null>(null);
  const [airllmServerUrl, setAirllmServerUrl] = useState<string>(AIRLLM_SERVER_URL);
  const [fitllmInstalled, setFitllmInstalled] = useState(false);
  const [recommendations, setRecommendations] =
    useState<GuidedRecommendation[]>(FALLBACK_RECOMMENDATIONS);
  const [routingEngine, setRoutingEngine] = useState<'ollama' | 'airllm'>(() =>
    readRoutingPreference(),
  );
  const [healthReport, setHealthReport] = useState<LocalHealthReport | null>(null);
  const [recentErrors, setRecentErrors] = useState<LocalErrorRecord[]>([]);

  const isConnected = connectedProvider?.connectionStatus === 'connected';
  const selectedModelId = connectedProvider?.selectedModelId ?? null;

  const persistRouting = useCallback((engine: 'ollama' | 'airllm') => {
    setRoutingEngine(engine);
    try {
      const storage = window.localStorage;
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(LOCAL_ENGINE_PREF_KEY, engine);
      }
    } catch {
      // intentionally ignored
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accomplish = getAccomplish();
      let resolvedStatus: {
        ollama: {
          reachable: boolean;
          baseUrl: string;
          modelCount: number;
          error?: string;
        };
        airllm: {
          running: boolean;
          serverUrl?: string;
          modelId?: string | null;
        };
        llmfit: {
          installed: boolean;
        };
        routing: {
          activeEngine: 'ollama' | 'airllm';
        };
      };

      if (LOCAL_HEALTH_REPORT_V2 && accomplish.getLocalHealthReport) {
        const report = await accomplish.getLocalHealthReport();
        setHealthReport(report);
        resolvedStatus = {
          ollama: {
            reachable: report.ollama.reachable,
            baseUrl: report.ollama.baseUrl,
            modelCount: report.ollama.modelCount,
            error: report.ollama.error,
          },
          airllm: {
            running: report.airllm.running,
            serverUrl: report.airllm.serverUrl,
            modelId: report.airllm.modelId ?? null,
          },
          llmfit: {
            installed: report.llmfit.installed,
          },
          routing: {
            activeEngine: report.routing.activeEngine,
          },
        };
      } else if (accomplish.getLocalSetupStatus) {
        resolvedStatus = await accomplish.getLocalSetupStatus();
        setHealthReport(null);
      } else {
        resolvedStatus = {
          ollama: {
            reachable: false,
            baseUrl: serverUrl,
            modelCount: 0,
          },
          airllm: {
            running: false,
            serverUrl: AIRLLM_SERVER_URL,
            modelId: null,
          },
          llmfit: {
            installed: false,
          },
          routing: {
            activeEngine: 'ollama',
          },
        };
        setHealthReport(null);
      }

      setOllamaReachable(resolvedStatus.ollama.reachable);
      setOllamaModelCount(resolvedStatus.ollama.modelCount);
      setAirllmRunning(resolvedStatus.airllm.running);
      setAirllmModelId(resolvedStatus.airllm.modelId ?? null);
      setAirllmServerUrl(resolvedStatus.airllm.serverUrl || AIRLLM_SERVER_URL);
      setFitllmInstalled(resolvedStatus.llmfit.installed);
      persistRouting(resolvedStatus.routing.activeEngine);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load local setup status');
    } finally {
      setLoading(false);
    }
  }, [persistRouting, serverUrl]);

  const refreshRecentErrors = useCallback(async () => {
    try {
      const accomplish = getAccomplish();
      if (!accomplish.getLocalRecentErrors) {
        setRecentErrors([]);
        return;
      }
      const errors = await accomplish.getLocalRecentErrors();
      setRecentErrors(errors);
    } catch {
      setRecentErrors([]);
    }
  }, []);

  const refreshRecommendations = useCallback(async () => {
    try {
      const accomplish = getAccomplish();
      const fitCheck = await accomplish.llmfitCheck();
      setFitllmInstalled(fitCheck.installed);
      if (!fitCheck.installed) {
        setRecommendations(FALLBACK_RECOMMENDATIONS);
        return;
      }

      const result = await accomplish.llmfitScan(false);
      if (!result.success || !result.models?.length) {
        setRecommendations(FALLBACK_RECOMMENDATIONS);
        return;
      }

      const top = result.models
        .filter((m) => m.fitLevel !== 'Too Tight')
        .slice(0, 3)
        .map((m) => ({
          id: m.name,
          name: m.name,
          ollamaName: m.ollamaName,
          source: 'fitllm' as const,
        }));

      setRecommendations(top.length > 0 ? top : FALLBACK_RECOMMENDATIONS);
    } catch {
      setRecommendations(FALLBACK_RECOMMENDATIONS);
    }
  }, []);

  const syncOllamaModels = useCallback(
    async (baseUrl: string) => {
      const accomplish = getAccomplish();
      const result = await accomplish.ollamaListModels(baseUrl);
      if (!result.success || !result.models) {
        return { modelCount: 0, firstModelId: null as string | null };
      }

      const models = result.models.map((m) => ({
        id: normalizeModelId(m.name),
        name: m.name,
        toolSupport: 'unknown' as const,
      }));
      onModelsSynced?.(models);
      return {
        modelCount: models.length,
        firstModelId: models[0]?.id ?? null,
      };
    },
    [onModelsSynced],
  );

  const connectToOllama = useCallback(
    async (url: string) => {
      const accomplish = getAccomplish();
      const result = await accomplish.testOllamaConnection(url);
      if (!result.success) {
        throw new Error(result.error || 'Connection failed');
      }

      const models: OllamaModel[] = (result.models || []).map((m) => ({
        id: normalizeModelId(m.id),
        name: m.displayName,
        toolSupport: m.toolSupport || 'unknown',
      }));

      onModelsSynced?.(models);
      await accomplish.setOllamaConfig({
        baseUrl: url,
        enabled: true,
        lastValidated: Date.now(),
        models: (result.models || []).map((m) => ({
          id: m.id,
          displayName: m.displayName,
          size: m.size,
          toolSupport: m.toolSupport,
        })),
      });

      const provider: ConnectedProvider = {
        providerId: 'ollama',
        connectionStatus: 'connected',
        selectedModelId: connectedProvider?.selectedModelId ?? null,
        credentials: {
          type: 'ollama',
          serverUrl: url,
        } as OllamaCredentials,
        lastConnectedAt: new Date().toISOString(),
        availableModels: models,
      };

      onConnect(provider);
      return models;
    },
    [connectedProvider?.selectedModelId, onConnect, onModelsSynced],
  );

  const installToOllama = useCallback(
    async (modelName: string) => {
      setActionLoading(true);
      setError(null);
      try {
        const accomplish = getAccomplish();
        const result = await accomplish.ollamaPullModel(modelName, serverUrl);
        if (!result.success) {
          throw new Error(
            mapLocalSetupError(
              LOCAL_ERROR_CODES_V1 ? result.code : undefined,
              result.error || 'Failed to install model',
              { ollamaUrl: serverUrl, airllmUrl: airllmServerUrl || AIRLLM_SERVER_URL },
            ),
          );
        }
        const synced = await syncOllamaModels(serverUrl);
        if (!selectedModelId && synced.firstModelId) {
          onModelChange(synced.firstModelId);
        }
        await refreshStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to install model');
      } finally {
        setActionLoading(false);
      }
    },
    [airllmServerUrl, onModelChange, refreshStatus, selectedModelId, serverUrl, syncOllamaModels],
  );

  const loadWithAirllm = useCallback(
    async (modelId: string) => {
      setActionLoading(true);
      setError(null);
      try {
        const accomplish = getAccomplish();
        if (!airllmRunning) {
          const started = await accomplish.airllmStart();
          if (!started.success) {
            throw new Error(
              mapLocalSetupError(
                LOCAL_ERROR_CODES_V1 ? started.code : undefined,
                started.error || 'Failed to start AirLLM',
                { ollamaUrl: serverUrl, airllmUrl: airllmServerUrl || AIRLLM_SERVER_URL },
              ),
            );
          }
        }
        const loaded = await accomplish.airllmLoadModel(modelId);
        if (!loaded.success) {
          throw new Error(
            mapLocalSetupError(
              LOCAL_ERROR_CODES_V1 ? loaded.code : undefined,
              loaded.error || 'Failed to load model',
              { ollamaUrl: serverUrl, airllmUrl: airllmServerUrl || AIRLLM_SERVER_URL },
            ),
          );
        }

        const { url } = await accomplish.airllmServerUrl();
        await accomplish.setOllamaConfig({
          baseUrl: url,
          enabled: true,
          lastValidated: Date.now(),
          models: [],
        });
        persistRouting('airllm');
        setAirllmModelId(modelId);
        setAirllmServerUrl(url);
        await refreshStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load AirLLM model');
      } finally {
        setActionLoading(false);
      }
    },
    [airllmRunning, airllmServerUrl, persistRouting, refreshStatus, serverUrl],
  );

  const switchRoutingToOllama = useCallback(async () => {
    const accomplish = getAccomplish();
    const target =
      (connectedProvider?.credentials as OllamaCredentials | undefined)?.serverUrl ||
      'http://localhost:11434';
    await accomplish.setOllamaConfig({
      baseUrl: target,
      enabled: true,
      lastValidated: Date.now(),
      models: [],
    });
    persistRouting('ollama');
    await refreshStatus();
  }, [connectedProvider?.credentials, persistRouting, refreshStatus]);

  const keepAirllmRouting = useCallback(async () => {
    const accomplish = getAccomplish();
    const target = airllmServerUrl || AIRLLM_SERVER_URL;
    await accomplish.setOllamaConfig({
      baseUrl: target,
      enabled: true,
      lastValidated: Date.now(),
      models: [],
    });
    persistRouting('airllm');
    await refreshStatus();
  }, [airllmServerUrl, persistRouting, refreshStatus]);

  const installAirllmDependencies = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      const accomplish = getAccomplish();
      const result = await accomplish.airllmInstallDependencies();
      if (!result.success) {
        throw new Error(
          mapLocalSetupError(
            LOCAL_ERROR_CODES_V1 ? result.code : undefined,
            result.error || 'Failed to install AirLLM dependencies',
            { ollamaUrl: serverUrl, airllmUrl: airllmServerUrl || AIRLLM_SERVER_URL },
          ),
        );
      }
      await refreshStatus();
      await refreshRecentErrors();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install AirLLM dependencies');
    } finally {
      setActionLoading(false);
    }
  }, [airllmServerUrl, refreshRecentErrors, refreshStatus, serverUrl]);

  const runFastSetup = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      if (!isConnected) {
        await connectToOllama(serverUrl);
      }

      await refreshStatus();
      const synced = await syncOllamaModels(serverUrl);
      if (synced.modelCount === 0) {
        const recommendation =
          recommendations.find((r) => r.ollamaName)?.ollamaName ||
          FALLBACK_RECOMMENDATIONS[1]?.ollamaName ||
          'llama3.2:3b';
        await installToOllama(recommendation);
      } else {
        if (!selectedModelId && synced.firstModelId) {
          onModelChange(synced.firstModelId);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fast setup failed');
    } finally {
      setActionLoading(false);
    }
  }, [
    connectToOllama,
    installToOllama,
    isConnected,
    onModelChange,
    recommendations,
    refreshStatus,
    selectedModelId,
    serverUrl,
    syncOllamaModels,
  ]);

  useEffect(() => {
    void refreshStatus();
    void refreshRecommendations();
    void refreshRecentErrors();
    const timer = window.setInterval(() => {
      void refreshStatus();
      void refreshRecentErrors();
    }, 8000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshRecentErrors, refreshRecommendations, refreshStatus]);

  const clearRecentErrors = useCallback(async () => {
    const accomplish = getAccomplish();
    if (!accomplish.clearLocalRecentErrors) {
      return;
    }
    await accomplish.clearLocalRecentErrors();
    await refreshRecentErrors();
  }, [refreshRecentErrors]);

  const exportDiagnostics = useCallback(async () => {
    const accomplish = getAccomplish();
    if (!accomplish.exportLocalDiagnostics) {
      return null;
    }
    const payload = await accomplish.exportLocalDiagnostics();
    if (payload.path) {
      return payload.path;
    }
    if (payload.blob) {
      const fileName = `accomplish-local-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const blob = new Blob([payload.blob], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(href);
      return fileName;
    }
    return null;
  }, []);

  const stepStatus = useMemo(() => {
    const detect: SetupStepStatus = loading ? 'running' : ollamaReachable ? 'done' : 'error';
    const connect: SetupStepStatus = isConnected ? 'done' : ollamaReachable ? 'pending' : 'error';
    const modelsReady = ollamaModelCount > 0 || !!airllmModelId;
    const ensureModel: SetupStepStatus = modelsReady ? 'done' : 'pending';
    const ready: SetupStepStatus =
      isConnected && selectedModelId ? 'done' : modelsReady ? 'pending' : 'pending';
    return { detect, connect, ensureModel, ready };
  }, [airllmModelId, isConnected, loading, ollamaModelCount, ollamaReachable, selectedModelId]);

  const healthCategory = useMemo(() => {
    if (healthReport?.status) {
      return healthReport.status;
    }
    if (ollamaReachable && (ollamaModelCount > 0 || Boolean(airllmModelId))) {
      return 'ready';
    }
    if (!ollamaReachable) {
      return 'blocked';
    }
    return 'degraded';
  }, [airllmModelId, healthReport?.status, ollamaModelCount, ollamaReachable]);
  const localIssues = healthReport?.issues ?? [];
  const canOfferAirllmFallback =
    (!ollamaReachable || localIssues.includes('OLLAMA_UNREACHABLE')) && airllmRunning;

  return {
    loading,
    actionLoading,
    error,
    ollamaReachable,
    ollamaModelCount,
    airllmRunning,
    airllmModelId,
    airllmServerUrl,
    fitllmInstalled,
    recommendations,
    routingEngine,
    healthCategory,
    healthReport,
    localIssues,
    recentErrors,
    stepStatus,
    canOfferAirllmFallback,
    refreshStatus,
    refreshRecentErrors,
    connectToOllama,
    installToOllama,
    loadWithAirllm,
    installAirllmDependencies,
    switchRoutingToOllama,
    keepAirllmRouting,
    clearRecentErrors,
    exportDiagnostics,
    runFastSetup,
  };
}
