const { test, expect } = require("@playwright/test");

test("creates a project, navigates folders, imports YOLO, filters and exports COCO", async ({ page }) => {
  const projectName = `ui-e2e-${Date.now()}`;
  const folderRoot = `ui-root-${Date.now()}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "数据集管理" })).toBeVisible();

  page.once("dialog", async (dialog) => dialog.accept(folderRoot));
  await page.getByRole("button", { name: "新建项目" }).click();
  const rootFolder = page.locator("article.project-folder").filter({ hasText: folderRoot });
  await expect(rootFolder).toBeVisible();
  await expect(rootFolder.getByTitle("进入文件夹")).toHaveCount(0);
  await rootFolder.dblclick();
  await expect(page.getByRole("heading", { name: "下级文件夹" })).toBeVisible();
  await expect(page.getByText("该级文件夹无数据。")).toBeVisible();

  page.once("dialog", async (dialog) => dialog.accept("level-b"));
  await page.getByRole("button", { name: "新建文件夹" }).click();
  const middleFolder = page.locator("article.project-folder").filter({ hasText: "level-b" });
  await expect(middleFolder).toBeVisible();
  await middleFolder.dblclick();

  page.once("dialog", async (dialog) => dialog.accept("level-c"));
  await page.getByRole("button", { name: "新建文件夹" }).click();
  const leafFolder = page.locator("article.project-folder").filter({ hasText: "level-c" });
  await expect(leafFolder).toBeVisible();
  await leafFolder.dblclick();
  await expect(page.getByRole("button", { name: "新建文件夹" })).toBeDisabled();
  await expect(page.getByText("第 3 级 / 最多 3 级")).toBeVisible();
  await page.getByRole("button", { name: "返回上一级" }).click();
  await expect(page.getByRole("heading", { name: "level-b" })).toBeVisible();
  await page.getByRole("button", { name: "根目录" }).click();

  page.once("dialog", async (dialog) => dialog.accept(projectName));
  await page.getByRole("button", { name: "新建项目" }).click();
  const project = page.locator("article.project-folder").filter({ hasText: projectName });
  await expect(project).toBeVisible();
  await project.dblclick();
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  await page.getByRole("button", { name: "导入数据" }).click();
  await page.getByRole("button", { name: "浏览" }).click();
  await expect(page.getByRole("heading", { name: "选择数据文件夹" })).toBeVisible();
  await expect(page.locator(".dir-current")).toHaveText("/test-data");
  await page.locator(".dir-list button").filter({ hasText: "yolo" }).click();
  await page.locator(".dir-list button").filter({ hasText: "scene-yolo" }).click();
  await expect(page.locator(".dir-current")).toHaveText("/test-data/yolo/scene-yolo");
  await page.getByRole("button", { name: "上一级", exact: true }).click();
  await expect(page.locator(".dir-current")).toHaveText("/test-data/yolo");
  await page.locator(".dir-list button").filter({ hasText: "scene-yolo" }).click();
  await page.getByRole("button", { name: "选择当前文件夹" }).click();
  await expect(page.locator(".import-path-row input")).toHaveValue("/test-data/yolo/scene-yolo");
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(page.locator(".filter-group").filter({ hasText: "场景" }).getByText("scene-yolo", { exact: true })).toBeVisible();
  const card = page.locator(".asset-card").filter({ hasText: "scene-yolo" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("1 标注");
  await expect(card.locator("img")).toHaveJSProperty("complete", true);
  await expect.poll(async () => card.locator("img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await card.click();
  await expect(page.locator(".file-path-bar code")).toContainText("/test-data/yolo/scene-yolo/");

  const categoryFilter = page.locator(".filter-group").filter({ hasText: "类别" });
  await categoryFilter.getByText("vehicle", { exact: true }).click();
  await expect(card).toHaveCount(1);

  await page.getByLabel("导出格式").selectOption("coco");
  await page.getByRole("button", { name: "导出数据集" }).click();
  await expect(page.locator(".progress-card").filter({ hasText: "导出进度" })).toBeHidden({ timeout: 20_000 });
});
