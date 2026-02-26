import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 10,
  up: (db: Database) => {
    db.exec(`ALTER TABLE app_settings ADD COLUMN swarm_enabled INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE app_settings ADD COLUMN swarm_defaults TEXT NOT NULL DEFAULT '{}'`);
  },
};
