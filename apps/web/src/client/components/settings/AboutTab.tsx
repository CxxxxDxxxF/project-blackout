import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LanguageSelector } from './LanguageSelector';

interface AboutTabProps {
  appVersion: string;
  accomplish: {
    getUserName: () => Promise<string>;
    setUserName: (userName: string) => Promise<void>;
    getSystemInstructions: () => Promise<string>;
    setSystemInstructions: (systemInstructions: string) => Promise<void>;
    getSoulMarkdown: () => Promise<string>;
    setSoulMarkdown: (markdown: string) => Promise<void>;
    getSwarmSettings: () => Promise<{
      enabled: boolean;
      defaults?: { maxAgents?: number };
    }>;
    setSwarmSettings: (payload: {
      enabled?: boolean;
      defaults?: { maxAgents?: number };
    }) => Promise<void>;
  };
}

export function AboutTab({ appVersion, accomplish }: AboutTabProps) {
  const { t } = useTranslation('settings');
  const [userName, setUserName] = useState('');
  const [systemInstructions, setSystemInstructions] = useState('');
  const [soulMarkdown, setSoulMarkdown] = useState('');
  const [swarmEnabled, setSwarmEnabled] = useState(false);
  const [swarmMaxAgents, setSwarmMaxAgents] = useState(3);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [loadedUserName, loadedSystemInstructions, loadedSoulMarkdown, loadedSwarm] =
          await Promise.all([
            accomplish.getUserName(),
            accomplish.getSystemInstructions(),
            accomplish.getSoulMarkdown(),
            accomplish.getSwarmSettings(),
          ]);
        if (!mounted) {
          return;
        }
        setUserName(loadedUserName);
        setSystemInstructions(loadedSystemInstructions);
        setSoulMarkdown(loadedSoulMarkdown);
        setSwarmEnabled(Boolean(loadedSwarm.enabled));
        setSwarmMaxAgents(loadedSwarm.defaults?.maxAgents ?? 3);
      } catch (error) {
        if (!mounted) {
          return;
        }
        setSaveState('error');
        setSaveError(error instanceof Error ? error.message : 'Failed to load settings');
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [accomplish]);

  const handleSave = async () => {
    setSaveState('saving');
    setSaveError('');

    try {
      await Promise.all([
        accomplish.setUserName(userName),
        accomplish.setSystemInstructions(systemInstructions),
        accomplish.setSoulMarkdown(soulMarkdown),
        accomplish.setSwarmSettings({
          enabled: swarmEnabled,
          defaults: { maxAgents: swarmMaxAgents },
        }),
      ]);
      setSaveState('saved');
      window.setTimeout(() => {
        setSaveState('idle');
      }, 2000);
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'Failed to save settings');
    }
  };

  return (
    <div className="space-y-6">
      <LanguageSelector />

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <div className="text-sm text-muted-foreground">Your Name</div>
          <Input
            value={userName}
            onChange={(e) => {
              setUserName(e.target.value);
            }}
            placeholder="Add your name"
            data-testid="settings-user-name-input"
            className="mt-2"
          />
        </div>

        <div>
          <div className="text-sm text-muted-foreground">System Prompt</div>
          <Textarea
            value={systemInstructions}
            onChange={(e) => {
              setSystemInstructions(e.target.value);
            }}
            placeholder="Set your default system prompt/instructions for the assistant"
            data-testid="settings-system-instructions-input"
            className="mt-2 min-h-28"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            This is saved and reused as your default behavior prompt.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          data-testid="settings-profile-save-button"
        >
          {saveState === 'saving' ? 'Saving...' : 'Save'}
        </button>

        {saveState === 'saved' && (
          <div className="text-sm text-green-600 dark:text-green-400">Saved</div>
        )}
        {saveState === 'error' && (
          <div className="text-sm text-destructive">{saveError || 'Save failed'}</div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-sm text-muted-foreground">Swarm Orchestration (Beta)</div>
        <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <span className="text-sm">Enable Swarm Mode toggle on Home</span>
          <input
            type="checkbox"
            checked={swarmEnabled}
            onChange={(e) => setSwarmEnabled(e.target.checked)}
            data-testid="settings-swarm-enabled"
          />
        </label>
        <div>
          <div className="text-sm text-muted-foreground">Default Max Agents</div>
          <Input
            type="number"
            min={1}
            max={3}
            value={swarmMaxAgents}
            onChange={(e) =>
              setSwarmMaxAgents(Math.max(1, Math.min(3, Number(e.target.value) || 1)))
            }
            data-testid="settings-swarm-max-agents"
            className="mt-2 max-w-28"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm text-muted-foreground">SOUL.md</div>
        <Textarea
          value={soulMarkdown}
          onChange={(e) => {
            setSoulMarkdown(e.target.value);
          }}
          data-testid="settings-soul-markdown"
          className="mt-2 min-h-48 font-mono text-xs"
        />
        <p className="mt-2 text-xs text-muted-foreground">Edits are saved when you click Save.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="space-y-4">
          <div>
            <div className="text-sm text-muted-foreground">{t('about.visitUs')}</div>
            <a
              href="https://www.accomplish.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              www.accomplish.ai
            </a>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">{t('about.haveQuestion')}</div>
            <a href="mailto:support@accomplish.ai" className="text-primary hover:underline">
              support@accomplish.ai
            </a>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">{t('about.versionLabel')}</div>
            <div className="font-medium">{appVersion || t('about.loading')}</div>
          </div>
        </div>
        <div className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
          {t('about.allRightsReserved')}
        </div>
      </div>
    </div>
  );
}
