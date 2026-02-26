import { describe, expect, it } from 'vitest';
import { runSwarmOrchestrator } from '../../src/orchestration/swarm-orchestrator.js';

describe('swarm orchestrator', () => {
  it('runs child tasks and returns partial when one child fails', async () => {
    const updates: string[] = [];
    const result = await runSwarmOrchestrator({
      parentTaskId: 'parent-1',
      prompt: 'Build a release checklist',
      swarm: { enabled: true, maxAgents: 3 },
      readyProviders: [
        {
          providerId: 'openai',
          connectionStatus: 'connected',
          selectedModelId: 'openai/gpt-5',
          credentials: { type: 'api_key', keyPrefix: 'sk-test' },
          lastConnectedAt: new Date().toISOString(),
        },
      ],
      parentModel: {
        providerId: 'openai',
        modelId: 'openai/gpt-5',
      },
      onChildUpdate: (summary) => {
        updates.push(`${summary.role}:${summary.status}`);
      },
      runChild: async (input) => {
        if (input.role === 'reviewer') {
          return { status: 'failed', error: 'simulated failure', transient: false };
        }
        return { status: 'completed', output: `${input.role} output` };
      },
    });

    expect(result.childSummaries).toHaveLength(3);
    expect(result.partial).toBe(true);
    expect(result.combinedOutput).toContain('researcher output');
    expect(result.combinedOutput).toContain('coder output');
    expect(updates.some((entry) => entry.includes('reviewer:failed'))).toBe(true);
  });
});
