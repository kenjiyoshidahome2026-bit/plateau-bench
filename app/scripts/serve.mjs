// iPhone など、Playwright で操れない端末で計測するためのサーバー（Mac で動かす）。
//
//   npm run build && node scripts/serve.mjs --runs 5 --terria http://<Mac の IP>:3002
//   → iPhone の Safari で http://<Mac の IP>:4173/__start を開くと、全エンジン×回数を順に計測し、
//     結果を results/iphone-<日時>.json と .csv に書き出す。
//
// - dist/ を配る（0.0.0.0:4173）。
// - /__proxy/<host>/<path> は https://<host>/<path> を中継し、タイルの所要時間と転送量をサーバー側で記録する。
//   頁の Resource Timing はワーカーからの取得を拾えないため、iPhone ではこの記録をタイルの指標に使う。
// - Safari には JS ヒープを測る API が無いため、iPhone のメモリの欄は空になる。
import http from "node:http";
import https from "node:https";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import os from "node:os";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]); return acc; }, []));
const PORT = Number(args.port ?? 4173);
const RUNS = Number(args.runs ?? 5);
const ENGINES = (args.engines ?? "maplibre,cesium,ortho-earth,navara,terria").split(",");
const SCENARIOS = args.scenarios ?? "initial,orbit,zoom";
const TERRIA = args.terria; // 例 http://192.168.1.10:3002
const TILESET = args.tileset ?? "https://assets.cms.plateau.reearth.io/assets/db/070026-aa27-431b-8d53-7cc6b03244f8/13101_chiyoda-ku_pref_2023_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2_no_texture/tileset.json";
const OUT = args.out ?? "results";
const EXTRA = new URLSearchParams(typeof args.query === "string" ? args.query : ""); // 各ページに足す query（例 "cesiumCull=0"・参考条件の切り替え）
// 結果を送ってよい端末は 1 台だけ：最初に結果を送った端末の User-Agent に固定し、違う端末からの結果は記録せずに断る
// （2026-10-20 の計測で、同じ URL を開いた別の Mac のブラウザの結果が iPhone の結果に混ざった）。--ua <文字列> で最初から固定もできる
let lockedUA = typeof args.ua === "string" ? args.ua : null;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml", ".b3dm": "application/octet-stream", ".glb": "model/gltf-binary", ".exr": "image/x-exr", ".ktx2": "image/ktx2" };

const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address ?? "localhost";
const origin = `http://${lanIp}:${PORT}`;
const proxied = (url) => { const u = new URL(url); return `${origin}/__proxy/${u.host}${u.pathname}${u.search}`; };

// 計測の順番：エンジンを回して 1 巡を RUNS 回（同じエンジンを続けて測らず、端末の温度の偏りを散らす）。
// シナリオごとに頁を開き直し、前のシナリオで読んだタイルがエンジン内に残らないようにする
const plan = [];
for (let r = 0; r < RUNS; r++) for (const sc of SCENARIOS.split(",")) for (const e of ENGINES) plan.push({ engine: e, run: r, scenario: sc });
let cursor = 0;
const results = [];
const tileLog = []; // { t, url, ms, bytes, status }
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function urlFor(step) {
  const q = new URLSearchParams({ ...Object.fromEntries(EXTRA), run: step.scenario, report: `${origin}/__results`, step: String(plan.indexOf(step)), tileset: proxied(TILESET) });
  if (step.engine === "terria") {
    if (!TERRIA) return null;
    return `${TERRIA}/?${q}#${origin}/__terria-init.json`; // init はこのサーバーが中継 URL 入りで返す
  }
  return `${origin}/${step.engine}.html?${q}`;
}

function nextUrl() {
  while (cursor < plan.length) {
    const u = urlFor(plan[cursor]);
    if (u) return u;
    cursor++;
  }
  return `${origin}/__done`;
}

function summarize() {
  const median = (xs) => { const s = xs.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const rows = [["engine", "scenario", "settled_ms", "fps_mean", "frame_p95_ms", "slow_frame_ratio", "main_thread_fps", "tile_requests", "tile_mb", "tile_median_ms", "tile_p95_ms", "runs"]];
  for (const e of ENGINES) for (const sc of SCENARIOS.split(",")) {
    const rs = results.filter((r) => r.engine?.name?.startsWith(e === "maplibre" ? "maplibre" : e === "terria" ? "terriajs" : e)).flatMap((r) => r.results).filter((x) => x.scenario === sc);
    const m = (f) => median(rs.map(f));
    rows.push([e, sc, m((x) => x.settledMs ?? x.settleAfterMs), m((x) => x.fpsMean), m((x) => x.frameP95Ms), m((x) => x.slowFrameRatio), m((x) => x.mainThreadFps), m((x) => x.serverTiles?.requests), m((x) => x.serverTiles?.bytes / 2 ** 20), m((x) => x.serverTiles?.medianMs), m((x) => x.serverTiles?.p95Ms), rs.length]);
  }
  return rows.map((r) => r.map((v) => (typeof v === "number" ? +v.toFixed(2) : v ?? "")).join(",")).join("\n") + "\n";
}

function save() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/iphone-${stamp}.json`, JSON.stringify({ meta: { date: new Date().toISOString(), RUNS, ENGINES, SCENARIOS, TILESET }, results, tileLog }, null, 1));
  writeFileSync(`${OUT}/iphone-${stamp}.csv`, summarize());
}

function cors(res) { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "content-type"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); }

function proxy(req, res, rest) {
  const target = `https://${rest}`;
  const t0 = performance.now();
  https.get(target, { headers: { "accept-encoding": "identity", "user-agent": req.headers["user-agent"] ?? "bench" } }, (up) => {
    cors(res);
    res.writeHead(up.statusCode ?? 502, { "content-type": up.headers["content-type"] ?? "application/octet-stream", "cache-control": "no-store" });
    let bytes = 0;
    up.on("data", (c) => { bytes += c.length; res.write(c); });
    up.on("end", () => { res.end(); tileLog.push({ t: Date.now(), url: target, ms: performance.now() - t0, bytes, status: up.statusCode }); });
  }).on("error", (e) => { res.writeHead(502); res.end(String(e)); });
}

function tilesBetween(t0, t1) {
  const ts = tileLog.filter((x) => x.t >= t0 && x.t <= t1), ms = ts.map((x) => x.ms).sort((a, b) => a - b);
  const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
  return { requests: ts.length, bytes: ts.reduce((s, x) => s + x.bytes, 0), medianMs: q(0.5), p95Ms: q(0.95) };
}

let pageOpenedAt = Date.now();
http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }
  if (url.pathname.startsWith("/__proxy/")) return proxy(req, res, req.url.slice("/__proxy/".length));
  if (url.pathname === "/__terria-init.json") {
    cors(res);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      catalog: [{ type: "3d-tiles", id: "bench-tiles", name: "PLATEAU 千代田区 LOD2", url: proxied(TILESET), shadows: "NONE" }],
      workbench: ["bench-tiles"],
      viewerMode: "3dSmooth",
      baseMaps: { items: [{ item: { id: "bench-empty", name: "なし", type: "composite", members: [] } }], defaultBaseMapId: "bench-empty", enabledBaseMaps: ["bench-empty"] },
    }));
  }
  // /__start は途中からの続き：iPhone がスリープして開き直しても、最初からやり直さない。最初からは /__start?reset=1
  if (url.pathname === "/__start") { if (url.searchParams.has("reset") || !results.length) cursor = 0; pageOpenedAt = Date.now(); res.writeHead(302, { location: nextUrl() }); return res.end(); }
  if (url.pathname === "/__done") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(`<h1>計測が終わりました</h1><p>${results.length} 件。Mac の ${OUT}/ を見てください。</p><pre>${summarize()}</pre>`); }
  if (url.pathname === "/__results" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body);
      const ua = req.headers["user-agent"] ?? "";
      if (!lockedUA) { lockedUA = ua; console.log(`結果を受け付ける端末：${ua}`); }
      if (ua !== lockedUA) {
        console.log(`⚠ 別の端末からの結果を断りました：${ua}`);
        cors(res); res.writeHead(409, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "another device is measuring", next: `${origin}/__done` }));
      }
      r.userAgent ??= ua;
      // 各シナリオの時間帯に中継したタイルを、そのシナリオの指標として付ける
      for (const x of r.results ?? []) if (x.wallStart && x.wallEnd) x.serverTiles = tilesBetween(x.scenario === "initial" ? pageOpenedAt : x.wallStart, x.wallEnd);
      results.push({ ...r, step: plan[cursor] });
      console.log(`${plan[cursor]?.engine} #${(plan[cursor]?.run ?? 0) + 1}`, (r.results ?? []).map((x) => `${x.scenario}:${x.fpsMean ? x.fpsMean.toFixed(1) + "fps" : Math.round(x.settledMs ?? 0) + "ms"}`).join(" "));
      cursor++;
      save();
      pageOpenedAt = Date.now();
      cors(res);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ next: nextUrl() }));
    });
    return;
  }
  // 静的ファイル（dist/）
  let p = normalize(join("dist", decodeURIComponent(url.pathname)));
  if (!p.startsWith("dist")) { res.writeHead(403); return res.end(); }
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404); return res.end("not found"); }
  cors(res);
  res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(p).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`iPhone の Safari で ${origin}/__start を開いてください（${plan.length} 回分）`);
  if (ENGINES.includes("terria") && !TERRIA) console.log("※ --terria を指定していないので TerriaJS は飛ばします");
});
