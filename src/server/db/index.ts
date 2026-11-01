import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { migrate } from "./migrate";
import * as schema from "./schema";
export function openDatabase(directory = config.dataDir) {
  mkdirSync(directory, { recursive: true });
  const sqlite = new Database(join(directory, "char2d.db"));
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
type Connection = ReturnType<typeof openDatabase>;
const globalDb = globalThis as typeof globalThis & { char2dDb?: Connection };
export function getDatabase() { return globalDb.char2dDb ??= openDatabase(); }
