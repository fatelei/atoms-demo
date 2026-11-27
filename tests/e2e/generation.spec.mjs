import { expect, test } from "@playwright/test";

const initialRequest = "制作一个中文的排练室费用计算器。一个数字输入框，标签「使用时长（小时）」，费率每小时 75 元。点击「计算费用」后显示总费用。";
const revisionRequest = "增加一个「会员八折」复选框。勾选后原来的计算按钮按八折计算，不勾保持原价。";

test.use({
  baseURL: process.env.E2E_BASE_URL || "https://atoms-demo.1443343615.workers.dev/",
  channel: process.env.E2E_BROWSER_CHANNEL || undefined,
  navigationTimeout: 30_000,
  actionTimeout: 15_000,
});

async function waitForVersion(page, number) {
  const version = page.getByText(`当前版本 v${number}`, { exact: true });
  const error = page.locator(".failure [role=alert]").last();
  await expect(version.or(error).first()).toBeVisible({ timeout: 175_000 });

  if (await error.isVisible()) {
    throw new Error(`构建 v${number} 失败：${await error.innerText()}`);
  }
  await expect(version).toBeVisible();
}

async function openWorkbench(page, editor) {
  await page.goto("/");
  const example = page.getByRole("button", { name: "活动报名表", exact: true });
  // The form is visible before React is ready to receive input.
  await expect(async () => {
    await example.click({ timeout: 2_000 });
    await expect(editor).toHaveValue(/报名表/, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function checkFee(frame, expected) {
  await frame.getByRole("spinbutton").fill("2");
  await frame.getByRole("button", { name: /计算费用/ }).click();
  await expect(frame.locator("body")).toContainText(
    new RegExp(`(?:^|[^0-9])${expected}(?![0-9])`),
    { useInnerText: true, timeout: 8_000 },
  );
}

test("生成、修改排练室计算器并在刷新后恢复项目", async ({ page }) => {
  test.setTimeout(400_000);

  const editor = page.locator("textarea");
  const preview = page.frameLocator(".canvas iframe");
  const checks = page.locator(".version").last().locator(".acceptance");

  await test.step("生成 v1 并验证两小时为 150 元", async () => {
    await openWorkbench(page, editor);
    await editor.fill(initialRequest);
    await page.getByRole("button", { name: "生成应用", exact: true }).click();
    await waitForVersion(page, 1);
    await expect(checks.locator("summary")).toBeVisible();
    await checkFee(preview, 150);
  });

  await test.step("添加会员八折，验证折扣价和原价", async () => {
    await editor.fill(revisionRequest);
    await page.getByRole("button", { name: "发送修改", exact: true }).click();
    await waitForVersion(page, 2);
    await checks.locator("summary").click();
    await expect(checks.getByText(/^回归 · /).first()).toBeVisible();

    const membership = preview.getByRole("checkbox");
    await membership.check();
    await checkFee(preview, 120);
    await membership.uncheck();
    await checkFee(preview, 150);
  });

  await test.step("刷新后恢复对话和 v2", async () => {
    await page.reload();
    await waitForVersion(page, 2);
    await expect(page.getByText(revisionRequest, { exact: true })).toBeVisible();
    await expect(preview.getByRole("checkbox")).toBeVisible();
  });
});

test("版本验收卡重跑旧检查并保存实际结果", async ({ page }) => {
  const original = {
    title: "点击两次得到 2",
    scope: "current",
    steps: [
      { action: "click", selector: "#increment" },
      { action: "click", selector: "#increment" },
      { action: "assertText", selector: "#total", value: "2" },
    ],
  };
  await page.route("**/api/generate", async (route) => {
    const { source } = route.request().postDataJSON();
    const increment = source ? 2 : 1;
    if (source) expect(source.checks).toEqual([original]);
    const checks = source ? [
      { ...original, scope: "regression" },
      {
        title: "点击增加 2，筛选后隐藏记录",
        scope: "current",
        steps: [
          { action: "click", selector: "#increment" },
          { action: "assertText", selector: "#total", value: "2" },
          { action: "fill", selector: "#filter", value: "周" },
          { action: "assertAbsent", selector: "#record" },
        ],
      },
    ] : [original];
    const app = {
      title: "计数器",
      summary: "点击按钮改变计数",
      html: '<button id="increment">增加</button><output id="total">0</output><input id="filter"><p id="record">林青</p>',
      css: "#total { margin-left: 8px; }",
      js: `
        const total = document.querySelector("#total");
        document.querySelector("#increment").onclick = () => {
          total.textContent = Number(total.textContent) + ${increment};
        };
        document.querySelector("#filter").oninput = (event) => {
          document.querySelector("#record").hidden = event.target.value !== "";
        };
      `,
      checks,
    };
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "result", app }) + "\n",
    });
  });

  const editor = page.locator("textarea");
  const preview = page.frameLocator(".canvas iframe");
  await openWorkbench(page, editor);
  await editor.fill("做一个计数器，每次点击加一");
  await page.getByRole("button", { name: "生成应用", exact: true }).click();
  await waitForVersion(page, 1);
  await expect(page.getByText("版本验收 · 1/1 项通过")).toBeVisible();
  await expect(preview.locator("#total")).toHaveText("0");

  await editor.fill("每次点击加二");
  await page.getByRole("button", { name: "发送修改", exact: true }).click();
  await waitForVersion(page, 2);
  await expect(preview.locator("#total")).toHaveText("0");
  const headline = page.getByText("版本验收 · 1/2 项通过");
  await expect(headline).toBeVisible();
  await headline.click();
  await expect(page.getByText("回归 · 点击两次得到 2")).toBeVisible();
  await expect(page.getByText("第 3 步 · 预期「2」 · 实际 4")).toBeVisible();
  await expect(page.getByText("点击增加 2，筛选后隐藏记录")).toBeVisible();
  await expect(preview.locator("#record")).toBeVisible();

  await page.reload();
  await waitForVersion(page, 2);
  await expect(headline).toBeVisible();
});


test("React 任务数据跨刷新保留且验收数据和项目相互隔离", async ({ page }) => {
  const app = {
    title: "任务板",
    summary: "新增和删除任务",
    framework: "react",
    html: '<div id="root"></div>',
    css: "body { padding: 12px; }",
    js: `
      const h = React.createElement;
      function App() {
        const [tasks, setTasks] = React.useState(null);
        const [draft, setDraft] = React.useState("");
        const [error, setError] = React.useState("");
        const [saving, setSaving] = React.useState(false);
        React.useEffect(() => {
          AtomsData.get("tasks").then((value) => setTasks(value ?? []), (error) => setError(error.message));
        }, []);
        async function update(next) {
          setSaving(true);
          try {
            await AtomsData.set("tasks", next);
            setTasks(next);
            setDraft("");
          } catch (error) {
            setError(error.message);
          } finally {
            setSaving(false);
          }
        }
        return h("main", null,
          h("input", { id: "task", "aria-label": "任务", value: draft, onChange: (event) => setDraft(event.target.value) }),
          h("button", { id: "add", disabled: !tasks || !draft || saving, onClick: () => update([...tasks, draft]) }, "新增"),
          h("p", { id: "count" }, tasks ? String(tasks.length) : "加载中"),
          error && h("p", { role: "alert" }, error),
          h("ul", null, (tasks ?? []).map((task, index) => h("li", { key: index },
            h("span", { className: "task-title" }, task),
            h("button", { disabled: saving, onClick: () => update(tasks.filter((_, i) => i !== index)) }, "删除")))));
      }
      ReactDOM.createRoot(document.getElementById("root")).render(h(App));
    `,
    checks: [{
      scope: "current",
      title: "新增任务后显示记录",
      steps: [
        { action: "fill", selector: "#task", value: "验收任务" },
        { action: "click", selector: "#add" },
        { action: "assertText", selector: ".task-title", value: "验收任务" },
      ],
    }],
  };
  await page.route("**/api/generate", (route) => route.fulfill({
    contentType: "application/x-ndjson",
    body: JSON.stringify({ type: "result", app }) + "\n",
  }));

  const editor = page.locator("textarea");
  const preview = page.frameLocator(".canvas iframe");
  const count = preview.locator("#count");
  async function createProject() {
    await editor.fill("创建一个可保存任务的任务板");
    await page.getByRole("button", { name: "生成应用", exact: true }).click();
    await waitForVersion(page, 1);
    await expect(page.getByText("版本验收 · 1/1 项通过")).toBeVisible();
    await expect(count).toHaveText("0");
  }

  await openWorkbench(page, editor);
  await createProject();
  const firstProject = page.url();
  await preview.getByRole("textbox", { name: "任务", exact: true }).fill("刷新后保留");
  await preview.getByRole("button", { name: "新增", exact: true }).click();
  await expect(preview.getByText("刷新后保留", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(preview.getByText("刷新后保留", { exact: true })).toBeVisible();
  await page.reload();
  await waitForVersion(page, 1);
  await expect(preview.getByText("刷新后保留", { exact: true })).toBeVisible();

  await editor.fill("调整任务列表样式，保留原有任务");
  await page.getByRole("button", { name: "发送修改", exact: true }).click();
  await waitForVersion(page, 2);
  await expect(preview.getByText("刷新后保留", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Atoms Demo" }).click();
  await createProject();
  await expect(preview.getByText("刷新后保留", { exact: true })).toBeHidden();

  await page.goto(firstProject);
  await waitForVersion(page, 2);
  await preview.getByRole("button", { name: "删除", exact: true }).click();
  await expect(count).toHaveText("0");
  await page.reload();
  await waitForVersion(page, 2);
  await expect(count).toHaveText("0");
});
