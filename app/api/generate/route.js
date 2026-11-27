import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateApp, GenerationError, hasSource, PROMPT_LIMIT } from "../../../lib/generator.js";

export const runtime = "nodejs";
export const maxDuration = 150;

let generating = false;

function errorResponse(error, status) {
  return Response.json({ error }, { status });
}

async function readPayload(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let raw = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 400_000) {
        await reader.cancel();
        throw new GenerationError("项目源码过大，请缩小应用范围。", 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } finally {
    reader.releaseLock();
  }
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
    payload = await readPayload(request);
  } catch (error) {
    if (error instanceof GenerationError) return errorResponse(error.message, error.status);
    return errorResponse("无法读取这条需求。", 400);
  }
  const prompt = payload?.prompt;
  const source = payload?.source ?? null;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > PROMPT_LIMIT) {
    return errorResponse(`请输入 1–${PROMPT_LIMIT} 个字符的需求。`, 400);
  }
  if (source !== null && !hasSource(source)) return errorResponse("当前版本的源码无效。", 400);
  if (generating) return errorResponse("智能体正在处理另一个请求，请稍后重试。", 429);

  let ai;
  try {
    ai = getCloudflareContext().env.AI;
  } catch (error) {
    console.error("Workers AI context unavailable", error.name);
  }
  if (!ai) return errorResponse("当前环境缺少 Workers AI 绑定。请在 Cloudflare 环境中重试。", 503);
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
          prompt: prompt.trim(), source, ai, requestSignal: signal, emit,
        });
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
