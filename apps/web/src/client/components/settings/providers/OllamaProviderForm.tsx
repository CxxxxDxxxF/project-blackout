import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { settingsVariants, settingsTransitions } from '@/lib/animations';
import type {
  ConnectedProvider,
  OllamaCredentials,
  ToolSupportStatus,
} from '@accomplish_ai/agent-core/common';
import {
  ConnectButton,
  ConnectedControls,
  ProviderFormHeader,
  FormError,
  ModelSelector,
} from '../shared';
import { LocalModelManager } from './LocalModelManager';
import { useLocalSetupFlow } from '../hooks/useLocalSetupFlow';

import ollamaLogo from '/assets/ai-logos/ollama.svg';

const LOCAL_SETUP_GUIDED_FLOW =
  import.meta.env.DEV || import.meta.env.VITE_LOCAL_SETUP_GUIDED_FLOW === '1';

interface OllamaModel {
  id: string;
  name: string;
  toolSupport?: ToolSupportStatus;
}

interface OllamaProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

function SetupStep({
  title,
  status,
  t,
}: {
  title: string;
  status: 'pending' | 'running' | 'done' | 'error';
  t: (key: string) => string;
}) {
  const styles = {
    pending: 'border-border bg-muted/40 text-muted-foreground',
    running: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    done: 'border-green-500/30 bg-green-500/10 text-green-300',
    error: 'border-red-500/30 bg-red-500/10 text-red-300',
  };
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${styles[status]}`}>
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 opacity-90">{t(`localSetup.stepStatus.${status}`)}</div>
    </div>
  );
}

function mapOllamaConnectionError(rawError: string, serverUrl: string): string {
  const message = rawError.toLowerCase();

  if (
    message.includes('econnrefused') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('fetch failed')
  ) {
    return `Cannot reach Ollama at ${serverUrl}. Start Ollama first ("ollama serve"), then retry.`;
  }

  if (message.includes('404')) {
    return `Connected to ${serverUrl}, but this does not look like an Ollama server. Check the URL.`;
  }

  if (message.includes('timeout') || message.includes('abort')) {
    return `Connection to ${serverUrl} timed out. Make sure Ollama is running and retry.`;
  }

  return rawError;
}

function ToolSupportBadge({
  status,
  t,
}: {
  status: ToolSupportStatus;
  t: (key: string) => string;
}) {
  const config = {
    supported: {
      label: t('toolBadge.supported'),
      className: 'bg-green-500/20 text-green-400 border-green-500/30',
      icon: (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
    unsupported: {
      label: t('toolBadge.unsupported'),
      className: 'bg-red-500/20 text-red-400 border-red-500/30',
      icon: (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      ),
    },
    unknown: {
      label: t('toolBadge.unknown'),
      className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      icon: (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01" />
        </svg>
      ),
    },
  };

  const { label, className, icon } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {icon}
      {label}
    </span>
  );
}

function OllamaModelSelector({
  models,
  value,
  onChange,
  error,
}: {
  models: OllamaModel[];
  value: string | null;
  onChange: (modelId: string) => void;
  error: boolean;
}) {
  const { t } = useTranslation('settings');
  const sortedModels = [...models].sort((a, b) => {
    const order: Record<ToolSupportStatus, number> = { supported: 0, unknown: 1, unsupported: 2 };
    const aOrder = order[a.toolSupport || 'unknown'];
    const bOrder = order[b.toolSupport || 'unknown'];
    return aOrder - bOrder;
  });

  const selectorModels = sortedModels.map((model) => {
    const toolSupport = model.toolSupport || 'unknown';
    const toolIcon = toolSupport === 'supported' ? '✓' : toolSupport === 'unsupported' ? '✗' : '?';
    return {
      id: model.id,
      name: `${model.name} ${toolIcon}`,
    };
  });

  const selectedModel = models.find((m) => m.id === value);
  const hasUnsupportedSelected = selectedModel?.toolSupport === 'unsupported';
  const hasUnknownSelected = selectedModel?.toolSupport === 'unknown';

  return (
    <div>
      <ModelSelector models={selectorModels} value={value} onChange={onChange} error={error} />

      {hasUnsupportedSelected && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <svg
            className="h-5 w-5 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="font-medium">{t('common.toolUnsupported')}</p>
            <p className="text-red-400/80 mt-1">{t('common.toolUnsupportedDetail')}</p>
          </div>
        </div>
      )}

      {hasUnknownSelected && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-400">
          <svg
            className="h-5 w-5 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="font-medium">{t('common.toolUnknown')}</p>
            <p className="text-yellow-400/80 mt-1">{t('common.toolUnknownDetail')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function OllamaProviderForm({
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: OllamaProviderFormProps) {
  const { t } = useTranslation('settings');
  const [serverUrl, setServerUrl] = useState('http://localhost:11434');
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [hasSyncedModels, setHasSyncedModels] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(false);

  const isConnected = connectedProvider?.connectionStatus === 'connected';

  const syncAvailableModels = useCallback((models: OllamaModel[]) => {
    setAvailableModels(models);
    setHasSyncedModels(true);
  }, []);

  const {
    loading: setupLoading,
    actionLoading,
    error: setupError,
    ollamaReachable,
    ollamaModelCount,
    airllmRunning,
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
  } = useLocalSetupFlow({
    serverUrl,
    connectedProvider,
    onConnect,
    onModelChange,
    onModelsSynced: syncAvailableModels,
  });

  const handleConnect = async () => {
    try {
      await connectToOllama(serverUrl);
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('status.connectionFailed');
      console.error('[Ollama] connect failed:', mapOllamaConnectionError(message, serverUrl));
    }
  };

  const sourceModels = hasSyncedModels
    ? availableModels
    : (connectedProvider?.availableModels as OllamaModel[] | undefined) || availableModels;

  const models: OllamaModel[] = sourceModels.map((m) => ({
    id: m.id,
    name: m.name,
    toolSupport: (m as { toolSupport?: ToolSupportStatus }).toolSupport || 'unknown',
  }));

  return (
    <div
      className="rounded-xl border border-border bg-card p-5"
      data-testid="provider-settings-panel"
    >
      <ProviderFormHeader logoSrc={ollamaLogo} providerName={t('providers.ollama')} invertInDark />

      <div className="space-y-3">
        {LOCAL_SETUP_GUIDED_FLOW && (
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{t('localSetup.title')}</p>
                <p className="text-xs text-muted-foreground">{t('localSetup.subtitle')}</p>
              </div>
              <button
                onClick={() => void runFastSetup()}
                disabled={setupLoading || actionLoading}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                {actionLoading
                  ? t('localSetup.actions.working')
                  : t('localSetup.actions.fastSetup')}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <SetupStep
                title={t('localSetup.steps.detectOllama')}
                status={stepStatus.detect}
                t={t}
              />
              <SetupStep
                title={t('localSetup.steps.connectEndpoint')}
                status={stepStatus.connect}
                t={t}
              />
              <SetupStep
                title={t('localSetup.steps.ensureModel')}
                status={stepStatus.ensureModel}
                t={t}
              />
              <SetupStep title={t('localSetup.steps.ready')} status={stepStatus.ready} t={t} />
            </div>

            {!ollamaReachable && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <p>{t('localSetup.ollamaUnreachable')}</p>
                <p className="mt-1 text-amber-200/90">
                  <code className="rounded bg-amber-950/20 px-1">ollama serve</code>
                </p>
              </div>
            )}

            {setupError && <FormError error={setupError} />}

            {routingEngine === 'airllm' && (
              <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-xs text-primary-foreground/90">
                <p>{t('localSetup.routing.airllmActive', { url: airllmServerUrl })}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void switchRoutingToOllama()}
                    className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted"
                  >
                    {t('localSetup.routing.switchToOllama')}
                  </button>
                  <button
                    onClick={() => void keepAirllmRouting()}
                    className="rounded-md border border-primary/40 bg-primary/20 px-2.5 py-1 text-xs text-primary hover:bg-primary/30"
                  >
                    {t('localSetup.routing.keepAirllm')}
                  </button>
                </div>
              </div>
            )}

            {ollamaModelCount === 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">
                  {t('localSetup.recommendedTitle')}
                </p>
                <div className="grid gap-2">
                  {recommendations.slice(0, 3).map((model) => (
                    <div
                      key={model.id}
                      className="flex flex-col gap-2 rounded-md border border-border bg-background/50 p-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{model.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {model.source === 'fitllm'
                            ? t('localSetup.sources.fitllm')
                            : t('localSetup.sources.fallback')}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {model.ollamaName && (
                          <button
                            onClick={() => void installToOllama(model.ollamaName!)}
                            disabled={actionLoading}
                            className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                          >
                            {t('localSetup.actions.installToOllama')}
                          </button>
                        )}
                        <button
                          onClick={() => void loadWithAirllm(model.id)}
                          disabled={actionLoading}
                          className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {t('localSetup.actions.loadWithAirllm')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {!fitllmInstalled && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('localSetup.fitllmMissing')}
                  </p>
                )}
              </div>
            )}

            {canOfferAirllmFallback && (
              <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-300">
                <p>{t('localSetup.airllmFallback')}</p>
                <p className="mt-1 text-blue-200/80">
                  {airllmRunning ? t('localSetup.airllmRunning') : t('localSetup.airllmStopped')}
                </p>
              </div>
            )}
          </div>
        )}

        <AnimatePresence mode="wait">
          {!isConnected ? (
            <motion.div
              key="disconnected"
              variants={settingsVariants.fadeSlide}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={settingsTransitions.enter}
              className="space-y-3"
            >
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('ollama.serverUrl')}
                </label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  data-testid="ollama-server-url"
                  className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                />
              </div>

              <FormError error={setupError} />

              <div className="rounded-md border border-border bg-muted/20 p-3">
                <button
                  onClick={() => setSetupExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-between text-left text-sm font-medium text-foreground"
                >
                  <span>{t('localSetup.advancedOptions')}</span>
                  <span className="text-xs text-muted-foreground">
                    {setupExpanded ? t('providers.hide') : t('providers.showAll')}
                  </span>
                </button>

                {setupExpanded && (
                  <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                    <p>{t('localSetup.advancedGuide.install')}</p>
                    <p>
                      {t('localSetup.advancedGuide.startServer')}{' '}
                      <code className="rounded bg-muted px-1">ollama serve</code>
                    </p>
                    <p>
                      {t('localSetup.advancedGuide.pullModel')}{' '}
                      <code className="rounded bg-muted px-1">ollama pull llama3.2:3b</code>
                    </p>
                    <p>{t('localSetup.advancedGuide.connect')}</p>
                  </div>
                )}
              </div>

              <ConnectButton onClick={handleConnect} connecting={actionLoading} />
            </motion.div>
          ) : (
            <motion.div
              key="connected"
              variants={settingsVariants.fadeSlide}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={settingsTransitions.enter}
              className="space-y-3"
            >
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  {t('ollama.serverUrl')}
                </label>
                <input
                  type="text"
                  value={
                    (connectedProvider?.credentials as OllamaCredentials)?.serverUrl ||
                    'http://localhost:11434'
                  }
                  disabled
                  className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground"
                />
              </div>

              <ConnectedControls onDisconnect={onDisconnect} />

              <OllamaModelSelector
                models={models}
                value={connectedProvider?.selectedModelId || null}
                onChange={onModelChange}
                error={showModelError && !connectedProvider?.selectedModelId}
              />

              {models.length === 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                  {t('localSetup.noModelsConnected')}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ToolSupportBadge status="supported" t={t} />
                  <span>{t('common.functionCallingVerified')}</span>
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="pt-4 mt-4 border-t border-border/50">
          <button
            onClick={() => setSetupExpanded((prev) => !prev)}
            className="mb-2 flex w-full items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2 text-left text-sm font-medium text-foreground"
          >
            <span>{t('localSetup.advancedOptions')}</span>
            <span className="text-xs text-muted-foreground">
              {setupExpanded ? t('providers.hide') : t('providers.showAll')}
            </span>
          </button>
          {setupExpanded && (
            <LocalModelManager
              serverUrl={
                isConnected
                  ? (connectedProvider?.credentials as OllamaCredentials)?.serverUrl ||
                    'http://localhost:11434'
                  : serverUrl
              }
              onModelsChange={(modelsFromManager) => {
                syncAvailableModels(
                  modelsFromManager.map((m) => ({
                    id: `ollama/${m.name}`,
                    name: m.name,
                    toolSupport: 'unknown',
                  })),
                );
              }}
              onAirllmRouted={(url) => {
                if (url) {
                  void keepAirllmRouting();
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
