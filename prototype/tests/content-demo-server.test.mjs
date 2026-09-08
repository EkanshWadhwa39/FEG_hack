import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createContentDemoServer, STATIC_PATHS, LIMITS } from "../../tools/content_demo_server.mjs";
import { TITLE_IDS, LOCALES, TIERS, ASSET_SIZES, IMMUTABLE, fixtureManifest,
  thumbnailSvg, resolveSyntheticFixture } from "../../tools/content_demo_fixtures.mjs";

const serverScript = fileURLToPath(new URL("../../tools/content_demo_server.mjs", import.meta.url));
const sha256 = body => createHash("sha256").update(body).digest("hex");
async function close(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
async function start(t, options) {
  const server = await createContentDemoServer(options);
  t.after(() => close(server));
  return server;
}
async function temporaryRoot(t) {
  // macOS /var and /tmp can be symlinks: use their canonical test directory.
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "content-demo-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function request(server, target, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: server.address().address, port: server.address().port,
      path: target, method, headers, agent: false }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("test request timeout")));
    req.end();
  });
}
async function metrics(server) { return JSON.parse((await request(server, "/__metrics")).body); }
function secure(response, cache = "no-store") {
  assert.equal(response.headers["cache-control"], cache);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-content-classification"], "SIMULATED");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.headers["timing-allow-origin"], undefined);
  const csp = response.headers["content-security-policy"];
  for (const kind of ["script", "style", "img", "connect", "frame"]) assert.ok(csp.includes(`${kind}-src 'self'`));
  assert.ok(csp.includes("frame-ancestors 'self'"));
  assert.ok(!csp.includes("unsafe-inline"));
}

test("fixture generation matches Python SHAKE-256 golden vectors and exact thumbnail", () => {
  // Golden SHA-256s independently generated with Python hashlib.shake_256.
  const vectors = [
    ["title-01", "hr-HR", "1x", "preloader", "54e485b37ed36894828493c3ab9af5ec3d66fcf396fa444c87bc8cecb8c1cb51"],
    ["title-07", "en", "0.5x", "common", "ac85ded3585e1d8d5a0d32421f0008a538479ecf1c3e802ef32f1e7efa16d209"],
    ["title-20", "hr-HR", "0.5x", "splash", "033fd8c2ad5df83ca369ef0d650eaa45fabec8491787367b92600073a163c456"],
  ];
  for (const [title, locale, tier, kind, expected] of vectors) {
    const target = fixtureManifest(title, locale, tier).assets.find(asset => asset.type === kind).url;
    assert.equal(sha256(resolveSyntheticFixture(target).body), expected);
  }
  assert.equal(thumbnailSvg("title-01").toString(), '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96" role="img" aria-label="SIMULATED title 01"><title>SIMULATED title 01</title><rect width="128" height="96" rx="8" fill="#0b2a8f"/><circle cx="64" cy="34" r="25" fill="white"/><text x="64" y="42" text-anchor="middle" font-size="24" fill="black">01</text><rect y="68" width="128" height="28" fill="white"/><text x="64" y="86" text-anchor="middle" font-size="12" fill="black">SIMULATED</text></svg>');
  for (const args of [["title-00"], ["title-21"], ["title01"], ["title-01", "EN"], ["title-01", "en", "2x"]]) {
    assert.throws(() => fixtureManifest(...args), TypeError);
  }
  assert.throws(() => thumbnailSvg("<script>"), TypeError);
  assert.equal(resolveSyntheticFixture(null), null);
  assert.equal(resolveSyntheticFixture(`${fixtureManifest("title-01").thumbnail}\n`), null);
});

test("all 20 titles, 240 assets and thumbnails have exact identities, lengths and cache headers", async t => {
  const server = await start(t);
  const hashes = new Set();
  for (const title of TITLE_IDS) {
    const thumb = fixtureManifest(title).thumbnail;
    const response = await request(server, thumb);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, thumbnailSvg(title));
    assert.equal(response.headers["content-type"], "image/svg+xml");
    secure(response, IMMUTABLE);
    for (const locale of LOCALES) for (const tier of TIERS) {
      for (const asset of fixtureManifest(title, locale, tier).assets) {
        const response = await request(server, asset.url);
        assert.equal(response.status, 200);
        assert.equal(response.body.length, ASSET_SIZES[asset.type]);
        assert.equal(Number(response.headers["content-length"]), asset.bytes);
        assert.equal(response.headers["content-type"], "application/octet-stream");
        assert.deepEqual(response.body, resolveSyntheticFixture(asset.url).body);
        secure(response, IMMUTABLE);
        hashes.add(sha256(response.body));
      }
    }
  }
  assert.equal(hashes.size, 240);
  const snapshot = await metrics(server);
  assert.equal(snapshot.requests, 260);
  assert.equal(Object.keys(snapshot.by_title).length, 20);
  assert.equal(snapshot.by_type.preloader.requests, 80);
  assert.equal(snapshot.by_type.splash.body_bytes, 80 * 65536);
});

test("HEAD counts requests but zero body bytes; metrics snapshot precedes its own request", async t => {
  const server = await start(t);
  const first = await metrics(server);
  assert.equal(first.requests, 0);
  assert.equal(first.body_bytes, 0);
  const target = fixtureManifest("title-04").assets[0].url;
  const head = await request(server, target, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers["content-length"], "16384");
  secure(head, IMMUTABLE);
  const before = await metrics(server);
  assert.deepEqual(before.by_title["title-04"].preloader, { requests: 1, body_bytes: 0, errors: 0 });
  await request(server, target);
  await request(server, target);
  const failed = await request(server, "/unknown-private-token", { headers: { Authorization: "never-record-me", Cookie: "secret-cookie" } });
  assert.equal(failed.status, 404);
  const snapshot = await metrics(server);
  assert.deepEqual(snapshot.by_title["title-04"].preloader, { requests: 3, body_bytes: 32768, errors: 0 });
  assert.equal(snapshot.errors, 1);
  assert.equal(snapshot.errors_by_status[404], 1);
  assert.equal(snapshot.by_type.metrics.requests, 2);
  assert.equal(snapshot.counters_saturated, false);
  assert.match(snapshot.body_bytes_semantics, /not wire bytes/);
  const text = JSON.stringify(snapshot);
  for (const forbidden of ["unknown-private-token", "never-record-me", "secret-cookie", "127.0.0.1", target, "Authorization"]) {
    assert.ok(!text.includes(forbidden));
  }
  assert.equal(Object.keys(snapshot.by_type).length, 10);
  const summedBytes = Object.values(snapshot.by_type).reduce((sum, value) => sum + value.body_bytes, 0);
  assert.equal(snapshot.body_bytes, summedBytes);
});

test("strict raw targets reject aliases, queries, dotfiles, traversal, raw/provider/Hansika files", async t => {
  const server = await start(t);
  const target = fixtureManifest("title-01").assets[0].url;
  const invalid = ["//health", "///content-demo.html", "/src//catalogue.js", "/src/../index.html",
    "/./content-demo.html", "/src/.hidden.js", "/.git/config", "/.env", "/%63ontent-demo.html",
    "/src%2fcatalogue.js", "/%2e%2e/CODE.md", "/src\\catalogue.js", "/health#x",
    "/health?", "/health?v=1", "/__metrics?secret=do-not-reflect", "/?v=1",
    "/content-demo.html?v=1", "/content-game.html?title=title-01", "/src/catalogue.js?v=1",
    "/index.html", "/src/sandbox.js", "/src/player.js", "/styles/style.css", "/src/",
    "/tools/content_server.py", "/CODE.md", "/Devtools_games/casino.psk.hr.har", "/provider/index.html",
    "/evidence/private/secret.json", "/package.json", "/__test/redirect?x=1", "/__test/no-store?x=1",
    target.replace("?v=1", ""), target.replace("?v=1", "?v=2"), `${target}&x=1`, `${target}&v=1`,
    target.replace("?v=1", "?v=%31"), `${target}?`, target.replace("synthetic-v1", "synthetic-v2"),
    target.replace("title-01", "title-00"), target.replace("title-01", "title-21"),
    target.replace("title-01", "title01"), target.replace("hr-HR", "hr"), target.replace("1x/", "2x/"),
    target.replace("preloader.bin", "secondary.bin"), target.replace("preloader.bin", "preloader"),
    target.replace("preloader.bin", "preloader.bin/"), "http://localhost/health"];
  for (const raw of invalid) {
    const response = await request(server, raw);
    assert.ok([400, 404].includes(response.status), `${raw}: ${response.status}`);
    secure(response);
    assert.equal(JSON.parse(response.body).error, "request rejected");
  }
  const head = await request(server, "/.env", { method: "HEAD" });
  assert.equal(head.status, 400);
  assert.equal(head.body.length, 0);
  secure(head);
  const snapshot = await metrics(server);
  assert.equal(snapshot.by_type.rejected.requests, invalid.length + 1);
  assert.equal(snapshot.by_type.preloader.requests, 0);
  assert.equal(Object.keys(snapshot.by_title).length, 20);
});

test("only explicit source allowlist; / maps to new demo and missing demo never exposes index", async t => {
  const root = await temporaryRoot(t);
  await writeFile(path.join(root, "index.html"), "PRIVATE OLD UI MUST NOT APPEAR");
  const server = await start(t, { staticRoot: root });
  assert.equal((await request(server, "/")).status, 404);
  assert.equal((await request(server, "/index.html")).status, 404);
  for (const route of STATIC_PATHS) {
    const filename = path.join(root, route.slice(1));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, `original test fixture for ${route}`);
  }
  for (const route of STATIC_PATHS) {
    const response = await request(server, route);
    assert.equal(response.status, 200, route);
    assert.equal(response.body.toString(), `original test fixture for ${route}`);
    secure(response);
  }
  assert.equal((await request(server, "/")).body.toString(), "original test fixture for /content-demo.html");
  const head = await request(server, "/src/catalogue.js", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  secure(head);
  await mkdir(path.join(root, "src", "not-allowlisted.js"));
  assert.equal((await request(server, "/src/not-allowlisted.js")).status, 404);
  await writeFile(path.join(root, "content-demo.html"), Buffer.alloc(LIMITS.sourceBytes + 1));
  assert.equal((await request(server, "/")).status, 404);
  await rm(path.join(root, "content-game.html"));
  await mkdir(path.join(root, "content-game.html"));
  assert.equal((await request(server, "/content-game.html")).status, 404);
});

test("existing core closure serves exact source bytes with no-store and correct MIME", async t => {
  const server = await start(t);
  const route = "/src/catalogue.js";
  const response = await request(server, route);
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/javascript; charset=utf-8");
  assert.deepEqual(response.body, await readFile(new URL("../src/catalogue.js", import.meta.url)));
  secure(response);
  assert.equal(server.origin, `http://127.0.0.1:${server.address().port}`);
  assert.equal(server.entryUrl, `${server.origin}/content-demo.html`);
  assert.equal(server.headersTimeout, LIMITS.headersTimeout);
  assert.equal(server.requestTimeout, LIMITS.requestTimeout);
  assert.equal(server.maxConnections, LIMITS.connections);
});

test("reject symlink source files", async t => {
  const root = await temporaryRoot(t);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "secret.js"), "secret source");
  try { await symlink(path.join(root, "secret.js"), path.join(root, "src", "catalogue.js"), "file"); }
  catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("Windows symlink privilege unavailable");
    throw error;
  }
  const server = await start(t, { staticRoot: root });
  const response = await request(server, "/src/catalogue.js");
  assert.equal(response.status, 404);
  assert.ok(!response.body.toString().includes("secret source"));
  secure(response);
});

test("reject symlink/junction ancestors, including source root and post-start replacement", async t => {
  const parent = await temporaryRoot(t);
  const root = path.join(parent, "prototype");
  const outside = path.join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(outside, "catalogue.js"), "secret source");
  const directoryLink = process.platform === "win32" ? "junction" : "dir";
  await symlink(outside, path.join(root, "src"), directoryLink);
  const server = await start(t, { staticRoot: root });
  assert.equal((await request(server, "/src/catalogue.js")).status, 404);
  const alias = path.join(parent, "alias");
  await symlink(root, alias, directoryLink);
  await assert.rejects(createContentDemoServer({ staticRoot: alias }), /non-symlink/);
  await assert.rejects(createContentDemoServer({ staticRoot: path.join(alias, "src") }), /non-symlink/);
  await rename(root, path.join(parent, "old-prototype"));
  await symlink(outside, root, directoryLink);
  assert.equal((await request(server, "/src/catalogue.js")).status, 404);
});

test("health, no-store and redirect negative controls; no redirect follow in test", async t => {
  const server = await start(t);
  const health = await request(server, "/health");
  secure(health);
  assert.equal(JSON.parse(health.body).binary_fixture_count, 240);
  assert.equal(JSON.parse(health.body).title_count, 20);
  const noStore = await request(server, "/__test/no-store");
  assert.equal(noStore.status, 200);
  assert.equal(noStore.body.toString(), "SIMULATED no-store fixture\n");
  secure(noStore);
  const redirect = await request(server, "/__test/redirect");
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, "/forbidden");
  assert.equal(redirect.body.length, 0);
  secure(redirect);
  const denied = await request(server, redirect.headers.location);
  assert.equal(denied.status, 403);
  secure(denied);
  secure(await request(server, "/__metrics"));
});

test("loopback binding, Host/Origin boundary, methods, bodies and target/header bounds", async t => {
  for (const host of ["0.0.0.0", "localhost", "example.com", "127.1.2.3", "::", null]) {
    await assert.rejects(createContentDemoServer({ host }), /loopback/);
  }
  for (const port of [-1, 65536, 1.5, "8095", true, null]) {
    await assert.rejects(createContentDemoServer({ port }), /port/);
  }
  const server = await start(t);
  for (const headers of [{ Host: "attacker.invalid" }, { Origin: "https://attacker.invalid" },
    { "Sec-Fetch-Site": "cross-site" }]) {
    const response = await request(server, "/health", { headers });
    assert.equal(response.status, 403);
    secure(response);
  }
  assert.equal((await request(server, "/health", { headers: { Origin: server.origin } })).status, 200);
  assert.equal((await request(server, "/health", { headers: { Host: `localhost:${server.address().port}` } })).status, 200);
  const method = await request(server, "/health", { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, "GET, HEAD");
  secure(method);
  assert.equal((await request(server, "/health", { headers: { "Content-Length": "1" } })).status, 413);
  assert.equal((await request(server, "/health", { headers: { Expect: "100-continue" } })).status, 400);
  const hugePath = await request(server, `/${"a".repeat(LIMITS.targetBytes)}`);
  assert.equal(hugePath.status, 414);
  secure(hugePath);
  const hugeHeader = await request(server, "/health", { headers: { "X-Test": "a".repeat(LIMITS.headerBytes) } });
  assert.equal(hugeHeader.status, 431);
  secure(hugeHeader);
  await assert.rejects(createContentDemoServer({ port: server.address().port }), { code: "EADDRINUSE" });
});

function rawRequest(server, bytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.connect(server.address().port, server.address().address, () => socket.write(bytes));
    socket.setTimeout(5000, () => socket.destroy(new Error("test timeout")));
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("end", () => { resolve(Buffer.concat(chunks).toString()); socket.destroy(); });
  });
}
test("parser and upgrade errors are bounded, redacted, no-store; server stays usable", async t => {
  const server = await start(t);
  const host = new URL(server.origin).host;
  for (const message of [
    `GET /health HTTP/1.1\r\nHost: ${host}\r\nBad Header: private-do-not-show\r\n\r\n`,
    `GET /health HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    `CONNECT private.invalid:443 HTTP/1.1\r\nHost: ${host}\r\n\r\n`,
  ]) {
    const response = await rawRequest(server, message);
    assert.match(response, /^HTTP\/1.1 400 /);
    assert.match(response, /Cache-Control: no-store/i);
    assert.ok(!response.includes("private"));
    assert.ok(response.length < 1200);
  }
  assert.equal((await request(server, "/health")).status, 200);
  assert.equal((await metrics(server)).errors_by_status[400], 3);
});

function cli(args) {
  const child = spawn(process.execPath, [serverScript, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = once(child, "exit").then(([code]) => ({ code, stdout, stderr }));
  return { child, done };
}
test("CLI readiness JSON, ephemeral port, graceful shutdown and friendly conflict/usage errors", { timeout: 15000 }, async t => {
  const running = cli(["--port", "0"]);
  t.after(() => { if (running.child.exitCode === null) running.child.kill(); });
  const [chunk] = await once(running.child.stdout, "data");
  const ready = JSON.parse(chunk.toString().trim());
  assert.equal(ready.ready, true);
  assert.equal(ready.classification, "SIMULATED");
  assert.ok(ready.port > 0);
  assert.equal(ready.origin, `http://127.0.0.1:${ready.port}`);
  assert.equal(ready.entryUrl, `${ready.origin}/content-demo.html`);
  const conflict = await cli(["--port", String(ready.port)]).done;
  assert.equal(conflict.code, 1);
  assert.equal(conflict.stdout, "");
  assert.match(conflict.stderr, /already in use.*--port 0/);
  for (const args of [["--port", "65536"], ["--port", "-1"], ["--port", "1.5"], ["--host", "0.0.0.0"]]) {
    const result = await cli(args).done;
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^Usage:/);
    assert.equal(result.stdout, "");
  }
  running.child.kill("SIGTERM");
  const stopped = await running.done;
  assert.equal(stopped.stderr, "");
  assert.equal(stopped.stdout.trim().split("\n").length, 1);
});

test("server.close releases listener for reuse and metrics do not leak across instances", async () => {
  const server = await createContentDemoServer();
  const port = server.address().port;
  await request(server, "/health");
  await close(server);
  assert.equal(server.listening, false);
  const next = await createContentDemoServer({ port });
  try { assert.equal((await metrics(next)).requests, 0); }
  finally { await close(next); }
});
