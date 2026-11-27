import app from "./.open-next/worker.js";

export default {
  async fetch(request, env, context) {
    if (request.method === "POST" && new URL(request.url).pathname === "/api/generate") {
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
