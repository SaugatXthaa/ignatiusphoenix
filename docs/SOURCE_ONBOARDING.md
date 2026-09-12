# Source Onboarding Guide — From Any Streaming Site to a Working Provider

This is the repo-native version of the *Stream Reverse Engineering* guide
(`Reverse_Engineering_Streaming_Sites.pdf`). Every technique from that guide is
mapped to a concrete file/hook in this codebase, so a future new web source can
be onboarded by following this checklist instead of re-inventing the steps.

**Golden rule:** the browser is just a JavaScript runtime that makes HTTP
requests. Replicate the requests in pure Node.js and you never need a browser.

---

## 0. Which pipeline does the site belong to?

| Site shape (from recon) | Pipeline in this repo | Example to copy |
|---|---|---|
| Hidden JSON API with direct m3u8/mp4 in response | `src/nuvio/<name>.cjs` provider + `src/source/<Name>.js` wrapper | `streamxtv.cjs` / `framextv.cjs`, `FrameX.js` |
| Embed/iframe player URLs | `src/source/<Name>.js` + `src/extractor/<Host>.js` | older embed-router sources |
| Encrypted API responses (XOR/AES/WASM/base64) | same as above + `stream-decrypt.cjs` helpers + `/proxy?xor=` | this guide §5–6 |
| 403 on plain Node fetch | `got-scraping` first, then `cf-fetch.cjs` (curl) | `/reanime-proxy` in `src/index.js` |

---

## 1. Reconnaissance (guide §2–3) — `scripts/recon_site.sh`

Run `SITE='https://target.example' bash scripts/recon_site.sh <movie-path>`.
It automates: homepage fetch → movie-page fetch → clue scan
(m3u8/mp4 URLs, `/api/` endpoints, iframes, base64 blobs, script bundles,
webpack chunk maps) and tells you which row of the table above you're in.

Manual equivalents live in the script itself; key grep patterns:

```bash
grep -oE 'https?://[^"'"'"' ]+\.(m3u8|mp4)[^"'"'"' ]*' page.html   # direct streams
grep -oE '/api/[a-z0-9/_-]+' bundle.js                              # API paths
grep -oE '[0-9]+:"[a-f0-9]+"' webpack.js                            # chunk map
grep -oE '\[[0-9]+,(?:[0-9]+,){14,15}[0-9]+\]' player.js            # XOR key array
```

Webpack chunk hunting (guide §3.3): the runtime maps chunk ids to hashed
filenames — extract with the third grep above, then download the chunk that
mentions `m3u8|sources|stream|fetch|player`.

---

## 2. Anti-bot layer (guide §4) — decision order

1. **Default: `got-scraping`** (Chrome TLS fingerprint + header generator).
   Already the repo standard — see `/proxy` in `src/index.js`.
2. **Still 403 (JA3-level block): `fetchWithCurl()`** from
   `src/utils/cf-fetch.cjs` — curl's TLS handshake passes CF without a browser.
3. **UA-based bot detection: use `SHORT_UA`** from the same module. The full
   Chrome UA string is rejected by some CF sites; the truncated one passes:
   `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`
4. **Referer gating:** every stream result must carry its Referer. Sources go
   through `callNuvioProvider` (Nuvio layer) or `behaviorHints.proxyHeaders`;
   the addon's `/proxy` re-injects it on every segment. **Registration
   requirement:** the source id MUST be in `NUVIO_SOURCE_IDS` inside
   `src/extractor/NuvioExtractor.js` — otherwise headers are silently dropped
   and streams 403 in the player (this exact bug hit streamxtv once).
5. **None of the above works:** the site runs a full CF challenge — find an
   API subdomain that isn't behind it instead of fighting the challenge.

---

## 3. Encryption playbooks (guide §5) — `src/utils/stream-decrypt.cjs`

| Cipher | Helper(s) | Notes |
|---|---|---|
| Base64-encoded URLs/m3u8 | `base64DecodeStrict()` | strict charset+length check so binary segments don't false-positive |
| XOR segments disguised as WebP/PNG | `isWebPDisguise()` / `isPngDisguise()` / `stripFakeImageHeader()` / `xorDecrypt()` | find the 16-byte key array in the player JS (`grep` pattern in §1); verify with `verifyMpegTs()` |
| Custom fake header + XOR | `detectAndDecrypt(body, { xorKey, stripHint })` | e.g. `"mvm1"` magic + 12–16 bytes |
| WASM key derivation | `createWasmRunner(b64)` | compile base64 WASM in Node; memory read/write helpers included. Export names/memory layout are site-specific — read the player JS for the call sequence |
| AES-256-CBC after PBKDF2→XOR→SHA-256 | `deriveAesKeyChain({ secret, seed })` + `aes256CbcDecrypt()` | exact guide §5.4 chain |
| SHA-256 obfuscated field names | `deriveFieldNames(seed)` | returns `cd_*` container / `kf_*` key / token field names per request |
| Custom stream ciphers (RC4+PRNG mixes) | port to a module like `src/utils/speedracelight.js` | keep the magic-header check as the round-trip test; `cineby.cjs` holds an independent copy for reference |

**Key hygiene:** once a key is confirmed, register it in
`src/utils/site-secrets.cjs` (env-overridable, one rotation point) instead of
hardcoding — see `download/SECRETS.md` for the rotation playbook.

---

## 4. Making encrypted streams playable (guide §6) — the proxy

Standard players cannot play encrypted streams. Two options, both already
wired:

**A. `/proxy` opt-in decrypt mode (new, generic).** Append query params:

```
/proxy?url=<enc-stream-url>
  &referer=<site-player-url>   # injected upstream
  &xor=<base64|hex key>        # activates auto-decrypt (WebP/PNG disguise,
                               # base64 m3u8, whole-body XOR — detected by magic bytes)
  &strip=<n>                   # strip n custom header bytes before XOR (e.g. 16)
  &b64m3u8=1                   # body is known base64 (skips auto-detection)
  &ct=<mime>                   # force content-type (default video/mp2t for segments)
```

Playlists are rewritten so every variant/segment URL flows back through
`/proxy` **with `xor`/`strip`/`ct` propagated** — the whole tree decrypts
end-to-end. Decrypted segments are MPEG-TS-verified before serving and logged
(`proxy-decrypt segment … ts=ok`).

**B. `/reanime-proxy` (existing, ReAnime-specific).** Hardcoded to
flixcloud.cc/atomic4cdn.top with the registered 16-byte key — do not extend it;
use A for new sources.

Example wiring in a provider:

```js
{
  name: 'NewSite 4K',
  url: `${ADDON_BASE}/proxy?url=${encodeURIComponent(manifest)}&referer=${encodeURIComponent('https://newsite.player/')}&xor=${encodeURIComponent(keyB64)}`,
  behaviorHints: { notWebReady: true },
}
```

---

## 5. Verify before shipping (guide §9)

```bash
# playlist shape (through the proxy, with the params you generated)
curl -s '<proxy-url>' | head -1          # must start with #EXTM3U

# real playback check
ffprobe -v error -show_streams -headers $'Referer: <referer>\r\n' '<proxy-url>'

# 5-second extract proves end-to-end playability
ffmpeg -y -protocol_whitelist "file,http,https,tcp,tls,crypto,data" \
  -allowed_extensions ALL -i '<proxy-url>' -t 5 -c copy out.mp4
```

In-repo checks: `verifyMpegTs()` (sync byte 0x47 every 188 bytes) for
decrypted segments; the addon boot log must show zero errors; run a live
`/stream/movie/<tt-id>.json` and count streams vs. before the change
(regression guard). Existing test scripts under `/home/z/my-project/scripts/`
(`test_stream_decrypt.mjs`, `test_audio_wiring.mjs`) are the templates.

---

## 6. Packaging checklist (guide §10)

1. [ ] Write `src/nuvio/<name>.cjs`: batching (5/batch, ~500ms apart), 22s
      internal deadline, 1 retry @7s, URL dedupe, quality normalization
      (4K-first), subtitle mapping deduped by language (cap 20),
      `audioTracks`/`hasMultipleAudio` passthrough — copy the skeleton of
      `src/nuvio/streamxtv.cjs`.
2. [ ] Write/extend `src/source/<Name>.js` to call it via `callNuvioProvider`
      (race-free parallel with `findAniListId` for anime); add enrichment
      markers (4K/HEVC/WebDL/HDR/audio) so `StreamResolver.enrichMeta` picks
      them up.
3. [ ] Register: `NUVIO_SOURCE_IDS` in `src/extractor/NuvioExtractor.js`
      (mandatory — Referer!), `PRIORITY_SOURCE_IDS` in
      `src/utils/StreamResolver.js`, comment in `src/source/index.js`.
4. [ ] Secrets → `src/utils/site-secrets.cjs`; CDN header requirements → the
      table in `download/SECRETS.md`.
5. [ ] `node --check` every touched file; boot the addon (expect 74 sources /
      30 extractors, zero errors); live movie + TV stream test; ffprobe the
      proxy URL.
6. [ ] Append a worklog entry with the verification numbers.

---

## 7. Troubleshooting (guide §7 + repo-specific)

| Symptom | Likely cause | Fix |
|---|---|---|
| 403 from site | JA3 / UA / challenge | `got-scraping` → `fetchWithCurl` → `SHORT_UA` → alternate API host |
| 403 from CDN only | Missing Referer | `&referer=` on the proxy URL; check `NUVIO_SOURCE_IDS` registration |
| Decrypted bytes are garbage | Wrong XOR key / wrong strip length | re-grep the player JS for the byte array; confirm with `verifyMpegTs` |
| AES throws | Wrong key chain order | PBKDF2 → XOR-seed → SHA-256 (`deriveAesKeyChain`), verify IV source |
| WASM instantiate fails | Not real base64 / wrong imports | strict-decode first; inspect the instantiate imports in the player JS |
| ffmpeg rejects segment URLs | Extension mismatch | not needed via `/proxy` (Content-Type is set); for direct URLs use the `&e=.ts` trick like `/reanime-proxy` |
| Streams work in curl but not player | Headers not propagated | pass `behaviorHints.proxyHeaders` or route via `/proxy?...&referer=` |
| Empty response | Rate limited | batch + delay pattern from `streamxtv.cjs` (5/batch, 500ms) |
| Site changed API | — | re-run `scripts/recon_site.sh`, diff the JS bundles |
