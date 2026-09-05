import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";

const graph = {
  nodes: ["demo", "parent", "child", "far"].map((id, index) => ({
    id, label: id === "child" ? "New row branch" : id,
    status: "active", preview: "A persisted conversation.",
    created_at: `2026-09-05T20:00:0${index}Z`,
  })),
  edges: [
    { source: "parent", target: "child", chunk_id: "parent#c6.row0" },
    { source: "demo", target: "far", chunk_id: "demo#c1" },
  ],
  layouts: {
    lineage: {
      demo: { x: 0, y: 0 }, far: { x: 1200, y: 320 },
      parent: { x: 0, y: 640 }, child: { x: 300, y: 640 },
    },
  },
};

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
      // Make the initial-fit race deterministic: container sizing is ready
      // before delayed card measurements, as on a slower first render.
      const NativeResizeObserver = window.ResizeObserver;
      window.ResizeObserver = class extends NativeResizeObserver {
        constructor(callback) {
          super((entries, observer) => {
            if (entries.some((entry) => entry.target.classList.contains("react-flow__node"))) {
              setTimeout(() => callback(entries, observer), 100);
            } else {
              callback(entries, observer);
            }
          });
        }
      };
    });
    await page.route(/\/(?:threads(?:[/?].*)?|graph)$/, async (route) => {
      assert.equal(route.request().method(), "GET");
      const path = new URL(route.request().url()).pathname;
      if (path === "/graph") {
        await route.fulfill({ json: graph });
      } else if (path === "/threads") {
        await route.fulfill({ json: [
          { id: "child", title: "New row branch", status: "active", updated_at: "" },
        ] });
      } else {
        assert.equal(path, "/threads/child");
        await route.fulfill({ json: {
          id: "child", title: "New row branch", raw_content: "",
          chunks: [], forked_children: [], lineage_depth: 1,
        } });
      }
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole("heading", { name: "New row branch" }).waitFor();
    await page.getByRole("button", { name: "Map", exact: true }).click();

    const assertFitted = async () => {
      await page.waitForFunction(() => {
        const clip = document.querySelector(".react-flow")?.getBoundingClientRect();
        const nodes = [...document.querySelectorAll(".react-flow__node")];
        return clip && nodes.length === 4
          && document.querySelectorAll(".react-flow__edge").length === 2
          && nodes.every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0
            && rect.left >= clip.left - 1 && rect.right <= clip.right + 1
            && rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1;
        });
      }, undefined, { timeout: 5000 });
      assert.equal(await page.locator(".react-flow__edge").count(), 2);
      assert.equal(await page.locator('[data-id="child"] .thread-map-card.active').count(), 1);
    };

    await assertFitted();
    if (process.env.TABLE_ROW_SCREENSHOT_DIR) {
      await mkdir(process.env.TABLE_ROW_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.TABLE_ROW_SCREENSHOT_DIR, `map-branch-${name}.png`) });
    }
    await page.getByRole("button", { name: "Tree", exact: true }).click();
    await assertFitted();
    await page.close();
    console.log(`${name}: persisted row branch and both connections fit inside lineage/tree viewports`);
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
