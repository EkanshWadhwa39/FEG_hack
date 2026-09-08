# Empire one-title CDN deployment

Status: implementation/runbook. This path is a **sandbox experiment**, not a staging or production dependency and not evidence of production authorization, CORS, cache policy, gameplay readiness, or business impact.

## What is deployed

Two distinct HTTPS origins are required:

1. **Lobby origin** — Vault HTML, CSS and JavaScript only.
2. **Provider CDN origin** — the reviewed Empire build under an immutable, digest-addressed release path, plus the separate Vault wrapper and configuration.

The provider ZIP itself is never deployed. The provider `index.html` and `assets/` bytes are extracted without modification. The wrapper and configuration are separate files. CDN mode deliberately exposes one synthetic title identity, not twenty copies of the same game.

The reviewed archive SHA-256 is pinned in code. Packaging fails closed for another archive, unsafe ZIP members, unsafe origins, an in-repository output path, or a non-empty output directory.

## Prerequisites

- Two dedicated HTTPS static-host origins with valid certificates.
- The private reviewed `empireofgold.zip` available outside the repository.
- A fresh, dedicated Chromium profile for every CONTROL or TREATMENT run.
- CDN transforms, HTML rewriting, automatic minification and image optimization disabled.
- No cookies, authentication headers, signed query strings, redirects, or credential-bearing launch URLs.

Cloudflare Pages `_headers` files are emitted. On another host, translate those policies exactly and verify them before opening a browser.

## 1. Prepare both immutable artifacts

Choose final origins before packaging; origin identity is part of the configuration and CORS policy.

```bash
rm -rf /tmp/empire-provider-public /tmp/empire-lobby-public
python3 tools/prepare_empire_cdn.py \
  --zip /private/path/empireofgold.zip \
  --cdn-origin https://YOUR-PROVIDER-CDN.example \
  --lobby-origin https://YOUR-LOBBY.example \
  --output-dir /tmp/empire-provider-public

python3 tools/prepare_empire_lobby.py \
  --cdn-origin https://YOUR-PROVIDER-CDN.example \
  --output-dir /tmp/empire-lobby-public
```

Both output directories must be outside this repository. Do not commit either generated directory, the archive, credentials, provider media, or raw browser evidence.

Inspect only the generated manifests and file inventory. Do not paste private provider bytes into tickets or logs.

## 2. Deploy without mutation

Deploy `/tmp/empire-provider-public` to the exact provider CDN origin and `/tmp/empire-lobby-public` to the exact lobby origin. Deploy atomically if the host supports it. Do not reuse a mutable release path.

Required provider behavior:

- `/releases/<reviewed-sha256>/assets/*`: `public, max-age=31536000, immutable`.
- Early assets: exact `Access-Control-Allow-Origin` and `Timing-Allow-Origin` for the lobby origin.
- `/releases/<reviewed-sha256>/index.html`: `no-store`.
- `/__vault/*`: `no-store`.
- `/__vault/config.json`: exact lobby-origin CORS.
- No redirects on config, wrapper, launch document, or warmed assets.

Required lobby behavior:

- `no-store` for the experiment shell.
- CSP permits scripts/styles only from the lobby origin and permits `connect-src`/`frame-src` only to the selected provider CDN origin.
- The generated config meta tag points to the exact provider CDN config URL.

## 3. HTTP smoke gate

After both deploys complete:

```bash
python3 tools/verify_empire_cdn_deployment.py \
  --cdn-origin https://YOUR-PROVIDER-CDN.example \
  --lobby-origin https://YOUR-LOBBY.example \
  --manifest /tmp/empire-provider-public/deployment-manifest.json
```

This checks every deployed provider file and wrapper/config artifact against the trusted local packaging manifest, plus the reviewed release identity, exact URLs, CORS/timing headers, immutable asset caching, no-store documents, and absence of credential-dependent response headers. It follows no redirects and sends no credentials. Keep the trusted manifest local; never substitute the deployed copy.

Its output is **MEASURED HTTP deployment smoke only**. It is not proof that Chromium reused cache entries and is not a latency benchmark.

## 4. Browser acceptance

Use a fresh dedicated browser profile; never an everyday profile.

1. Open the lobby origin.
2. Confirm the page renders exactly one Empire card and labels the environment as configured sandbox/CDN.
3. Keep authorization `UNKNOWN`; confirm no provider asset is requested and launch fails closed.
4. Set simulated authorization to `GRANTED`.
5. Leave speculative preparation off for CONTROL. Launch the sole title.
6. Confirm the wrapper handshake succeeds and the unchanged provider loads. Do not call it interactive: no authoritative provider input-accepted signal exists.
7. Repeat TREATMENT in a separate fresh profile/context. Enable speculative preparation, wait for the exact eight-object batch to complete, then launch the same title.
8. Export CONTROL and TREATMENT HARs separately. Redact them before review. Never commit raw HARs.
9. Verify the warmed asset request URLs are byte-for-byte identical to launch consumption URLs and inspect Chromium cache fields. Do not infer cache reuse from server counters alone.
10. Record browser/version, CDN, region, connection conditions, run count, exact commit, archive digest, milestone and failures.

The local `npm run verify:empire -- --zip ...` experiment remains the reproducible baseline and is unchanged. Never mix local and CDN measurements in one result.

## 5. Failure gates

Stop and report UNKNOWN/failed if any of these occurs:

- config CORS fails, redirects, times out, or disagrees with the exact origins;
- archive/build identity is not the reviewed digest;
- a launch/warm URL is reconstructed or differs by path, query, host, or version;
- any request carries cookies or authorization;
- the provider or CDN transforms bytes;
- a warmed object is SECONDARY or outside the audited eight-object subset;
- control and treatment share a browser profile/cache;
- only iframe load/paint is observed without authoritative input acceptance.

## Rollback

Disable or delete the lobby deployment first so no new experiment sessions begin. Then remove the provider deployment or revoke its public route. Retain only redacted derived results and the manifests needed to identify what was tested; do not retain the private ZIP or raw HAR in the repository.
