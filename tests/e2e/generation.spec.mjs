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
  await expect(version.or(error).first()).toBeVisible({ timeout: 155_000 });

  if (await error.isVisible()) {
    throw new Error(`构建 v${number} 失败：${await error.innerText()}`);
  }
  await expect(version).toBeVisible();
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
  test.setTimeout(360_000);

  const editor = page.locator("textarea");
  const preview = page.frameLocator(".canvas iframe");

  await test.step("生成 v1 并验证两小时为 150 元", async () => {
    await page.goto("/");
    const example = page.getByRole("button", { name: "活动报名表", exact: true });
    // The form is visible before React is ready to receive input.
    await expect(async () => {
      await example.click({ timeout: 2_000 });
      await expect(editor).toHaveValue(/报名表/, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    await editor.fill(initialRequest);
    await page.getByRole("button", { name: "生成应用", exact: true }).click();
    await waitForVersion(page, 1);
    await checkFee(preview, 150);
  });

  await test.step("添加会员八折，验证折扣价和原价", async () => {
    await editor.fill(revisionRequest);
    await page.getByRole("button", { name: "发送修改", exact: true }).click();
    await waitForVersion(page, 2);

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
