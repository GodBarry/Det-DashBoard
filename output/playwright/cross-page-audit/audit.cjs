const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const outDir = __dirname;
const pages = [
  { id: 'dataset', nav: 0, root: '.home-workspace, .workspace-layout, .workspace-folder-layout', columns: ['.home-sidebar, .workspace-sidebar', '.home-browser, .preview-area', '.home-inspector, .inspector-panel'] },
  { id: 'asset', nav: 1, root: '.asset-workspace', columns: ['.asset-sidebar', '.asset-main', '.asset-inspector'] },
  { id: 'training', nav: 2, root: '.training-workspace', columns: ['.training-sidebar', '.training-main', '.training-inspector'] },
  { id: 'inference', nav: 3, root: '.inference-workspace', columns: ['.inference-sidebar', '.inference-main', '.inference-inspector'] },
  { id: 'evaluation', nav: 4, root: '.evaluation-viz-workspace', columns: ['.evaluation-runs', '.evaluation-viz-main', '.evaluation-insights'] },
];
const viewports = [
  { id: '1080p-browser', width: 1920, height: 940 },
  { id: '2k-browser', width: 2560, height: 1320 },
  { id: '2160x1440-browser', width: 2160, height: 1320 },
];

function rect(el) {
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), right: Math.round(box.right), bottom: Math.round(box.bottom) };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = [];
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    for (const theme of ['light', 'dark']) {
      const currentTheme = await page.locator('.app-shell').evaluate((el) => el.classList.contains('dark') ? 'dark' : 'light');
      if (currentTheme !== theme) await page.locator('.theme-toggle').click();
      for (const target of pages) {
        await page.locator('.nav-tabs button').nth(target.nav).click();
        await page.waitForTimeout(350);
        const data = await page.evaluate(({ target, viewport, theme }) => {
          const rect = (el) => {
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), right: Math.round(box.right), bottom: Math.round(box.bottom) };
          };
          const root = document.querySelector(target.root);
          const nav = document.querySelector('.main-nav');
          const columns = target.columns.map((selector) => document.querySelector(selector));
          const clipped = [...document.querySelectorAll(`${target.root} *`)].filter((el) => {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (!el.textContent.trim() || el.children.length > 2) return false;
            return el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
          }).slice(0, 30).map((el) => ({ tag: el.tagName, cls: el.className, text: el.textContent.trim().slice(0, 80), client: [el.clientWidth, el.clientHeight], scroll: [el.scrollWidth, el.scrollHeight] }));
          const parseRgb = (value) => {
            const match = String(value).match(/[\d.]+/g);
            return match && match.length >= 3 ? match.slice(0, 3).map(Number) : null;
          };
          const luminance = (rgb) => {
            const values = rgb.map((value) => { const channel = value / 255; return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
            return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
          };
          const contrast = (foreground, background) => {
            const a = luminance(foreground); const b = luminance(background);
            return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          };
          const backgroundFor = (el) => {
            let node = el;
            while (node) {
              const value = getComputedStyle(node).backgroundColor;
              const rgba = String(value).match(/[\d.]+/g);
              if (rgba && rgba.length >= 3 && (rgba.length < 4 || Number(rgba[3]) > .85)) return parseRgb(value);
              node = node.parentElement;
            }
            return theme === 'dark' ? [8, 19, 27] : [255, 255, 255];
          };
          const lowContrast = [...document.querySelectorAll(`${target.root} *`)].filter((el) => el.childNodes.length && [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())).map((el) => {
            const style = getComputedStyle(el); const fg = parseRgb(style.color); const bg = backgroundFor(el);
            const ratio = fg && bg ? contrast(fg, bg) : 21; const size = parseFloat(style.fontSize); const weight = Number(style.fontWeight) || 400;
            const large = size >= 24 || (size >= 18.66 && weight >= 700);
            return { el, ratio, size, text: el.textContent.trim().slice(0, 80), color: style.color, background: bg };
          }).filter((item) => item.ratio < (item.size >= 18.66 ? 3 : 4.5) && item.el.getBoundingClientRect().width > 0).slice(0, 30).map(({ el, ...item }) => ({ ...item, ratio: Number(item.ratio.toFixed(2)), cls: el.className }));
          const styles = root ? getComputedStyle(root) : null;
          return {
            page: target.id,
            viewport: viewport.id,
            theme,
            nav: rect(nav),
            root: rect(root),
            columns: columns.map(rect),
            rootScroll: root ? { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, clientHeight: root.clientHeight, scrollHeight: root.scrollHeight } : null,
            rootStyle: styles ? { color: styles.color, backgroundColor: styles.backgroundColor, fontFamily: styles.fontFamily, fontSize: styles.fontSize } : null,
            clipped,
            lowContrast,
          };
        }, { target, viewport, theme });
        report.push(data);
        await page.screenshot({ path: path.join(outDir, `${viewport.id}-${target.id}-${theme}-typography-after.png`), fullPage: false });
      }
    }
    await context.close();
  }
  fs.writeFileSync(path.join(outDir, 'typography-after-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
