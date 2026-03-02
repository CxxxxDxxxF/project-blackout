import type {
  CapabilityPack,
  CapabilityPackAsset,
  CapabilityPackAssetType,
  CapabilityPackStatus,
} from '../../common/types/capabilityPacks.js';
import { getDatabase } from '../database.js';

interface CapabilityPackRow {
  id: string;
  owner: string;
  repo: string;
  ref: string;
  pinned_sha: string;
  manifest_version: number;
  pack_version: string;
  name: string;
  description: string;
  source_url: string;
  status: string;
  installed_at: string;
  updated_at: string;
  last_error: string | null;
}

interface CapabilityPackAssetRow {
  id: string;
  pack_id: string;
  asset_type: string;
  asset_key: string;
  source_path_or_url: string;
  local_ref: string;
  checksum: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCapabilityPack(row: CapabilityPackRow): CapabilityPack {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    ref: row.ref,
    pinnedSha: row.pinned_sha,
    manifestVersion: row.manifest_version,
    packVersion: row.pack_version,
    name: row.name,
    description: row.description,
    sourceUrl: row.source_url,
    status: row.status as CapabilityPackStatus,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    lastError: row.last_error || undefined,
  };
}

function rowToCapabilityPackAsset(row: CapabilityPackAssetRow): CapabilityPackAsset {
  return {
    id: row.id,
    packId: row.pack_id,
    assetType: row.asset_type as CapabilityPackAssetType,
    assetKey: row.asset_key,
    sourcePathOrUrl: row.source_path_or_url,
    localRef: row.local_ref,
    checksum: row.checksum || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllCapabilityPacks(): CapabilityPack[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM capability_packs ORDER BY installed_at DESC')
    .all() as CapabilityPackRow[];
  return rows.map(rowToCapabilityPack);
}

export function getCapabilityPackById(id: string): CapabilityPack | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM capability_packs WHERE id = ?').get(id) as
    | CapabilityPackRow
    | undefined;
  return row ? rowToCapabilityPack(row) : null;
}

export function getCapabilityPackBySource(owner: string, repo: string): CapabilityPack | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM capability_packs WHERE owner = ? AND repo = ? LIMIT 1')
    .get(owner, repo) as CapabilityPackRow | undefined;
  return row ? rowToCapabilityPack(row) : null;
}

export function upsertCapabilityPack(pack: CapabilityPack): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO capability_packs (
      id,
      owner,
      repo,
      ref,
      pinned_sha,
      manifest_version,
      pack_version,
      name,
      description,
      source_url,
      status,
      installed_at,
      updated_at,
      last_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner = excluded.owner,
      repo = excluded.repo,
      ref = excluded.ref,
      pinned_sha = excluded.pinned_sha,
      manifest_version = excluded.manifest_version,
      pack_version = excluded.pack_version,
      name = excluded.name,
      description = excluded.description,
      source_url = excluded.source_url,
      status = excluded.status,
      updated_at = excluded.updated_at,
      last_error = excluded.last_error
  `,
  ).run(
    pack.id,
    pack.owner,
    pack.repo,
    pack.ref,
    pack.pinnedSha,
    pack.manifestVersion,
    pack.packVersion,
    pack.name,
    pack.description,
    pack.sourceUrl,
    pack.status,
    pack.installedAt,
    pack.updatedAt,
    pack.lastError || null,
  );
}

export function setCapabilityPackStatus(
  id: string,
  status: CapabilityPackStatus,
  lastError?: string,
): void {
  const db = getDatabase();
  db.prepare(
    'UPDATE capability_packs SET status = ?, updated_at = ?, last_error = ? WHERE id = ?',
  ).run(status, new Date().toISOString(), lastError || null, id);
}

export function deleteCapabilityPack(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM capability_packs WHERE id = ?').run(id);
}

export function clearAllCapabilityPacks(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM capability_packs').run();
}

export function getCapabilityPackAssets(packId: string): CapabilityPackAsset[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT * FROM capability_pack_assets WHERE pack_id = ? ORDER BY asset_type, asset_key',
    )
    .all(packId) as CapabilityPackAssetRow[];
  return rows.map(rowToCapabilityPackAsset);
}

export function getCapabilityPackAssetByKey(
  packId: string,
  assetType: CapabilityPackAssetType,
  assetKey: string,
): CapabilityPackAsset | null {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT * FROM capability_pack_assets WHERE pack_id = ? AND asset_type = ? AND asset_key = ? LIMIT 1',
    )
    .get(packId, assetType, assetKey) as CapabilityPackAssetRow | undefined;
  return row ? rowToCapabilityPackAsset(row) : null;
}

export function upsertCapabilityPackAsset(asset: CapabilityPackAsset): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO capability_pack_assets (
      id,
      pack_id,
      asset_type,
      asset_key,
      source_path_or_url,
      local_ref,
      checksum,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_path_or_url = excluded.source_path_or_url,
      local_ref = excluded.local_ref,
      checksum = excluded.checksum,
      updated_at = excluded.updated_at
  `,
  ).run(
    asset.id,
    asset.packId,
    asset.assetType,
    asset.assetKey,
    asset.sourcePathOrUrl,
    asset.localRef,
    asset.checksum || null,
    asset.createdAt,
    asset.updatedAt,
  );
}

export function replaceCapabilityPackAssets(packId: string, assets: CapabilityPackAsset[]): void {
  const db = getDatabase();
  const trx = db.transaction(() => {
    db.prepare('DELETE FROM capability_pack_assets WHERE pack_id = ?').run(packId);
    const stmt = db.prepare(
      `
      INSERT INTO capability_pack_assets (
        id,
        pack_id,
        asset_type,
        asset_key,
        source_path_or_url,
        local_ref,
        checksum,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    );
    for (const asset of assets) {
      stmt.run(
        asset.id,
        asset.packId,
        asset.assetType,
        asset.assetKey,
        asset.sourcePathOrUrl,
        asset.localRef,
        asset.checksum || null,
        asset.createdAt,
        asset.updatedAt,
      );
    }
  });
  trx();
}

export function deleteCapabilityPackAssets(packId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM capability_pack_assets WHERE pack_id = ?').run(packId);
}
