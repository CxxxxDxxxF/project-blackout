import type { ProviderId, ConnectedProvider } from '../common/types/providerSettings.js';

export type SwarmRole = 'researcher' | 'coder' | 'reviewer';

export interface SwarmRouteSelection {
  providerId: ProviderId;
  modelId: string;
}

const ROLE_PROVIDER_PREFERENCES: Record<SwarmRole, ProviderId[]> = {
  researcher: ['openai', 'anthropic', 'google', 'openrouter', 'ollama'],
  coder: ['anthropic', 'openai', 'deepseek', 'google', 'ollama'],
  reviewer: ['openai', 'anthropic', 'google', 'openrouter', 'lmstudio'],
};

function isProviderReady(provider: ConnectedProvider | undefined): provider is ConnectedProvider {
  return !!provider && provider.connectionStatus === 'connected' && !!provider.selectedModelId;
}

export function selectSwarmRoute(
  role: SwarmRole,
  readyProviders: ConnectedProvider[],
  fallback?: {
    providerId?: ProviderId;
    modelId?: string;
  },
): SwarmRouteSelection | null {
  const providersById = new Map<ProviderId, ConnectedProvider>();
  for (const provider of readyProviders) {
    if (isProviderReady(provider)) {
      providersById.set(provider.providerId, provider);
    }
  }

  for (const providerId of ROLE_PROVIDER_PREFERENCES[role]) {
    const provider = providersById.get(providerId);
    if (provider?.selectedModelId) {
      return {
        providerId: provider.providerId,
        modelId: provider.selectedModelId,
      };
    }
  }

  if (fallback?.providerId && fallback.modelId) {
    return { providerId: fallback.providerId, modelId: fallback.modelId };
  }

  const first = readyProviders.find((provider) => isProviderReady(provider));
  if (!first?.selectedModelId) {
    return null;
  }

  return {
    providerId: first.providerId,
    modelId: first.selectedModelId,
  };
}
