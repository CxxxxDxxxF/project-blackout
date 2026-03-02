import { useTranslation } from 'react-i18next';
import type { CapabilityPack, CapabilityPackUpdateCheck } from '@accomplish_ai/agent-core/common';

interface PackCardProps {
  pack: CapabilityPack & {
    skillCount: number;
    connectorCount: number;
  };
  updateCheck?: CapabilityPackUpdateCheck;
  checkingUpdates?: boolean;
  updating?: boolean;
  uninstalling?: boolean;
  actionError?: string | null;
  onCheckUpdates: (packId: string) => void;
  onUpdate: (packId: string) => void;
  onUninstall: (packId: string) => void;
}

function truncateSha(sha: string): string {
  if (sha.length <= 12) {
    return sha;
  }
  return sha.slice(0, 12);
}

export function PackCard({
  pack,
  updateCheck,
  checkingUpdates,
  updating,
  uninstalling,
  actionError,
  onCheckUpdates,
  onUpdate,
  onUninstall,
}: PackCardProps) {
  const { t } = useTranslation('settings');

  const hasUpdate = updateCheck?.updateAvailable === true;

  let statusLabel = t('packs.status.installed');
  let statusClassName = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
  if (pack.status === 'error') {
    statusLabel = t('packs.status.error');
    statusClassName = 'border-destructive/40 bg-destructive/10 text-destructive';
  } else if (hasUpdate) {
    statusLabel = t('packs.status.updateAvailable');
    statusClassName = 'border-amber-500/40 bg-amber-500/10 text-amber-400';
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">{pack.name}</h4>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClassName}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{pack.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t('packs.card.source')}: {pack.owner}/{pack.repo}
            </span>
            <span>
              {t('packs.card.version')}: {pack.packVersion}
            </span>
            <span>
              {t('packs.card.sha')}: {truncateSha(pack.pinnedSha)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t('packs.card.skills')}: {pack.skillCount}
            </span>
            <span>
              {t('packs.card.connectors')}: {pack.connectorCount}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            onClick={() => onCheckUpdates(pack.id)}
            disabled={Boolean(checkingUpdates || updating || uninstalling)}
          >
            {checkingUpdates ? t('packs.actions.checking') : t('packs.actions.checkUpdates')}
          </button>

          {hasUpdate && (
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              onClick={() => onUpdate(pack.id)}
              disabled={Boolean(updating || uninstalling)}
            >
              {updating ? t('packs.actions.updating') : t('packs.actions.update')}
            </button>
          )}

          <button
            type="button"
            className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            onClick={() => onUninstall(pack.id)}
            disabled={Boolean(uninstalling || updating)}
          >
            {uninstalling ? t('packs.actions.uninstalling') : t('packs.actions.uninstall')}
          </button>
        </div>
      </div>

      {actionError ? <p className="mt-3 text-xs text-destructive">{actionError}</p> : null}
    </div>
  );
}
