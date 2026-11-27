import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DATA_KEY, MAX_DATA_BYTES, PROJECT_KEY } from "../../../lib/app-data.js";

const headers = { "Cache-Control": "no-store" };

export async function POST(request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-site" || site === "cross-site" ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return Response.json({ error: "Invalid origin or content type" }, { status: 403, headers });
  }
  const project = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!PROJECT_KEY.test(project ?? "")) {
    return Response.json({ error: "Missing project access key" }, { status: 401, headers });
  }

  const body = request.body?.getReader();
  if (!body) return Response.json({ error: "Missing operation" }, { status: 400, headers });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let operation;
  try {
    while (true) {
      const { value, done } = await body.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_DATA_BYTES) {
        await body.cancel();
        return Response.json({ error: "Project data exceeds size limit" }, { status: 413, headers });
      }
      text += decoder.decode(value, { stream: true });
    }
    operation = JSON.parse(text + decoder.decode());
  } catch {
    return Response.json({ error: "Invalid operation" }, { status: 400, headers });
  } finally {
    body.releaseLock();
  }

  const { action, key, value } = operation ?? {};
  if (typeof key !== "string" || !DATA_KEY.test(key) ||
      !["get", "set", "remove"].includes(action) || (action === "set" && value === undefined)) {
    return Response.json({ error: "Invalid operation" }, { status: 400, headers });
  }
  try {
    const { env } = getCloudflareContext();
    const store = env.APP_DATA.getByName(project);
    return Response.json(await store.execute(action, key, value), { headers });
  } catch {
    return Response.json({ error: "项目数据服务暂不可用，请重试。" }, { status: 503, headers });
  }
}
