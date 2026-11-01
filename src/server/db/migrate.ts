import { readMigrationFiles } from "drizzle-orm/migrator";
import type Database from "better-sqlite3";
import { resolve } from "node:path";
// SQLite's write lock serializes migration and journal updates across web/worker.
// It also releases automatically if a process crashes, unlike a stale file lock.
export function migrate(sqlite: Database.Database) {
  const migrations = readMigrationFiles({ migrationsFolder: resolve("drizzle") });
  sqlite.transaction(() => {
    sqlite.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)");
    const latest = sqlite.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1").get() as { created_at: number } | undefined;
    for (const migration of migrations) {
      if (latest && Number(latest.created_at) >= migration.folderMillis) continue;
      for (const statement of migration.sql) sqlite.exec(statement);
      sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(migration.hash, migration.folderMillis);
    }
  }).immediate();
}
// CLI is separate so importing migrate does not open another database.
