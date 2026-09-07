import { assessPrefetch } from "./governor.js";
import { resolveManifest } from "./manifest.js";

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

const enabledControl = document.querySelector("#prefetch-enabled");
const budgetControl = document.querySelector("#byte-budget");
const decisionElement = document.querySelector("#governor-decision");
const reasonElement = document.querySelector("#governor-reason");
const branchElement = document.querySelector("#resolved-branch");
const bytesElement = document.querySelector("#planned-bytes");
const assetList = document.querySelector("#asset-list");
const decisionCard = decisionElement.closest(".metric");

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
  const plan = resolveManifest(DEMO_MANIFEST, DEMO_SELECTION);
  const plannedBytes = plan.assets.reduce((total, asset) => total + asset.estimatedBytes, 0);
  const decision = assessPrefetch({
    enabled: enabledControl.checked,
    byteBudget: Number(budgetControl.value),
    nextAssetBytes: plannedBytes,
    ...SIMULATED_ENVIRONMENT,
  });

  decisionElement.textContent = `${decision.allowed ? "ELIGIBLE" : "BLOCKED"} · SIMULATED`;
  reasonElement.textContent = `${decision.reason.replaceAll("_", " ")} · SIMULATED`;
  decisionCard.dataset.state = decision.allowed ? "allowed" : "blocked";
  branchElement.textContent = `${plan.locale} / ${plan.tier} · SIMULATED`;
  bytesElement.textContent = formatBytes(plannedBytes);
  assetList.replaceChildren(...plan.assets.map(renderAsset));
}

enabledControl.addEventListener("change", render);
budgetControl.addEventListener("change", render);
render();
