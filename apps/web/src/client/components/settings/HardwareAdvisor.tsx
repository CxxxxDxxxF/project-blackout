import React, { useEffect, useState, useMemo } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { cn } from '@/lib/utils';

export interface LlmfitModel {
    name: string;
    provider: string;
    fitLevel: 'Perfect' | 'Good' | 'Marginal' | 'Too Tight';
    runMode: 'GPU' | 'MoE' | 'CPU+GPU' | 'CPU';
    scores: {
        quality: number;
        speed: number;
        fit: number;
        context: number;
        composite: number;
    };
    quantization: string;
    estimatedSpeedTps: number;
    requiredVramGb: number;
    ollamaName?: string;
}

export interface LlmfitHardware {
    totalRamGb: number;
    availableRamGb: number;
    gpuVramGb: number;
    backend: string;
}

interface HardwareAdvisorProps {
    onModelSelect: (ollamaModelId: string) => void;
}

type State =
    | { type: 'idle' }
    | { type: 'checking' }
    | { type: 'not-installed' }
    | { type: 'scanning' }
    | { type: 'results'; models: LlmfitModel[]; hardware?: LlmfitHardware }
    | { type: 'error'; message: string };

const FIT_CONFIG = {
    Perfect: { label: 'Perfect', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    Good: { label: 'Good', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    Marginal: { label: 'Marginal', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    'Too Tight': { label: 'Too Tight', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
} satisfies Record<LlmfitModel['fitLevel'], { label: string; className: string }>;

function FitBadge({ level }: { level: LlmfitModel['fitLevel'] }) {
    const { label, className } = FIT_CONFIG[level];
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                className,
            )}
        >
            {label}
        </span>
    );
}

function ScoreBar({ value }: { value: number }) {
    const pct = Math.min(100, Math.max(0, value));
    return (
        <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
            <div
                className="h-full rounded-full bg-primary/60"
                style={{ width: `${pct}% ` }}
            />
        </div>
    );
}

export function HardwareAdvisor({ onModelSelect }: HardwareAdvisorProps) {
    const [state, setState] = useState<State>({ type: 'idle' });

    const handleScan = async () => {
        setState({ type: 'checking' });

        const accomplish = getAccomplish();
        const check = await accomplish.llmfitCheck();

        if (!check.installed) {
            setState({ type: 'not-installed' });
            return;
        }

        setState({ type: 'scanning' });

        const result = await accomplish.llmfitScan();

        if (!result.success || !result.models) {
            setState({ type: 'error', message: result.error ?? 'Scan returned no results' });
            return;
        }

        setState({ type: 'results', models: result.models, hardware: result.hardware });
    };

    const handleUseModel = (model: LlmfitModel) => {
        const id = model.ollamaName ? `ollama / ${model.ollamaName} ` : `ollama / ${model.name} `;
        onModelSelect(id);
    };

    return (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-foreground">Hardware Advisor</p>
                    <p className="text-xs text-muted-foreground">
                        Powered by{' '}
                        <a
                            href="https://github.com/AlexsJones/llmfit"
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2 hover:text-foreground"
                        >
                            llmfit
                        </a>{' '}
                        · scores 206 models against your RAM &amp; GPU
                    </p>
                </div>

                {(state.type === 'idle' ||
                    state.type === 'not-installed' ||
                    state.type === 'error' ||
                    state.type === 'results') && (
                        <button
                            onClick={handleScan}
                            className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
                                />
                            </svg>
                            {state.type === 'results' ? 'Re-scan' : 'Scan Hardware'}
                        </button>
                    )}
            </div>

            {/* Checking llmfit */}
            {(state.type === 'checking' || state.type === 'scanning') && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    {state.type === 'checking' ? 'Checking for llmfit…' : 'Scanning hardware and scoring models…'}
                </div>
            )}

            {/* Not installed */}
            {state.type === 'not-installed' && (
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-400 space-y-1">
                    <p className="font-medium">llmfit is not installed</p>
                    <p className="text-yellow-400/80">
                        Install it to get hardware-aware model recommendations:
                    </p>
                    <code className="block mt-1 rounded bg-black/20 px-2 py-1 font-mono">
                        cargo install llmfit
                    </code>
                    <p className="text-yellow-400/60">
                        Or download a binary from{' '}
                        <a
                            href="https://github.com/AlexsJones/llmfit/releases"
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                        >
                            GitHub Releases
                        </a>
                        .
                    </p>
                </div>
            )}

            {/* Error */}
            {state.type === 'error' && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                    <p className="font-medium">Scan failed</p>
                    <p className="mt-0.5 text-red-400/80">{state.message}</p>
                </div>
            )}

            {/* Results */}
            {state.type === 'results' && (
                <div className="space-y-2">
                    {state.hardware && (
                        <p className="text-xs text-muted-foreground">
                            {state.hardware.totalRamGb.toFixed(0)} GB RAM ·{' '}
                            {state.hardware.gpuVramGb > 0
                                ? `${state.hardware.gpuVramGb.toFixed(0)} GB VRAM · `
                                : 'No GPU · '}
                            {state.hardware.backend}
                        </p>
                    )}

                    <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                        {state.models
                            .filter((m) => m.fitLevel !== 'Too Tight')
                            .slice(0, 6)
                            .map((model, i) => (
                                <div
                                    key={i}
                                    className="flex items-center justify-between gap-3 bg-background px-3 py-2.5"
                                >
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs font-medium text-foreground truncate">
                                                {model.name}
                                            </span>
                                            <FitBadge level={model.fitLevel} />
                                            <span className="text-xs text-muted-foreground">{model.runMode}</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                Score <ScoreBar value={model.scores.composite} />
                                                <span>{model.scores.composite}</span>
                                            </span>
                                            <span>{model.estimatedSpeedTps.toFixed(0)} t/s</span>
                                            <span>{model.quantization}</span>
                                        </div>
                                    </div>

                                    {model.ollamaName && (
                                        <button
                                            onClick={() => handleUseModel(model)}
                                            className="shrink-0 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/70"
                                        >
                                            Use
                                        </button>
                                    )}
                                </div>
                            ))}
                    </div>

                    {state.models.filter((m) => m.fitLevel === 'Too Tight').length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            {state.models.filter((m) => m.fitLevel === 'Too Tight').length} model(s) excluded —
                            insufficient memory.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
