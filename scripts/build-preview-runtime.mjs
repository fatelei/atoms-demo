import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: `import * as React from "react";
import { createRoot } from "react-dom/client";
globalThis.React = React;
globalThis.ReactDOM = { createRoot };`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  minify: true,
  legalComments: "inline",
  define: { "process.env.NODE_ENV": '"production"' },
});
const output = new URL("../.generated/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("react-runtime.js", output), `export default ${JSON.stringify(result.outputFiles[0].text)};\n`);
