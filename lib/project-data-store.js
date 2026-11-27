import { DurableObject } from "cloudflare:workers";

export class ProjectDataStore extends DurableObject {
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
