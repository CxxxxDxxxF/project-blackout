import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { TaskInputBar } from '@/components/landing/TaskInputBar';
import { SettingsDialog } from '@/components/layout/SettingsDialog';
import { useTaskStore } from '@/stores/taskStore';
import { getAccomplish } from '@/lib/accomplish';
import { springs } from '@/lib/animations';
import { ArrowUpLeft } from '@phosphor-icons/react';
import { hasAnyReadyProvider } from '@accomplish_ai/agent-core/common';
import { PlusMenu } from '@/components/landing/PlusMenu';
import { IntegrationIcon } from '@/components/landing/IntegrationIcons';

const USE_CASE_KEYS = [
  { key: 'repoOnboardingChecklist', icons: ['github.com', 'docs.google.com'] },
  { key: 'prReviewAssistant', icons: ['github.com'] },
  { key: 'bugReproPlan', icons: ['github.com', 'notion.so'] },
  { key: 'apiContractDiff', icons: ['github.com', 'docs.google.com'] },
  { key: 'testFailureTriage', icons: ['github.com'] },
  { key: 'releaseNotesFromCommits', icons: ['github.com', 'docs.google.com'] },
  { key: 'promptEvalBatch', icons: ['sheets.google.com', 'docs.google.com'] },
  { key: 'aiSupportCopilot', icons: ['slack.com', 'docs.google.com'] },
  { key: 'ragKnowledgeCleanup', icons: ['notion.so', 'docs.google.com'] },
  { key: 'agentRunbookDraft', icons: ['docs.google.com'] },
  { key: 'internWeekPlan', icons: ['calendar.google.com', 'docs.google.com'] },
  { key: 'internPortfolioReview', icons: ['linkedin.com', 'docs.google.com'] },
  { key: 'internProjectScoping', icons: ['notion.so', 'sheets.google.com'] },
  { key: 'internBugBash', icons: ['github.com', 'sheets.google.com'] },
  { key: 'internDemoPrep', icons: ['slides.google.com', 'docs.google.com'] },
] as const;

export function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [userName, setUserName] = useState('');
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [swarmFeatureEnabled, setSwarmFeatureEnabled] = useState(false);
  const [swarmModeEnabled, setSwarmModeEnabled] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'providers' | 'voice' | 'skills' | 'connectors' | 'about'
  >('providers');
  const { startTask, interruptTask, isLoading, addTaskUpdate, setPermissionRequest } =
    useTaskStore();
  const navigate = useNavigate();
  const accomplish = useMemo(() => getAccomplish(), []);
  const { t } = useTranslation('home');
  const [activePromptPage, setActivePromptPage] = useState(0);

  const useCaseExamples = useMemo(() => {
    return USE_CASE_KEYS.map(({ key, icons }) => ({
      title: t(`useCases.${key}.title`),
      description: t(`useCases.${key}.description`),
      prompt: t(`useCases.${key}.prompt`),
      icons,
    }));
  }, [t]);

  const promptPages = useMemo(() => {
    const cardsPerPage = 6;
    const pages: Array<typeof useCaseExamples> = [];
    for (let i = 0; i < useCaseExamples.length; i += cardsPerPage) {
      pages.push(useCaseExamples.slice(i, i + cardsPerPage));
    }
    return pages;
  }, [useCaseExamples]);

  const totalPromptPages = promptPages.length;

  useEffect(() => {
    setActivePromptPage((prev) => {
      if (totalPromptPages === 0) {
        return 0;
      }
      return prev % totalPromptPages;
    });
  }, [totalPromptPages]);

  useEffect(() => {
    if (totalPromptPages <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setActivePromptPage((prev) => (prev + 1) % totalPromptPages);
    }, 6000);
    return () => {
      window.clearInterval(timer);
    };
  }, [totalPromptPages]);

  useEffect(() => {
    const unsubscribeTask = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    const unsubscribePermission = accomplish.onPermissionRequest((request) => {
      setPermissionRequest(request);
    });

    return () => {
      unsubscribeTask();
      unsubscribePermission();
    };
  }, [addTaskUpdate, setPermissionRequest, accomplish]);

  useEffect(() => {
    let mounted = true;
    Promise.all([accomplish.getUserName(), accomplish.getSwarmSettings()])
      .then(([savedName, swarmSettings]) => {
        if (mounted) {
          setUserName(savedName);
          setSwarmFeatureEnabled(Boolean(swarmSettings.enabled));
          if (!swarmSettings.enabled) {
            setSwarmModeEnabled(false);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setUserName('');
          setSwarmFeatureEnabled(false);
          setSwarmModeEnabled(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [accomplish, showSettingsDialog]);

  const executeTask = useCallback(async () => {
    if (!prompt.trim() || isLoading) return;

    const taskId = `task_${Date.now()}`;
    const task = await startTask({
      prompt: prompt.trim(),
      taskId,
      ...(swarmFeatureEnabled && swarmModeEnabled
        ? { swarm: { enabled: true, maxAgents: 3 } }
        : {}),
    });
    if (task) {
      navigate(`/execution/${task.id}`);
    }
  }, [prompt, isLoading, startTask, navigate, swarmFeatureEnabled, swarmModeEnabled]);

  const handleSubmit = async () => {
    if (isLoading) {
      void interruptTask();
      return;
    }
    if (!prompt.trim()) return;

    const isE2EMode = await accomplish.isE2EMode();
    if (!isE2EMode) {
      const settings = await accomplish.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        setSettingsInitialTab('providers');
        setShowSettingsDialog(true);
        return;
      }
    }

    await executeTask();
  };

  const handleSettingsDialogChange = (open: boolean) => {
    setShowSettingsDialog(open);
    if (!open) {
      setSettingsInitialTab('providers');
    }
  };

  const handleOpenSpeechSettings = useCallback(() => {
    setSettingsInitialTab('voice');
    setShowSettingsDialog(true);
  }, []);

  const handleOpenModelSettings = useCallback(() => {
    setSettingsInitialTab('providers');
    setShowSettingsDialog(true);
  }, []);

  const handleApiKeySaved = async () => {
    setShowSettingsDialog(false);
    if (prompt.trim()) {
      await executeTask();
    }
  };

  const focusPromptTextarea = () => {
    setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="task-input-textarea"]',
      );
      textarea?.focus();
    }, 0);
  };

  const handleExampleClick = (examplePrompt: string) => {
    setPrompt(examplePrompt);
    focusPromptTextarea();
  };

  const handleSkillSelect = (command: string) => {
    setPrompt((prev) => `${command} ${prev}`.trim());
    focusPromptTextarea();
  };

  const showPreviousPromptPage = () => {
    if (totalPromptPages <= 1) {
      return;
    }
    setActivePromptPage((prev) => (prev - 1 + totalPromptPages) % totalPromptPages);
  };

  const showNextPromptPage = () => {
    if (totalPromptPages <= 1) {
      return;
    }
    setActivePromptPage((prev) => (prev + 1) % totalPromptPages);
  };

  return (
    <>
      <SettingsDialog
        open={showSettingsDialog}
        onOpenChange={handleSettingsDialogChange}
        onApiKeySaved={handleApiKeySaved}
        initialTab={settingsInitialTab}
      />

      <div className="h-full flex flex-col bg-accent relative overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 pb-0">
          <div className="w-full max-w-[720px] mx-auto flex flex-col items-center gap-3">
            <motion.h1
              data-testid="home-title"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.gentle}
              className="font-apparat text-[32px] tracking-[-0.015em] text-foreground w-full text-center pt-[250px]"
            >
              {userName.trim() ? `Welcome back, ${userName.trim()}` : t('title')}
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.1 }}
              className="w-full"
            >
              <TaskInputBar
                value={prompt}
                onChange={setPrompt}
                onSubmit={handleSubmit}
                isLoading={isLoading}
                placeholder={t('inputPlaceholder')}
                typingPlaceholder={true}
                large={true}
                autoFocus={true}
                onOpenSpeechSettings={handleOpenSpeechSettings}
                onOpenModelSettings={handleOpenModelSettings}
                hideModelWhenNoModel={true}
                toolbarLeft={
                  <div className="flex items-center gap-2">
                    <PlusMenu
                      onSkillSelect={handleSkillSelect}
                      onOpenSettings={(tab) => {
                        setSettingsInitialTab(tab);
                        setShowSettingsDialog(true);
                      }}
                      disabled={isLoading}
                    />
                    {swarmFeatureEnabled && (
                      <button
                        type="button"
                        onClick={() => setSwarmModeEnabled((prev) => !prev)}
                        className={`h-7 rounded-full border px-2 text-xs transition-colors ${
                          swarmModeEnabled
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-muted/50'
                        }`}
                        data-testid="swarm-mode-toggle"
                      >
                        Swarm Mode {swarmModeEnabled ? 'On' : 'Off'}
                      </button>
                    )}
                  </div>
                }
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...springs.gentle, delay: 0.2 }}
              className="w-full"
            >
              <div className="flex flex-col gap-3 pt-[200px] pb-[120px]">
                <h2 className="font-apparat text-[22px] font-light tracking-[-0.66px] text-foreground text-center">
                  {t('examplePrompts')}
                </h2>

                <div className="relative w-full">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`prompt-page-${activePromptPage}`}
                      className="grid grid-cols-3 gap-4 w-full"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.22 }}
                    >
                      {(promptPages[activePromptPage] || []).map((example, index) => (
                        <motion.button
                          key={`${example.title}-${index}`}
                          data-testid={`home-example-${activePromptPage * 6 + index}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: index * 0.05 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleExampleClick(example.prompt)}
                          className="group flex flex-col justify-between rounded-[4px] border border-border hover:border-muted-foreground/40 active:border-muted-foreground/40 bg-accent pl-3 pr-4 py-3 text-left h-[164px] transition-colors"
                        >
                          <div className="flex items-start justify-between w-full">
                            <span className="font-sans text-[14px] leading-[18px] tracking-[-0.28px] text-foreground whitespace-pre-line w-[120px]">
                              {example.title}
                            </span>
                            <span className="shrink-0 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0 group-active:translate-y-0 -scale-y-100 rotate-180">
                              <ArrowUpLeft className="w-4 h-4 text-foreground" weight="regular" />
                            </span>
                          </div>

                          <p className="text-[13px] leading-[15px] tracking-[-0.13px] text-muted-foreground">
                            {example.description}
                          </p>

                          <div className="flex items-center gap-[2px]">
                            {example.icons.map((domain) => (
                              <div
                                key={domain}
                                className="flex items-center rounded-[5.778px] bg-popover p-[3.25px] shrink-0"
                              >
                                <IntegrationIcon domain={domain} className="w-[22px] h-[22px]" />
                              </div>
                            ))}
                          </div>
                        </motion.button>
                      ))}
                    </motion.div>
                  </AnimatePresence>

                  {totalPromptPages > 1 && (
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={showPreviousPromptPage}
                        aria-label="Previous example prompts"
                        className="h-7 w-7 rounded-full border border-border text-foreground hover:bg-muted/60 transition-colors"
                      >
                        ‹
                      </button>

                      <div className="flex items-center gap-1">
                        {promptPages.map((_, pageIdx) => (
                          <button
                            key={`prompt-dot-${pageIdx}`}
                            type="button"
                            onClick={() => setActivePromptPage(pageIdx)}
                            aria-label={`Example prompts page ${pageIdx + 1}`}
                            className={`h-2 w-2 rounded-full transition-colors ${
                              pageIdx === activePromptPage
                                ? 'bg-foreground'
                                : 'bg-muted-foreground/30'
                            }`}
                          />
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={showNextPromptPage}
                        aria-label="Next example prompts"
                        className="h-7 w-7 rounded-full border border-border text-foreground hover:bg-muted/60 transition-colors"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[120px] bg-gradient-to-t from-accent to-transparent" />
      </div>
    </>
  );
}
