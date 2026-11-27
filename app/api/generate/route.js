import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PROJECT_KEY } from "../../../lib/app-data.js";
import { readJsonBody } from "../../../lib/json-body.js";
import { generateApp, GenerationError, hasSource, PROMPT_LIMIT } from "../../../lib/generator.js";

export const runtime = "nodejs";
export const maxDuration = 150;

let generating = false;

function errorResponse(error, status) {
  return Response.json({ error }, { status });
}

export async function POST(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return errorResponse("请从当前工作台发起生成。", 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return errorResponse("请以 JSON 提交需求。", 415);
  }

  let payload;
  try {
    payload = await readJsonBody(request, 400_000);
  } catch (error) {
    if (error instanceof RangeError) return errorResponse("项目源码过大，请缩小应用范围。", 413);
    return errorResponse("无法读取这条需求。", 400);
  }
  const prompt = payload?.prompt;
  const source = payload?.source ?? null;
  const projectKey = payload?.projectKey;
  if (projectKey !== undefined && (typeof projectKey !== "string" || !PROJECT_KEY.test(projectKey))) {
    return errorResponse("当前项目的访问凭据无效。", 400);
  }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > PROMPT_LIMIT) {
    return errorResponse(`请输入 1–${PROMPT_LIMIT} 个字符的需求。`, 400);
  }
  if (source !== null && !hasSource(source)) return errorResponse("当前版本的源码无效。", 400);
  if (generating) return errorResponse("智能体正在处理另一个请求，请稍后重试。", 429);

  let env;
  try {
    ({ env } = getCloudflareContext());
  } catch (error) {
    console.error("Workers AI context unavailable", error.name);
  }
  if (!env?.AI) return errorResponse("当前环境缺少 Workers AI 绑定。请在 Cloudflare 环境中重试。", 503);
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, request.signal]);
  const encoder = new TextEncoder();
  generating = true;

  const stream = new ReadableStream({
    async start(streamController) {
      function emit(event) {
        if (!signal.aborted) streamController.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }
      try {
        const app = await generateApp({
          prompt: prompt.trim(), source, ai: env.AI, requestSignal: signal, emit,
        });
        if (app.backend) {
          if (!projectKey || !env.BACKEND_LOADER) throw new GenerationError("当前项目的后端沙箱不可用，请刷新工作台后重试。", 503);
          const backendId = crypto.randomUUID();
          const store = env.APP_DATA.getByName(projectKey);
          if (!(await store.registerBackend(backendId, app.backend))) {
            throw new GenerationError("该项目已达到后端版本上限。", 409);
          }
          app.backendId = backendId;
        }
        emit({ type: "result", app });
      } catch (error) {
        if (!signal.aborted) {
          if (!(error instanceof GenerationError)) console.error("Unexpected build failure", error.name);
          emit({ type: "error", message: error instanceof GenerationError ? error.message : "生成时遇到问题，请重试。" });
        }
      } finally {
        generating = false;
        if (!controller.signal.aborted) streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform" },
  });
}
