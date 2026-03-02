'use client';

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '@/stores/taskStore';
import { getAccomplish } from '@/lib/accomplish';
import { staggerContainer } from '@/lib/animations';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import ConversationListItem from './ConversationListItem';
import SettingsDialog from './SettingsDialog';
import { Gear, ChatText, MagnifyingGlass, Trash, WarningCircle } from '@phosphor-icons/react';
import logoImage from '/assets/logo-1.png';

export default function Sidebar() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const { tasks, loadTasks, updateTaskStatus, addTaskUpdate, openLauncher, deleteTask } = useTaskStore();
  const accomplish = getAccomplish();
  const { t } = useTranslation('sidebar');

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Subscribe to task status changes and task updates so the sidebar reflects live state
  useEffect(() => {
    const unsubscribeStatusChange = accomplish.onTaskStatusChange?.((data) => {
      updateTaskStatus(data.taskId, data.status);
    });

    const unsubscribeTaskUpdate = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    return () => {
      unsubscribeStatusChange?.();
      unsubscribeTaskUpdate();
    };
  }, [updateTaskStatus, addTaskUpdate, accomplish]);

  const handleNewConversation = () => {
    navigate('/');
  };

  const handleConfirmClearAll = async () => {
    setIsClearing(true);
    const toDelete = tasks.filter(
      (t) => t.status !== 'running' && t.status !== 'waiting_permission',
    );
    for (const task of toDelete) {
      await deleteTask(task.id);
    }
    setIsClearing(false);
    setShowClearDialog(false);
    navigate('/');
  };

  const deletableCount = tasks.filter(
    (t) => t.status !== 'running' && t.status !== 'waiting_permission',
  ).length;

  return (
    <>
      <div className="flex h-screen w-[260px] flex-col border-r border-border bg-card pt-12">
        {/* Action Buttons */}
        <div className="px-3 py-3 border-b border-border flex gap-2">
          <Button
            data-testid="sidebar-new-task-button"
            onClick={handleNewConversation}
            variant="default"
            size="sm"
            className="flex-1 justify-center gap-2"
            title={t('newTask')}
          >
            <ChatText className="h-4 w-4" />
            {t('newTask')}
          </Button>
          <Button
            onClick={openLauncher}
            variant="outline"
            size="sm"
            className="px-2"
            title={t('searchTasks')}
          >
            <MagnifyingGlass className="h-4 w-4" />
          </Button>
          {tasks.length > 0 && (
            <Button
              onClick={() => setShowClearDialog(true)}
              variant="outline"
              size="sm"
              className="px-2 text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors duration-200"
              title="Clear all chat history"
            >
              <Trash className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Conversation List */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            <AnimatePresence mode="wait">
              {tasks.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {t('noConversations')}
                </motion.div>
              ) : (
                <motion.div
                  key="task-list"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                  className="space-y-1"
                >
                  {tasks.map((task) => (
                    <ConversationListItem key={task.id} task={task} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>

        {/* Bottom Section - Logo and Settings */}
        <div className="px-3 py-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center">
            <img
              src={logoImage}
              alt="Accomplish"
              className="dark:invert"
              style={{ height: '20px', paddingLeft: '6px' }}
            />
          </div>
          <Button
            data-testid="sidebar-settings-button"
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            title={t('settings')}
          >
            <Gear className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Clear All History Confirmation Dialog */}
      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 shrink-0">
                <WarningCircle className="h-5 w-5 text-destructive" weight="fill" />
              </div>
              <DialogTitle>Clear all chat history?</DialogTitle>
            </div>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              This will permanently delete{' '}
              <span className="font-semibold text-foreground">
                {deletableCount} chat{deletableCount !== 1 ? 's' : ''}
              </span>
              . Any currently running tasks will be left intact.
              <br />
              <span className="text-destructive/80 font-medium">This cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => setShowClearDialog(false)}
              disabled={isClearing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmClearAll}
              disabled={isClearing}
              className="gap-2"
            >
              {isClearing ? (
                <>Clearing...</>
              ) : (
                <><Trash className="h-4 w-4" />Clear All</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </>
  );
}
