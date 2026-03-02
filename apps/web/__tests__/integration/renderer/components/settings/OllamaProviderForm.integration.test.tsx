/**
 * Integration tests for OllamaProviderForm guided setup flow
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OllamaProviderForm } from '@/components/settings/providers/OllamaProviderForm';
import type { ConnectedProvider } from '@accomplish_ai/agent-core/common';

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

describe('OllamaProviderForm Integration', () => {
  const onConnect = vi.fn();
  const onDisconnect = vi.fn();
  const onModelChange = vi.fn();

  const baseConnectedProvider: ConnectedProvider = {
    providerId: 'ollama',
    connectionStatus: 'connected',
    selectedModelId: 'ollama/llama3.2:3b',
    credentials: {
      type: 'ollama',
      serverUrl: 'http://localhost:11434',
    },
    lastConnectedAt: new Date().toISOString(),
    availableModels: [{ id: 'ollama/llama3.2:3b', name: 'llama3.2:3b', toolSupport: 'unknown' }],
  };

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
      models: [
        {
          name: 'Llama 3.2 3B',
          provider: 'ollama',
          fitLevel: 'Good',
          runMode: 'CPU',
          scores: { quality: 70, speed: 70, fit: 80, context: 50, composite: 70 },
          quantization: 'Q4',
          estimatedSpeedTps: 16,
          requiredVramGb: 0,
          ollamaName: 'llama3.2:3b',
        },
      ],
    });
    mockAccomplish.testOllamaConnection.mockResolvedValue({ success: true, models: [] });
    mockAccomplish.setOllamaConfig.mockResolvedValue(undefined);
    mockAccomplish.ollamaListModels.mockResolvedValue({ success: true, models: [] });
    mockAccomplish.ollamaPullModel.mockResolvedValue({ success: true });
    mockAccomplish.airllmStart.mockResolvedValue({ success: true });
    mockAccomplish.airllmLoadModel.mockResolvedValue({ success: true });
    mockAccomplish.airllmServerUrl.mockResolvedValue({ url: 'http://127.0.0.1:11435' });
  });

  it('shows blocked guidance when Ollama is unreachable', async () => {
    mockAccomplish.getLocalSetupStatus.mockResolvedValue({
      ollama: {
        reachable: false,
        baseUrl: 'http://localhost:11434',
        modelCount: 0,
        error: 'Cannot reach Ollama',
      },
      airllm: { running: false, serverUrl: 'http://127.0.0.1:11435', modelId: null },
      llmfit: { installed: true },
      routing: { activeEngine: 'ollama' },
    });

    render(
      <OllamaProviderForm
        connectedProvider={undefined}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onModelChange={onModelChange}
        showModelError={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Ollama is not reachable. Start it first, then reconnect.'),
      ).toBeInTheDocument();
    });
  });

  it('shows recommendation actions when connected but no models are available', async () => {
    mockAccomplish.getLocalSetupStatus.mockResolvedValue({
      ollama: { reachable: true, baseUrl: 'http://localhost:11434', modelCount: 0 },
      airllm: { running: false, serverUrl: 'http://127.0.0.1:11435', modelId: null },
      llmfit: { installed: true },
      routing: { activeEngine: 'ollama' },
    });

    render(
      <OllamaProviderForm
        connectedProvider={baseConnectedProvider}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onModelChange={onModelChange}
        showModelError={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Recommended Models')).toBeInTheDocument();
      expect(screen.getByText('Install to Ollama')).toBeInTheDocument();
      expect(screen.getByText('Load with AirLLM')).toBeInTheDocument();
    });
  });

  it('shows AirLLM routing banner and quick actions when routed to AirLLM', async () => {
    mockAccomplish.getLocalSetupStatus.mockResolvedValue({
      ollama: { reachable: true, baseUrl: 'http://127.0.0.1:11435', modelCount: 0 },
      airllm: {
        running: true,
        serverUrl: 'http://127.0.0.1:11435',
        modelId: 'meta-llama/Llama-3.2-1B',
      },
      llmfit: { installed: true },
      routing: { activeEngine: 'airllm' },
    });

    render(
      <OllamaProviderForm
        connectedProvider={baseConnectedProvider}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onModelChange={onModelChange}
        showModelError={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Local routing currently uses AirLLM at http://127.0.0.1:11435.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Switch to Ollama localhost')).toBeInTheDocument();
      expect(screen.getByText('Keep AirLLM')).toBeInTheDocument();
    });
  });

  it('switches routing back to Ollama localhost when user clicks switch action', async () => {
    mockAccomplish.getLocalSetupStatus.mockResolvedValue({
      ollama: { reachable: true, baseUrl: 'http://127.0.0.1:11435', modelCount: 0 },
      airllm: { running: true, serverUrl: 'http://127.0.0.1:11435', modelId: null },
      llmfit: { installed: true },
      routing: { activeEngine: 'airllm' },
    });

    render(
      <OllamaProviderForm
        connectedProvider={baseConnectedProvider}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onModelChange={onModelChange}
        showModelError={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Switch to Ollama localhost')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Switch to Ollama localhost'));

    await waitFor(() => {
      expect(mockAccomplish.setOllamaConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://localhost:11434',
          enabled: true,
        }),
      );
    });
  });

  it('shows fallback recommendations when FitLLM is not installed', async () => {
    mockAccomplish.getLocalSetupStatus.mockResolvedValue({
      ollama: { reachable: true, baseUrl: 'http://localhost:11434', modelCount: 0 },
      airllm: { running: false, serverUrl: 'http://127.0.0.1:11435', modelId: null },
      llmfit: { installed: false },
      routing: { activeEngine: 'ollama' },
    });
    mockAccomplish.llmfitCheck.mockResolvedValue({ installed: false });
    mockAccomplish.llmfitScan.mockResolvedValue({ success: false, models: [] });

    render(
      <OllamaProviderForm
        connectedProvider={baseConnectedProvider}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onModelChange={onModelChange}
        showModelError={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('FitLLM is not installed. Showing safe fallback recommendations.'),
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Llama 3.2 1B')).toBeInTheDocument();
    expect(screen.getByText('Llama 3.2 3B')).toBeInTheDocument();
  });

  it('runs fast setup path end-to-end for first-time local setup', async () => {
    mockAccomplish.getLocalSetupStatus.mockResolvedValue({
      ollama: { reachable: true, baseUrl: 'http://localhost:11434', modelCount: 0 },
      airllm: { running: false, serverUrl: 'http://127.0.0.1:11435', modelId: null },
      llmfit: { installed: true },
      routing: { activeEngine: 'ollama' },
    });
    mockAccomplish.llmfitScan.mockResolvedValue({
      success: true,
      models: [
        {
          name: 'Llama 3.2 3B',
          provider: 'ollama',
          fitLevel: 'Good',
          runMode: 'CPU',
          scores: { quality: 70, speed: 70, fit: 80, context: 50, composite: 70 },
          quantization: 'Q4',
          estimatedSpeedTps: 16,
          requiredVramGb: 0,
          ollamaName: 'llama3.2:3b',
        },
      ],
    });
    mockAccomplish.testOllamaConnection.mockResolvedValue({ success: true, models: [] });
    mockAccomplish.ollamaListModels.mockResolvedValue({
      success: true,
      models: [{ name: 'llama3.2:3b' }],
    });

    render(
      <OllamaProviderForm
        connectedProvider={undefined}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onModelChange={onModelChange}
        showModelError={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Set up fastest local path')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Set up fastest local path'));

    await waitFor(() => {
      expect(mockAccomplish.testOllamaConnection).toHaveBeenCalledWith('http://localhost:11434');
      expect(mockAccomplish.ollamaPullModel).toHaveBeenCalledWith(
        'llama3.2:3b',
        'http://localhost:11434',
      );
      expect(onConnect).toHaveBeenCalled();
      expect(onModelChange).toHaveBeenCalledWith('ollama/llama3.2:3b');
    });
  });
});
