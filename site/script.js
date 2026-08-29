document.documentElement.classList.add("js");

const story = document.querySelector(".story");
const stage = document.querySelector(".story-stage");
const steps = [...document.querySelectorAll(".story-step")];
const screens = [...document.querySelectorAll(".screen")];
const traveler = document.querySelector(".traveler");
const animatedLayout = window.matchMedia(
  "(min-width: 821px) and (prefers-reduced-motion: no-preference)",
);

const waypoints = [
  [80, 300],
  [220, 300],
  [410, 130],
  [590, 470],
  [820, 360],
];

function setActiveStep(index) {
  if (!stage) return;
  if (stage.dataset.active === String(index)) return;

  stage.dataset.active = String(index);
  steps.forEach((step, stepIndex) => {
    step.classList.toggle("is-current", stepIndex === index);
  });
  screens.forEach((screen, screenIndex) => {
    const active = screenIndex === index;
    screen.classList.toggle("is-active", active);
    screen.setAttribute("aria-hidden", String(!active));
  });
}

let frameRequested = false;

function updateActiveStep() {
  const activationLine = window.innerHeight / 2;
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  steps.forEach((step, index) => {
    const bounds = step.getBoundingClientRect();
    const distance = Math.abs(bounds.top + bounds.height / 2 - activationLine);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  setActiveStep(closestIndex);
}

function drawStory() {
  frameRequested = false;
  if (!animatedLayout.matches || !story || !stage || !traveler) return;

  updateActiveStep();

  const bounds = story.getBoundingClientRect();
  const travel = Math.max(story.offsetHeight - window.innerHeight, 1);
  const progress = Math.min(Math.max(-bounds.top / travel, 0), 1);
  stage.style.setProperty("--story-progress", progress.toFixed(4));

  const scaled = progress * (waypoints.length - 1);
  const segment = Math.min(Math.floor(scaled), waypoints.length - 2);
  const segmentProgress = scaled - segment;
  const [startX, startY] = waypoints[segment];
  const [endX, endY] = waypoints[segment + 1];
  const x = startX + (endX - startX) * segmentProgress;
  const y = startY + (endY - startY) * segmentProgress;
  traveler.style.transform = `translate(${x}px, ${y}px)`;
}

function requestDraw() {
  if (frameRequested) return;
  frameRequested = true;
  window.requestAnimationFrame(drawStory);
}

window.addEventListener("scroll", requestDraw, { passive: true });
window.addEventListener("resize", requestDraw);
animatedLayout.addEventListener("change", requestDraw);
requestDraw();
