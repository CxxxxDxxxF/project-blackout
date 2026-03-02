import { BrowserWindow } from 'electron';
import type { SwarmChildSummary, Task, TaskMessage } from '@accomplish_ai/agent-core';
import { createMessageId } from '@accomplish_ai/agent-core';
import { getStorage } from '../store/storage';

export type MockScenario =
  | 'success'
  | 'swarm'
  | 'with-tool'
  | 'permission-required'
  | 'question'
  | 'error'
  | 'interrupted';

export interface MockTaskConfig {
  taskId: string;
  prompt: string;
  scenario: MockScenario;
  delayMs?: number;
}

export function isMockTaskEventsEnabled(): boolean {
  return (
    (global as Record<string, unknown>).E2E_MOCK_TASK_EVENTS === true ||
    process.env.E2E_MOCK_TASK_EVENTS === '1'
  );
}

const SCENARIO_KEYWORDS: Record<MockScenario, string[]> = {
  success: ['__e2e_success__', 'test success'],
  swarm: ['__e2e_swarm__', 'test swarm'],
  'with-tool': ['__e2e_tool__', 'use tool', 'search files'],
  'permission-required': ['__e2e_permission__', 'write file', 'create file'],
  question: ['__e2e_question__'],
  error: ['__e2e_error__', 'cause error', 'trigger failure'],
  interrupted: ['__e2e_interrupt__', 'stop task', 'cancel task'],
};

export function detectScenarioFromPrompt(prompt: string): MockScenario {
  const promptLower = prompt.toLowerCase();

  const priorityOrder: MockScenario[] = [
    'error',
    'interrupted',
    'question',
    'swarm',
    'permission-required',
    'with-tool',
    'success',
  ];

  for (const scenario of priorityOrder) {
    const keywords = SCENARIO_KEYWORDS[scenario];
    if (keywords.some((keyword) => promptLower.includes(keyword.toLowerCase()))) {
      return scenario;
    }
  }

  return 'success';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeMockTaskFlow(
  window: BrowserWindow,
  config: MockTaskConfig,
): Promise<void> {
  const { taskId, prompt, scenario, delayMs = 100 } = config;

  if (window.isDestroyed()) {
    console.warn('[MockTaskFlow] Window destroyed, skipping mock flow');
    return;
  }

  const storage = getStorage();
  const sendEvent = (channel: string, data: unknown) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  };

  sendEvent('task:progress', { taskId, stage: 'init' });
  await sleep(delayMs);

  sendEvent('task:update', {
    taskId,
    type: 'message',
    message: {
      id: createMessageId(),
      type: 'assistant',
      content: `I'll help you with: ${prompt}`,
      timestamp: new Date().toISOString(),
    },
  });
  await sleep(delayMs);

  await executeScenario(sendEvent, storage, taskId, scenario, delayMs);
}

async function executeScenario(
  sendEvent: (channel: string, data: unknown) => void,
  storage: ReturnType<typeof getStorage>,
  taskId: string,
  scenario: MockScenario,
  delayMs: number,
): Promise<void> {
  switch (scenario) {
    case 'success':
      await executeSuccessScenario(sendEvent, storage, taskId, delayMs);
      break;

    case 'swarm':
      await executeSwarmScenario(sendEvent, storage, taskId, delayMs);
      break;

    case 'with-tool':
      await executeToolScenario(sendEvent, storage, taskId, delayMs);
      break;

    case 'permission-required':
      executePermissionScenario(sendEvent, taskId);
      break;

    case 'question':
      executeQuestionScenario(sendEvent, taskId);
      break;

    case 'error':
      executeErrorScenario(sendEvent, storage, taskId);
      break;

    case 'interrupted':
      await executeInterruptedScenario(sendEvent, storage, taskId, delayMs);
      break;
  }
}

async function executeSuccessScenario(
  sendEvent: (channel: string, data: unknown) => void,
  storage: ReturnType<typeof getStorage>,
  taskId: string,
  delayMs: number,
): Promise<void> {
  sendEvent('task:update', {
    taskId,
    type: 'message',
    message: {
      id: createMessageId(),
      type: 'assistant',
      content: 'Task completed successfully.',
      timestamp: new Date().toISOString(),
    },
  });
  await sleep(delayMs);

  storage.updateTaskStatus(taskId, 'completed', new Date().toISOString());

  sendEvent('task:update', {
    taskId,
    type: 'complete',
    result: { status: 'success', sessionId: `session_${taskId}` },
  });
}

async function executeSwarmScenario(
  sendEvent: (channel: string, data: unknown) => void,
  storage: ReturnType<typeof getStorage>,
  taskId: string,
  delayMs: number,
): Promise<void> {
  const providerId = 'openai';
  const modelId = 'openai/gpt-5';

  let swarmChildren: SwarmChildSummary[] = [
    {
      childId: `${taskId}_child_researcher`,
      role: 'researcher',
      providerId,
      modelId,
      status: 'queued',
    },
    {
      childId: `${taskId}_child_coder`,
      role: 'coder',
      providerId,
      modelId,
      status: 'queued',
    },
    {
      childId: `${taskId}_child_reviewer`,
      role: 'reviewer',
      providerId,
      modelId,
      status: 'queued',
    },
  ];

  const upsertChild = (child: SwarmChildSummary) => {
    swarmChildren = swarmChildren.map((existing) =>
      existing.childId === child.childId ? child : existing,
    );
    sendEvent('task:update', {
      taskId,
      type: 'swarm-child-update',
      swarmChild: child,
    });
  };

  // Emit queued updates for all children
  for (const child of swarmChildren) {
    upsertChild(child);
  }
  await sleep(delayMs);

  const nowIso = () => new Date().toISOString();

  const runChild = async (
    role: SwarmChildSummary['role'],
    outputPreview: string,
  ): Promise<void> => {
    const childId = `${taskId}_child_${role}`;
    const startedAt = nowIso();
    upsertChild({
      childId,
      role,
      providerId,
      modelId,
      status: 'running',
      startedAt,
    });
    await sleep(delayMs * 2);
    upsertChild({
      childId,
      role,
      providerId,
      modelId,
      status: 'completed',
      startedAt,
      completedAt: nowIso(),
      outputPreview,
    });
  };

  await runChild(
    'researcher',
    'Research brief: validate swarm UI, emit child updates, ensure completion carries swarmChildren.',
  );
  await runChild(
    'coder',
    'Implementation: add mock swarm scenario (__e2e_swarm__), update e2e constants, and add an execution page test.',
  );
  await runChild(
    'reviewer',
    'Review: check child updates render, expand reveals previews, and completion preserves swarmChildren in store.',
  );

  const summaryLines = swarmChildren
    .map((c) => `- ${c.role} (${c.providerId}/${c.modelId}): ${c.status}`)
    .join('\n');

  sendEvent('task:update', {
    taskId,
    type: 'message',
    message: {
      id: createMessageId(),
      type: 'assistant',
      content: `Swarm execution summary:\n${summaryLines}`,
      timestamp: nowIso(),
    },
  });
  await sleep(delayMs);

  storage.updateTaskStatus(taskId, 'completed', nowIso());

  sendEvent('task:update', {
    taskId,
    type: 'complete',
    result: {
      status: 'success',
      sessionId: `session_${taskId}`,
      partial: false,
      swarmChildren,
    },
  });
}

async function executeToolScenario(
  sendEvent: (channel: string, data: unknown) => void,
  storage: ReturnType<typeof getStorage>,
  taskId: string,
  delayMs: number,
): Promise<void> {
  sendEvent('task:update:batch', {
    taskId,
    messages: [
      {
        id: createMessageId(),
        type: 'tool',
        content: 'Reading files',
        toolName: 'Read',
        timestamp: new Date().toISOString(),
      },
      {
        id: createMessageId(),
        type: 'tool',
        content: 'Searching code',
        toolName: 'Grep',
        timestamp: new Date().toISOString(),
      },
    ],
  });
  await sleep(delayMs * 2);

  sendEvent('task:update', {
    taskId,
    type: 'message',
    message: {
      id: createMessageId(),
      type: 'assistant',
      content: 'Found the information using available tools.',
      timestamp: new Date().toISOString(),
    },
  });
  await sleep(delayMs);

  storage.updateTaskStatus(taskId, 'completed', new Date().toISOString());

  sendEvent('task:update', {
    taskId,
    type: 'complete',
    result: { status: 'success', sessionId: `session_${taskId}` },
  });
}

function executePermissionScenario(
  sendEvent: (channel: string, data: unknown) => void,
  taskId: string,
): void {
  sendEvent('permission:request', {
    id: `perm_${Date.now()}`,
    taskId,
    type: 'file',
    question: 'Allow file write?',
    toolName: 'Write',
    fileOperation: 'create',
    filePath: '/test/output.txt',
    timestamp: new Date().toISOString(),
  });
}

function executeQuestionScenario(
  sendEvent: (channel: string, data: unknown) => void,
  taskId: string,
): void {
  sendEvent('permission:request', {
    id: `perm_${Date.now()}`,
    taskId,
    type: 'question',
    header: 'Test Question',
    question: 'Which option do you prefer?',
    options: [
      { label: 'Option A', description: 'First option for testing' },
      { label: 'Option B', description: 'Second option for testing' },
      { label: 'Other', description: 'Enter a custom response' },
    ],
    multiSelect: false,
    timestamp: new Date().toISOString(),
  });
}

function executeErrorScenario(
  sendEvent: (channel: string, data: unknown) => void,
  storage: ReturnType<typeof getStorage>,
  taskId: string,
): void {
  storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());

  sendEvent('task:update', {
    taskId,
    type: 'error',
    error: 'Command execution failed: File not found',
  });
}

async function executeInterruptedScenario(
  sendEvent: (channel: string, data: unknown) => void,
  storage: ReturnType<typeof getStorage>,
  taskId: string,
  delayMs: number,
): Promise<void> {
  sendEvent('task:update', {
    taskId,
    type: 'message',
    message: {
      id: createMessageId(),
      type: 'assistant',
      content: 'Task was interrupted by user.',
      timestamp: new Date().toISOString(),
    },
  });
  await sleep(delayMs);

  storage.updateTaskStatus(taskId, 'interrupted', new Date().toISOString());

  sendEvent('task:update', {
    taskId,
    type: 'complete',
    result: { status: 'interrupted', sessionId: `session_${taskId}` },
  });
}

export function createMockTask(taskId: string, prompt: string): Task {
  const initialMessage: TaskMessage = {
    id: createMessageId(),
    type: 'user',
    content: prompt,
    timestamp: new Date().toISOString(),
  };

  return {
    id: taskId,
    prompt,
    status: 'running',
    messages: [initialMessage],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
}
