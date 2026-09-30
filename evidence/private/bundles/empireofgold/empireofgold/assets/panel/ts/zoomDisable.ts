(function() {
// ==========================
// CONFIG
// ==========================
const INTERACTIVE_SELECTOR = `
  button, a, input, textarea, select,
  [onclick], [role="button"],
  .footer-item, .tab-button, [data-section],
  #close_btn, #h-close_btn, .close-btn
`;

function isInteractive(el: HTMLElement): boolean {
    return !!el.closest(INTERACTIVE_SELECTOR);
}

// ==========================
// 1. BLOCK GESTURE EVENTS (iOS Safari)
// ==========================
['gesturestart', 'gesturechange', 'gestureend'].forEach((evt) => {
    document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
});

// ==========================
// 2. BLOCK CTRL + WHEEL
// ==========================
document.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
}, { passive: false });

// ==========================
// 3. GLOBAL TOUCH CONTROL
// ==========================
let lastTap = 0;

document.addEventListener('touchstart', (e: TouchEvent) => {
    const now = Date.now();
    const target = e.target as HTMLElement;

    // MULTI TOUCH BLOCK
    if (e.touches.length > 1) {
        e.preventDefault();
        return;
    }

    if (!isInteractive(target)) {
        if (now - lastTap < 350) {
            e.preventDefault();
        }
    }

    lastTap = now;
}, { passive: false });

// ==========================
// 4. TOUCH MOVE (PINCH BLOCK)
// ==========================
document.addEventListener('touchmove', (e: TouchEvent) => {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

// ==========================
// 5. TOUCH END (SYNC FIX)
// ==========================
document.addEventListener('touchend', (e: TouchEvent) => {
    const now = Date.now();
    const target = e.target as HTMLElement;

    if (!isInteractive(target)) {
        if (now - lastTap < 350) {
            e.preventDefault();
        }
    }
}, { passive: false });

// ==========================
// 6. CLICK FALLBACK (SAFE)
// ==========================
let lastClick = 0;

document.addEventListener('click', (e: MouseEvent) => {
    const now = Date.now();
    const target = e.target as HTMLElement;

    if (!isInteractive(target)) {
        if (now - lastClick < 350) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    lastClick = now;
}, true);

// ==========================
// 7. VIEWPORT LOCK
// ==========================
function lockViewport(): void {
    let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement;

    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        document.head.appendChild(meta);
    }

    // viewport-fit=cover is REQUIRED for env(safe-area-inset-*) to work
    const content =
        'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover';

    meta.setAttribute('content', content);

    // Orientation fix — re-apply after rotation so viewport width updates correctly
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            meta.setAttribute('content', content);
        }, 50);
    });

    // iOS resume fix
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            meta.setAttribute('content', content);
        }
    });
}

lockViewport();
document.addEventListener('DOMContentLoaded', lockViewport);

// ==========================
// 8. FORCE ZOOM RESET (CRITICAL)
// ==========================
function forceResetZoom(): void {
    // Reset browser zoom (best effort)
    document.body.style.zoom = "1";
    document.documentElement.style.zoom = "1";

    // Reset transforms
    document.body.style.transform = "scale(1)";
    document.documentElement.style.transform = "scale(1)";

    // Clear stored zoom (if any)
    try {
        localStorage.removeItem("zoom");
        sessionStorage.removeItem("zoom");
    } catch (e) { }

    // Force scroll reset (sometimes tied to zoom feel)
    window.scrollTo(0, 0);
}

// Run immediately
forceResetZoom();

// Run on document ready and full load
document.addEventListener('DOMContentLoaded', forceResetZoom);
window.addEventListener('load', forceResetZoom);

// ==========================
// 9. iOS VISUAL VIEWPORT RESET (CRITICAL)
// ==========================
(function fixIOSZoom() {
    function isInputFocused(): boolean {
        const active = document.activeElement;
        return !!(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
    }

    const reset = () => {
        // Don't reset while a text input is focused (e.g. spending limit keypad on iOS)
        if (isInputFocused()) return;

        // Scroll reset helps snap viewport back
        window.scrollTo(0, 0);
    };

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', reset);
        window.visualViewport.addEventListener('scroll', reset);
    }

    window.addEventListener('pageshow', reset); // back/forward cache
    window.addEventListener('focus', reset);

    // ==========================
    // iOS INPUT LIFT FIX
    // Prevent iOS Safari from scrolling the page up when a native input is focused.
    // iOS tries to scroll the focused input into view above the keyboard,
    // causing the whole app to "lift". We counter this by:
    //   1. Moving the input to a fixed off-screen position before focus
    //   2. Immediately resetting window scroll after focus
    // ==========================
    document.addEventListener('focusin', (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;

        // Move input off-screen so iOS has no visible element to scroll to
        const el = target as HTMLInputElement;
        el.style.position = 'fixed';
        el.style.top = '0px';
        el.style.left = '0px';
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';

        // Snap scroll back immediately and after iOS finishes its scroll animation
        window.scrollTo(0, 0);
        setTimeout(() => window.scrollTo(0, 0), 50);
        setTimeout(() => window.scrollTo(0, 0), 150);
    });

    document.addEventListener('focusout', (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;

        // Restore scroll after keyboard dismisses
        setTimeout(() => window.scrollTo(0, 0), 100);
    });
})();

})();