import { useTranslation } from 'react-i18next';
import type { CapabilityPackInstallPreview } from '@accomplish_ai/agent-core/common';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface InstallPackDialogProps {
  open: boolean;
  preview: CapabilityPackInstallPreview | null;
  installing: boolean;
  installError: string | null;
  onOpenChange: (open: boolean) => void;
  onInstall: () => Promise<void>;
}

function shortSha(sha: string): string {
  if (sha.length <= 12) {
    return sha;
  }
  return sha.slice(0, 12);
}

export function InstallPackDialog({
  open,
  preview,
  installing,
  installError,
  onOpenChange,
  onInstall,
}: InstallPackDialogProps) {
  const { t } = useTranslation('settings');

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!installing) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('packs.installDialog.title')}</DialogTitle>
          <DialogDescription>{t('packs.installDialog.description')}</DialogDescription>
        </DialogHeader>

        {preview ? (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  {t('packs.installDialog.source')}: {preview.owner}/{preview.repo}
                </span>
                <span>
                  {t('packs.installDialog.ref')}: {preview.ref}
                </span>
                <span>
                  {t('packs.installDialog.sha')}: {shortSha(preview.resolvedSha)}
                </span>
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-semibold text-foreground">{preview.manifest.pack.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {preview.manifest.pack.description}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span>
                  {t('packs.card.version')}: {preview.manifest.pack.version}
                </span>
                <span>
                  {t('packs.card.skills')}: {preview.summary.skillCount}
                </span>
                <span>
                  {t('packs.card.connectors')}: {preview.summary.connectorCount}
                </span>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('packs.installDialog.skillsTitle')}
                </p>
                <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-sm">
                  {preview.manifest.assets.skills.length > 0 ? (
                    preview.manifest.assets.skills.map((skill) => (
                      <li key={skill.id} className="text-foreground">
                        {skill.id}
                      </li>
                    ))
                  ) : (
                    <li className="text-muted-foreground">{t('packs.installDialog.none')}</li>
                  )}
                </ul>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('packs.installDialog.connectorsTitle')}
                </p>
                <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-sm">
                  {preview.manifest.assets.connectors.length > 0 ? (
                    preview.manifest.assets.connectors.map((connector) => (
                      <li key={connector.id} className="text-foreground">
                        {connector.name}
                      </li>
                    ))
                  ) : (
                    <li className="text-muted-foreground">{t('packs.installDialog.none')}</li>
                  )}
                </ul>
              </div>
            </div>

            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {t('packs.installDialog.defaultsNotice')}
            </p>

            {installError ? <p className="text-sm text-destructive">{installError}</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={installing}>
            {t('packs.actions.cancel')}
          </Button>
          <Button onClick={() => void onInstall()} disabled={!preview || installing}>
            {installing ? t('packs.actions.installing') : t('packs.actions.install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
