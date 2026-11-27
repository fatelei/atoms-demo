import app from "./.open-next/worker.js";
export { ProjectDataStore } from "./lib/project-data-store.js";

export default {
  async fetch(request, env, context) {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/api/app-data") {
      const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.APP_DATA_LIMIT.limit({ key: client });
      if (!success) {
        return Response.json({ error: "项目数据请求过多，请稍后重试。" }, {
          status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" },
        });
      }
    }
    if (request.method === "POST" && path === "/api/generate") {
      const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.GENERATION_LIMIT.limit({ key: client });
      if (!success) {
        return Response.json(
          { error: "生成请求过多，请稍后再试。" },
          { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
        );
      }
    }
    return app.fetch(request, env, context);
  },
};
