import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CapabilityPack,
  CapabilityPackActionResult,
  CapabilityPackInstallPreview,
  CapabilityPackUpdateCheck,
} from '@accomplish_ai/agent-core/common';
import { getAccomplish } from '@/lib/accomplish';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PackCard } from './PackCard';
import { InstallPackDialog } from './InstallPackDialog';

const CAPABILITY_PACKS_V1 = import.meta.env.DEV || import.meta.env.VITE_CAPABILITY_PACKS_V1 === '1';

type InstalledPack = CapabilityPack & {
  skillCount: number;
  connectorCount: number;
};

export function PacksPanel() {
  const { t } = useTranslation('settings');
  const accomplish = useMemo(() => getAccomplish(), []);

  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState('');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<CapabilityPackInstallPreview | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [updateChecks, setUpdateChecks] = useState<Record<string, CapabilityPackUpdateCheck>>({});
  const [checkingById, setCheckingById] = useState<Record<string, boolean>>({});
  const [updatingById, setUpdatingById] = useState<Record<string, boolean>>({});
  const [uninstallingById, setUninstallingById] = useState<Record<string, boolean>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const resolveActionError = useCallback(
    <T,>(result: CapabilityPackActionResult<T> | null | undefined): string => {
      if (!result) {
        return t('packs.errors.generic');
      }
      if (result.code) {
        const key = `packs.errorCodes.${result.code}`;
        const translated = t(key);
        if (translated !== key) {
          return translated;
        }
      }
      if (result.error && result.error.trim()) {
        return result.error;
      }
      return t('packs.errors.generic');
    },
    [t],
  );

  const fetchPacks = useCallback(
    async (showSpinner: boolean) => {
      if (!CAPABILITY_PACKS_V1) {
        setLoading(false);
        return;
      }
      if (!accomplish.packsList) {
        setGlobalError(t('packs.errors.unavailable'));
        setLoading(false);
        return;
      }

      if (showSpinner) {
        setLoading(true);
      }

      try {
        const list = await accomplish.packsList();
        setPacks(list);
        setGlobalError(null);
      } catch (error) {
        console.error('[Packs] Failed to load packs:', error);
        setGlobalError(error instanceof Error ? error.message : t('packs.errors.loadFailed'));
      } finally {
        if (showSpinner) {
          setLoading(false);
        }
      }
    },
    [accomplish, t],
  );

  const fetchAllowlist = useCallback(async () => {
    if (!CAPABILITY_PACKS_V1) {
      return;
    }
    if (!accomplish.packsGetAllowlist) {
      return;
    }
    try {
      const owners = await accomplish.packsGetAllowlist();
      setAllowlist(owners);
    } catch (error) {
      console.error('[Packs] Failed to load owner allowlist:', error);
    }
  }, [accomplish]);

  useEffect(() => {
    void fetchPacks(true);
    void fetchAllowlist();
  }, [fetchPacks, fetchAllowlist]);

  const handlePreviewInstall = useCallback(async () => {
    if (!accomplish.packsPreviewFromGithub) {
      setPreviewError(t('packs.errors.unavailable'));
      return;
    }
    const trimmed = repoUrl.trim();
    if (!trimmed) {
      setPreviewError(t('packs.errors.repoUrlRequired'));
      return;
    }

    setPreviewing(true);
    setPreviewError(null);
    setInstallError(null);
    try {
      const result = await accomplish.packsPreviewFromGithub(trimmed);
      if (!result.success || !result.data) {
        setPreviewError(resolveActionError(result));
        return;
      }
      setPreview(result.data);
      setInstallDialogOpen(true);
    } catch (error) {
      console.error('[Packs] Preview failed:', error);
      setPreviewError(error instanceof Error ? error.message : t('packs.errors.previewFailed'));
    } finally {
      setPreviewing(false);
    }
  }, [accomplish, repoUrl, resolveActionError, t]);

  const handleInstall = useCallback(async () => {
    if (!accomplish.packsInstallFromGithub || !preview) {
      setInstallError(t('packs.errors.unavailable'));
      return;
    }

    setInstalling(true);
    setInstallError(null);
    try {
      const result = await accomplish.packsInstallFromGithub(preview.sourceUrl);
      if (!result.success) {
        setInstallError(resolveActionError(result));
        return;
      }

      setInstallDialogOpen(false);
      setPreview(null);
      setRepoUrl('');
      await fetchPacks(false);
    } catch (error) {
      console.error('[Packs] Install failed:', error);
      setInstallError(error instanceof Error ? error.message : t('packs.errors.installFailed'));
    } finally {
      setInstalling(false);
    }
  }, [accomplish, fetchPacks, preview, resolveActionError, t]);

  const setActionError = useCallback((packId: string, message: string | null) => {
    setActionErrors((prev) => {
      if (!message) {
        const next = { ...prev };
        delete next[packId];
        return next;
      }
      return {
        ...prev,
        [packId]: message,
      };
    });
  }, []);

  const handleCheckUpdates = useCallback(
    async (packId: string) => {
      if (!accomplish.packsCheckUpdates) {
        setActionError(packId, t('packs.errors.unavailable'));
        return;
      }

      setCheckingById((prev) => ({ ...prev, [packId]: true }));
      setActionError(packId, null);
      try {
        const result = await accomplish.packsCheckUpdates(packId);
        if (!result.success || !result.data) {
          setActionError(packId, resolveActionError(result));
          return;
        }
        setUpdateChecks((prev) => ({
          ...prev,
          [packId]: result.data as CapabilityPackUpdateCheck,
        }));
      } catch (error) {
        console.error('[Packs] Check updates failed:', error);
        setActionError(
          packId,
          error instanceof Error ? error.message : t('packs.errors.updateCheckFailed'),
        );
      } finally {
        setCheckingById((prev) => ({ ...prev, [packId]: false }));
      }
    },
    [accomplish, resolveActionError, setActionError, t],
  );

  const handleUpdate = useCallback(
    async (packId: string) => {
      if (!accomplish.packsUpdate) {
        setActionError(packId, t('packs.errors.unavailable'));
        return;
      }

      setUpdatingById((prev) => ({ ...prev, [packId]: true }));
      setActionError(packId, null);
      try {
        const result = await accomplish.packsUpdate(packId);
        if (!result.success) {
          setActionError(packId, resolveActionError(result));
          return;
        }
        await fetchPacks(false);
        await handleCheckUpdates(packId);
      } catch (error) {
        console.error('[Packs] Update failed:', error);
        setActionError(
          packId,
          error instanceof Error ? error.message : t('packs.errors.updateFailed'),
        );
      } finally {
        setUpdatingById((prev) => ({ ...prev, [packId]: false }));
      }
    },
    [accomplish, fetchPacks, handleCheckUpdates, resolveActionError, setActionError, t],
  );

  const handleUninstall = useCallback(
    async (packId: string) => {
      if (!accomplish.packsUninstall) {
        setActionError(packId, t('packs.errors.unavailable'));
        return;
      }

      setUninstallingById((prev) => ({ ...prev, [packId]: true }));
      setActionError(packId, null);
      try {
        const result = await accomplish.packsUninstall(packId);
        if (!result.success) {
          setActionError(packId, resolveActionError(result));
          return;
        }

        setUpdateChecks((prev) => {
          const next = { ...prev };
          delete next[packId];
          return next;
        });
        await fetchPacks(false);
      } catch (error) {
        console.error('[Packs] Uninstall failed:', error);
        setActionError(
          packId,
          error instanceof Error ? error.message : t('packs.errors.uninstallFailed'),
        );
      } finally {
        setUninstallingById((prev) => ({ ...prev, [packId]: false }));
      }
    },
    [accomplish, fetchPacks, resolveActionError, setActionError, t],
  );

  if (!CAPABILITY_PACKS_V1) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">{t('packs.disabled')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[260px] items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('packs.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('packs.description')}</p>
        {allowlist.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('packs.allowlist', { owners: allowlist.join(', ') })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <Input
          value={repoUrl}
          onChange={(event) => {
            setRepoUrl(event.target.value);
            setPreviewError(null);
          }}
          placeholder={t('packs.inputPlaceholder')}
          disabled={previewing || installing}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => void handlePreviewInstall()}
            disabled={previewing || installing || !repoUrl.trim()}
          >
            {previewing ? t('packs.actions.previewing') : t('packs.actions.previewInstall')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void fetchPacks(true)}
            disabled={previewing || installing}
          >
            {t('packs.actions.refresh')}
          </Button>
        </div>
      </div>

      {previewError ? <p className="text-sm text-destructive">{previewError}</p> : null}
      {globalError ? <p className="text-sm text-destructive">{globalError}</p> : null}

      {packs.length > 0 ? (
        <div className="space-y-3">
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              updateCheck={updateChecks[pack.id]}
              checkingUpdates={checkingById[pack.id]}
              updating={updatingById[pack.id]}
              uninstalling={uninstallingById[pack.id]}
              actionError={actionErrors[pack.id]}
              onCheckUpdates={handleCheckUpdates}
              onUpdate={handleUpdate}
              onUninstall={handleUninstall}
            />
          ))}
        </div>
      ) : (
        <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          {t('packs.empty')}
        </div>
      )}

      <InstallPackDialog
        open={installDialogOpen}
        preview={preview}
        installing={installing}
        installError={installError}
        onOpenChange={(open) => {
          setInstallDialogOpen(open);
          if (!open) {
            setInstallError(null);
          }
        }}
        onInstall={handleInstall}
      />
    </div>
  );
}
