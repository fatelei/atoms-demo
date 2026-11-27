export async function readJsonBody(message, limit) {
  const reader = message.body?.getReader();
  if (!reader) throw new Error("Missing JSON body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RangeError("JSON body too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
