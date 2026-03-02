import type { BrowserWindow } from 'electron';
import type { TaskMessage, TaskResult, TaskStatus, TodoItem } from '@accomplish_ai/agent-core';
import { mapResultToStatus } from '@accomplish_ai/agent-core';
import { getTaskManager, recoverDevBrowserServer } from '../opencode';
import type { TaskCallbacks } from '../opencode';
import { getStorage } from '../store/storage';

const DEV_BROWSER_TOOL_PREFIXES = ['dev-browser-mcp_', 'dev_browser_mcp_', 'browser_'];
const BROWSER_FAILURE_WINDOW_MS = 12000;
const BROWSER_FAILURE_THRESHOLD = 2;
const BROWSER_CONNECTION_ERROR_PATTERNS = [
  /fetch failed/i,
  /\bECONNREFUSED\b/i,
  /\bECONNRESET\b/i,
  /\bUND_ERR\b/i,
  /socket hang up/i,
  /\bwebsocket\b/i,
  /browserType\.connectOverCDP/i,
  /Target closed/i,
  /Session closed/i,
  /Page closed/i,
];
const MAX_BATCH_MESSAGES = 40;
const MAX_MESSAGE_CONTENT_CHARS = 12000;
const MAX_TOOL_INPUT_CHARS = 8000;
const MAX_PROGRESS_MESSAGE_CHARS = 1000;
const MAX_ERROR_MESSAGE_CHARS = 2000;
const MAX_DEBUG_MESSAGE_CHARS = 2000;
const MAX_DEBUG_DATA_CHARS = 4000;

function isDevBrowserToolCall(toolName: string): boolean {
  return DEV_BROWSER_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

function isBrowserConnectionFailure(output: string): boolean {
  // Guard against false positives from successful outputs that mention words
  // like "WebSocket" while not being an actual error.
  const isExplicitErrorOutput = /^\s*Error:/i.test(output) || /"isError"\s*:\s*true/.test(output);
  if (!isExplicitErrorOutput) {
    return false;
  }

  return BROWSER_CONNECTION_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}

export interface TaskCallbacksOptions {
  taskId: string;
  window: BrowserWindow;
  sender: Electron.WebContents;
}

function truncate(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return value;
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function sanitizeTaskMessage(message: TaskMessage): TaskMessage {
  let sanitizedToolInput = message.toolInput;
  if (sanitizedToolInput !== undefined) {
    try {
      const raw = JSON.stringify(sanitizedToolInput);
      if (raw.length > MAX_TOOL_INPUT_CHARS) {
        sanitizedToolInput = {
          truncated: true,
          preview: `${raw.slice(0, MAX_TOOL_INPUT_CHARS)}...[truncated ${raw.length - MAX_TOOL_INPUT_CHARS} chars]`,
        };
      }
    } catch {
      sanitizedToolInput = '[unserializable tool input]';
    }
  }

  return {
    ...message,
    content: truncate(message.content, MAX_MESSAGE_CONTENT_CHARS) || '',
    toolInput: sanitizedToolInput,
  };
}

function sanitizeTaskMessageForRenderer(message: TaskMessage): TaskMessage {
  const sanitized = sanitizeTaskMessage(message);
  return {
    ...sanitized,
    // Attachment payloads (especially screenshots) can be large enough to
    // overwhelm structured cloning in renderer IPC. Persist originals in
    // storage, but stream text-only messages to renderer.
    attachments: undefined,
    // Tool input can also contain huge payloads (snapshots/DOM); omit it from
    // live renderer updates.
    toolInput: undefined,
  };
}

function isRecoverablePersistError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message) : '';
  return code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY constraint failed/i.test(message);
}

export function createTaskCallbacks(options: TaskCallbacksOptions): TaskCallbacks {
  const { taskId, window, sender } = options;

  const storage = getStorage();
  const taskManager = getTaskManager();
  let browserFailureCount = 0;
  let browserFailureWindowStart = 0;
  let browserRecoveryInFlight = false;
  let hasRendererSendFailure = false;

  const forwardToRenderer = (channel: string, data: unknown) => {
    if (hasRendererSendFailure) {
      return;
    }
    if (window.isDestroyed() || sender.isDestroyed()) {
      return;
    }
    try {
      sender.send(channel, data);
    } catch (error) {
      hasRendererSendFailure = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[TaskCallbacks] Failed to send IPC event to renderer', {
        taskId,
        channel,
        error: errorMessage,
      });
    }
  };

  const resetBrowserFailureState = () => {
    browserFailureCount = 0;
    browserFailureWindowStart = 0;
  };

  return {
    onBatchedMessages: (messages: TaskMessage[]) => {
      const boundedMessages = messages.slice(Math.max(0, messages.length - MAX_BATCH_MESSAGES));
      const sanitizedForRenderer = boundedMessages.map(sanitizeTaskMessageForRenderer);
      const sanitizedForStorage = boundedMessages.map(sanitizeTaskMessage);
      forwardToRenderer('task:update:batch', { taskId, messages: sanitizedForRenderer });
      for (const msg of sanitizedForStorage) {
        try {
          storage.addTaskMessage(taskId, msg);
        } catch (error) {
          if (isRecoverablePersistError(error)) {
            console.warn('[TaskCallbacks] Skipping persist for message after task teardown', {
              taskId,
              messageId: msg.id,
            });
            continue;
          }
          throw error;
        }
      }
    },

    onProgress: (progress: { stage: string; message?: string }) => {
      forwardToRenderer('task:progress', {
        taskId,
        ...progress,
        message: truncate(progress.message, MAX_PROGRESS_MESSAGE_CHARS),
      });
    },

    onPermissionRequest: (request: unknown) => {
      forwardToRenderer('permission:request', request);
    },

    onComplete: (result: TaskResult) => {
      forwardToRenderer('task:update', {
        taskId,
        type: 'complete',
        result,
      });

      const taskStatus = mapResultToStatus(result);
      storage.updateTaskStatus(taskId, taskStatus, new Date().toISOString());

      const sessionId = result.sessionId || taskManager.getSessionId(taskId);
      if (sessionId) {
        storage.updateTaskSessionId(taskId, sessionId);
      }

      if (result.status === 'success') {
        storage.clearTodosForTask(taskId);
      }
    },

    onError: (error: Error) => {
      forwardToRenderer('task:update', {
        taskId,
        type: 'error',
        error: truncate(error.message, MAX_ERROR_MESSAGE_CHARS),
      });

      storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());
    },

    onDebug: (log: { type: string; message: string; data?: unknown }) => {
      if (storage.getDebugMode()) {
        const debugData =
          log.data === undefined
            ? undefined
            : truncate(
                (() => {
                  try {
                    return JSON.stringify(log.data);
                  } catch {
                    return String(log.data);
                  }
                })(),
                MAX_DEBUG_DATA_CHARS,
              );
        forwardToRenderer('debug:log', {
          taskId,
          timestamp: new Date().toISOString(),
          type: log.type,
          message: truncate(log.message, MAX_DEBUG_MESSAGE_CHARS) || '',
          data: debugData,
        });
      }
    },

    onStatusChange: (status: TaskStatus) => {
      forwardToRenderer('task:status-change', {
        taskId,
        status,
      });
      storage.updateTaskStatus(taskId, status, new Date().toISOString());
    },

    onTodoUpdate: (todos: TodoItem[]) => {
      storage.saveTodosForTask(taskId, todos);
      forwardToRenderer('todo:update', { taskId, todos });
    },

    onAuthError: (error: { providerId: string; message: string }) => {
      forwardToRenderer('auth:error', error);
    },

    onToolCallComplete: ({ toolName, toolOutput }) => {
      if (!isDevBrowserToolCall(toolName)) {
        return;
      }

      if (!isBrowserConnectionFailure(toolOutput)) {
        resetBrowserFailureState();
        return;
      }

      const now = Date.now();
      if (
        browserFailureWindowStart === 0 ||
        now - browserFailureWindowStart > BROWSER_FAILURE_WINDOW_MS
      ) {
        browserFailureWindowStart = now;
        browserFailureCount = 1;
      } else {
        browserFailureCount += 1;
      }

      if (browserFailureCount < BROWSER_FAILURE_THRESHOLD || browserRecoveryInFlight) {
        return;
      }

      browserRecoveryInFlight = true;
      const reason = `Detected repeated browser connection failures (${browserFailureCount} in ${Math.ceil(
        (now - browserFailureWindowStart) / 1000,
      )}s). Reconnecting browser...`;

      console.warn(`[TaskCallbacks] ${reason}`);

      void recoverDevBrowserServer(
        {
          onProgress: (progress) => {
            forwardToRenderer('task:progress', {
              taskId,
              ...progress,
            });
          },
        },
        { reason },
      )
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn('[TaskCallbacks] Browser recovery failed:', errorMessage);
          if (storage.getDebugMode()) {
            forwardToRenderer('debug:log', {
              taskId,
              timestamp: new Date().toISOString(),
              type: 'warning',
              message: `Browser recovery failed: ${errorMessage}`,
            });
          }
        })
        .finally(() => {
          browserRecoveryInFlight = false;
          resetBrowserFailureState();
        });
    },
  };
}
