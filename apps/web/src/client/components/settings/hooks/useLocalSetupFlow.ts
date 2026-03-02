import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import type {
  ConnectedProvider,
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
      const localStatus = accomplish.getLocalSetupStatus
        ? await accomplish.getLocalSetupStatus()
        : {
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
              activeEngine: 'ollama' as const,
            },
          };
      setOllamaReachable(localStatus.ollama.reachable);
      setOllamaModelCount(localStatus.ollama.modelCount);
      setAirllmRunning(localStatus.airllm.running);
      setAirllmModelId(localStatus.airllm.modelId ?? null);
      setAirllmServerUrl(localStatus.airllm.serverUrl || AIRLLM_SERVER_URL);
      setFitllmInstalled(localStatus.llmfit.installed);
      persistRouting(localStatus.routing.activeEngine);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load local setup status');
    } finally {
      setLoading(false);
    }
  }, [persistRouting, serverUrl]);

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
          throw new Error(result.error || 'Failed to install model');
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
    [onModelChange, refreshStatus, selectedModelId, serverUrl, syncOllamaModels],
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
            throw new Error(started.error || 'Failed to start AirLLM');
          }
        }
        const loaded = await accomplish.airllmLoadModel(modelId);
        if (!loaded.success) {
          throw new Error(loaded.error || 'Failed to load model');
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
    [airllmRunning, persistRouting, refreshStatus],
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

  const runFastSetup = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      if (!isConnected) {
        await connectToOllama(serverUrl);
      }

      await refreshStatus();

      if (ollamaModelCount === 0) {
        const recommendation =
          recommendations.find((r) => r.ollamaName)?.ollamaName ||
          FALLBACK_RECOMMENDATIONS[1]?.ollamaName ||
          'llama3.2:3b';
        await installToOllama(recommendation);
      } else {
        const synced = await syncOllamaModels(serverUrl);
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
    ollamaModelCount,
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
  }, [refreshRecommendations, refreshStatus]);

  const stepStatus = useMemo(() => {
    const detect: SetupStepStatus = loading ? 'running' : ollamaReachable ? 'done' : 'error';
    const connect: SetupStepStatus = isConnected ? 'done' : ollamaReachable ? 'pending' : 'error';
    const modelsReady = ollamaModelCount > 0 || !!airllmModelId;
    const ensureModel: SetupStepStatus = modelsReady ? 'done' : 'pending';
    const ready: SetupStepStatus =
      isConnected && selectedModelId ? 'done' : modelsReady ? 'pending' : 'pending';
    return { detect, connect, ensureModel, ready };
  }, [airllmModelId, isConnected, loading, ollamaModelCount, ollamaReachable, selectedModelId]);

  const canOfferAirllmFallback = !ollamaReachable && airllmRunning;

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
    stepStatus,
    canOfferAirllmFallback,
    refreshStatus,
    connectToOllama,
    installToOllama,
    loadWithAirllm,
    switchRoutingToOllama,
    keepAirllmRouting,
    runFastSetup,
  };
}
