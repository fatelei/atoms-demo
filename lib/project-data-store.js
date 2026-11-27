import { DurableObject } from "cloudflare:workers";

export class ProjectDataStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS backend_versions (id TEXT PRIMARY KEY, source TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS backend_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL)");
  }

  registerBackend(id, source) {
    const { count } = this.sql.exec("SELECT COUNT(*) AS count FROM backend_versions").one();
    if (count >= 40) return false;
    this.sql.exec("INSERT INTO backend_versions (id, source) VALUES (?, ?)", id, source);
    return true;
  }

  getBackend(id) {
    return this.sql.exec("SELECT source FROM backend_versions WHERE id = ?", id).toArray()[0]?.source ?? null;
  }

  getBackendState() {
    const row = this.sql.exec("SELECT revision, state FROM backend_state WHERE id = 1").toArray()[0];
    return row ? { revision: row.revision, state: JSON.parse(row.state) } : { revision: 0, state: null };
  }

  saveBackendState(revision, state) {
    return this.ctx.storage.transactionSync(() => {
      const current = this.getBackendState();
      if (current.revision !== revision) return false;
      this.sql.exec("INSERT OR REPLACE INTO backend_state (id, revision, state) VALUES (1, ?, ?)", revision + 1, JSON.stringify(state));
      return true;
    });
  }

  async execute(action, key, value) {
    const storage = this.ctx.storage;
    if (action === "get") return { value: (await storage.get(key)) ?? null };
    if (action === "remove") {
      await storage.delete(key);
      return {};
    }
    return storage.transaction(async (transaction) => {
      if ((await transaction.get(key)) === undefined && (await transaction.list({ limit: 32 })).size >= 32) {
        return { error: "项目数据已达到 32 个键的上限。" };
      }
      await transaction.put(key, value);
      return {};
    });
  }
}
