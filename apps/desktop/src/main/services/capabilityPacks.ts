import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type {
  CapabilityPack,
  CapabilityPackActionResult,
  CapabilityPackAsset,
  CapabilityPackAssetType,
  CapabilityPackErrorCode,
  CapabilityPackInstallPreview,
  CapabilityPackManifest,
  CapabilityPackStatus,
  CapabilityPackUpdateCheck,
  CapabilityPackConnectorManifestEntry,
  CapabilityPackSkillManifestEntry,
  McpConnector,
} from '@accomplish_ai/agent-core/common';
import { getStorage } from '../store/storage';
import { skillsManager } from '../skills';

const GITHUB_OWNER_ALLOWLIST = ['CxxxxDxxxF'];
const GITHUB_HOST = 'github.com';
const GITHUB_RAW_HOST = 'raw.githubusercontent.com';
const MANIFEST_FILE = 'ACCOMPLISH_PACK.yaml';

function isCapabilityPacksEnabled(): boolean {
  return process.env.CAPABILITY_PACKS_V1 === '1' || process.env.NODE_ENV !== 'production';
}

function toActionFailure<T>(
  code: CapabilityPackErrorCode,
  error: string,
): CapabilityPackActionResult<T> {
  return {
    success: false,
    code,
    error,
  };
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sanitizePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitizeConnectorId(value: string): string {
  const sanitized = sanitizePathSegment(value).slice(0, 64);
  return sanitized || 'pack-connector';
}

function isSafeRelativePath(inputPath: string): boolean {
  if (!inputPath || inputPath.includes('\0')) {
    return false;
  }
  if (inputPath.startsWith('/') || inputPath.startsWith('\\') || /^[A-Za-z]:/.test(inputPath)) {
    return false;
  }
  const normalized = path.posix.normalize(inputPath.replace(/\\/g, '/'));
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return false;
  }
  return true;
}

function ensureHttpUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('URL must use http:// or https://');
  }
  return parsed;
}

function parseGitHubRepoUrl(rawUrl: string): {
  owner: string;
  repo: string;
  ref: string;
  canonicalSourceUrl: string;
} {
  let parsed: URL;
  try {
    parsed = ensureHttpUrl(rawUrl.trim());
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid URL');
  }

  if (parsed.hostname !== GITHUB_HOST) {
    throw new Error('Only github.com repository URLs are supported');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('GitHub repository URL must include owner and repository');
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!owner || !repo) {
    throw new Error('GitHub repository URL is missing owner or repository');
  }

  let ref = 'main';
  if (parts[2] === 'tree' && parts.length >= 4) {
    ref = decodeURIComponent(parts.slice(3).join('/'));
  } else if (parts[2] === 'blob' && parts.length >= 4) {
    ref = decodeURIComponent(parts[3]);
  }

  const encodedRef = ref.split('/').map(encodeURIComponent).join('/');
  const canonicalSourceUrl = `https://${GITHUB_HOST}/${owner}/${repo}/tree/${encodedRef}`;
  return { owner, repo, ref, canonicalSourceUrl };
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Accomplish-Desktop',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`GitHub API request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

async function fetchGitHubText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/plain',
      'User-Agent': 'Accomplish-Desktop',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`GitHub content request failed (${res.status}) for ${url}`);
  }
  return await res.text();
}

async function resolveRefToCommitSha(owner: string, repo: string, ref: string): Promise<string> {
  const encodedRef = encodeURIComponent(ref);
  try {
    const response = await fetchGitHubJson<{ sha?: string }>(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodedRef}`,
    );
    if (!response.sha) {
      throw new Error('GitHub API did not return a commit SHA');
    }
    return response.sha;
  } catch (error) {
    if (ref === 'main') {
      const fallback = await fetchGitHubJson<{ sha?: string }>(
        `https://api.github.com/repos/${owner}/${repo}/commits/master`,
      );
      if (!fallback.sha) {
        throw error instanceof Error ? error : new Error('Failed to resolve commit SHA');
      }
      return fallback.sha;
    }
    throw error;
  }
}

function normalizeSkillEntry(entry: unknown): CapabilityPackSkillManifestEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Skill entries must be objects');
  }
  const raw = entry as Record<string, unknown>;
  const id = String(raw.id || '').trim();
  const pathValue = String(raw.path || '').trim();
  if (!id) {
    throw new Error('Skill entry must include a non-empty id');
  }
  if (!pathValue) {
    throw new Error(`Skill "${id}" must include a non-empty path`);
  }
  if (!pathValue.endsWith('SKILL.md')) {
    throw new Error(`Skill "${id}" path must point to SKILL.md`);
  }
  if (!isSafeRelativePath(pathValue)) {
    throw new Error(`Skill "${id}" path is unsafe`);
  }
  return {
    id,
    path: path.posix.normalize(pathValue.replace(/\\/g, '/')),
  };
}

function normalizeConnectorEntry(entry: unknown): CapabilityPackConnectorManifestEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Connector entries must be objects');
  }
  const raw = entry as Record<string, unknown>;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  const url = String(raw.url || '').trim();
  if (!id) {
    throw new Error('Connector entry must include a non-empty id');
  }
  if (!name) {
    throw new Error(`Connector "${id}" must include a non-empty name`);
  }
  if (!url) {
    throw new Error(`Connector "${id}" must include a non-empty url`);
  }
  ensureHttpUrl(url);
  return { id, name, url };
}

function parseAndValidateManifest(rawManifest: string): CapabilityPackManifest {
  const parsed = matter(`---\n${rawManifest}\n---\n`);
  const manifest = parsed.data as Record<string, unknown>;

  const schemaVersionRaw = manifest.schemaVersion;
  const schemaVersion = Number(schemaVersionRaw);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error('Manifest schemaVersion must be a positive integer');
  }

  const packRaw = manifest.pack as Record<string, unknown> | undefined;
  if (!packRaw || typeof packRaw !== 'object') {
    throw new Error('Manifest pack metadata is missing');
  }

  const packId = String(packRaw.id || '').trim();
  const packName = String(packRaw.name || '').trim();
  const packVersion = String(packRaw.version || '').trim();
  const packDescription = String(packRaw.description || '').trim();

  if (!packId || !packName || !packVersion || !packDescription) {
    throw new Error('Manifest pack.id, pack.name, pack.version, and pack.description are required');
  }

  const assetsRaw = manifest.assets as Record<string, unknown> | undefined;
  if (!assetsRaw || typeof assetsRaw !== 'object') {
    throw new Error('Manifest assets section is missing');
  }

  const rawSkills = Array.isArray(assetsRaw.skills) ? assetsRaw.skills : [];
  const rawConnectors = Array.isArray(assetsRaw.connectors) ? assetsRaw.connectors : [];

  const skills = rawSkills.map(normalizeSkillEntry);
  const connectors = rawConnectors.map(normalizeConnectorEntry);
  if (skills.length === 0 && connectors.length === 0) {
    throw new Error('Manifest must define at least one skill or connector asset');
  }

  const seenSkillIds = new Set<string>();
  for (const skill of skills) {
    if (seenSkillIds.has(skill.id)) {
      throw new Error(`Duplicate skill id "${skill.id}"`);
    }
    seenSkillIds.add(skill.id);
  }

  const seenConnectorIds = new Set<string>();
  for (const connector of connectors) {
    if (seenConnectorIds.has(connector.id)) {
      throw new Error(`Duplicate connector id "${connector.id}"`);
    }
    seenConnectorIds.add(connector.id);
  }

  return {
    schemaVersion,
    pack: {
      id: packId,
      name: packName,
      version: packVersion,
      description: packDescription,
    },
    assets: {
      skills,
      connectors,
    },
  };
}

interface PreviewContext {
  owner: string;
  repo: string;
  ref: string;
  sourceUrl: string;
  resolvedSha: string;
  manifest: CapabilityPackManifest;
}

async function buildPreviewFromSource(sourceUrl: string): Promise<PreviewContext> {
  const parsed = parseGitHubRepoUrl(sourceUrl);
  if (!GITHUB_OWNER_ALLOWLIST.includes(parsed.owner)) {
    throw new Error('GitHub owner is not in the allowlist');
  }

  const resolvedSha = await resolveRefToCommitSha(parsed.owner, parsed.repo, parsed.ref);
  const manifestRawUrl = `https://${GITHUB_RAW_HOST}/${parsed.owner}/${parsed.repo}/${resolvedSha}/${MANIFEST_FILE}`;
  const rawManifest = await fetchGitHubText(manifestRawUrl);
  const manifest = parseAndValidateManifest(rawManifest);

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    ref: parsed.ref,
    sourceUrl: parsed.canonicalSourceUrl,
    resolvedSha,
    manifest,
  };
}

interface ResolvedSkillInstallAsset {
  asset: CapabilityPackSkillManifestEntry;
  content: string;
  checksum: string;
  skillName: string;
  skillDescription: string;
  localRef: string;
}

function resolvePackId(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

function resolveConnectorLocalId(packId: string, connectorAssetId: string): string {
  const key = sanitizeConnectorId(`${packId}-${connectorAssetId}`);
  return `pack-${key}`;
}

function buildSkillLocalRef(
  userSkillsPath: string,
  owner: string,
  repo: string,
  assetId: string,
): string {
  const dirName = [
    'pack',
    sanitizePathSegment(owner),
    sanitizePathSegment(repo),
    sanitizePathSegment(assetId),
  ]
    .filter(Boolean)
    .join('-');
  const skillDir = path.join(userSkillsPath, dirName);
  return path.join(skillDir, 'SKILL.md');
}

function ensurePathWithinBase(baseDir: string, targetPath: string): void {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (!resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error('Resolved path escapes the user skills directory');
  }
}

function classifyInstallError<T = undefined>(error: unknown): CapabilityPackActionResult<T> {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes(`${MANIFEST_FILE}`) && message.includes('(404)')) {
      return toActionFailure<T>('PACK_MANIFEST_MISSING', message);
    }
    if (message.includes('allowlist')) {
      return toActionFailure<T>('PACK_OWNER_NOT_ALLOWED', message);
    }
    if (message.includes('Manifest') || message.includes('manifest')) {
      return toActionFailure<T>('PACK_MANIFEST_INVALID', message);
    }
    if (message.includes('GitHub')) {
      return toActionFailure<T>('PACK_FETCH_FAILED', message);
    }
    if (message.includes('connector')) {
      return toActionFailure<T>('PACK_CONNECTOR_CONFLICT', message);
    }
    if (message.includes('skill')) {
      return toActionFailure<T>('PACK_SKILL_CONFLICT', message);
    }
    return toActionFailure<T>('PACK_ASSET_INVALID', message);
  }
  return toActionFailure<T>('PACK_FETCH_FAILED', 'Unknown capability pack error');
}

async function resolveSkillInstallAssets(
  preview: PreviewContext,
  packId: string,
): Promise<ResolvedSkillInstallAsset[]> {
  const userSkillsPath = skillsManager.getUserSkillsPath();
  const currentAssets = getStorage().getCapabilityPackAssets(packId);
  const currentSkillByKey = new Map(
    currentAssets.filter((a) => a.assetType === 'skill').map((a) => [a.assetKey, a]),
  );
  const currentSkillRefs = new Set(
    currentAssets.filter((a) => a.assetType === 'skill').map((a) => a.localRef),
  );
  const existingSkills = await skillsManager.getAll();
  const nameToExistingPath = new Map<string, string>();
  for (const skill of existingSkills) {
    nameToExistingPath.set(skill.name.toLowerCase(), skill.filePath);
  }

  const resolved: ResolvedSkillInstallAsset[] = [];
  for (const skillEntry of preview.manifest.assets.skills) {
    const rawUrl = `https://${GITHUB_RAW_HOST}/${preview.owner}/${preview.repo}/${preview.resolvedSha}/${skillEntry.path}`;
    const content = await fetchGitHubText(rawUrl);
    const parsed = matter(content);
    const skillName = String((parsed.data as { name?: string }).name || '').trim();
    const skillDescription = String(
      (parsed.data as { description?: string }).description || '',
    ).trim();
    if (!skillName || !skillDescription) {
      throw new Error(
        `Skill "${skillEntry.id}" frontmatter must include non-empty name and description`,
      );
    }

    const existingPath = nameToExistingPath.get(skillName.toLowerCase());
    if (existingPath && !currentSkillRefs.has(existingPath)) {
      throw new Error(`Skill name conflict for "${skillName}"`);
    }

    const existingAsset = currentSkillByKey.get(skillEntry.id);
    const localRef =
      existingAsset?.localRef ||
      buildSkillLocalRef(userSkillsPath, preview.owner, preview.repo, skillEntry.id);
    ensurePathWithinBase(userSkillsPath, localRef);

    resolved.push({
      asset: skillEntry,
      content,
      checksum: sha256(content),
      skillName,
      skillDescription,
      localRef,
    });
  }

  return resolved;
}

export class CapabilityPacksService {
  async listPacks(): Promise<
    Array<
      CapabilityPack & {
        skillCount: number;
        connectorCount: number;
      }
    >
  > {
    const storage = getStorage();
    return storage.getAllCapabilityPacks().map((pack) => {
      const assets = storage.getCapabilityPackAssets(pack.id);
      return {
        ...pack,
        skillCount: assets.filter((asset) => asset.assetType === 'skill').length,
        connectorCount: assets.filter((asset) => asset.assetType === 'connector').length,
      };
    });
  }

  getAllowlist(): string[] {
    return [...GITHUB_OWNER_ALLOWLIST];
  }

  async previewFromGitHub(
    sourceUrl: string,
  ): Promise<CapabilityPackActionResult<CapabilityPackInstallPreview>> {
    if (!isCapabilityPacksEnabled()) {
      return toActionFailure<CapabilityPackInstallPreview>(
        'PACK_FETCH_FAILED',
        'Capability packs are disabled by feature flag',
      );
    }
    try {
      const preview = await buildPreviewFromSource(sourceUrl);
      return {
        success: true,
        data: {
          owner: preview.owner,
          repo: preview.repo,
          ref: preview.ref,
          resolvedSha: preview.resolvedSha,
          sourceUrl: preview.sourceUrl,
          manifest: preview.manifest,
          summary: {
            skillCount: preview.manifest.assets.skills.length,
            connectorCount: preview.manifest.assets.connectors.length,
          },
        },
      };
    } catch (error) {
      return classifyInstallError<CapabilityPackInstallPreview>(error);
    }
  }

  async installFromGitHub(sourceUrl: string): Promise<CapabilityPackActionResult<CapabilityPack>> {
    if (!isCapabilityPacksEnabled()) {
      return toActionFailure<CapabilityPack>(
        'PACK_FETCH_FAILED',
        'Capability packs are disabled by feature flag',
      );
    }

    const storage = getStorage();
    try {
      const preview = await buildPreviewFromSource(sourceUrl);
      const packId = resolvePackId(preview.owner, preview.repo);
      const existingPack = storage.getCapabilityPackById(packId);
      const existingAssets = storage.getCapabilityPackAssets(packId);
      const now = new Date().toISOString();

      const resolvedSkills = await resolveSkillInstallAssets(preview, packId);

      const previousConnectorByKey = new Map(
        existingAssets
          .filter((asset) => asset.assetType === 'connector')
          .map((asset) => [asset.assetKey, asset]),
      );

      const connectorAssets: CapabilityPackAsset[] = [];
      const upsertConnectors: McpConnector[] = [];
      for (const connectorEntry of preview.manifest.assets.connectors) {
        const existingConnectorAsset = previousConnectorByKey.get(connectorEntry.id);
        const connectorId =
          existingConnectorAsset?.localRef || resolveConnectorLocalId(packId, connectorEntry.id);
        const existingConnector = storage.getConnectorById(connectorId);
        if (existingConnector && !existingConnectorAsset) {
          throw new Error(`Connector id conflict for "${connectorEntry.id}"`);
        }
        upsertConnectors.push({
          id: connectorId,
          name: connectorEntry.name,
          url: connectorEntry.url,
          status: 'disconnected',
          isEnabled: false,
          createdAt: existingConnector?.createdAt || now,
          updatedAt: now,
          oauthMetadata: existingConnector?.oauthMetadata,
          clientRegistration: existingConnector?.clientRegistration,
          lastConnectedAt: undefined,
        });
        connectorAssets.push({
          id: `${packId}:connector:${connectorEntry.id}`,
          packId,
          assetType: 'connector',
          assetKey: connectorEntry.id,
          sourcePathOrUrl: connectorEntry.url,
          localRef: connectorId,
          checksum: sha256(`${connectorEntry.name}:${connectorEntry.url}`),
          createdAt: existingConnectorAsset?.createdAt || now,
          updatedAt: now,
        });
      }

      const nextSkillKeys = new Set(preview.manifest.assets.skills.map((asset) => asset.id));
      const nextConnectorKeys = new Set(
        preview.manifest.assets.connectors.map((asset) => asset.id),
      );
      const staleSkillAssets = existingAssets.filter(
        (asset) => asset.assetType === 'skill' && !nextSkillKeys.has(asset.assetKey),
      );
      const staleConnectorAssets = existingAssets.filter(
        (asset) => asset.assetType === 'connector' && !nextConnectorKeys.has(asset.assetKey),
      );

      for (const staleConnector of staleConnectorAssets) {
        const existingConnector = storage.getConnectorById(staleConnector.localRef);
        if (existingConnector?.status === 'connected') {
          return toActionFailure<CapabilityPack>(
            'PACK_CONNECTOR_CONNECTED_BLOCKS_UNINSTALL',
            `Cannot update pack while connector "${existingConnector.name}" is connected. Disconnect it first.`,
          );
        }
      }

      for (const skill of resolvedSkills) {
        const skillDir = path.dirname(skill.localRef);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(skill.localRef, skill.content, 'utf8');
      }

      for (const connector of upsertConnectors) {
        storage.deleteConnectorTokens(connector.id);
        storage.upsertConnector(connector);
      }

      for (const staleConnector of staleConnectorAssets) {
        storage.deleteConnectorTokens(staleConnector.localRef);
        storage.deleteConnector(staleConnector.localRef);
      }

      for (const staleSkill of staleSkillAssets) {
        try {
          fs.rmSync(path.dirname(staleSkill.localRef), { recursive: true, force: true });
        } catch (error) {
          console.warn('[CapabilityPacks] Failed to remove stale skill directory', {
            path: staleSkill.localRef,
            error,
          });
        }
      }

      const nextAssets: CapabilityPackAsset[] = [
        ...resolvedSkills.map((skill) => {
          const existingAsset = existingAssets.find(
            (asset) => asset.assetType === 'skill' && asset.assetKey === skill.asset.id,
          );
          return {
            id: `${packId}:skill:${skill.asset.id}`,
            packId,
            assetType: 'skill' as CapabilityPackAssetType,
            assetKey: skill.asset.id,
            sourcePathOrUrl: skill.asset.path,
            localRef: skill.localRef,
            checksum: skill.checksum,
            createdAt: existingAsset?.createdAt || now,
            updatedAt: now,
          };
        }),
        ...connectorAssets,
      ];

      const packRecord: CapabilityPack = {
        id: packId,
        owner: preview.owner,
        repo: preview.repo,
        ref: preview.ref,
        pinnedSha: preview.resolvedSha,
        manifestVersion: preview.manifest.schemaVersion,
        packVersion: preview.manifest.pack.version,
        name: preview.manifest.pack.name,
        description: preview.manifest.pack.description,
        sourceUrl: preview.sourceUrl,
        status: 'installed' as CapabilityPackStatus,
        installedAt: existingPack?.installedAt || now,
        updatedAt: now,
        lastError: undefined,
      };

      storage.upsertCapabilityPack(packRecord);
      storage.replaceCapabilityPackAssets(packId, nextAssets);

      await skillsManager.resync();
      const syncedSkills = await skillsManager.getAll();
      const importedSkillPathSet = new Set(
        resolvedSkills.map((skill) => path.resolve(skill.localRef)),
      );
      for (const syncedSkill of syncedSkills) {
        const resolvedPath = path.resolve(syncedSkill.filePath);
        if (importedSkillPathSet.has(resolvedPath)) {
          await skillsManager.setEnabled(syncedSkill.id, false);
        }
      }

      return {
        success: true,
        data: packRecord,
      };
    } catch (error) {
      return classifyInstallError<CapabilityPack>(error);
    }
  }

  async checkUpdates(
    packId: string,
  ): Promise<CapabilityPackActionResult<CapabilityPackUpdateCheck>> {
    if (!isCapabilityPacksEnabled()) {
      return toActionFailure<CapabilityPackUpdateCheck>(
        'PACK_FETCH_FAILED',
        'Capability packs are disabled by feature flag',
      );
    }

    const storage = getStorage();
    const pack = storage.getCapabilityPackById(packId);
    if (!pack) {
      return toActionFailure<CapabilityPackUpdateCheck>(
        'PACK_NOT_FOUND',
        `Capability pack "${packId}" was not found`,
      );
    }

    try {
      const latestSha = await resolveRefToCommitSha(pack.owner, pack.repo, pack.ref);
      if (latestSha === pack.pinnedSha) {
        return {
          success: true,
          data: {
            packId: pack.id,
            currentSha: pack.pinnedSha,
            latestSha,
            updateAvailable: false,
          },
        };
      }

      const latestManifestRaw = await fetchGitHubText(
        `https://${GITHUB_RAW_HOST}/${pack.owner}/${pack.repo}/${latestSha}/${MANIFEST_FILE}`,
      );
      const latestManifest = parseAndValidateManifest(latestManifestRaw);
      const existingAssets = storage.getCapabilityPackAssets(pack.id);
      const existingSkillCount = existingAssets.filter(
        (asset) => asset.assetType === 'skill',
      ).length;
      const existingConnectorCount = existingAssets.filter(
        (asset) => asset.assetType === 'connector',
      ).length;

      return {
        success: true,
        data: {
          packId: pack.id,
          currentSha: pack.pinnedSha,
          latestSha,
          updateAvailable: true,
          latestPackVersion: latestManifest.pack.version,
          changes: {
            nameChanged: pack.name !== latestManifest.pack.name,
            descriptionChanged: pack.description !== latestManifest.pack.description,
            packVersionChanged: pack.packVersion !== latestManifest.pack.version,
            skillCountChanged: existingSkillCount !== latestManifest.assets.skills.length,
            connectorCountChanged:
              existingConnectorCount !== latestManifest.assets.connectors.length,
          },
        },
      };
    } catch (error) {
      return classifyInstallError<CapabilityPackUpdateCheck>(error);
    }
  }

  async update(packId: string): Promise<CapabilityPackActionResult<CapabilityPack>> {
    const storage = getStorage();
    const pack = storage.getCapabilityPackById(packId);
    if (!pack) {
      return toActionFailure('PACK_NOT_FOUND', `Capability pack "${packId}" was not found`);
    }

    const updateCheck = await this.checkUpdates(packId);
    if (!updateCheck.success) {
      return {
        success: false,
        code: updateCheck.code,
        error: updateCheck.error,
      };
    }

    if (!updateCheck.data?.updateAvailable) {
      return toActionFailure(
        'PACK_UPDATE_NOT_AVAILABLE',
        `Capability pack "${pack.name}" is already up to date`,
      );
    }

    return this.installFromGitHub(pack.sourceUrl);
  }

  async uninstall(packId: string): Promise<CapabilityPackActionResult<{ removedAssets: number }>> {
    const storage = getStorage();
    const pack = storage.getCapabilityPackById(packId);
    if (!pack) {
      return toActionFailure('PACK_NOT_FOUND', `Capability pack "${packId}" was not found`);
    }

    const assets = storage.getCapabilityPackAssets(pack.id);
    const connectorAssets = assets.filter((asset) => asset.assetType === 'connector');
    for (const connectorAsset of connectorAssets) {
      const connector = storage.getConnectorById(connectorAsset.localRef);
      if (connector?.status === 'connected') {
        return toActionFailure(
          'PACK_CONNECTOR_CONNECTED_BLOCKS_UNINSTALL',
          `Disconnect connector "${connector.name}" before uninstalling this pack`,
        );
      }
    }

    for (const skillAsset of assets.filter((asset) => asset.assetType === 'skill')) {
      try {
        fs.rmSync(path.dirname(skillAsset.localRef), { recursive: true, force: true });
      } catch (error) {
        console.warn('[CapabilityPacks] Failed to remove skill asset directory', {
          path: skillAsset.localRef,
          error,
        });
      }
    }

    for (const connectorAsset of connectorAssets) {
      storage.deleteConnectorTokens(connectorAsset.localRef);
      storage.deleteConnector(connectorAsset.localRef);
    }

    storage.deleteCapabilityPackAssets(pack.id);
    storage.deleteCapabilityPack(pack.id);
    await skillsManager.resync();

    return {
      success: true,
      data: {
        removedAssets: assets.length,
      },
    };
  }
}

let serviceSingleton: CapabilityPacksService | null = null;

export function getCapabilityPacksService(): CapabilityPacksService {
  if (!serviceSingleton) {
    serviceSingleton = new CapabilityPacksService();
  }
  return serviceSingleton;
}
