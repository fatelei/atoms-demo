import { MAX_DATA_BYTES, PROJECT_KEY } from "./app-data.js";
import { readJsonBody } from "./json-body.js";

const ACTION = /^[a-zA-Z0-9_:-]{1,80}$/;
const headers = { "Cache-Control": "no-store" };
const sandboxModule = `
import handle from "./generated.js";
export default {
  async fetch(request) {
    const command = await request.json();
    return Response.json(await handle(command));
  },
};
`;

function reply(body, status = 200) {
  return Response.json(body, { status, headers });
}

function openSandbox(loader, version, source) {
  return loader.get(version, () => ({
    compatibilityDate: "2026-10-13",
    mainModule: "entry.js",
    modules: { "entry.js": sandboxModule, "generated.js": source },
    globalOutbound: null,
    env: {},
    limits: { cpuMs: 50, subRequests: 3 },
  })).getEntrypoint();
}

async function invoke(sandbox, action, input, state) {
  const response = await sandbox.fetch(new Request("https://sandbox.invalid/", {
    method: "POST",
    body: JSON.stringify({ action, input, state }),
    signal: AbortSignal.timeout(7000),
  }));
  const result = await readJsonBody(response, MAX_DATA_BYTES);
  if (!response.ok || !result || typeof result.ok !== "boolean") {
    throw new Error("Invalid sandbox result");
  }
  return result;
}

export async function handleProjectBackend(request, env) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-site" || site === "cross-site" ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return reply({ error: "请从当前工作台发起后端请求。" }, 403);
  }
  const project = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if (!PROJECT_KEY.test(project)) return reply({ error: "缺少项目访问凭据。" }, 401);

  let command;
  try {
    command = await readJsonBody(request, MAX_DATA_BYTES * 2);
  } catch (error) {
    return reply({ error: "后端请求格式无效或超过大小限制。" }, error instanceof RangeError ? 413 : 400);
  }
  const { version, action, input = null, testState } = command ?? {};
  if (typeof version !== "string" || !PROJECT_KEY.test(version) || typeof action !== "string" || !ACTION.test(action)) {
    return reply({ error: "无效的后端版本或操作。" }, 400);
  }
  if (new TextEncoder().encode(JSON.stringify(input)).length > 8000) {
    return reply({ error: "操作参数过大。" }, 413);
  }

  try {
    const store = env.APP_DATA.getByName(project);
    const source = await store.getBackend(version);
    if (!source) return reply({ error: "未找到该项目的后端版本。" }, 404);
    // The stored version ID maps to immutable code and cannot be supplied by model output.
    const sandbox = openSandbox(env.BACKEND_LOADER, version, source);
    if (testState !== undefined) {
      const result = await invoke(sandbox, action, input, testState);
      if (!result.ok) return reply({ error: String(result.error || "后端拒绝了该操作。").slice(0, 240) }, 422);
      return reply({ value: result.data ?? null, testState: Object.hasOwn(result, "state") ? result.state : testState });
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await store.getBackendState();
      const result = await invoke(sandbox, action, input, snapshot.state);
      if (!result.ok) return reply({ error: String(result.error || "后端拒绝了该操作。").slice(0, 240) }, 422);
      if (result.state === undefined || await store.saveBackendState(snapshot.revision, result.state)) {
        return reply({ value: result.data ?? null });
      }
    }
    return reply({ error: "项目数据有并发修改，请重试。" }, 409);
  } catch (error) {
    console.error("Project backend invocation failed", error?.name);
    return reply({ error: "后端沙箱运行失败，请重试或修改后端代码。" }, 502);
  }
}
