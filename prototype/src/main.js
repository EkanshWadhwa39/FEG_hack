import { startIstClock } from "./clock.js";
import { assessPrefetch } from "./governor.js";
import { resolveManifest } from "./manifest.js";
import { createSimulatedRequester } from "./simulation.js";
import { warmAssets } from "./warmer.js";
import {
  OverlayLabel,
  OverlayTracker,
  buildOverlayHtml,
  createInstrumentedRequester,
} from "./overlay.js";
import { createBaselineContext } from "./baseline.js";

// Illustrative local metadata only. No URL in this scaffold is requested.
const DEMO_MANIFEST = Object.freeze({
  locales: {
    "hr-HR": {
      tiers: {
        "0.5x": {
          assets: [
            { url: "/demo-assets/hr-HR/0.5x/preloader.js?v=demo", stage: "PRELOADER", estimatedBytes: 110_000 },
          ],
        },
        "1x": {
          assets: [
            { url: "/demo-assets/hr-HR/1x/preloader.js?v=demo", stage: "PRELOADER", estimatedBytes: 180_000 },
            { url: "/demo-assets/hr-HR/1x/common.js?v=demo", stage: "COMMON", estimatedBytes: 320_000 },
            { url: "/demo-assets/hr-HR/1x/splash.webp?v=demo", stage: "SPLASH", estimatedBytes: 420_000 },
            { url: "/demo-assets/hr-HR/1x/critical-primary.bin?v=demo", stage: "PRIMARY", critical: true, estimatedBytes: 1_200_000 },
            { url: "/demo-assets/hr-HR/1x/noncritical-primary.bin?v=demo", stage: "PRIMARY", critical: false, estimatedBytes: 900_000 },
            { url: "/demo-assets/hr-HR/1x/secondary.bin?v=demo", stage: "SECONDARY", estimatedBytes: 2_400_000 },
          ],
        },
      },
    },
  },
});

const DEMO_SELECTION = Object.freeze({ locale: "hr-HR", tier: "1x" });
const SIMULATED_ENVIRONMENT = Object.freeze({
  saveData: false,
  effectiveType: "4g",
  visibilityState: "visible",
  bytesUsed: 0,
});

// ── DOM refs ─────────────────────────────────────────────────────────────────
const clockElement = document.querySelector("#ist-clock");
const enabledControl = document.querySelector("#prefetch-enabled");
const budgetControl = document.querySelector("#byte-budget");
const decisionElement = document.querySelector("#governor-decision");
const reasonElement = document.querySelector("#governor-reason");
const branchElement = document.querySelector("#resolved-branch");
const bytesElement = document.querySelector("#planned-bytes");
const assetList = document.querySelector("#asset-list");
const runButton = document.querySelector("#run-warming");
const warmingStatus = document.querySelector("#warming-status");
const warmingSummary = document.querySelector("#warming-summary");
const warmingCard = document.querySelector("#warming-card");
const decisionCard = decisionElement.closest(".metric");
const overlayToggle = document.querySelector("#overlay-toggle");
const liveOverlay = document.querySelector("#live-overlay");
const overlayBody = document.querySelector("#overlay-body");
const comparisonGrid = document.querySelector("#comparison-grid");

// ── Overlay setup ─────────────────────────────────────────────────────────────
const tracker = new OverlayTracker();
let overlayInterval = null;

function updateOverlay() {
  const snap = tracker.snapshot();
  overlayBody.innerHTML = buildOverlayHtml(snap);
}

function startOverlayUpdates() {
  updateOverlay();
  overlayInterval = setInterval(updateOverlay, 200);
}

function stopOverlayUpdates() {
  if (overlayInterval !== null) {
    clearInterval(overlayInterval);
    overlayInterval = null;
  }
  updateOverlay();
}

overlayToggle.addEventListener("click", () => {
  const pressed = overlayToggle.getAttribute("aria-pressed") === "true";
  overlayToggle.setAttribute("aria-pressed", String(!pressed));
  liveOverlay.hidden = pressed;
});

// ── Baseline arm comparison ───────────────────────────────────────────────────
const fmtMs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const fmtMB = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function renderComparison() {
  const baseline = createBaselineContext(DEMO_MANIFEST, DEMO_SELECTION);

  function armCard(title, cssClass, stats) {
    const card = document.createElement("div");
    card.className = `arm-card ${cssClass}`;
    const heading = document.createElement("h3");
    heading.textContent = title;
    card.append(heading);
    for (const { label, value, labelTag } of stats) {
      const row = document.createElement("div");
      row.className = "arm-stat";
      const l = document.createElement("span");
      l.className = "arm-stat-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "arm-stat-value";
      v.textContent = value;
      if (labelTag) {
        const badge = document.createElement("span");
        badge.className = `label ${labelTag.toLowerCase()}`;
        badge.textContent = labelTag;
        v.append(" ", badge);
      }
      row.append(l, v);
      card.append(row);
    }
    return card;
  }

  const { cold, warm } = baseline;
  const controlCard = armCard("Control — no warming", "control-arm", [
    { label: "Elapsed (HAR span)", value: fmtMs(cold.elapsedMs), labelTag: cold.elapsedMsLabel },
    { label: "Wire bytes", value: fmtMB(cold.wireBytes), labelTag: cold.wireBytesLabel },
    { label: "Requests", value: String(cold.requestCount), labelTag: cold.requestCountLabel },
    { label: "Cache hits", value: `${cold.cacheHits} (pre-existing)`, labelTag: cold.cacheHitsLabel },
  ]);

  const treatmentCard = armCard("Treatment — cache warmed", "treatment-arm", [
    { label: "Elapsed (HAR span)", value: fmtMs(warm.elapsedMs), labelTag: warm.elapsedMsLabel },
    { label: "Wire bytes", value: fmtMB(warm.wireBytes), labelTag: warm.wireBytesLabel },
    { label: "Requests", value: String(warm.requestCount), labelTag: warm.requestCountLabel },
    { label: "Cache hits", value: String(warm.cacheHits), labelTag: warm.cacheHitsLabel },
  ]);

  comparisonGrid.replaceChildren(controlCard, treatmentCard);
}

// ── Existing simulation (unchanged logic, overlay wired in) ───────────────────
let currentPlan;
let currentDecision;
let running = false;
let hasResult = false;

const formatBytes = (bytes) => `${(bytes / 1_048_576).toFixed(2)} MiB · SIMULATED`;

function renderAsset(asset) {
  const item = document.createElement("li");
  const stage = document.createElement("span");
  const path = document.createElement("span");
  const size = document.createElement("span");

  stage.className = "asset-stage";
  path.className = "asset-path";
  size.className = "asset-size";
  stage.textContent = asset.stage;
  path.textContent = asset.url;
  size.textContent = formatBytes(asset.estimatedBytes);
  item.append(stage, path, size);
  return item;
}

function render() {
  currentPlan = resolveManifest(DEMO_MANIFEST, DEMO_SELECTION);
  const plannedBytes = currentPlan.assets.reduce((total, asset) => total + asset.estimatedBytes, 0);
  currentDecision = assessPrefetch({
    enabled: enabledControl.checked,
    byteBudget: Number(budgetControl.value),
    nextAssetBytes: plannedBytes,
    ...SIMULATED_ENVIRONMENT,
  });

  decisionElement.textContent = `${currentDecision.allowed ? "ELIGIBLE" : "BLOCKED"} · SIMULATED`;
  reasonElement.textContent = `${currentDecision.reason.replaceAll("_", " ")} · SIMULATED`;
  decisionCard.dataset.state = currentDecision.allowed ? "allowed" : "blocked";
  branchElement.textContent = `${currentPlan.locale} / ${currentPlan.tier} · SIMULATED`;
  bytesElement.textContent = formatBytes(plannedBytes);
  assetList.replaceChildren(...currentPlan.assets.map(renderAsset));
  runButton.disabled = running || !currentDecision.allowed;

  if (!running && !hasResult) {
    warmingCard.dataset.state = currentDecision.allowed ? "" : "blocked";
    warmingStatus.textContent = currentDecision.allowed
      ? "NOT RUN · SIMULATED"
      : "NOT RUN — GOVERNOR BLOCKED · SIMULATED";
    warmingSummary.textContent = "No network request sent · SIMULATED";
  }
}

async function runSimulation() {
  render();
  if (running || !currentDecision.allowed) return;

  running = true;
  runButton.disabled = true;
  runButton.setAttribute("aria-busy", "true");
  enabledControl.disabled = true;
  budgetControl.disabled = true;
  warmingCard.dataset.state = "allowed";
  warmingStatus.textContent = "RUNNING · SIMULATED";
  warmingSummary.textContent = "Local tasks in progress; no network request sent · SIMULATED";

  // Wire overlay tracker into this run
  tracker.reset();
  tracker.start(OverlayLabel.SIMULATED);
  startOverlayUpdates();

  try {
    const summary = await warmAssets({
      plan: currentPlan,
      target: DEMO_SELECTION,
      concurrency: 2,
      requestAsset: createInstrumentedRequester(
        createSimulatedRequester(),
        tracker,
        OverlayLabel.SIMULATED,
      ),
    });
    hasResult = true;
    warmingStatus.textContent = "COMPLETE · SIMULATED";
    warmingSummary.textContent = `${summary.attempted} attempted; ${summary.requested} simulated successes; ${summary.failed} failed; ${summary.cancelled} cancelled · SIMULATED`;
  } catch {
    hasResult = true;
    warmingCard.dataset.state = "blocked";
    warmingStatus.textContent = "FAILED · SIMULATED";
    warmingSummary.textContent = "No network request sent; simulation stopped safely · SIMULATED";
  } finally {
    stopOverlayUpdates();
    running = false;
    runButton.removeAttribute("aria-busy");
    enabledControl.disabled = false;
    budgetControl.disabled = false;
    render();
  }
}

function resetSimulation() {
  hasResult = false;
  render();
}

startIstClock(clockElement);
renderComparison();

enabledControl.addEventListener("change", resetSimulation);
budgetControl.addEventListener("change", resetSimulation);
runButton.addEventListener("click", runSimulation);
render();
