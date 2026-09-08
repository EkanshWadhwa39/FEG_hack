#!/usr/bin/env python3
"""Serve a controlled two-origin browser HTTP-cache reuse experiment."""

from __future__ import annotations

import argparse
import json
import signal
import threading
import zipfile
from collections import Counter
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

DEFAULT_ASSET_BYTES = 1024 * 1024
ASSET_PATH = "/fixture.bin?v=local-proof-1"
MISMATCH_ASSET_PATH = "/fixture.bin?v=local-proof-mismatch"
NO_STORE_ASSET_PATH = "/fixture-no-store.bin?v=local-proof-1"


class ExperimentState:
    """Thread-safe aggregate request counters with no URL logging."""

    def __init__(self, asset: bytes, source_label: str) -> None:
        self.asset = asset
        self.source_label = source_label
        self._lock = threading.Lock()
        self._phase = "setup"
        self._requests: Counter[str] = Counter()
        self._bytes: Counter[str] = Counter()

    def set_phase(self, phase: str) -> None:
        if phase not in {"setup", "prefetch", "launch"}:
            raise ValueError("invalid phase")
        with self._lock:
            self._phase = phase

    def record_asset_response(self) -> None:
        with self._lock:
            self._requests[self._phase] += 1
            self._bytes[self._phase] += len(self.asset)

    def reset(self) -> None:
        with self._lock:
            self._phase = "setup"
            self._requests.clear()
            self._bytes.clear()

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "source": self.source_label,
                "asset_bytes": len(self.asset),
                "requests": {
                    phase: self._requests[phase]
                    for phase in ("setup", "prefetch", "launch")
                },
                "response_body_bytes": {
                    phase: self._bytes[phase]
                    for phase in ("setup", "prefetch", "launch")
                },
            }


class QuietHandler(BaseHTTPRequestHandler):
    server_version = "FEGCacheReuse/1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_text(
        self,
        body: str,
        content_type: str = "text/html; charset=utf-8",
        status: HTTPStatus = HTTPStatus.OK,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)


class LobbyHandler(QuietHandler):
    asset_origin = ""

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlsplit(self.path)
        if parsed.path != "/":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_text(parent_page(self.asset_origin))


class AssetHandler(QuietHandler):
    state: ExperimentState

    def end_cors_preflight(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.end_cors_preflight()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlsplit(self.path)
        if parsed.path == "/reset":
            self.state.reset()
            self.send_text("{}", "application/json")
            return
        if parsed.path == "/phase/prefetch":
            self.state.set_phase("prefetch")
            self.send_text(
                "{}",
                "application/json",
                extra_headers={"Access-Control-Allow-Origin": "*"},
            )
            return
        if parsed.path == "/phase/launch":
            self.state.set_phase("launch")
            self.send_text(
                "{}",
                "application/json",
                extra_headers={"Access-Control-Allow-Origin": "*"},
            )
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlsplit(self.path)
        if parsed.path == "/frame.html":
            self.send_text(frame_page())
            return
        if parsed.path == "/metrics":
            self.send_text(
                json.dumps(self.state.snapshot(), sort_keys=True),
                "application/json",
            )
            return
        if self.path in {ASSET_PATH, MISMATCH_ASSET_PATH, NO_STORE_ASSET_PATH}:
            self.state.record_asset_response()
            payload = self.state.asset
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(payload)))
            cache_control = (
                "no-store"
                if self.path == NO_STORE_ASSET_PATH
                else "public, max-age=3600, immutable"
            )
            self.send_header("Cache-Control", cache_control)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Timing-Allow-Origin", "*")
            self.send_header("ETag", '"local-proof-1"')
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_error(HTTPStatus.NOT_FOUND)


def parent_page(asset_origin: str) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Local cache reuse experiment</title></head>
<body><main><h1>Local cache reuse experiment</h1><p id="status">Running</p></main>
<script>
const assetOrigin = {json.dumps(asset_origin)};
const parameters = new URL(location.href).searchParams;
const mode = parameters.get("mode");
const experimentCase = parameters.get("case") || "exact";
const prefetchPath = experimentCase === "no-store"
  ? {json.dumps(NO_STORE_ASSET_PATH)}
  : {json.dumps(ASSET_PATH)};
const assetUrl = assetOrigin + prefetchPath;
window.__experimentResult = null;

async function mark(phase) {{
  await fetch(`${{assetOrigin}}/phase/${{phase}}`, {{method: "POST", mode: "cors", credentials: "omit", cache: "no-store"}});
}}

async function run() {{
  if (!new Set(["control", "treatment", "prefetch-only", "launch-only"]).has(mode)) throw new Error("invalid mode");
  if (!new Set(["exact", "mismatch", "no-store"]).has(experimentCase)) throw new Error("invalid case");
  if (mode === "treatment" || mode === "prefetch-only") {{
    await mark("prefetch");
    const warmed = await fetch(assetUrl, {{mode: "cors", credentials: "omit", cache: "default"}});
    if (!warmed.ok) throw new Error("prefetch failed");
    await warmed.arrayBuffer();
  }}
  if (mode === "prefetch-only") {{
    window.__experimentResult = {{mode, experimentCase, prefetchComplete: true}};
    document.querySelector("#status").textContent = "Complete";
    return;
  }}
  await mark("launch");
  window.addEventListener("message", (event) => {{
    if (event.origin !== assetOrigin || event.data?.type !== "experiment-result") return;
    window.__experimentResult = {{mode, ...event.data.result}};
    document.querySelector("#status").textContent = "Complete";
  }}, {{once: true}});
  const frame = document.createElement("iframe");
  frame.src = `${{assetOrigin}}/frame.html?case=${{encodeURIComponent(experimentCase)}}`;
  frame.title = "Synthetic game frame";
  document.body.append(frame);
}}
run().catch((error) => {{
  window.__experimentResult = {{mode, error: error.message}};
  document.querySelector("#status").textContent = "Failed";
}});
</script></body></html>"""


def frame_page() -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Synthetic game frame</title></head>
<body><p>Loading synthetic fixture</p><script>
async function launch() {{
  const experimentCase = new URL(location.href).searchParams.get("case") || "exact";
  const assetPath = experimentCase === "mismatch"
    ? {json.dumps(MISMATCH_ASSET_PATH)}
    : experimentCase === "no-store"
      ? {json.dumps(NO_STORE_ASSET_PATH)}
      : {json.dumps(ASSET_PATH)};
  const response = await fetch(assetPath, {{mode: "cors", credentials: "omit", cache: "default"}});
  if (!response.ok) throw new Error("launch request failed");
  const body = await response.arrayBuffer();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const resourceUrl = new URL(assetPath, location.href).href;
  const entry = performance.getEntriesByName(resourceUrl).at(-1);
  parent.postMessage({{
    type: "experiment-result",
    result: {{
      receivedBytes: body.byteLength,
      transferSize: entry?.transferSize ?? null,
      encodedBodySize: entry?.encodedBodySize ?? null,
      decodedBodySize: entry?.decodedBodySize ?? null,
      durationMs: entry ? Number(entry.duration.toFixed(3)) : null
    }}
  }}, "*");
}}
launch().catch((error) => parent.postMessage({{
  type: "experiment-result", result: {{error: error.message}}
}}, "*"));
</script></body></html>"""


def load_asset(zip_path: Path | None, member: str | None, size: int) -> tuple[bytes, str]:
    if zip_path is None:
        pattern = bytes(range(256))
        repeats, remainder = divmod(size, len(pattern))
        return pattern * repeats + pattern[:remainder], "SYNTHETIC"
    if not member:
        raise ValueError("--zip-member is required with --zip")
    with zipfile.ZipFile(zip_path) as archive:
        return archive.read(member), "FEG_PROVIDED_PRIVATE_BUNDLE"


def start_servers(asset: bytes, source_label: str, bind: str = "127.0.0.1") -> tuple[ThreadingHTTPServer, ThreadingHTTPServer]:
    state = ExperimentState(asset, source_label)

    class BoundAssetHandler(AssetHandler):
        pass

    BoundAssetHandler.state = state
    asset_server = ThreadingHTTPServer((bind, 0), BoundAssetHandler)
    asset_origin = f"http://{bind}:{asset_server.server_port}"

    class BoundLobbyHandler(LobbyHandler):
        pass

    BoundLobbyHandler.asset_origin = asset_origin
    lobby_server = ThreadingHTTPServer((bind, 0), BoundLobbyHandler)
    return lobby_server, asset_server


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--asset-bytes", type=int, default=DEFAULT_ASSET_BYTES)
    parser.add_argument("--zip", type=Path, help="Private provider ZIP; never committed")
    parser.add_argument("--zip-member", help="Exact member to serve without extraction")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.asset_bytes <= 0:
        raise SystemExit("--asset-bytes must be positive")
    asset, source = load_asset(args.zip, args.zip_member, args.asset_bytes)
    lobby, asset_server = start_servers(asset, source, args.bind)
    browser_asset_origin = f"http://asset.test:{asset_server.server_port}"
    lobby.RequestHandlerClass.asset_origin = browser_asset_origin
    threads = [
        threading.Thread(target=server.serve_forever, daemon=True)
        for server in (lobby, asset_server)
    ]
    for thread in threads:
        thread.start()

    print(
        json.dumps(
            {
                "event": "ready",
                "lobby_origin": f"http://{args.bind}:{lobby.server_port}",
                "asset_origin": f"http://{args.bind}:{asset_server.server_port}",
                "browser_lobby_origin": f"http://lobby-a.test:{lobby.server_port}",
                "partition_lobby_origin": f"http://lobby-b.test:{lobby.server_port}",
                "browser_asset_origin": browser_asset_origin,
                "source": source,
                "asset_bytes": len(asset),
            },
            sort_keys=True,
        ),
        flush=True,
    )

    stopped = threading.Event()

    def stop(_signum: int, _frame: object) -> None:
        stopped.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    stopped.wait()
    lobby.shutdown()
    asset_server.shutdown()
    for server in (lobby, asset_server):
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
