import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalHealthReport, LocalSetupErrorCode } from '@accomplish_ai/agent-core/common';

interface LocalHealthBannerProps {
  healthCategory: 'ready' | 'degraded' | 'blocked' | 'recovering';
  issues: LocalSetupErrorCode[];
  report: LocalHealthReport | null;
  actionLoading?: boolean;
  onRunFastSetup: () => void;
  onInstallAirllmDeps: () => void;
  onSwitchToOllama: () => void;
  onRefresh: () => void;
}

export function LocalHealthBanner({
  healthCategory,
  issues,
  report,
  actionLoading,
  onRunFastSetup,
  onInstallAirllmDeps,
  onSwitchToOllama,
  onRefresh,
}: LocalHealthBannerProps) {
  const { t } = useTranslation('settings');

  const colorClass = {
    ready: 'border-green-500/30 bg-green-500/10 text-green-300',
    degraded: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    blocked: 'border-red-500/30 bg-red-500/10 text-red-300',
    recovering: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  }[healthCategory];

  const uniqueIssues = useMemo(() => Array.from(new Set(issues)), [issues]);

  const cta = useMemo(() => {
    if (uniqueIssues.includes('AIRLLM_DEPS_MISSING')) {
      return {
        label: t('localSetup.health.actions.installAirllmDeps'),
        action: onInstallAirllmDeps,
      };
    }
    if (report?.routing.stale && report.routing.activeEngine === 'airllm') {
      return {
        label: t('localSetup.health.actions.switchToOllama'),
        action: onSwitchToOllama,
      };
    }
    if (uniqueIssues.includes('OLLAMA_NO_MODELS')) {
      return {
        label: t('localSetup.health.actions.fastSetupModel'),
        action: onRunFastSetup,
      };
    }
    return {
      label: t('localSetup.health.actions.refresh'),
      action: onRefresh,
    };
  }, [onInstallAirllmDeps, onRefresh, onRunFastSetup, onSwitchToOllama, report, t, uniqueIssues]);

  if (healthCategory === 'ready' && uniqueIssues.length === 0 && !report?.routing.stale) {
    return null;
  }

  return (
    <div className={`rounded-md border p-3 ${colorClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider">
            {t('localSetup.health.title')}
          </p>
          <p className="text-sm font-medium">
            {t(`localSetup.health.categories.${healthCategory}`)}
          </p>
        </div>
        <button
          onClick={cta.action}
          disabled={actionLoading}
          className="rounded-md border border-current/40 bg-background/10 px-2.5 py-1 text-xs font-medium hover:bg-background/20 disabled:opacity-50"
        >
          {cta.label}
        </button>
      </div>

      {report?.routing.stale && (
        <p className="mt-2 text-xs opacity-90">
          {report.routing.reason || t('localSetup.health.routingStale')}
        </p>
      )}

      {uniqueIssues.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {uniqueIssues.map((issueCode) => (
            <li key={issueCode}>{t(`localSetup.errorCodes.${issueCode}`)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
