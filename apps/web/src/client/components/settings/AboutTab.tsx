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
  };
}

export function AboutTab({ appVersion, accomplish }: AboutTabProps) {
  const { t } = useTranslation('settings');
  const [userName, setUserName] = useState('');
  const [systemInstructions, setSystemInstructions] = useState('');
  const [soulMarkdown, setSoulMarkdown] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [loadedUserName, loadedSystemInstructions, loadedSoulMarkdown] = await Promise.all([
          accomplish.getUserName(),
          accomplish.getSystemInstructions(),
          accomplish.getSoulMarkdown(),
        ]);
        if (!mounted) {
          return;
        }
        setUserName(loadedUserName);
        setSystemInstructions(loadedSystemInstructions);
        setSoulMarkdown(loadedSoulMarkdown);
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
