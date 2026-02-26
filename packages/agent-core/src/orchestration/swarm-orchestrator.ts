import type { ConnectedProvider, ProviderId } from '../common/types/providerSettings.js';
import type { SwarmChildSummary, SwarmTaskConfig } from '../common/types/task.js';
import { createTaskId } from '../common/utils/id.js';
import { selectSwarmRoute, type SwarmRole } from './swarm-routing.js';

export interface SwarmChildPlan {
  role: SwarmRole;
  prompt: string;
}

export interface SwarmRunChildInput {
  childId: string;
  role: SwarmRole;
  prompt: string;
  providerId: ProviderId;
  modelId: string;
  timeoutMs: number;
  attempt: number;
}

export interface SwarmRunChildResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
  output?: string;
  error?: string;
  transient?: boolean;
}

export interface SwarmOrchestratorOptions {
  parentTaskId: string;
  prompt: string;
  swarm: SwarmTaskConfig;
  readyProviders: ConnectedProvider[];
  parentModel?: {
    providerId?: ProviderId;
    modelId?: string;
  };
  signal?: AbortSignal;
  onChildUpdate: (summary: SwarmChildSummary) => void;
  runChild: (input: SwarmRunChildInput) => Promise<SwarmRunChildResult>;
}

export interface SwarmOrchestratorResult {
  combinedOutput: string;
  childSummaries: SwarmChildSummary[];
  partial: boolean;
}

const DEFAULT_MAX_AGENTS = 3;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const TRANSIENT_ERROR_PATTERNS = [
  /\btimeout\b/i,
  /\bETIMEDOUT\b/i,
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\btemporar(y|ily)\b/i,
  /\bnetwork\b/i,
  /\baborted\b/i,
];

function isTransientError(error?: string): boolean {
  if (!error) {
    return false;
  }
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

function estimateTokens(input: string): number {
  return Math.max(128, Math.ceil(input.length / 4));
}

function buildPlan(prompt: string): SwarmChildPlan[] {
  return [
    {
      role: 'researcher',
      prompt: `Analyze requirements, constraints, and unknowns for: ${prompt}\nReturn a concise research brief with assumptions and references to inspect.`,
    },
    {
      role: 'coder',
      prompt: `Produce the implementation for: ${prompt}\nFocus on concrete code edits and test updates, minimizing regressions.`,
    },
    {
      role: 'reviewer',
      prompt: `Review the work for: ${prompt}\nList bugs, risks, missing tests, and rollout checks.`,
    },
  ];
}

function nextSummary(
  base: Omit<SwarmChildSummary, 'status'> & { status?: SwarmChildSummary['status'] },
): SwarmChildSummary {
  return {
    ...base,
    status: base.status ?? 'queued',
  };
}

export async function runSwarmOrchestrator(
  options: SwarmOrchestratorOptions,
): Promise<SwarmOrchestratorResult> {
  const {
    parentTaskId,
    prompt,
    swarm,
    readyProviders,
    parentModel,
    onChildUpdate,
    runChild,
    signal,
  } = options;
  const maxAgents = Math.max(
    1,
    Math.min(swarm.maxAgents ?? DEFAULT_MAX_AGENTS, DEFAULT_MAX_AGENTS),
  );
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const budget = swarm.budget;
  const wallStart = Date.now();
  let estimatedTokensUsed = 0;
  const plan = buildPlan(prompt).slice(0, maxAgents);
  const outputs: string[] = [];
  const summaries: SwarmChildSummary[] = [];
  let nextIndex = 0;

  async function executePlanItem(item: SwarmChildPlan): Promise<void> {
    if (signal?.aborted) {
      const cancelled = nextSummary({
        childId: createTaskId(),
        role: item.role,
        providerId: parentModel?.providerId ?? 'openai',
        modelId: parentModel?.modelId ?? 'unknown',
        status: 'cancelled',
        error: 'Parent task was cancelled',
      });
      summaries.push(cancelled);
      onChildUpdate(cancelled);
      return;
    }

    if (budget?.maxWallMs && Date.now() - wallStart >= budget.maxWallMs) {
      const budgetStopped = nextSummary({
        childId: createTaskId(),
        role: item.role,
        providerId: parentModel?.providerId ?? 'openai',
        modelId: parentModel?.modelId ?? 'unknown',
        status: 'cancelled',
        error: 'Soft wall-time budget reached before child started',
      });
      summaries.push(budgetStopped);
      onChildUpdate(budgetStopped);
      return;
    }

    const tokenEstimate = estimateTokens(item.prompt);
    if (
      budget?.maxEstimatedTokens &&
      estimatedTokensUsed + tokenEstimate > budget.maxEstimatedTokens
    ) {
      const budgetStopped = nextSummary({
        childId: createTaskId(),
        role: item.role,
        providerId: parentModel?.providerId ?? 'openai',
        modelId: parentModel?.modelId ?? 'unknown',
        status: 'cancelled',
        error: 'Soft token budget reached before child started',
      });
      summaries.push(budgetStopped);
      onChildUpdate(budgetStopped);
      return;
    }
    estimatedTokensUsed += tokenEstimate;

    const route = selectSwarmRoute(item.role, readyProviders, parentModel);
    if (!route) {
      const failed = nextSummary({
        childId: createTaskId(),
        role: item.role,
        providerId: parentModel?.providerId ?? 'openai',
        modelId: parentModel?.modelId ?? 'unknown',
        status: 'failed',
        error: 'No route available from ready providers',
      });
      summaries.push(failed);
      onChildUpdate(failed);
      return;
    }

    const childId = `${parentTaskId}-child-${item.role}-${createTaskId().slice(-6)}`;
    let summary = nextSummary({
      childId,
      role: item.role,
      providerId: route.providerId,
      modelId: route.modelId,
      status: 'queued',
    });
    summaries.push(summary);
    onChildUpdate(summary);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const startedAt = new Date().toISOString();
      summary = { ...summary, status: 'running', startedAt };
      onChildUpdate(summary);

      const result = await runChild({
        childId,
        role: item.role,
        prompt: item.prompt,
        providerId: route.providerId,
        modelId: route.modelId,
        timeoutMs,
        attempt,
      });

      const completedAt = new Date().toISOString();
      const transient = result.transient ?? isTransientError(result.error);
      if (result.status === 'completed') {
        const outputPreview = result.output ? result.output.slice(0, 600) : undefined;
        summary = { ...summary, status: 'completed', completedAt, outputPreview };
        onChildUpdate(summary);
        if (result.output) {
          outputs.push(`## ${item.role}\n${result.output}`);
        }
        return;
      }

      if (attempt === 1 && result.status === 'failed' && transient) {
        summary = {
          ...summary,
          status: 'running',
          error: 'Transient error detected; retrying once',
        };
        onChildUpdate(summary);
        continue;
      }

      summary = {
        ...summary,
        status: result.status,
        completedAt,
        error:
          result.error || (result.status === 'timed_out' ? 'Child task timed out' : 'Child failed'),
      };
      onChildUpdate(summary);
      return;
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < plan.length) {
      const index = nextIndex;
      nextIndex += 1;
      await executePlanItem(plan[index]);
    }
  }

  const workers = Array.from({ length: Math.min(maxAgents, plan.length) }, () => worker());
  await Promise.all(workers);

  const partial = summaries.some((child) => child.status !== 'completed');
  return {
    combinedOutput: outputs.join('\n\n').trim(),
    childSummaries: summaries,
    partial,
  };
}
