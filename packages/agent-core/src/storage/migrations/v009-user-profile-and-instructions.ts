import type { Database } from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration: Migration = {
  version: 9,
  up: (db: Database) => {
    db.exec(`ALTER TABLE app_settings ADD COLUMN user_name TEXT NOT NULL DEFAULT ''`);
    db.exec(`ALTER TABLE app_settings ADD COLUMN system_instructions TEXT NOT NULL DEFAULT ''`);
  },
};
