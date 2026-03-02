import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalErrorRecord, LocalHealthReport } from '@accomplish_ai/agent-core/common';

interface LocalDiagnosticsPanelProps {
  healthReport: LocalHealthReport | null;
  recentErrors: LocalErrorRecord[];
  onClearErrors: () => Promise<void>;
  onExportDiagnostics: () => Promise<string | null>;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString();
}

export function LocalDiagnosticsPanel({
  healthReport,
  recentErrors,
  onClearErrors,
  onExportDiagnostics,
}: LocalDiagnosticsPanelProps) {
  const { t } = useTranslation('settings');
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const visibleErrors = useMemo(() => recentErrors.slice(0, 10), [recentErrors]);

  const handleExport = async () => {
    setIsExporting(true);
    setExportMessage(null);
    try {
      const result = await onExportDiagnostics();
      if (result) {
        setExportMessage(t('localSetup.diagnostics.exported', { target: result }));
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleClear = async () => {
    setIsClearing(true);
    try {
      await onClearErrors();
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {t('localSetup.diagnostics.title')}
          </h4>
          <p className="text-xs text-muted-foreground">{t('localSetup.diagnostics.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleClear()}
            disabled={isClearing || visibleErrors.length === 0}
            className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            {t('localSetup.diagnostics.clearErrors')}
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={isExporting}
            className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {isExporting
              ? t('localSetup.diagnostics.exporting')
              : t('localSetup.diagnostics.export')}
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
        <p className="text-muted-foreground">{t('localSetup.diagnostics.healthStatus')}</p>
        <p className="mt-1 font-medium text-foreground">
          {healthReport
            ? t(`localSetup.health.categories.${healthReport.status}`)
            : t('localSetup.diagnostics.unavailable')}
        </p>
        {healthReport?.routing && (
          <p className="mt-1 text-muted-foreground">
            {t('localSetup.diagnostics.routing', {
              engine: healthReport.routing.activeEngine,
              endpoint: healthReport.ollama.baseUrl,
            })}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('localSetup.diagnostics.recentErrors')}
        </p>
        {visibleErrors.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('localSetup.diagnostics.noErrors')}</p>
        ) : (
          <div className="space-y-2">
            {visibleErrors.map((record, index) => (
              <div
                key={`${record.timestamp}-${record.code}-${index}`}
                className="rounded-md border border-border bg-background/50 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">{record.code}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatTimestamp(record.timestamp)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{record.message}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {t('localSetup.diagnostics.actionContext', { action: record.action })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {exportMessage && <p className="text-xs text-green-400">{exportMessage}</p>}
    </div>
  );
}
