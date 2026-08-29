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

if ("IntersectionObserver" in window) {
  const stepObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (visible[0]) {
        setActiveStep(Number(visible[0].target.dataset.step));
      }
    },
    { rootMargin: "-35% 0px -35% 0px", threshold: [0, 0.25, 0.5, 0.75] },
  );

  steps.forEach((step) => stepObserver.observe(step));
}

let frameRequested = false;

function drawStory() {
  frameRequested = false;
  if (!animatedLayout.matches || !story || !stage || !traveler) return;

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
