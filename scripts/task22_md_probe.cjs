// Task 22: probe moviesdrive_v2's mdrive.lol archive chain for F1
process.env.NODE_ENV = 'test';
const src = require('fs').readFileSync('/home/z/my-project/phoenix-analysis/src/nuvio/moviesdrive_v2.cjs', 'utf8');
// 暴露内部函数：在模块源码尾部追加导出后经 data: URL 加载 — 简化：直接 eval 内嵌
const mod = require('/home/z/my-project/phoenix-analysis/src/nuvio/moviesdrive_v2.cjs');
console.log('exports:', Object.keys(mod));

(async () => {
  // 用导出的 getStreams 走一遍并截获打印的 mdrive URL：改用搜索+页面抓取手动复刻
  const search = mod.searchMoviesdrive || null;
  if (typeof search === 'function') {
    const res = await search('F1', 10);
    for (const r of res.slice(0, 3)) console.log('search hit:', r.permalink || r, (r.title || '').slice(0, 60));
  }
  process.exit(0);
})();
