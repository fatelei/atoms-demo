# Atoms Demo

输入一句需求，生成一页能操作的网页。可以在同一个项目里接着说要改什么，也可以打开或恢复之前的版本。

## 在本机跑起来

准备 Node.js 22 或更高版本，并用 Wrangler 登录自己的 Cloudflare 账户。在项目目录执行：

```sh
npm ci
npx wrangler login
npm run build:cloudflare
npx wrangler dev
```

生成请求通过 Wrangler 的远程 Workers AI 绑定执行，会占用该账户的 Workers AI 用量。默认模型是 `@cf/qwen/qwen3.8-27b`。

打开终端给出的本地地址，输入「做一个温度换算器，输入摄氏温度后用按钮算出华氏温度」。在预览里输入 25，确认结果是 77。接着发一句「加上华氏度转摄氏度」，在新版本里把两个方向都试一遍。刷新后，从「最近项目」打开同一个工作台。

如果模型暂时不可用，失败的需求会留在对话里，可以点「重试」。

## 代码从哪里看

- `app/api/generate/route.js` 接收需求，把构建进度和结果发回工作台。
- `lib/generator.js` 管理单 Agent 的构建过程。先出计划，再写代码。返回格式或 JavaScript 语法错误时，最多请求模型修复一次。
- `lib/preview.js` 把生成的 HTML、CSS 和 JavaScript 放进沙箱 iframe。候选版本通过启动检查后才会成为当前版本。
- `app/page.js` 管理项目对话、预览和历史版本。项目及源码版本保存在浏览器的 `localStorage` 里。预览中填入的临时数据会随重载重置。

## 笔试说明

实现取舍、实际验证结果和后续优先级见 [笔试说明](docs/assessment.md)。

## Cloudflare Workers

[打开在线工作台](https://atoms-demo.1443343615.workers.dev/)

已登录 Wrangler 后，在项目目录运行 `npm run deploy:cloudflare`。部署配置已经声明 Workers AI 绑定，生成接口无需额外的 API Key。
