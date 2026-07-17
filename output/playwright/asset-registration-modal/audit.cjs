const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve('output/playwright/asset-registration-modal');
fs.mkdirSync(outDir, { recursive: true });
const modes = [
  { id: 'cluster', label: '登记模型簇' },
  { id: 'version', label: '登记模型版本' },
  { id: 'algorithm', label: '导入算法适配器' },
  { id: 'env', label: '登记Python环境' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = [];
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('.nav-tabs button').nth(1).click();
  await page.waitForTimeout(500);

  for (const theme of ['dark', 'light']) {
    const currentTheme = await page.locator('.app-shell').evaluate((el) => el.classList.contains('dark') ? 'dark' : 'light');
    if (currentTheme !== theme) {
      await page.locator('.theme-toggle').click();
      await page.waitForTimeout(250);
    }
    for (const mode of modes) {
      await page.getByRole('button', { name: mode.label }).click();
      await page.waitForTimeout(250);
      const modal = page.locator('.asset-drawer');
      await modal.screenshot({ path: path.join(outDir, `${theme}-${mode.id}.png`) });
      const metrics = await page.evaluate(() => {
        const modal = document.querySelector('.asset-drawer');
        const firstField = document.querySelector('.drawer-field');
        const firstLabel = document.querySelector('.drawer-field > span:first-child');
        const firstControl = document.querySelector('.drawer-field > :last-child');
        const activeTab = document.querySelector('.drawer-tabs button.active');
        const primary = document.querySelector('.drawer-actions .primary');
        const rect = (el) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) };
        };
        const styles = (el) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          return { color: s.color, background: s.backgroundColor, fontSize: s.fontSize, fontFamily: s.fontFamily };
        };
        return {
          modal: rect(modal),
          field: rect(firstField),
          label: rect(firstLabel),
          control: rect(firstControl),
          activeTab: rect(activeTab),
          primary: rect(primary),
          modalStyle: styles(modal),
          labelStyle: styles(firstLabel),
          controlStyle: styles(firstControl),
          title: document.querySelector('.drawer-head h2')?.textContent || '',
          activeText: activeTab?.textContent || '',
        };
      });
      report.push({ theme, mode: mode.id, ...metrics });
      await page.locator('.drawer-close').click();
      await page.waitForTimeout(150);
    }
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
})();