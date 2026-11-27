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
    await page.locator(".recent button").click();
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
  await page.locator(".recent button").click();
  await waitForVersion(page, 2);
  await expect(headline).toBeVisible();
});
