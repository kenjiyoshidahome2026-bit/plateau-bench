// 本計測スクリプト：各エンジンのページを毎回まっさらなブラウザで開き、3 シナリオを計測して JSON と CSV に書き出す。
//
//   node scripts/measure.mjs --runs 5 --engines maplibre,cesium,ortho-earth,navara,terria
//
// 主なオプション
//   --base URL       ベンチのページの置き場（既定 http://localhost:4173）
//   --terria URL     TerriaMap の置き場（既定 http://localhost:3002）。"terria" を engines に入れた時だけ使う
//   --query STR      各ページに付ける追加の query（例 "tileset=/testtiles/tileset.json"）
//   --terria-init N  Terria の init 名（既定 bench。合成データは bench-test）
//   --runs N         エンジンごとの回数（既定 5）
//   --scenarios S    既定 initial,orbit,zoom
//   --size WxH       既定 1920x1080
//   --vsync          垂直同期を有効のまま測る（既定は無効＝上限なしの FPS）
//   --headless       ヘッドレスで動かす（GPU が使えないことがあるので本番では使わない）
//   --chrome PATH    Chrome の実行ファイル（既定は Playwright の "chrome" チャネル、無ければ同梱の Chromium）
//   --out DIR        既定 results
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const BASE = args.base ?? "http://localhost:4173";
const TERRIA = args.terria ?? "http://localhost:3002";
const QUERY = args.query ?? "";
const TERRIA_INIT = args["terria-init"] ?? "bench";
const RUNS = Number(args.runs ?? 5);
const ENGINES = (args.engines ?? "maplibre,cesium,ortho-earth,navara,terria").split(",");
const SCENARIOS = (args.scenarios ?? "initial,orbit,zoom").split(",");
const [W, H] = (args.size ?? "1920x1080").split("x").map(Number);
const OUT = args.out ?? "results";
const TILE_RE = /\.(b3dm|glb|gltf|i3dm|cmpt|pnts|subtree)(\?|$)|tileset\.json/;

function pageUrl(engine) {
  const q = new URLSearchParams(QUERY);
  if (engine === "terria") return `${TERRIA}/?${q}#${TERRIA_INIT}`;
  return `${BASE}/${engine}.html?${q}`;
}

// ブラウザの各プロセスの RSS（MB）。描画プロセス（ワーカー込み）と GPU プロセスを分けて返す。
// プロセスの一覧は DevTools Protocol の SystemInfo.getProcessInfo で取り、RSS は ps で読む
async function processMemory(browserCdp) {
  let procs;
  try { procs = (await browserCdp.send("SystemInfo.getProcessInfo")).processInfo; } catch { return null; }
  let out;
  try { out = execFileSync("ps", ["-o", "pid=,rss=", "-p", procs.map((p) => p.id).join(",")], { encoding: "utf8" }); } catch { return null; }
  const rss = new Map(out.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number)));
  const sum = (f) => procs.filter(f).reduce((s, p) => s + (rss.get(p.id) ?? 0), 0) / 1024;
  return { rendererMB: sum((p) => p.type === "renderer"), gpuMB: sum((p) => p.type === "GPU"), totalMB: sum(() => true) };
}

// 端末のメモリの逼迫具合（空き・スワップ使用量）。スワップが増えた回は結果が悪く出るので記録しておく
function systemMemory() {
  const r = { freeMB: os.freemem() / 2 ** 20 };
  if (os.platform() === "darwin") {
    try {
      const m = execFileSync("sysctl", ["-n", "vm.swapusage"], { encoding: "utf8" }).match(/used = ([\d.]+)M/);
      if (m) r.swapUsedMB = Number(m[1]);
    } catch {}
  }
  return r;
}

async function launch() {
  const flags = ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--no-first-run", "--window-position=0,0", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
  if (!args.vsync) flags.push("--disable-gpu-vsync", "--disable-frame-rate-limit");
  if (args.headless) flags.push("--enable-unsafe-swiftshader");
  const opts = { headless: !!args.headless, args: flags };
  if (args.chrome) return chromium.launch({ ...opts, executablePath: args.chrome });
  try { return await chromium.launch({ ...opts, channel: "chrome" }); } catch { return chromium.launch(opts); }
}

async function runOnce(engine, run, scenarios) {
  const sysBefore = systemMemory();
  const browser = await launch();
  const browserCdp = await browser.newBrowserCDPSession();
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  // タイルの要求（ワーカーからの物も Playwright は page に報告する）
  const tiles = [];
  page.on("requestfinished", async (req) => {
    if (!TILE_RE.test(req.url())) return;
    const t = req.timing();
    let bytes = null;
    try { bytes = (await req.sizes()).responseBodySize; } catch {}
    tiles.push({ url: req.url(), start: t.startTime, durationMs: t.responseEnd, bytes });
  });
  const failed = [];
  // 失敗の理由も残す（net::ERR_ABORTED は視界から外れたタイルをエンジンが取り消した物で、読込の失敗ではない）
  page.on("requestfailed", (req) => TILE_RE.test(req.url()) && failed.push({ url: req.url(), error: req.failure()?.errorText }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // ワーカー内の失敗（例：Navara の Draco 解読）は pageerror に来ず console.error にだけ出るので、それも残す
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 300)));
  page.on("response", (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url().slice(0, 200)}`));

  // メモリを 1 秒ごとに採る
  const mem = [];
  const memTimer = setInterval(async () => { const m = await processMemory(browserCdp); if (m) mem.push({ t: Date.now(), ...m }); }, 1000);

  // 途中で失敗（例：Terria のサーバが落ちて接続拒否）しても、メモリ採取のタイマーとブラウザは必ず止める。
  // 止めないと Node が終了できず、スクリプトが固まって次の計測（--vsync など）が始まらない（2026-10-19 に発生）
  try {
    return await measurePage();
  } finally {
    clearInterval(memTimer);
    await browser.close().catch(() => {});
  }

  async function measurePage() {
  const navStart = Date.now();
  await page.goto(pageUrl(engine), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__bench, null, { timeout: 120_000 });
  const engineInfo = await page.evaluate(async () => {
    await window.__bench.ready;
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return { ...window.__bench.engine, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, userAgent: navigator.userAgent };
  });

  const results = [];
  for (const sc of scenarios) {
    const t0 = Date.now(), tileFrom = sc === "initial" ? 0 : tiles.length; // 初回表示は頁を開いた時からの全部
    const r = await page.evaluate((s) => Promise.race([window.__bench.run(s), new Promise((res) => setTimeout(() => res({ scenario: s, timeout: true }), 180_000))]), sc);
    // 周回・ズームは、開始姿勢で読込が落ち着いた後（カメラが動き出してから）の要求だけを数える
    const ts = tiles.slice(tileFrom).filter((x) => x.start >= (sc === "initial" ? 0 : r.wallStart ?? t0));
    const durs = ts.map((x) => x.durationMs).filter((x) => x >= 0).sort((a, b) => a - b);
    const q = (p) => (durs.length ? durs[Math.min(durs.length - 1, Math.floor(p * durs.length))] : null);
    const memIn = mem.filter((m) => m.t >= (sc === "initial" ? navStart : t0));
    const peak = (k) => (memIn.length ? Math.max(...memIn.map((m) => m[k])) : null);
    r.network = {
      tileRequests: ts.length,
      tileBytes: ts.reduce((s, x) => s + (x.bytes ?? 0), 0),
      tileMedianMs: q(0.5),
      tileP95Ms: q(0.95),
      firstTileMs: sc === "initial" && ts.some((x) => !/tileset\.json/.test(x.url)) ? Math.min(...ts.filter((x) => !/tileset\.json/.test(x.url)).map((x) => x.start + x.durationMs)) - navStart : null,
      lastTileMs: ts.length ? Math.max(...ts.map((x) => x.start + x.durationMs)) - (sc === "initial" ? navStart : t0) : null,
    };
    r.process = { rendererPeakMB: peak("rendererMB"), gpuPeakMB: peak("gpuMB"), totalPeakMB: peak("totalMB") };
    // 絵が出ているかの検査：初回表示の後にスクリーンショットを撮り、一番多い色（＝背景）以外の画素の割合を記す。
    // タイルの要求・取得は数えられても建物が 1 棟も描けていない（Navara の Draco wasm 欠落など）回を、数字だけで通さないため
    if (sc === "initial") {
      // 計測が終わった後なので待っても数字には響かない。ワーカー描画のエンジンは最後の絵が出るまで少し掛かるので、
      // 1 秒待って撮り、まだ背景だけなら 3 秒後にもう一度撮る
      let png, frac = 0;
      for (const wait of [1000, 3000]) {
        await page.waitForTimeout(wait);
        png = await page.screenshot({ type: "png" });
        frac = await drawnFraction(page, png);
        if (frac >= 0.03) break;
      }
      r.drawnFraction = frac;
      r.blank = frac < 0.03;
      writeFileSync(`${OUT}/${engine}-run${run + 1}-initial.png`, png);
    }
    results.push(r);
  }
  const allMemory = await page.evaluate(() => window.__bench.measureAllMemory?.()).catch(() => null);
  clearInterval(memTimer);
  const sysPeak = systemMemory();
  await browser.close();
  return { engine, run, engineInfo, results, allMemoryMB: allMemory, system: { before: sysBefore, end: sysPeak, swapGrewMB: (sysPeak.swapUsedMB ?? 0) - (sysBefore.swapUsedMB ?? 0) }, failedTiles: failed.filter((f) => f.error !== "net::ERR_ABORTED").length, abortedTiles: failed.filter((f) => f.error === "net::ERR_ABORTED").length, failedTileUrls: failed.slice(0, 20), errors: errors.slice(0, 5) };
  }
}

// スクリーンショットのうち、一番多い色（＝背景）以外の画素の割合。頁の中で縮小して数える
async function drawnFraction(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 192; c.height = 108;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const hist = new Map();
    for (let i = 0; i < d.length; i += 4) { const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3); hist.set(k, (hist.get(k) ?? 0) + 1); }
    return 1 - Math.max(...hist.values()) / (d.length / 4);
  }, png.toString("base64"));
}

const median = (xs) => { const s = xs.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(OUT, { recursive: true });
const all = [];
for (const engine of ENGINES) {
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`${engine} #${i + 1}/${RUNS} … `);
    try {
      // シナリオごとにブラウザを開き直す。同じ頁で続けると、前のシナリオで読んだタイルがエンジン内に残る量が
      // エンジンごとに違い（キャッシュ上限の差）、後のシナリオの条件がそろわないため
      const parts = [];
      for (const sc of SCENARIOS) parts.push(await runOnce(engine, i, [sc]));
      const r = {
        ...parts[0],
        results: parts.flatMap((p) => p.results),
        allMemoryMB: parts.map((p) => p.allMemoryMB),
        system: { before: parts[0].system.before, end: parts.at(-1).system.end, swapGrewMB: Math.max(...parts.map((p) => p.system.swapGrewMB)) },
        failedTiles: parts.reduce((a, p) => a + p.failedTiles, 0),
        abortedTiles: parts.reduce((a, p) => a + p.abortedTiles, 0),
        failedTileUrls: parts.flatMap((p) => p.failedTileUrls),
        errors: parts.flatMap((p) => p.errors).slice(0, 5),
      };
      all.push(r);
      if (r.system.swapGrewMB > 50) console.log(`  ⚠ この回でスワップが ${Math.round(r.system.swapGrewMB)} MB 増えました（メモリ不足の影響あり）`);
      const init = r.results.find((x) => x.scenario === "initial");
      if (init?.blank) console.log(`  ⚠ 絵が出ていません（背景以外の画素 ${(init.drawnFraction * 100).toFixed(1)}%）。この回の数字は無効です。console: ${r.errors[0] ?? "なし"}`);
      console.log(r.results.map((x) => `${x.scenario}:${x.timeout ? "timeout" : x.fpsMean ? x.fpsMean.toFixed(1) + "fps" : Math.round(x.settledMs) + "ms"}`).join(" "));
    } catch (e) {
      console.log("失敗", e.message);
      all.push({ engine, run: i, error: e.message });
    }
  }
}

// 中央値の表。settle_after_ms＝周回・ズームでカメラが止まってから読み込みが落ち着くまでの時間（bench.js の settleAfterMs）。
// 動きながら読むエンジンと、止まってから読むエンジン（vsync ありの Cesium 系）を同じ物差しで比べるための列（2026-10-19 Kenji さん裁定）
const rows = [["engine", "version", "scenario", "drawn_fraction", "settled_ms", "settle_after_ms", "first_tile_ms", "fps_mean", "frame_p95_ms", "slow_frame_ratio", "main_thread_fps", "tile_requests", "tile_mb", "tile_median_ms", "tile_p95_ms", "renderer_peak_mb", "gpu_peak_mb", "js_heap_peak_mb", "runs"]];
for (const engine of ENGINES) {
  const ok = all.filter((r) => r.engine === engine && r.results);
  for (const sc of SCENARIOS) {
    // 絵が出なかった回（initial の blank）は、その回の全シナリオを表から外す
    const okDrawn = ok.filter((r) => !r.results.find((x) => x.scenario === "initial")?.blank);
    const rs = okDrawn.map((r) => r.results.find((x) => x.scenario === sc)).filter((x) => x && !x.timeout);
    const m = (f) => median(rs.map(f));
    rows.push([engine, ok[0]?.engineInfo?.version ?? "", sc, median(ok.map((r) => r.results.find((x) => x.scenario === "initial")?.drawnFraction)), m((x) => x.settledMs ?? x.settleAfterMs), m((x) => x.settleAfterMs), m((x) => x.network.firstTileMs), m((x) => x.fpsMean), m((x) => x.frameP95Ms), m((x) => x.slowFrameRatio), m((x) => x.mainThreadFps), m((x) => x.network.tileRequests), m((x) => x.network.tileBytes / 2 ** 20), m((x) => x.network.tileMedianMs), m((x) => x.network.tileP95Ms), m((x) => x.process.rendererPeakMB), m((x) => x.process.gpuPeakMB), m((x) => x.memory?.jsHeapPeakMB), rs.length]);
  }
}
const csv = rows.map((r) => r.map((v) => (typeof v === "number" ? +v.toFixed(2) : v ?? "")).join(",")).join("\n");
const meta = { date: new Date().toISOString(), host: { platform: os.platform(), release: os.release(), cpus: os.cpus()[0]?.model, cores: os.cpus().length, memGB: os.totalmem() / 2 ** 30 }, args: { BASE, TERRIA, QUERY, RUNS, ENGINES, SCENARIOS, W, H, vsync: !!args.vsync, headless: !!args.headless } };
writeFileSync(`${OUT}/${stamp}.json`, JSON.stringify({ meta, runs: all }, null, 1));
writeFileSync(`${OUT}/${stamp}.csv`, csv + "\n");
console.log(`\n${OUT}/${stamp}.json と .csv に書き出しました\n`);
console.log(csv);
