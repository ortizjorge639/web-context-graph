import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";

const executablePath = execFileSync(
  process.execPath, ["node_modules/hyperframes/bin/hyperframes.mjs", "browser", "path"],
  { encoding: "utf8" },
).trim();
const url = process.env.LINEAGE_PREVIEW_URL
  || "http://localhost:3217/api/projects/lineage-cinematic/preview";
const browser = await puppeteer.launch({
  executablePath, headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const errors = [];
  const remoteRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (["http:", "https:"].includes(requestUrl.protocol) && requestUrl.origin !== new URL(url).origin) {
      remoteRequests.push(request.url());
      console.error(`Blocked nonlocal request: ${request.url()}`);
      request.abort();
    } else {
      request.continue();
    }
  });
  await page.goto(url, { waitUntil: "networkidle0" });
  assert.deepEqual(errors, [], "Page load errors");
  await page.waitForFunction(
    () => Boolean(window.__lineage?.ready && window.__timelines?.main),
    { polling: 100 },
  );
  assert.deepEqual(errors, [], "Initialization errors");
  const duration = await page.evaluate(() => Number(document.querySelector("[data-composition-id]").dataset.duration));
  assert.equal(duration, 23, "Update the sample windows when intentionally retiming the film");
  const times = [0, 2.5, 5.5, 8, 11.5, 14, 16.5, 19, 22.9];
  const hashes = new Map();
  const canvasHashes = new Set();
  const capture = async (time) => {
    const state = await page.evaluate((value) => {
      window.__player?.pause?.();
      window.__timelines.main.seek(value, true);
      window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time: value } }));
      const { nodes, edges, block } = window.__lineage;
      return {
        time: Number(document.querySelector("#stage").dataset.time),
        canvas: document.querySelector("#stage").toDataURL(),
        overlays: [...document.querySelectorAll(".copy, .caption, #file-labels, #file-labels span, #end-card, #end-content")]
          .map((element) => element.getAttribute("style")),
        fontLoaded: document.fonts.check('600 64px "Lineage Sans"'),
        finiteGeometry: edges.every((edge) => [...edge.geometry.attributes.position.array].every(Number.isFinite)),
        blockClearance: Math.min(...[-2.35, 2.35].flatMap((x) => [-1.09, 1.09].map((y) => {
          const point = new window.THREE.Vector3(x, y, -0.0375).applyMatrix4(block.matrix);
          return point.z - 0.055;
        }))),
        nodes: nodes.map((node) => ({ id: node.id, parent: node.parent })),
      };
    }, time);
    assert.ok(Math.abs(state.time - time) < 0.001, `Runtime failed to seek to ${time}`);
    assert.ok(state.fontLoaded, "Bundled font did not load");
    assert.ok(state.finiteGeometry, "Edge geometry contains a non-finite vertex");
    assert.ok(state.blockClearance > 0, "Selected block intersects the retained source page");
    assert.equal(state.nodes.filter((node) => node.parent === null).length, 1);
    for (const node of state.nodes) {
      const visited = new Set([node.id]);
      let parent = node.parent;
      while (parent) {
        assert.ok(!visited.has(parent), "Lineage contains a cycle");
        visited.add(parent);
        const ancestor = state.nodes.find((item) => item.id === parent);
        assert.ok(ancestor, "Dangling parent reference");
        parent = ancestor.parent;
      }
    }
    canvasHashes.add(createHash("sha256").update(state.canvas).digest("hex"));
    return createHash("sha256").update(state.canvas).update(JSON.stringify(state.overlays)).digest("hex");
  };
  for (const time of times) hashes.set(time, await capture(time));
  for (const time of [...times].reverse()) {
    assert.equal(await capture(time), hashes.get(time), `Backward seek differs at ${time}`);
  }
  for (const index of [2, 0, 3, 1, 0, 2]) {
    const time = times[index];
    assert.equal(await capture(time), hashes.get(time), `Random seek differs at ${time}`);
  }
  assert.ok(new Set(hashes.values()).size === times.length, "Scene/overlay state is stale across shots");
  assert.ok(canvasHashes.size >= times.length - 2, "Canvas is stale outside the intentional file/end holds");
  assert.deepEqual(remoteRequests, [], "Render must not request remote assets");
  assert.deepEqual(errors, [], "Browser errors");
  console.log(`PASS: ${times.length} forward/backward samples plus random seeks have identical WebGL pixels and overlay styles.`);
  console.log("PASS: local font, finite geometry, block clearance, single-parent acyclic tree, no remote requests/browser errors.");
} finally {
  await browser.close();
}
