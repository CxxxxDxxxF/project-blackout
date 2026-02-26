import { useState, useEffect } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { motion, AnimatePresence } from 'framer-motion';

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

interface LlmfitScanResult {
  success: boolean;
  models?: LlmfitModel[];
  hardware?: {
    totalRamGb: number;
    availableRamGb: number;
    gpuVramGb: number;
    backend: string;
  };
  error?: string;
}

export function HardwareAdvisor({
  onLoadModel,
}: {
  onLoadModel: (model: LlmfitModel, isAirllm: boolean) => void;
}) {
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [useAirllm, setUseAirllm] = useState(false);
  const [scanResult, setScanResult] = useState<LlmfitScanResult | null>(null);

  useEffect(() => {
    getAccomplish()
      .llmfitCheck()
      .then((res) => {
        setIsInstalled(res.installed);
        if (res.version) setVersion(res.version);
      })
      .catch(() => setIsInstalled(false));
  }, []);

  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await getAccomplish().llmfitScan(useAirllm);
      setScanResult(result);
    } catch (err: unknown) {
      setScanResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setScanning(false);
    }
  };

  const renderFitBadge = (fit: string) => {
    switch (fit) {
      case 'Perfect':
        return (
          <span className="bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
            Perfect Fit
          </span>
        );
      case 'Good':
        return (
          <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
            Good Fit
          </span>
        );
      case 'Marginal':
        return (
          <span className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
            Marginal
          </span>
        );
      default:
        return (
          <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
            Too Tight
          </span>
        );
    }
  };

  if (isInstalled === false) {
    return null; // Silent skip if not installed, since it's an advanced feature
  }

  return (
    <div className="mt-6 rounded-lg border border-border bg-card/50 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="text-primary font-bold">[]</span> Hardware Advisor
          {version && (
            <span className="text-xs text-muted-foreground font-normal ml-1">v{version}</span>
          )}
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex h-8 items-center gap-2 rounded-md bg-primary hover:bg-primary/90 px-3 text-xs font-medium text-primary-foreground transition-colors disabled:opacity-50"
        >
          {scanning ? (
            <>
              <span className="animate-pulse mr-1">•</span>
              Scanning...
            </>
          ) : (
            'Scan Hardware'
          )}
        </button>
      </div>
      <div className="bg-muted/10 px-4 py-2 border-b border-border/50 text-xs text-muted-foreground flex items-center gap-2">
        <input
          type="checkbox"
          id="airllm-advisor-toggle"
          checked={useAirllm}
          onChange={(e) => setUseAirllm(e.target.checked)}
          className="accent-primary"
        />
        <label htmlFor="airllm-advisor-toggle" className="cursor-pointer">
          Target AirLLM Engine (Allow models up to 70B)
        </label>
      </div>

      <AnimatePresence mode="wait">
        {scanResult && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="p-4 space-y-4"
          >
            {scanResult.success && scanResult.hardware && (
              <div className="flex flex-wrap gap-4 text-xs bg-background/50 p-3 rounded-md border border-border/50">
                <div className="flex justify-center items-center gap-1.5 min-w-[120px]">
                  <span className="font-bold text-muted-foreground">CPU</span>
                  <span className="text-muted-foreground">Backend:</span>
                  <span className="font-medium text-foreground">{scanResult.hardware.backend}</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-[120px]">
                  <span className="font-bold text-muted-foreground">RAM</span>
                  <span className="text-muted-foreground">Memory:</span>
                  <span className="font-medium text-foreground">
                    {scanResult.hardware.totalRamGb.toFixed(1)} GB
                  </span>
                </div>
                {scanResult.hardware.gpuVramGb > 0 && (
                  <div className="flex items-center gap-1.5 min-w-[120px]">
                    <span className="font-bold text-muted-foreground">GPU</span>
                    <span className="text-muted-foreground">VRAM:</span>
                    <span className="font-medium text-foreground">
                      {scanResult.hardware.gpuVramGb.toFixed(1)} GB
                    </span>
                  </div>
                )}
              </div>
            )}

            {!scanResult.success && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <span className="font-bold shrink-0 mt-0.5">!</span>
                <p>{scanResult.error}</p>
              </div>
            )}

            {scanResult.success && scanResult.models && scanResult.models.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Top Recommended Models
                </h4>
                <div className="grid gap-2">
                  {scanResult.models.slice(0, 5).map((model, idx) => (
                    <div
                      key={idx}
                      className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-border p-3 transition-colors hover:border-primary/50 hover:bg-muted/10 bg-background"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground text-sm">{model.name}</span>
                          {renderFitBadge(model.fitLevel)}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{model.quantization}</span>
                          <span className="flex items-center gap-1">
                            <div className="h-1 w-1 bg-zinc-600 rounded-full" />
                            {model.estimatedSpeedTps} t/s
                          </span>
                          <span className="flex items-center gap-1">
                            <div className="h-1 w-1 bg-zinc-600 rounded-full" />
                            {model.runMode}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => onLoadModel(model, useAirllm)}
                        disabled={!useAirllm && !model.ollamaName}
                        className="w-full sm:w-auto shrink-0 rounded bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                      >
                        {useAirllm
                          ? 'Load to AirLLM'
                          : model.ollamaName
                            ? 'Load to Ollama'
                            : 'HuggingFace Only'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
