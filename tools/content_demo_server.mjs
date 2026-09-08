#!/usr/bin/env node
/**
 * Portable, dependency-free ORIGINAL SIMULATED localhost demo host (Node >=18).
 * CLI: node tools/content_demo_server.mjs [--port 8095|0]
 * API: await createContentDemoServer({port: 0, host: '127.0.0.1', staticRoot?});
 * returns a listening http.Server with origin and entryUrl; close via server.close().
 * staticRoot is a trusted, source-only test override, NOT an arbitrary asset mount.
 *
 * Only explicit source names below are readable. Missing UI files return 404;
 * / never falls back to Hansika's index. No provider code/data is opened.
 * lstat checks every ancestor and file, with descriptor identity checks before
 * and after bounded reads. Symlinks/junctions are rejected (also root ancestors).
 * Unlike Python's Linux-only dir_fd host this is NOT a pinned-directory sandbox
 * against a hostile local process concurrently replacing filesystem ancestors.
 * Use a trusted checkout, not a directory writable by an untrusted local user.
 *
 * Fixture bodies match content_server.py, but this is a NEW host: same-origin
 * only, narrower routes, stricter queries, portable source handling. Earlier
 * browser evidence is not silently transferred to it. No artificial delay.
 */
import http from "node:http";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TITLE_IDS, ASSET_SIZES, IMMUTABLE, resolveSyntheticFixture } from "./content_demo_fixtures.mjs";

const DEFAULT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prototype");
export const STATIC_PATHS = Object.freeze([
  "/content-demo.html", "/content-game.html",
  "/styles/content-demo.css", "/styles/content-game.css",
  "/src/content-demo.js", "/src/content-demo-policy.js", "/src/content-demo-scheduler.js",
  "/src/content-game.js", "/src/content-game-model.js",
  ...["catalogue", "candidate-policy", "content-adapters", "browser-requester", "content-loader",
    "governor", "manifest", "warmer", "drawer", "catalogue-bindings", "content-integration"]
    .map(name => `/src/${name}.js`),
]);
const STATIC = new Set(STATIC_PATHS);
export const LIMITS = Object.freeze({ targetBytes: 1024, headerBytes: 8192,
  sourceBytes: 1024 * 1024, connections: 64, headersTimeout: 5000,
  requestTimeout: 10000, socketTimeout: 5000, requestsPerSocket: 100 });
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; "
  + "connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; font-src 'self'; "
  + "base-uri 'none'; object-src 'none'; form-action 'none'";
const SECURITY = Object.freeze({ "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN", "X-Content-Classification": "SIMULATED" });
const KINDS = ["thumbnail", ...Object.keys(ASSET_SIZES), "static", "health", "metrics",
  "rejected", "test_no_store", "test_redirect"];
const counter = () => ({ requests: 0, body_bytes: 0, errors: 0 });

function createMetrics() {
  const data = {
    classification: "MEASURED", content_classification: "SIMULATED",
    scope: "local synthetic Node server only",
    body_bytes_semantics: "HTTP body bytes in successful complete response writes; excludes headers; "
      + "partial failed writes unknown; not wire bytes or proof of client receipt/cache reuse",
    counters_saturated: false, ...counter(), errors_by_status: {},
    by_title: Object.fromEntries(TITLE_IDS.map(id => [id, Object.fromEntries(
      ["thumbnail", ...Object.keys(ASSET_SIZES)].map(kind => [kind, counter()]))])),
    by_type: Object.fromEntries(KINDS.map(kind => [kind, counter()])),
  };
  function add(bucket, key, amount) {
    if (bucket[key] > Number.MAX_SAFE_INTEGER - amount) {
      bucket[key] = Number.MAX_SAFE_INTEGER;
      data.counters_saturated = true;
    } else bucket[key] += amount;
  }
  function buckets(kind, title) {
    return [data, data.by_type[kind], ...(title ? [data.by_title[title][kind]] : [])];
  }
  return {
    snapshot: () => structuredClone(data),
    response(status, kind, title) {
      for (const bucket of buckets(kind, title)) {
        add(bucket, "requests", 1);
        if (status >= 400) add(bucket, "errors", 1);
      }
      if (status >= 400) {
        data.errors_by_status[status] ??= 0;
        add(data.errors_by_status, status, 1);
      }
    },
    complete(bytes, kind, title) {
      for (const bucket of buckets(kind, title)) add(bucket, "body_bytes", bytes);
    },
  };
}

async function inspectChain(absolute, file = false) {
  const anchor = path.parse(absolute).root;
  const paths = [anchor];
  for (const part of absolute.slice(anchor.length).split(path.sep).filter(Boolean)) {
    paths.push(path.join(paths.at(-1), part));
  }
  const chain = [];
  for (let i = 0; i < paths.length; i++) {
    const stat = await lstat(paths[i], { bigint: true });
    if (stat.isSymbolicLink() || !(file && i === paths.length - 1 ? stat.isFile() : stat.isDirectory())) {
      throw new Error("unsafe source path");
    }
    chain.push(stat);
  }
  return chain;
}
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const unchanged = (a, b) => sameIdentity(a, b) && a.size === b.size
  && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

async function readSource(root, rootChain, route) {
  const filename = path.join(root, ...route.slice(1).split("/"));
  const before = await inspectChain(filename, true);
  if (!rootChain.every((stat, i) => sameIdentity(stat, before[i]))) throw new Error("source root changed");
  const expected = before.at(-1);
  if (expected.size > BigInt(LIMITS.sourceBytes)) throw new Error("source too large");
  // O_NOFOLLOW is supplemental on platforms supporting it; lstat is mandatory.
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
    | (constants.O_NONBLOCK || 0));
  try {
    const pinned = await handle.stat({ bigint: true });
    if (!pinned.isFile() || !unchanged(expected, pinned)) throw new Error("source changed");
    const opened = await inspectChain(filename, true);
    if (!before.every((stat, i) => sameIdentity(stat, opened[i]))) throw new Error("source changed");
    // Fixed allocation, not readFile(): even a growing file cannot exceed the cap.
    const body = Buffer.alloc(Number(pinned.size));
    let offset = 0;
    while (offset < body.length) {
      const { bytesRead } = await handle.read(body, offset, body.length - offset, offset);
      if (!bytesRead) throw new Error("source changed");
      offset += bytesRead;
    }
    const after = await inspectChain(filename, true);
    if (!before.every((stat, i) => sameIdentity(stat, after[i]))
        || !unchanged(pinned, await handle.stat({ bigint: true }))) throw new Error("source changed");
    return body;
  } finally { await handle.close(); }
}

function invalidTarget(target) {
  return !target.startsWith("/") || target.includes("//") || /[%\\#\x00-\x20\x7f-\uffff]/.test(target)
    || target.split("?")[0].split("/").some(part => part.startsWith("."));
}
const errorBody = status => Buffer.from(JSON.stringify({
  classification: "SIMULATED", error: "request rejected", status,
}));

export async function createContentDemoServer({ port = 0, host = "127.0.0.1", staticRoot = DEFAULT_ROOT } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("port must be between 0 and 65535");
  if (!["127.0.0.1", "::1"].includes(host)) throw new TypeError("host must be a literal loopback address");
  if (typeof staticRoot !== "string" || !staticRoot) throw new TypeError("staticRoot must be a source directory");
  const root = path.resolve(staticRoot);
  let rootChain;
  try { rootChain = await inspectChain(root); }
  catch { throw new Error("staticRoot and its ancestors must be non-symlink source directories"); }
  const metrics = createMetrics();
  const server = http.createServer({ maxHeaderSize: LIMITS.headerBytes,
    headersTimeout: LIMITS.headersTimeout, requestTimeout: LIMITS.requestTimeout,
    connectionsCheckingInterval: 1000 });
  server.maxConnections = LIMITS.connections;
  server.maxRequestsPerSocket = LIMITS.requestsPerSocket;
  server.keepAliveTimeout = 1000;
  server.setTimeout(LIMITS.socketTimeout, socket => socket.destroy());
  let authorities;
  let activeRequests = 0;

  async function dispatch(req, res) {
    function respond(status, body = Buffer.alloc(0), { kind = "rejected", title = null,
      contentType = "application/json; charset=utf-8", cache = "no-store", location } = {}) {
      if (res.destroyed) return;
      const headers = { ...SECURITY, "Content-Type": contentType,
        "Content-Length": body.length, "Cache-Control": cache };
      if (location) headers.Location = location;
      if (status >= 400) headers.Connection = "close";
      if (status === 405) headers.Allow = "GET, HEAD";
      // Request counts are visible even to a HEAD client immediately at headers.
      metrics.response(status, kind, title);
      if (req.method !== "HEAD") res.once("finish", () => metrics.complete(body.length, kind, title));
      res.writeHead(status, headers);
      res.end(req.method === "HEAD" ? undefined : body);
    }
    const reject = status => respond(status, errorBody(status));
    if (++activeRequests > LIMITS.connections) {
      activeRequests--;
      reject(503);
      return;
    }
    // Count active response lifetimes, not just route-dispatch promises.
    res.once("close", () => { activeRequests--; });
    try {
      const target = req.url || "";
      if (Buffer.byteLength(target) > LIMITS.targetBytes) return reject(414);
      if (invalidTarget(target)) return reject(400);
      const names = req.rawHeaders.filter((_value, index) => index % 2 === 0).map(name => name.toLowerCase());
      if (names.some(name => !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name))
          || names.filter(name => name === "host").length !== 1
          || names.filter(name => name === "origin").length > 1) return reject(400);
      if (!authorities.has(req.headers.host)) return reject(403); // DNS rebinding defense.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return reject(403);
      if (req.headers["sec-fetch-site"] === "cross-site") return reject(403);
      if (req.headers["transfer-encoding"] || (req.headers["content-length"] !== undefined
          && req.headers["content-length"] !== "0")) return reject(413);
      if (!["GET", "HEAD"].includes(req.method)) return reject(405);
      if (req.headers.expect) return reject(400);
      if (target.startsWith("/synthetic/")) {
        const fixture = resolveSyntheticFixture(target);
        if (!fixture) return reject(404);
        return respond(200, fixture.body, { ...fixture, cache: IMMUTABLE });
      }
      if (target === "/health") return respond(200, Buffer.from(JSON.stringify({
        classification: "SIMULATED", ready: true, scope: "synthetic fixture host; UI readiness not asserted",
        title_count: TITLE_IDS.length, thumbnail_ready_count: TITLE_IDS.length,
        missing_thumbnail_count: 0, binary_fixture_count: 240,
      })), { kind: "health" });
      if (target === "/__metrics") return respond(200, Buffer.from(JSON.stringify(metrics.snapshot())), { kind: "metrics" });
      if (target === "/__test/no-store") return respond(200, Buffer.from("SIMULATED no-store fixture\n"), {
        kind: "test_no_store", contentType: "text/plain; charset=utf-8",
      });
      if (target === "/__test/redirect") return respond(302, undefined, { kind: "test_redirect", location: "/forbidden" });
      if (target === "/forbidden") return reject(403);
      const route = target === "/" ? "/content-demo.html" : target;
      if (!STATIC.has(route)) return reject(404);
      let body;
      try { body = await readSource(root, rootChain, route); }
      catch { return reject(404); } // No paths or exception details escape.
      const contentType = route.endsWith(".html") ? "text/html; charset=utf-8"
        : route.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
      respond(200, body, { kind: "static", contentType });
    } catch { if (!res.headersSent) reject(500); else res.destroy(); }
  }
  server.on("request", dispatch);
  server.on("checkContinue", dispatch);
  server.on("checkExpectation", dispatch);
  // Parser/upgrade errors never print a raw URL, packet, header or peer address.
  const rejectedSockets = new WeakSet();
  function rejectSocket(socket, status = 400) {
    if (rejectedSockets.has(socket) || socket.destroyed) return;
    rejectedSockets.add(socket);
    const body = errorBody(status);
    const headers = { ...SECURITY, "Cache-Control": "no-store", "Connection": "close",
      "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length };
    metrics.response(status, "rejected", null);
    socket.on("error", () => {});
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\n`
      + Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join("")
      + "\r\n" + body.toString(), error => {
        if (!error) metrics.complete(body.length, "rejected", null);
      });
  }
  server.on("clientError", (error, socket) => rejectSocket(socket, error.code === "HPE_HEADER_OVERFLOW" ? 431 : 400));
  server.on("upgrade", (_req, socket) => rejectSocket(socket));
  server.on("connect", (_req, socket) => rejectSocket(socket));
  // Pipelined overflow is dropped without a response: Node otherwise generates an
  // automatic 503 without our no-store policy. Never write a second raw response.
  server.on("dropRequest", (_req, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host, exclusive: true }, () => {
      server.removeListener("error", reject);
      const actualPort = server.address().port;
      const authority = `${host === "::1" ? "[::1]" : host}:${actualPort}`;
      authorities = new Set([authority, `localhost:${actualPort}`]);
      Object.defineProperties(server, {
        origin: { value: `http://${authority}`, enumerable: true },
        entryUrl: { value: `http://${authority}/content-demo.html`, enumerable: true },
      });
      resolve();
    });
  });
  return server;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^(0|[1-9][0-9]{0,4})$/.test(args[1])
      || Number(args[1]) > 65535)) {
    console.error("Usage: node tools/content_demo_server.mjs [--port 8095|0]");
    process.exitCode = 1;
    return;
  }
  const port = args.length ? Number(args[1]) : 8095;
  try {
    const server = await createContentDemoServer({ port });
    console.log(JSON.stringify({ classification: "SIMULATED", ready: true, host: "127.0.0.1",
      port: server.address().port, origin: server.origin, entryUrl: server.entryUrl }));
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    server.on("error", () => { console.error("Demo server stopped after a listener error."); stop(); process.exitCode = 1; });
  } catch (error) {
    console.error(error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Try --port 8096 or --port 0.`
      : "Cannot start demo server. Check the port and non-symlink source directory.");
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
