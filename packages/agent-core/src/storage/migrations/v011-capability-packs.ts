import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 11,
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE capability_packs (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        ref TEXT NOT NULL,
        pinned_sha TEXT NOT NULL,
        manifest_version INTEGER NOT NULL,
        pack_version TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        source_url TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('installed', 'error')),
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      )
    `);

    db.exec(`
      CREATE TABLE capability_pack_assets (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL REFERENCES capability_packs(id) ON DELETE CASCADE,
        asset_type TEXT NOT NULL CHECK (asset_type IN ('skill', 'connector')),
        asset_key TEXT NOT NULL,
        source_path_or_url TEXT NOT NULL,
        local_ref TEXT NOT NULL,
        checksum TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    db.exec(`CREATE INDEX idx_capability_packs_owner_repo ON capability_packs(owner, repo)`);
    db.exec(`CREATE INDEX idx_capability_packs_status ON capability_packs(status)`);
    db.exec(`CREATE INDEX idx_capability_pack_assets_pack_id ON capability_pack_assets(pack_id)`);
    db.exec(
      `CREATE UNIQUE INDEX idx_capability_pack_assets_unique ON capability_pack_assets(pack_id, asset_type, asset_key)`,
    );
  },
};
