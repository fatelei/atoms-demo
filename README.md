# Atoms Demo

输入一句需求，生成一页能操作的网页。可以在同一个项目里接着说要改什么，也可以打开或恢复之前的版本。

新版本的验收卡会显示浏览器实际跑出的检查结果。修改时会复测上一版的检查。展开失败项，可以看到出错步骤、预期值和实际结果。

## 在本机跑起来

准备 Node.js 22 或更高版本，并用 Wrangler 登录自己的 Cloudflare 账户。在项目目录执行：

```sh
npm ci
npx wrangler login
npm run build:cloudflare
npx wrangler dev
```

生成请求通过 Wrangler 的远程 Workers AI 绑定执行，会占用该账户的 Workers AI 用量。默认模型是 `@cf/qwen/qwen3.8-27b`。

打开终端给出的本地地址，输入「做一个温度换算器，输入摄氏温度后用按钮算出华氏温度」。在预览里输入 25，确认结果是 77。接着发一句「加上华氏度转摄氏度」，在新版本里把两个方向都试一遍。刷新页面会回到当前项目。也可以从「最近项目」打开其他项目。

如果模型暂时不可用，失败的需求会留在对话里，可以点「重试」。

## 代码从哪里看

- `app/api/generate/route.js` 接收需求，把构建进度和结果发回工作台。
- `lib/generator.js` 管理单 Agent 的构建过程。先出计划，再写代码。返回格式或 JavaScript 语法错误时，最多请求模型修复一次。
- `lib/preview.js` 在沙箱 iframe 内加载 React 和生成的组件。已有的 HTML／JavaScript 版本也可以继续预览。候选版本通过启动检查后才会成为当前版本。
- `app/page.js` 管理项目对话、预览和历史版本。项目及源码版本保存在浏览器的 `localStorage` 里。有后端的应用通过 `AtomsBackend` 调用生成的 API，由 Dynamic Worker 执行业务规则。项目记录写入 SQLite Durable Object。已有 `AtomsData` 应用仍能读写原数据。

## 笔试说明

实现取舍、实际验证结果和后续优先级见 [笔试说明](docs/assessment.md)。

## Cloudflare Workers

[打开在线工作台](https://atoms-demo.1443343615.workers.dev/)

已登录 Wrangler 后，在项目目录运行 `npm run deploy:cloudflare`。部署配置包含 Workers AI、SQLite Durable Object 和 Worker Loader。Worker Loader 需要 **Workers Paid**。生成接口无需额外的 API Key。

## 后端怎么跑

Agent 可以生成 React 页面和一个 JS 后端模块。每个后端版本在独立的 Dynamic Worker 中运行。它收到操作、参数和当前记录，返回结果与可选的新状态。主 Worker 关闭沙箱出网，校验结果，并在 SQLite 里提交更新。浏览器验收用各自的临时状态，调用同一段沙箱代码。

## 上线后验收

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

默认测试上面的线上地址。要测试别的部署，运行 `E2E_BASE_URL=https://你的部署地址 npm run test:e2e`。真实生成用例会占用目标部署的 Workers AI 额度。只想用固定响应检查验收卡，可以运行 `npm run test:e2e -- --grep 版本验收卡`。

只检查 React 任务数据的保存、刷新恢复和项目隔离，可以运行 `npm run test:e2e -- --grep 'React 任务数据'`。这条用例固定生成结果，数据读写走实际部署。

`npm run test:e2e -- --grep 预约后端` 会生成 12 人预约台，直接向服务器构造超额请求，再修改单笔上限并检查旧记录。该用例使用真实模型和后端沙箱。
