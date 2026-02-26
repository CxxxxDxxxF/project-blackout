import type {
  SelectedModel,
  OllamaConfig,
  LiteLLMConfig,
  AzureFoundryConfig,
  LMStudioConfig,
} from '../../common/types/provider.js';
import type { ThemePreference, SwarmDefaults } from '../../types/storage.js';
import { getDatabase } from '../database.js';
import { safeParseJsonWithFallback } from '../../utils/json.js';

interface AppSettingsRow {
  id: number;
  debug_mode: number;
  onboarding_complete: number;
  selected_model: string | null;
  ollama_config: string | null;
  litellm_config: string | null;
  azure_foundry_config: string | null;
  lmstudio_config: string | null;
  openai_base_url: string | null;
  theme: string;
  user_name: string;
  system_instructions: string;
  swarm_enabled: number;
  swarm_defaults: string;
}

export interface AppSettings {
  debugMode: boolean;
  onboardingComplete: boolean;
  selectedModel: SelectedModel | null;
  ollamaConfig: OllamaConfig | null;
  litellmConfig: LiteLLMConfig | null;
  azureFoundryConfig: AzureFoundryConfig | null;
  lmstudioConfig: LMStudioConfig | null;
  openaiBaseUrl: string;
  theme: ThemePreference;
  userName: string;
  systemInstructions: string;
  swarmEnabled: boolean;
  swarmDefaults: SwarmDefaults;
}

function getRow(): AppSettingsRow {
  const db = getDatabase();
  return db.prepare('SELECT * FROM app_settings WHERE id = 1').get() as AppSettingsRow;
}

export function getDebugMode(): boolean {
  return getRow().debug_mode === 1;
}

export function setDebugMode(enabled: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET debug_mode = ? WHERE id = 1').run(enabled ? 1 : 0);
}

export function getOnboardingComplete(): boolean {
  return getRow().onboarding_complete === 1;
}

export function setOnboardingComplete(complete: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET onboarding_complete = ? WHERE id = 1').run(complete ? 1 : 0);
}

export function getSelectedModel(): SelectedModel | null {
  const row = getRow();
  if (!row.selected_model) return null;
  try {
    return JSON.parse(row.selected_model) as SelectedModel;
  } catch {
    return null;
  }
}

export function setSelectedModel(model: SelectedModel): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET selected_model = ? WHERE id = 1').run(JSON.stringify(model));
}

export function getOllamaConfig(): OllamaConfig | null {
  const row = getRow();
  if (!row.ollama_config) return null;
  try {
    return JSON.parse(row.ollama_config) as OllamaConfig;
  } catch {
    return null;
  }
}

export function setOllamaConfig(config: OllamaConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET ollama_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getLiteLLMConfig(): LiteLLMConfig | null {
  const row = getRow();
  if (!row.litellm_config) return null;
  try {
    return JSON.parse(row.litellm_config) as LiteLLMConfig;
  } catch {
    return null;
  }
}

export function setLiteLLMConfig(config: LiteLLMConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET litellm_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getAzureFoundryConfig(): AzureFoundryConfig | null {
  const row = getRow();
  if (!row.azure_foundry_config) return null;
  try {
    return JSON.parse(row.azure_foundry_config) as AzureFoundryConfig;
  } catch {
    return null;
  }
}

export function setAzureFoundryConfig(config: AzureFoundryConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET azure_foundry_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getLMStudioConfig(): LMStudioConfig | null {
  const row = getRow();
  if (!row.lmstudio_config) return null;
  try {
    return JSON.parse(row.lmstudio_config) as LMStudioConfig;
  } catch {
    return null;
  }
}

export function setLMStudioConfig(config: LMStudioConfig | null): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET lmstudio_config = ? WHERE id = 1').run(
    config ? JSON.stringify(config) : null,
  );
}

export function getOpenAiBaseUrl(): string {
  const row = getRow();
  return row.openai_base_url || '';
}

export function setOpenAiBaseUrl(baseUrl: string): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET openai_base_url = ? WHERE id = 1').run(baseUrl || '');
}

const VALID_THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export function getTheme(): ThemePreference {
  const row = getRow();
  const value = row.theme as ThemePreference;
  if (VALID_THEMES.includes(value)) {
    return value;
  }
  return 'system';
}

export function setTheme(theme: ThemePreference): void {
  if (!VALID_THEMES.includes(theme)) {
    throw new Error(`Invalid theme value: ${theme}`);
  }
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET theme = ? WHERE id = 1').run(theme);
}

export function getUserName(): string {
  return getRow().user_name || '';
}

export function setUserName(userName: string): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET user_name = ? WHERE id = 1').run(userName || '');
}

export function getSystemInstructions(): string {
  return getRow().system_instructions || '';
}

export function setSystemInstructions(systemInstructions: string): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET system_instructions = ? WHERE id = 1').run(
    systemInstructions || '',
  );
}

export function getSwarmEnabled(): boolean {
  return getRow().swarm_enabled === 1;
}

export function setSwarmEnabled(enabled: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE app_settings SET swarm_enabled = ? WHERE id = 1').run(enabled ? 1 : 0);
}

function sanitizeSwarmDefaults(defaults: SwarmDefaults): SwarmDefaults {
  const normalized: SwarmDefaults = {};
  if (typeof defaults.maxAgents === 'number') {
    normalized.maxAgents = Math.max(1, Math.min(10, Math.floor(defaults.maxAgents)));
  }
  if (defaults.budget) {
    const budget: NonNullable<SwarmDefaults['budget']> = {};
    if (typeof defaults.budget.maxEstimatedTokens === 'number') {
      budget.maxEstimatedTokens = Math.max(1, Math.floor(defaults.budget.maxEstimatedTokens));
    }
    if (typeof defaults.budget.maxWallMs === 'number') {
      budget.maxWallMs = Math.max(1, Math.floor(defaults.budget.maxWallMs));
    }
    if (Object.keys(budget).length > 0) {
      normalized.budget = budget;
    }
  }
  return normalized;
}

export function getSwarmDefaults(): SwarmDefaults {
  const parsed = safeParseJsonWithFallback<SwarmDefaults>(getRow().swarm_defaults, {}) ?? {};
  return sanitizeSwarmDefaults(parsed);
}

export function setSwarmDefaults(defaults: SwarmDefaults): void {
  const db = getDatabase();
  const normalized = sanitizeSwarmDefaults(defaults);
  db.prepare('UPDATE app_settings SET swarm_defaults = ? WHERE id = 1').run(
    JSON.stringify(normalized),
  );
}

export function getAppSettings(): AppSettings {
  const row = getRow();
  return {
    debugMode: row.debug_mode === 1,
    onboardingComplete: row.onboarding_complete === 1,
    selectedModel: safeParseJsonWithFallback<SelectedModel>(row.selected_model),
    ollamaConfig: safeParseJsonWithFallback<OllamaConfig>(row.ollama_config),
    litellmConfig: safeParseJsonWithFallback<LiteLLMConfig>(row.litellm_config),
    azureFoundryConfig: safeParseJsonWithFallback<AzureFoundryConfig>(row.azure_foundry_config),
    lmstudioConfig: safeParseJsonWithFallback<LMStudioConfig>(row.lmstudio_config),
    openaiBaseUrl: row.openai_base_url || '',
    theme: VALID_THEMES.includes(row.theme as ThemePreference)
      ? (row.theme as ThemePreference)
      : 'system',
    userName: row.user_name || '',
    systemInstructions: row.system_instructions || '',
    swarmEnabled: row.swarm_enabled === 1,
    swarmDefaults: sanitizeSwarmDefaults(
      safeParseJsonWithFallback<SwarmDefaults>(row.swarm_defaults, {}) ?? {},
    ),
  };
}

export function clearAppSettings(): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE app_settings SET
      debug_mode = 0,
      onboarding_complete = 0,
      selected_model = NULL,
      ollama_config = NULL,
      litellm_config = NULL,
      azure_foundry_config = NULL,
      lmstudio_config = NULL,
      openai_base_url = '',
      theme = 'system',
      user_name = '',
      system_instructions = '',
      swarm_enabled = 0,
      swarm_defaults = '{}'
    WHERE id = 1`,
  ).run();
}
