// Task 22 (2026-09-14) — hindmoviez domain-migration bridge (shim, self-installing).
// The upstream link network migrated domains, breaking the scraper's legacy
// regexes/endpoints which still target the old ones:
//   1. mvlink.blog pages now link hshare.lol (scraper expects hshare.ink)
//   2. mvlink.blog/wp-admin/admin-ajax.php action=hindshare_sign now rejects
//      the new hshare.lol filename IDs ("Invalid format") — the sign step is
//      obsolete because hshare.lol pages are public (no signing needed)
//   3. hshare pages now link hcloud.shop (scraper expects hcloud.ink)
// This shim bridges all three at the fetch layer, leaving the obfuscated
// scraper logic untouched:
//   - POST admin-ajax action=hindshare_sign → synthetic {success,data.url}
//     pointing at hshare.ink/?id=<decoded id>  (rewritten to .lol on fetch)
//   - outbound fetches  hshare.ink→hshare.lol, hcloud.ink→hcloud.shop
//   - mvlink HTML: hshare.lol→hshare.ink, hshare HTML: hcloud.shop→hcloud.ink
//     so the legacy regexes match; direct .workers.dev links inside the hcloud
//     redirect chain are resolved by the scraper's existing nested url= decoder.
if (!globalThis.__hindmoviezDomainShim) {
  globalThis.__hindmoviezDomainShim = true;
  const __hmOrigFetch = globalThis.fetch;
  globalThis.fetch = async function hindmoviezBridgedFetch(input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const isHmFlow = /mvlink\.blog|hshare\.(?:ink|lol)|hcloud\.(?:ink|shop)/i.test(url);
      if (!isHmFlow) return __hmOrigFetch.call(this, input, init);

      // (1) neutralize the dead signing endpoint (only for hindshare_sign)
      if (/wp-admin\/admin-ajax\.php/i.test(url)) {
        const body = init && typeof init.body === 'string' ? init.body : '';
        if (/action=hindshare_sign/.test(body)) {
          const m = body.match(/d=([^&]+)/);
          let id = '';
          if (m) {
            try {
              id = Buffer.from(decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
            } catch { /* id stays '' */ }
          }
          const payload = JSON.stringify({ success: true, data: { url: 'https://hshare.ink/?id=' + encodeURIComponent(id) } });
          return new Response(payload, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return __hmOrigFetch.call(this, input, init);
      }

      // (2) URL rewrites for the dead domains (outbound)
      let fetchUrl = url
        .replace(/^https?:\/\/hshare\.ink/i, 'https://hshare.lol')
        .replace(/^http(s)?:\/\/hcloud\.ink/i, (m0, s) => `http${s || ''}://hcloud.shop`);

      const res = await __hmOrigFetch.call(this, fetchUrl, init);

      // (3) response rewrites so legacy regexes see the old domains
      const ct = res.headers && res.headers.get ? res.headers.get('content-type') || '' : '';
      if (/text\/html|text\/plain/i.test(ct)) {
        const text = await res.text();
        let out = text;
        if (/mvlink\.blog/i.test(url)) out = text.replace(/hshare\.lol/gi, 'hshare.ink');
        else if (/hshare\.lol/i.test(url)) out = text.replace(/hcloud\.shop/gi, 'hcloud.ink');
        if (out !== text) {
          const headers = new Headers();
          res.headers.forEach((v, k) => { if (!/^content-(length|encoding)$/i.test(k)) headers.set(k, v); });
          return new Response(out, { status: res.status, statusText: res.statusText, headers });
        }
      }
      return res;
    } catch (e) {
      return __hmOrigFetch.call(this, input, init);
    }
  };
}
