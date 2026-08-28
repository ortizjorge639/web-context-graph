const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealItems = document.querySelectorAll(".reveal");
if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px" },
  );
  revealItems.forEach((item) => revealObserver.observe(item));
}

const modeTabs = document.querySelectorAll("[data-mode]");
const map = document.querySelector("#interactive-map");
const label = document.querySelector("#mode-label");
const panel = document.querySelector("#mode-visual");
const mapPaths = [...map.querySelectorAll("path")];
const pathLayouts = {
  lineage: mapPaths.map((path) => path.getAttribute("d")),
  tree: [
    "M350 90C350 130 140 130 140 178",
    "M350 90C350 130 350 130 350 178",
    "M350 90C350 130 560 130 560 178",
    "M140 242C140 310 77 310 77 380",
    "M140 242C140 310 210 310 210 380",
    "M350 242C350 310 350 310 350 380",
    "M560 242C560 310 560 310 560 380",
  ],
};

function selectMode(tab, moveFocus = false) {
  const mode = tab.dataset.mode;
  modeTabs.forEach((candidate) => {
    const isSelected = candidate === tab;
    candidate.setAttribute("aria-selected", String(isSelected));
    candidate.tabIndex = isSelected ? 0 : -1;
  });
  map.classList.toggle("tree-mode", mode === "tree");
  map.classList.toggle("lineage-mode", mode === "lineage");
  mapPaths.forEach((path, index) => path.setAttribute("d", pathLayouts[mode][index]));
  label.textContent = mode === "tree" ? "Knowledge tree" : "Lineage";
  panel.setAttribute("aria-labelledby", tab.id);
  if (moveFocus) tab.focus();
}

modeTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectMode(tab));
  tab.addEventListener("keydown", (event) => {
    const previousKeys = ["ArrowLeft", "ArrowUp"];
    const nextKeys = ["ArrowRight", "ArrowDown"];
    let targetIndex = index;
    if (previousKeys.includes(event.key)) targetIndex = (index - 1 + modeTabs.length) % modeTabs.length;
    if (nextKeys.includes(event.key)) targetIndex = (index + 1) % modeTabs.length;
    if (event.key === "Home") targetIndex = 0;
    if (event.key === "End") targetIndex = modeTabs.length - 1;
    if (targetIndex === index && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectMode(modeTabs[targetIndex], true);
  });
});
