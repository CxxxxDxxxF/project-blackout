import { renderHook, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useLocalSetupFlow } from '@/components/settings/hooks/useLocalSetupFlow';

const mockAccomplish = {
  getLocalSetupStatus: vi.fn(),
  llmfitCheck: vi.fn(),
  llmfitScan: vi.fn(),
  testOllamaConnection: vi.fn(),
  setOllamaConfig: vi.fn(),
  ollamaListModels: vi.fn(),
  ollamaPullModel: vi.fn(),
  airllmStart: vi.fn(),
  airllmLoadModel: vi.fn(),
  airllmServerUrl: vi.fn(),
};

vi.mock('@/lib/accomplish', () => ({
  getAccomplish: () => mockAccomplish,
}));

describe('useLocalSetupFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccomplish.getLocalSetupStatus.mockResolvedValue({
      ollama: { reachable: true, baseUrl: 'http://localhost:11434', modelCount: 1 },
      airllm: { running: false, serverUrl: 'http://127.0.0.1:11435', modelId: null },
      llmfit: { installed: true },
      routing: { activeEngine: 'ollama' },
    });
    mockAccomplish.llmfitCheck.mockResolvedValue({ installed: true, version: '1.0.0' });
    mockAccomplish.llmfitScan.mockResolvedValue({
      success: true,
      models: [{ name: 'Llama 3.2 3B', ollamaName: 'llama3.2:3b', fitLevel: 'Good' }],
    });
    mockAccomplish.testOllamaConnection.mockResolvedValue({
      success: true,
      models: [{ id: 'llama3.2:3b', displayName: 'llama3.2:3b', size: 1 }],
    });
    mockAccomplish.ollamaListModels.mockResolvedValue({
      success: true,
      models: [{ name: 'llama3.2:3b', model: 'llama3.2:3b', size: 1, digest: 'x', modifiedAt: '' }],
    });
    mockAccomplish.ollamaPullModel.mockResolvedValue({ success: true });
    mockAccomplish.setOllamaConfig.mockResolvedValue(undefined);
    mockAccomplish.airllmStart.mockResolvedValue({ success: true });
    mockAccomplish.airllmLoadModel.mockResolvedValue({ success: true });
    mockAccomplish.airllmServerUrl.mockResolvedValue({ url: 'http://127.0.0.1:11435' });
  });

  it('derives completed detection/connect/model steps from setup status', async () => {
    const onConnect = vi.fn();
    const onModelChange = vi.fn();

    const { result } = renderHook(() =>
      useLocalSetupFlow({
        serverUrl: 'http://localhost:11434',
        connectedProvider: {
          providerId: 'ollama',
          connectionStatus: 'connected',
          selectedModelId: 'ollama/llama3.2:3b',
          credentials: { type: 'ollama', serverUrl: 'http://localhost:11434' },
          lastConnectedAt: new Date().toISOString(),
        },
        onConnect,
        onModelChange,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stepStatus.detect).toBe('done');
    expect(result.current.stepStatus.connect).toBe('done');
    expect(result.current.stepStatus.ensureModel).toBe('done');
    expect(result.current.stepStatus.ready).toBe('done');
  });

  it('fast setup connects and selects first model when none selected', async () => {
    const onConnect = vi.fn();
    const onModelChange = vi.fn();

    mockAccomplish.getLocalSetupStatus.mockResolvedValue({
      ollama: { reachable: true, baseUrl: 'http://localhost:11434', modelCount: 0 },
      airllm: { running: false, serverUrl: 'http://127.0.0.1:11435', modelId: null },
      llmfit: { installed: true },
      routing: { activeEngine: 'ollama' },
    });

    const { result } = renderHook(() =>
      useLocalSetupFlow({
        serverUrl: 'http://localhost:11434',
        connectedProvider: undefined,
        onConnect,
        onModelChange,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.runFastSetup();
    });

    expect(onConnect).toHaveBeenCalled();
    expect(mockAccomplish.ollamaPullModel).toHaveBeenCalled();
    expect(onModelChange).toHaveBeenCalledWith('ollama/llama3.2:3b');
  });
});
