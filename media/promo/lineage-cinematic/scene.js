import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const W = 1920;
const H = 1080;
const PAPER_W = 5.4;
const PAPER_H = 6.8;
const PALETTE = { canvas: "#f8f7f9", paper: "#ffffff", ink: "#111012", muted: "#777477", coral: "#ff6b74" };
const FONT = '"Lineage Sans"';
window.THREE = THREE;

await document.fonts.load(`400 64px ${FONT}`);
await document.fonts.load(`600 64px ${FONT}`);
await document.fonts.ready;

const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector("#stage"), antialias: true, preserveDrawingBuffer: true,
});
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
const camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 120);
const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
const environmentMap = pmrem.fromScene(environment, 0.025);
scene.environment = environmentMap.texture;
scene.environmentIntensity = 0.18;
environment.dispose();
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xffffff, 0xb5aeb9, 0.85));
const key = new THREE.DirectionalLight(0xfff7f2, 1.8);
key.position.set(-5, 9, 13);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -22, right: 25, top: 17, bottom: -17, near: 1, far: 70 });
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.015;
key.shadow.radius = 4;
scene.add(key);
const fill = new THREE.DirectionalLight(0xe9e9ff, 0.6);
fill.position.set(12, 1, 8);
scene.add(fill);

// A seamless physical backplate, not a CSS drop shadow.
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(160, 100),
  new THREE.MeshStandardMaterial({ color: PALETTE.canvas, roughness: 1 }),
);
backdrop.position.z = -0.35;
backdrop.receiveShadow = true;
scene.add(backdrop);

const paperGeometry = new RoundedBoxGeometry(PAPER_W, PAPER_H, 0.1, 3, 0.045);
const paperMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.54, metalness: 0.08 });
const metaMaterial = new THREE.MeshStandardMaterial({ color: "#242129", roughness: 0.48, metalness: 0.16 });
const faceGeometry = new THREE.PlaneGeometry(PAPER_W - 0.085, PAPER_H - 0.085);
const blockGeometry = new RoundedBoxGeometry(4.7, 2.18, 0.075, 3, 0.035);
const blockMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.coral, roughness: 0.45, metalness: 0.06, transparent: true });
const markerGeometry = new THREE.SphereGeometry(0.065, 16, 12);
const activeMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.coral, roughness: 0.8, metalness: 0 });
const quietMaterial = new THREE.MeshStandardMaterial({ color: "#b4aeb9", roughness: 0.6 });
const edgeMaterial = new THREE.MeshStandardMaterial({ color: "#bbb6c0", roughness: 0.5, metalness: 0.08 });

const clamp = (x) => Math.max(0, Math.min(1, x));
const mix = THREE.MathUtils.lerp;
const smoother = (x) => { const t = clamp(x); return t * t * t * (t * (t * 6 - 15) + 10); };
const phase = (time, start, end) => smoother((time - start) / (end - start));
const range = (time, start, end, fade = 0.45) =>
  phase(time, start, start + fade) * (1 - phase(time, end - fade, end));
const textureWidth = 1536;
const textureHeight = Math.round(textureWidth * PAPER_H / PAPER_W);

function texture(draw, width = textureWidth, height = textureHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is required to author the paper textures");
  ctx.scale(width / 1080, width / 1080);
  draw(ctx);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return map;
}

function text(ctx, content, x, y, size = 42, weight = 400, color = PALETTE.ink) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillText(content, x, y);
}
function lines(ctx, content, x, y, size = 42, leading = 62, color = PALETTE.ink, weight = 400) {
  content.forEach((line, i) => text(ctx, line, x, y + i * leading, size, weight, color));
}
function line(ctx, x1, y1, x2, y2, color = "#e1dde4", width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function field(ctx, x, y, width, height, color, radius = 18) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}
function pageHeader(ctx, label) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1080, 1360);
  text(ctx, "Lineage", 70, 105, 39, 650);
  text(ctx, label, 690, 105, 28, 500, PALETTE.muted);
  line(ctx, 70, 151, 1010, 151);
}

const nodes = [
  {
    id: "demo-root", parent: null, title: "Cooling one city block", short: "The question",
    question: ["How could one city", "block stay cooler?"],
    body: ["Shade where people pause.", "Start at the library entrance,", "then explore the streets around it."],
    macro: [2.7, 0, 0], tree: [-7.2, 0, 0], files: [-5.65, 0.55, 0.2], fileOrder: 0,
  },
  {
    id: "demo-canopy", parent: "demo-root", title: "Library canopy", short: "Library canopy",
    question: ["What would a", "library canopy need?"],
    body: ["Begin with the entrance.", "Compare materials, maintenance,", "and the changing summer light."],
    macro: [10.8, 0, 0], tree: [0, 0, 0], files: [0, 0.55, 0.2], fileOrder: 1,
  },
  {
    id: "demo-streets", parent: "demo-root", title: "Cooler streets", short: "Cooler streets",
    question: ["What changes", "at street level?"],
    body: ["Test a small pavement pilot.", "Compare surface temperatures", "before changing the whole block."],
    macro: [10.8, -8.3, 0], tree: [0, -4.3, 0], files: [0, -4.3, -1.5],
  },
  {
    id: "demo-pause", parent: "demo-root", title: "Places to pause", short: "Places to pause",
    question: ["Where could", "neighbors pause?"],
    body: ["Map the places people wait.", "Start with existing seating", "and routes to the library."],
    macro: [10.8, 8.3, 0], tree: [0, 4.3, 0], files: [0, 4.3, -1.5],
  },
  {
    id: "demo-materials", parent: "demo-canopy", title: "Canopy materials", short: "Canopy materials",
    question: ["Which materials", "are worth testing?"],
    body: ["Compare timber and fabric.", "Consider repairs, shade quality,", "and the life of each material."],
    macro: [18.9, 4.1, 0], tree: [7.2, 2.4, 0], files: [5.65, 0.55, 0.2], fileOrder: 2,
  },
  {
    id: "demo-light", parent: "demo-canopy", title: "Seasonal light", short: "Seasonal light",
    question: ["How does the", "light change?"],
    body: ["Trace the sun across seasons.", "Keep winter daylight in view", "as you plan for summer shade."],
    macro: [18.9, -4.1, 0], tree: [7.2, -2.4, 0], files: [7.2, -2.4, -1.5],
  },
];
const byId = new Map(nodes.map((node) => [node.id, node]));
const activeIds = new Set(["demo-root", "demo-canopy", "demo-materials"]);

function conversationMap(node) {
  return texture((ctx) => {
    pageHeader(ctx, node.parent ? "CHILD THREAD" : "ROOT THREAD");
    text(ctx, node.parent ? "Continue the thought" : "A question worth exploring", 70, 245, 30, 450, PALETTE.muted);
    lines(ctx, node.question, 70, 333, 56, 71, PALETTE.ink, 560);
    if (node.parent) {
      field(ctx, 70, 465, 940, 154, "#fff0f1");
      text(ctx, "Root-to-fork context", 105, 520, 28, 600, "#8a343e");
      text(ctx, node.parent === "demo-root" ? "Shade where people pause." : "Compare materials and summer light.", 105, 570, 34);
    } else {
      text(ctx, "Copilot", 70, 493, 31, 600);
    }
    field(ctx, 70, 672, 940, 437, node.id === "demo-root" ? "#ffe6e9" : "#f3f1f5");
    text(ctx, "02   /   RESPONSE BLOCK", 110, 732, 25, 600, "#635961");
    lines(ctx, node.body, 110, 814, 40, 62, PALETTE.ink, 450);
    text(ctx, "Branch from this block", 110, 1054, 30, 550, "#8a343e");
    line(ctx, 70, 1170, 1010, 1170);
    text(ctx, node.parent ? "Your own direction. Same lineage." : "The source stays here.", 70, 1240, 31, 450, PALETTE.muted);
  });
}

const blockMap = texture((ctx) => {
  ctx.fillStyle = PALETTE.coral;
  ctx.fillRect(0, 0, 1080, 501);
  text(ctx, "02   /   RESPONSE BLOCK", 48, 77, 29, 600, "#56252d");
  lines(ctx, nodes[0].body, 48, 174, 45, 68, PALETTE.ink, 500);
  text(ctx, "Branch from this block", 48, 431, 33, 620);
  line(ctx, 921, 420, 990, 420, PALETTE.ink, 3);
  line(ctx, 971, 403, 991, 420, PALETTE.ink, 3);
  line(ctx, 971, 437, 991, 420, PALETTE.ink, 3);
}, 1536, 712);

function markdownMap(node) {
  return texture((ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1080, 1360);
    text(ctx, "thread.md", 72, 135, 90, 590);
    text(ctx, "CONVERSATION", 74, 190, 26, 500, PALETTE.muted);
    line(ctx, 72, 232, 1006, 232);
    text(ctx, "# " + node.short, 72, 324, 45, 580);
    text(ctx, "**user:**", 72, 455, 37, 600, "#9b404a");
    lines(ctx, node.question, 72, 530, 43, 61);
    text(ctx, "**assistant:**", 72, 765, 37, 600, "#9b404a");
    lines(ctx, node.body, 72, 840, 40, 64);
    line(ctx, 72, 1160, 1006, 1160);
    text(ctx, "Plain text. On your machine.", 72, 1240, 30, 500, PALETTE.muted);
  });
}
function yamlMap(node) {
  return texture((ctx) => {
    ctx.fillStyle = "#242129";
    ctx.fillRect(0, 0, 1080, 1360);
    text(ctx, "meta.yaml", 72, 135, 90, 560, "#ffffff");
    text(ctx, "STRUCTURE", 74, 190, 26, 500, "#c1b7c8");
    line(ctx, 72, 232, 1006, 232, "#514a58");
    lines(ctx, ["id:", node.id, "", "forked_from:", ...(node.parent ? ["  thread_id:", "  " + node.parent, "  chunk_id:", "  " + node.parent + "#c2"] : ["  null"])], 72, 350, 37, 74, "#f5f0f8");
    text(ctx, "Relationships stay explicit.", 72, 1240, 30, 450, "#c1b7c8");
  });
}
function face(map, z = 0.052) {
  const material = new THREE.MeshStandardMaterial({
    map, roughness: 0.92, metalness: 0,
    transparent: true, envMapIntensity: 0.15,
  });
  const mesh = new THREE.Mesh(faceGeometry, material);
  mesh.position.z = z;
  mesh.receiveShadow = true;
  return mesh;
}

function treeMap(node) {
  const titles = {
    "demo-root": ["The", "question"],
    "demo-canopy": ["Library", "canopy"],
    "demo-streets": ["Cooler", "streets"],
    "demo-pause": ["Places", "to pause"],
    "demo-materials": ["Canopy", "materials"],
    "demo-light": ["Seasonal", "light"],
  };
  return texture((ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1080, 1360);
    const active = activeIds.has(node.id);
    text(ctx, node.parent ? (active ? "YOUR PATH" : "SIBLING") : "ROOT", 80, 164, 56, 600, active ? "#9b404a" : "#625e65");
    lines(ctx, titles[node.id], 80, 390, 128, 150, PALETTE.ink, 570);
    if (node.id !== "demo-root") {
      field(ctx, 80, 730, 920, 410, active ? "#ffe6e9" : "#f0edf2");
      lines(ctx, node.id === "demo-materials" ? ["Timber", "or fabric?"]
        : node.id === "demo-canopy" ? ["Start at the", "entrance."]
          : node.id === "demo-light" ? ["Follow", "the seasons."]
            : node.id === "demo-pause" ? ["Where people", "wait."]
              : ["A pavement", "pilot."], 130, 895, 76, 110, PALETTE.ink, 450);
    }
  });
}

for (const node of nodes) {
  const group = new THREE.Group();
  const paper = new THREE.Mesh(paperGeometry, paperMaterial);
  paper.castShadow = true;
  paper.receiveShadow = true;
  group.add(paper);
  const conversation = face(conversationMap(node));
  const treeFace = face(treeMap(node), 0.054);
  const markdown = face(markdownMap(node), 0.056);
  group.add(conversation, treeFace, markdown);
  const meta = new THREE.Group();
  const metaPaper = new THREE.Mesh(paperGeometry, metaMaterial);
  metaPaper.castShadow = true;
  const yaml = face(yamlMap(node));
  meta.add(metaPaper, yaml);
  group.add(meta);
  scene.add(group);
  Object.assign(node, { group, conversation, treeFace, markdown, meta });
}

const block = new THREE.Mesh(blockGeometry, blockMaterial);
block.castShadow = true;
block.receiveShadow = true;
const blockFace = new THREE.Mesh(
  new THREE.PlaneGeometry(4.63, 2.11),
  new THREE.MeshStandardMaterial({ map: blockMap, roughness: 0.7, envMapIntensity: 0.15, transparent: true }),
);
blockFace.position.z = 0.039;
block.add(blockFace);
nodes[0].group.add(block);

// Each edge has exactly one parent. Geometry follows the same data throughout
// the macro, tree and file reveals; no scene substitutes a converging network.
const edges = nodes.filter((node) => node.parent).map((node) => {
  const curve = new THREE.CubicBezierCurve3(...Array.from({ length: 4 }, () => new THREE.Vector3()));
  const geometry = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(1, 0, 0)), 64, 0.027, 6, false);
  const active = activeIds.has(node.id);
  const mesh = new THREE.Mesh(geometry, active ? activeMaterial : edgeMaterial);
  const start = new THREE.Mesh(markerGeometry, active ? activeMaterial : quietMaterial);
  const end = new THREE.Mesh(markerGeometry, active ? activeMaterial : quietMaterial);
  scene.add(mesh, start, end);
  return { node, parent: byId.get(node.parent), curve, geometry, mesh, start, end, active };
});

const tubePoint = new THREE.Vector3();
const tubeTangent = new THREE.Vector3();
const tubeNormal = new THREE.Vector3();
const tubeBinormal = new THREE.Vector3();
const zAxis = new THREE.Vector3(0, 0, 1);
const temp = new THREE.Vector3();
function updateEdge(edge, progress, scale, opacity, filing) {
  const { parent, node, curve, geometry, mesh } = edge;
  const from = parent.group.localToWorld(new THREE.Vector3(2.42, -0.92, 0.3));
  const to = node.group.localToWorld(new THREE.Vector3(-2.67, 0.7, 0.3));
  curve.v0.copy(from);
  curve.v3.copy(to);
  const mid = mix(from.x, to.x, 0.5);
  const clearance = Math.max(from.z, to.z) + mix(0.06, 1.5, filing);
  curve.v1.set(mid, from.y, clearance);
  curve.v2.set(mid, to.y, clearance);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const radius = mix(0.025, 0.034, scale);
  for (let i = 0; i <= 64; i++) {
    curve.getPoint(i / 64, tubePoint);
    curve.getTangent(i / 64, tubeTangent).normalize();
    tubeNormal.crossVectors(tubeTangent, zAxis).normalize();
    tubeBinormal.crossVectors(tubeTangent, tubeNormal).normalize();
    for (let j = 0; j <= 6; j++) {
      const angle = j / 6 * Math.PI * 2;
      temp.copy(tubeNormal).multiplyScalar(Math.cos(angle)).addScaledVector(tubeBinormal, Math.sin(angle));
      const index = i * 7 + j;
      normals.setXYZ(index, temp.x, temp.y, temp.z);
      temp.multiplyScalar(radius).add(tubePoint);
      positions.setXYZ(index, temp.x, temp.y, temp.z);
    }
  }
  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.setDrawRange(0, Math.floor(progress * 64) * 36);
  geometry.computeBoundingSphere();
  mesh.visible = progress > 0 && opacity > 0.01;
  edge.start.visible = mesh.visible;
  edge.end.visible = mesh.visible && progress >= 0.99;
  edge.start.position.copy(from);
  edge.end.position.copy(to);
}

const elements = Object.fromEntries([
  "opening-copy", "child-copy", "tree-copy", "tree-caption", "files-copy",
  "file-labels", "files-caption", "end-card", "end-content",
].map((id) => [id, document.getElementById(id)]));
function overlay(id, opacity, offset = 0) {
  elements[id].style.opacity = String(opacity);
  elements[id].style.transform = `translate3d(0, ${offset}px, 0)`;
}
function cameraPose(position, target) {
  camera.position.fromArray(position);
  camera.lookAt(...target);
}
function interpolate(a, b, t) { return a.map((value, i) => mix(value, b[i], t)); }

export function renderAt(time) {
  const t = Math.max(0, Math.min(23, time));
  const tracking = phase(t, 3.65, 5.7);
  const wide = phase(t, 8.0, 10.65);
  const filing = phase(t, 13.35, 15.25);
  const paperReveal = phase(t, 14.15, 15.45);
  const mapReveal = phase(t, 8.8, 10.1);
  const close = phase(t, 18.6, 19.55);
  renderer.domElement.dataset.time = String(time);

  let position = interpolate([0.7, 1.65, 14], [7.5, 3.0, 16.2], tracking);
  let target = interpolate([0, 0, 0], [6.8, 1.65, 0], tracking);
  position = interpolate(position, [1.5, 8.1, 24.8], wide);
  target = interpolate(target, [0, 1.15, 0], wide);
  position = interpolate(position, [0.5, 4.2, 20.2], filing);
  target = interpolate(target, [0.45, 0.95, 0], filing);
  cameraPose(position, target);

  for (const node of nodes) {
    let point = interpolate(node.macro, node.tree, wide);
    point = interpolate(point, node.files, filing);
    const active = activeIds.has(node.id);
    const entrance = node.id === "demo-root" ? 1 : node.id === "demo-canopy"
      ? phase(t, 4.35, 5.55) : phase(t, 8.3 + nodes.indexOf(node) * 0.12, 9.35 + nodes.indexOf(node) * 0.12);
    const scale = mix(mix(1, 0.85, tracking), 0.5, wide) * entrance * (active ? mix(1, 1.5, filing) : 1 - filing);
    node.group.position.fromArray(point);
    node.group.position.z += (1 - entrance) * -0.9;
    node.group.scale.setScalar(Math.max(0.001, scale));
    node.group.rotation.set(
      mix(-0.035, 0, wide),
      mix(-0.13, -0.025, wide) + (active ? -0.1 * filing : 0),
      mix(-0.018, 0, wide),
    );
    node.group.visible = scale > 0.005;
    node.conversation.material.opacity = (1 - mapReveal) * (1 - paperReveal);
    node.treeFace.material.opacity = mapReveal * (1 - paperReveal);
    node.markdown.material.opacity = paperReveal;
    node.meta.visible = active && paperReveal > 0;
    node.meta.position.set(paperReveal * 1.5, paperReveal * 1.55, -0.16);
    node.meta.rotation.z = paperReveal * -0.05;
    node.meta.rotation.y = paperReveal * -0.075;
  }
  block.position.set(
    0.72 * phase(t, 0, 2.7) * (1 - phase(t, 3.1, 4.0)),
    -0.94 + 0.36 * phase(t, 0, 2.7) * (1 - phase(t, 3.1, 4.0)),
    0.42 + 0.9 * phase(t, 0, 2.7) * (1 - phase(t, 3.1, 4.2)),
  );
  block.rotation.set(-0.02 * phase(t, 0, 2.7), -0.12 * phase(t, 0, 2.7), 0.008 * phase(t, 0, 2.7));
  block.visible = paperReveal < 1;
  block.material.opacity = 1 - paperReveal;
  blockFace.material.opacity = 1 - paperReveal;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  for (const node of nodes.filter((item) => item.fileOrder !== undefined)) {
    const anchor = node.group.localToWorld(new THREE.Vector3(0.7, -4.2, 0)).project(camera);
    const label = elements["file-labels"].children[node.fileOrder];
    label.style.left = `${(anchor.x * 0.5 + 0.5) * W}px`;
    label.style.top = `${(-anchor.y * 0.5 + 0.5) * H}px`;
  }

  for (const edge of edges) {
    const start = edge.node.id === "demo-canopy" ? 3.65
      : edge.node.id === "demo-materials" ? 9.35 : 8.45 + nodes.indexOf(edge.node) * 0.12;
    const progress = phase(t, start, start + 1.4);
    updateEdge(edge, progress, wide, edge.active ? 1 : 1 - filing, filing);
  }
  renderer.render(scene, camera);

  overlay("opening-copy", 1 - phase(t, 3.1, 3.7), -24 * phase(t, 3.1, 3.7));
  overlay("child-copy", range(t, 5.35, 8.05), 25 * (1 - phase(t, 5.35, 5.95)));
  overlay("tree-copy", range(t, 10.05, 13.65, 0.55), 24 * (1 - phase(t, 10.05, 10.6)));
  overlay("tree-caption", range(t, 10.4, 13.5, 0.5));
  overlay("files-copy", range(t, 14.3, 18.95, 0.6), 24 * (1 - phase(t, 14.3, 14.9)));
  overlay("file-labels", range(t, 15.4, 18.8, 0.55));
  overlay("files-caption", range(t, 15.4, 18.8, 0.55));
  overlay("end-card", close);
  overlay("end-content", phase(t, 18.85, 19.6), 24 * (1 - phase(t, 18.85, 19.6)));
}

window.addEventListener("hf-seek", (event) => renderAt(event.detail.time));
window.__lineage = { renderAt, renderer, scene, camera, nodes, edges, block, ready: true, textureWidth };
renderAt(window.__hfThreeTime || 0);
