# Atoms Demo

输入一句需求，生成一页能操作的网页。可以在同一个项目里接着说要改什么，也可以打开或恢复之前的版本。

## 在本机跑起来

准备 Node.js 22 或更高版本，以及一枚有调用额度的 Atoms API Key。在项目目录执行下面两条命令。

```sh
cp -n .env.example .env.local
npm ci
```

用编辑器打开 `.env.local`，填写 `ATOMS_API_KEY`，然后运行 `npm run dev`。默认模型是 `gpt-6.1-sol`，可以通过 `ATOMS_MODEL` 更换。

打开终端给出的本地地址，输入「做一个温度换算器，输入摄氏温度后用按钮算出华氏温度」。在预览里输入 25，确认结果是 77。接着发一句「加上华氏度转摄氏度」，在新版本里把两个方向都试一遍。刷新后，从「最近项目」打开同一个工作台。

如果页面提示「Atoms API 调用额度不足」，先检查 Key 对应的调用额度，再回项目里点「重试」。失败的需求会留在对话里。

## 代码从哪里看

- `app/api/generate/route.js` 接收需求，把构建进度和结果发回工作台。
- `lib/generator.js` 管理单 Agent 的构建过程。先出计划，再写代码。返回格式或 JavaScript 语法错误时，最多请求模型修复一次。
- `lib/preview.js` 把生成的 HTML、CSS 和 JavaScript 放进沙箱 iframe。候选版本通过启动检查后才会成为当前版本。
- `app/page.js` 管理项目对话、预览和历史版本。项目及源码版本保存在浏览器的 `localStorage` 里。预览中填入的临时数据会随重载重置。

## 笔试说明

实现取舍、实际验证结果和后续优先级见 [笔试说明](docs/assessment.md)。

## Cloudflare Workers

[打开在线工作台](https://atoms-demo.1443343615.workers.dev/)

已登录 Wrangler 后，在项目目录运行 `npm run deploy:cloudflare`。生成接口需要 Worker Secret `ATOMS_API_KEY`。它可以在 Cloudflare 控制台设置，也可以用 `npx wrangler secret put ATOMS_API_KEY` 写入。
