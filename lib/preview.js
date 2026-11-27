import reactRuntime from "../.generated/react-runtime.js";

// Keep model output out of the host DOM. Encoding also prevents a closing
// script tag in a generated field from terminating the bootstrap script.
function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

const encodedReact = encode(reactRuntime);

export function previewDocument(artifact, token, steps = null, storage = null) {
  const payload = encode({ html: artifact.html, css: artifact.css, js: artifact.js, steps, storage, backend: Boolean(artifact.backendId), react: artifact.framework === "react" });
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px system-ui,sans-serif}</style>
</head><body><script>
(() => {
  const token = ${JSON.stringify(token)};
  const report = (kind, detail = "") =>
    parent.postMessage({ channel: "atoms-preview", token, kind, detail }, "*");
  const reportError = (value) => report("error", String(value).slice(0, 240));
  const normalize = (value) => value.replace(/\\s+/g, " ").trim();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (node) => {
    if (!node) return false;
    if (typeof node.checkVisibility === "function") {
      return node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true });
    }
    return node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
  };

  async function runCheck(steps) {
    const attempts = ${artifact.backendId ? 80 : 9};
    for (const [index, step] of steps.entries()) {
      const expected = step.action === "assertAbsent" ? "元素不存在或不可见" : step.value;
      let actual;
      try {
        const matches = () => {
          const node = document.querySelector(step.selector);
          const visible = isVisible(node);
          const text = visible ? normalize(node.innerText || "") : "";
          return { node, visible, text };
        };
        if (step.action === "assertText" || step.action === "assertAbsent") {
          for (let attempt = 0; attempt < attempts; attempt += 1) {
            const { visible, text } = matches();
            if (step.action === "assertAbsent" ? !visible : visible && text === normalize(expected)) {
              actual = undefined;
              break;
            }
            actual = visible ? (text || "元素可见，文本为空") : "元素不可见或不存在";
            await wait(35);
          }
        } else {
          let node = null;
          for (let attempt = 0; attempt < attempts; attempt += 1) {
            const target = matches();
            if (target.visible && !target.node.matches(":disabled")) {
              node = target.node;
              break;
            }
            await wait(35);
          }
          if (!node) throw new Error("找不到可操作的元素 " + step.selector);
          if (step.action === "click") node.click();
          else if (step.action === "fill") {
            if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) || node.readOnly) {
              throw new Error("元素不能填写 " + step.selector);
            }
            const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, step.value);
            if (node.value !== step.value) throw new Error("元素不接受该输入值");
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
          }
          await wait(30);
        }
      } catch (error) {
        actual = String(error.message || error);
      }
      if (actual !== undefined) {
        report("check", { passed: false, step: index + 1, expected, actual: actual.slice(0, 240) });
        return;
      }
    }
    report("check", { passed: true });
  }

  window.addEventListener("error", (event) => reportError(event.message || "脚本加载失败"));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest?.("a[href]");
    if (anchor && !anchor.getAttribute("href").startsWith("#")) event.preventDefault();
  }, true);
  try {
    const bytes = Uint8Array.from(atob("${payload}"), (character) => character.charCodeAt(0));
    const app = JSON.parse(new TextDecoder().decode(bytes));
    const values = new Map(Object.entries(app.storage ?? {}));
    function syncStorage() {
      if (app.storage !== null) report("storage", Object.fromEntries(values));
    }
    Object.defineProperty(window, "localStorage", { value: {
      get length() { return values.size; },
      key(index) { return Array.from(values.keys())[index] ?? null; },
      getItem(key) { return values.get(String(key)) ?? null; },
      setItem(key, value) {
        values.set(String(key), String(value));
        syncStorage();
      },
      removeItem(key) {
        values.delete(String(key));
        syncStorage();
      },
      clear() {
        values.clear();
        syncStorage();
      },
    } });
    const data = new Map();
    const pending = new Map();
    let sequence = 0;
    window.addEventListener("message", (event) => {
      if (event.source !== parent || event.data?.channel !== "atoms-app-data" || event.data.token !== token) return;
      const resolve = pending.get(event.data.id);
      if (resolve) resolve(event.data);
    });
    async function request(kind, action, key, value) {
      if (kind === "backend" && !app.backend) throw new Error("当前版本没有后端沙箱。");
      if (kind === "data" && app.backend) throw new Error("当前版本应通过 AtomsBackend 读写数据。");
      if (kind === "data" && app.storage === null) {
        if (action === "get") return structuredClone(data.get(key) ?? null);
        if (action === "set") data.set(key, structuredClone(value));
        if (action === "remove") data.delete(key);
        return;
      }
      const id = ++sequence;
      const result = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ error: "项目数据请求超时，请重试。" }), 10000);
        pending.set(id, (message) => {
          clearTimeout(timeout);
          resolve(message);
        });
        report(kind, { id, action, key, value });
      });
      pending.delete(id);
      if (result.error) throw new Error(result.error);
      return result.value;
    }
    Object.defineProperty(window, "AtomsData", { value: Object.freeze({
      get: (key) => request("data", "get", key),
      set: (key, value) => request("data", "set", key, value),
      remove: (key) => request("data", "remove", key),
    }) });
    Object.defineProperty(window, "AtomsBackend", { value: Object.freeze({
      call: (action, input = null) => request("backend", action, undefined, input),
    }) });
    const markup = document.createElement("template");
    markup.innerHTML = app.html;
    markup.content.querySelectorAll("script, meta, base, iframe, object, embed").forEach((node) => node.remove());
    const style = document.createElement("style");
    style.textContent = app.css;
    document.head.append(style);
    document.body.append(markup.content);
    if (app.react) {
      const runtime = document.createElement("script");
      const runtimeBytes = Uint8Array.from(atob("${artifact.framework === "react" ? encodedReact : ""}"), (character) => character.charCodeAt(0));
      runtime.textContent = JSON.parse(new TextDecoder().decode(runtimeBytes));
      document.body.append(runtime);
      runtime.remove();
    }
    const script = document.createElement("script");
    script.textContent = app.js;
    document.currentScript?.remove();
    document.body.append(script);
    report("ready");
    if (app.steps) window.addEventListener("load", () => { void runCheck(app.steps); }, { once: true });
  } catch (error) {
    reportError(error);
  }
})();
</script></body></html>`;
}
