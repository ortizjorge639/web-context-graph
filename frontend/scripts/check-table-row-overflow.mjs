import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";

const header = "| Command | Purpose |\n| :--- | :--- |";
const rows = [
  ["`/help`", "Displays available commands and keyboard shortcuts."],
  ["`/plan`", "Creates an implementation plan before making code changes."],
  ["`/diff`", "Shows changes in the current working directory."],
  ["`/review`", "Reviews changes for bugs and logic errors."],
  ["`/research`", "Researches a topic across sources and provides citations."],
].map((cells) => `| ${cells.join(" | ")} |`);
const text = [header, ...rows].join("\n");
const summary = { id: "t1", title: "What does each command do?", status: "active", updated_at: "" };
const thread = {
  ...summary,
  raw_content: text,
  forked_children: [],
  lineage_depth: 0,
  chunks: [
    { id: "t1#c0", kind: "block", order: 0, text: "**assistant:** Here are the commands you can explore:" },
    {
      id: "t1#c1", kind: "block", order: 1, text,
      table_rows: rows.map((row, index) => ({
        id: `t1#c1.row${index}`, table_index: 0, row_index: index,
        text: `${header}\n${row}`,
        end_offset: [header, ...rows.slice(0, index + 1)].join("\n").length,
      })),
    },
  ],
};

// Serve only the built frontend, with synthetic API responses. No vault or
// backend process is involved, and the OS chooses an unused loopback port.
const server = await preview({
  configFile: false,
  preview: { host: "127.0.0.1", port: 0, open: false },
});
let browser;
try {
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  browser = await chromium.launch();
  for (const [name, viewport] of [
    ["mobile", { width: 390, height: 844 }],
    ["desktop", { width: 1440, height: 1000 }],
  ]) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(() => {
      localStorage.setItem("wcg_onboarding_seen", "1");
      localStorage.setItem("wcg_appearance", "light");
    });
    await page.route(/\/threads(?:[/?].*)?$/, async (route) => {
      assert.equal(route.request().method(), "GET", "This check must not mutate a conversation");
      const path = new URL(route.request().url()).pathname;
      assert.ok(path === "/threads" || path === "/threads/t1");
      await route.fulfill({ json: path === "/threads" ? [summary] : thread });
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    const button = page.getByRole("button", { name: "Branch from table row 2", exact: true });
    await button.waitFor();
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter((animation) => animation.effect.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished));
    });
    const scroller = page.locator(".message-list .markdown-table-scroll");
    if (name === "mobile") {
      assert.ok(await scroller.evaluate((node) => node.scrollWidth > node.clientWidth));
    }
    for (const fraction of [0, 0.5, 1, 0]) {
      await scroller.evaluate((node, position) => {
        node.scrollLeft = (node.scrollWidth - node.clientWidth) * position;
      }, fraction);
      const hit = await button.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const clip = node.closest(".markdown-table-scroll").getBoundingClientRect();
        const points = [
          [rect.x + rect.width / 2, rect.y + rect.height / 2],
          [rect.left + 2, rect.y + rect.height / 2], [rect.right - 2, rect.y + rect.height / 2],
          [rect.x + rect.width / 2, rect.top + 2], [rect.x + rect.width / 2, rect.bottom - 2],
        ];
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          rect: rect.toJSON(),
          clip: clip.toJSON(),
          targets: points.map(([x, y]) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 100)),
          insideClip: rect.left >= clip.left && rect.right <= clip.right
            && rect.left >= 0 && rect.right <= innerWidth,
          receivesPointer: points.every(([x, y]) => {
            const target = document.elementFromPoint(x, y);
            return target === node || node.contains(target);
          }),
        };
      });
      assert.ok(hit.insideClip && hit.receivesPointer,
        `${name}: row action must be painted and hit-testable at scroll fraction ${fraction}: ${JSON.stringify(hit)}`);
      if (fraction === 0) {
        // A physical pointer click cannot auto-scroll the target into view,
        // unlike locator.click() or focusing an offscreen button.
        await page.mouse.click(hit.x, hit.y);
        assert.match(await page.locator(".branch-composer-context").innerText(), /Command[\s\S]*Purpose[\s\S]*\/plan/);
        assert.equal(await page.locator(".table-row-selected").count(), 1);
        assert.equal(await page.locator(".message-selected").count(), 0);
        if (process.env.TABLE_ROW_SCREENSHOT_DIR) {
          await mkdir(process.env.TABLE_ROW_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({
            path: join(process.env.TABLE_ROW_SCREENSHOT_DIR, `table-row-${name}.png`),
          });
        }
        await page.getByRole("button", { name: "Cancel branch" }).click();
      }
    }
    assert.equal(await page.locator(".conversation-scroll").evaluate((node) => node.scrollLeft), 0);
    await page.close();
    console.log(`${name}: row actions receive pointer input at left, middle, and right scroll positions`);
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
