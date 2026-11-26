// Keep model output out of the host DOM. Encoding also prevents a closing
// script tag in a generated field from terminating the bootstrap script.
function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export function previewDocument(artifact, token) {
  const payload = encode({ html: artifact.html, css: artifact.css, js: artifact.js });
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
  window.addEventListener("error", (event) => reportError(event.message || "脚本加载失败"));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest?.("a[href]");
    if (anchor && !anchor.getAttribute("href").startsWith("#")) event.preventDefault();
  }, true);
  try {
    const bytes = Uint8Array.from(atob("${payload}"), (character) => character.charCodeAt(0));
    const app = JSON.parse(new TextDecoder().decode(bytes));
    const markup = document.createElement("template");
    markup.innerHTML = app.html;
    markup.content.querySelectorAll("script, meta, base, iframe, object, embed").forEach((node) => node.remove());
    const style = document.createElement("style");
    style.textContent = app.css;
    document.head.append(style);
    document.body.append(markup.content);
    const script = document.createElement("script");
    script.textContent = app.js;
    document.body.append(script);
    report("ready");
  } catch (error) {
    reportError(error);
  }
})();
</script></body></html>`;
}
