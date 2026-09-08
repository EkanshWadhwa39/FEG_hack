import { bindCatalogueIntent } from "./catalogue-bindings.js";
import { getPlayerCatalogue } from "./catalogue.js";

/** UI-independent wiring for existing [data-game-id] tiles. The UI owns rendering,
 * focus, ordering, thumbnails and launch screen. Only this static projection may
 * be passed to a player renderer. No selector/candidate telemetry enters that path.
 *
 * readVariant() must supply explicit {build,locale,tier}, never inferred defaults.
 * onLaunch(grant) performs NORMAL foreground loading after LAUNCH_AUTHORIZED.
 * Observe grant.signal for revocation/replacement; never render after it aborts.
 * onOperatorEvent receives sanitized status, not raw exceptions or URLs.
 */
export function bindContentLoading({ root, catalogue, loader, readVariant, onLaunch,
  onOperatorEvent = () => {}, dwellMs = 150 } = {}) {
  if (typeof readVariant !== "function" || typeof onLaunch !== "function") throw new TypeError("launch integration callbacks required");
  if (!Number.isFinite(dwellMs) || dwellMs < 150) throw new RangeError("dwell must be at least 150ms");
  const playerThumbnails = Object.freeze(Object.fromEntries(catalogue.map(entry => [entry.id,
    Object.freeze({ label: entry.label, url: entry.thumbnailUrl })])));
  let generation = 0;
  let disposed = false;
  const emit = status => { try { onOperatorEvent({ label: "SIMULATED", status }); } catch { /* Telemetry cannot block launch. */ } };
  const binding = bindCatalogueIntent({ root, gameIds: catalogue.map(entry => entry.id), dwellMs,
    onIntent: async intent => {
      try {
        const token = intent.kind === "CLICK" ? ++generation : generation;
        if (intent.kind === "CLICK") { loader.cancel(); loader.cancelLaunch(); }
        const variant = readVariant();
        if (intent.kind === "CLICK") {
          const grant = await loader.beginLaunch({ gameId: intent.gameId, ...variant });
          if (disposed || token !== generation) return;
          emit(grant.status);
          if (grant.status === "LAUNCH_AUTHORIZED" && !grant.signal.aborted) await onLaunch(grant);
        } else {
          const outcome = await loader.prepare({ intent, ...variant });
          if (!disposed) emit(outcome.status);
        }
      } catch { if (!disposed) emit("CONTENT_LOADING_FAILED"); }
    },
  });
  return Object.freeze({ playerCatalogue: getPlayerCatalogue(catalogue), playerThumbnails,
    dispose() { disposed = true; generation++; binding.dispose(); loader.dispose(); },
    cancelPending() { generation++; binding.cancelPending(); loader.cancel(); loader.cancelLaunch(); },
  });
}
