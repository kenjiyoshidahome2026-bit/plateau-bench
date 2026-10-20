// 各エンジンのページが共通で使う計測の口。
// ページは registerEngine({ name, version, setPose, isIdle, loadedCount, onFrame, extraStats? }) を呼ぶ。
// onFrame(cb) はエンジンが 1 フレーム描くたびに cb を呼び、解除関数を返す。FPS はこれで数える
// （描画をワーカーで行うエンジンもあるため、頁の requestAnimationFrame の間隔では測れない）。
// 計測スクリプト（ステップ3）は window.__bench を使う。?run=orbit などで手動実行もできる。
import { SCENARIOS, INITIAL_POSE } from "./scenario.js";

const T0 = performance.now();
const TILE_RE = /\.(b3dm|glb|gltf|i3dm|cmpt|pnts|subtree)(\?|$)|tileset\.json/;

const tileEntries = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (TILE_RE.test(e.name)) tileEntries.push(e);
}).observe({ type: "resource", buffered: true });

const memSamples = [];
setInterval(() => {
  if (performance.memory) memSamples.push({ t: performance.now() - T0, used: performance.memory.usedJSHeapSize });
}, 1000);

let engine = null;
let readyResolve;
const ready = new Promise((r) => (readyResolve = r));

export function registerEngine(e) {
  engine = e;
  engine.setPose(INITIAL_POSE);
  readyResolve();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const pct = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// 読込完了＝エンジンが idle と言い、かつ読み込んだタイル数が quietMs の間増えなかった時点。
// タイルの取得はワーカーで行うエンジンが多く、頁の Resource Timing には出ないため、数はエンジンに聞く
async function waitSettled({ quietMs = 1000, timeoutMs = 60_000, needTile = false } = {}) {
  const start = performance.now();
  let lastCount = engine.loadedCount(), lastChange = start;
  for (;;) {
    const now = performance.now(), c = engine.loadedCount();
    if (c !== lastCount) { lastCount = c; lastChange = now; }
    const ok = engine.isIdle() && now - lastChange >= quietMs && (!needTile || c > 0);
    if (ok) return lastChange; // 最後に数が増えた時刻を完了時刻とみなす
    if (now - start > timeoutMs) return null;
    await sleep(100);
  }
}

function tileSummary(fromTime) {
  const es = tileEntries.filter((e) => e.startTime >= fromTime);
  const durs = es.map((e) => e.duration);
  return {
    requests: es.length,
    transferBytes: es.reduce((s, e) => s + (e.transferSize || 0), 0), // 別オリジンは Timing-Allow-Origin が無いと 0
    durationMedianMs: pct(durs, 0.5),
    durationP95Ms: pct(durs, 0.95),
  };
}

function memSummary(fromTime) {
  const ms = memSamples.filter((m) => m.t + T0 >= fromTime).map((m) => m.used);
  return { jsHeapPeakMB: ms.length ? Math.max(...ms) / 2 ** 20 : null, jsHeapEndMB: ms.length ? ms[ms.length - 1] / 2 ** 20 : null };
}

async function runInitial() {
  await ready;
  const wallStart = Date.now();
  const done = await waitSettled({ needTile: true });
  const first = tileEntries.find((e) => !/tileset\.json/.test(e.name));
  return {
    scenario: "initial",
    wallStart,
    wallEnd: Date.now(),
    firstTileMs: first ? first.responseEnd : null, // 頁から取った場合だけ（ワーカー取得は計測スクリプト側で測る）
    settledMs: done,
    tiles: tileSummary(0),
    memory: memSummary(0),
    extra: engine.extraStats?.() ?? null,
  };
}

async function runMoving(name) {
  await ready;
  const sc = SCENARIOS[name];
  engine.setPose(sc.pose(0));
  await waitSettled();
  const wallStart = Date.now();
  const engineFrames = [];
  const off = engine.onFrame(() => engineFrames.push(performance.now()));
  const start = performance.now();
  const rafFrames = [];
  let prev = start;
  for (;;) {
    await nextFrame();
    const now = performance.now();
    rafFrames.push(now - prev);
    prev = now;
    const t = Math.min(1, (now - start) / sc.duration);
    engine.setPose(sc.pose(t));
    if (t >= 1) break;
  }
  off();
  const settled = await waitSettled();
  const intervals = engineFrames.slice(1).map((t, i) => t - engineFrames[i]);
  const span = engineFrames.length > 1 ? engineFrames[engineFrames.length - 1] - engineFrames[0] : NaN;
  const rafTotal = rafFrames.reduce((a, b) => a + b, 0);
  return {
    scenario: name,
    wallStart,
    wallEnd: Date.now(),
    frames: engineFrames.length,
    fpsMean: ((engineFrames.length - 1) / span) * 1000,
    frameP95Ms: pct(intervals, 0.95),
    slowFrameRatio: intervals.length ? intervals.filter((f) => f > 33.4).length / intervals.length : null,
    mainThreadFps: (rafFrames.length / rafTotal) * 1000, // 頁の応答性の目安（描画の速さではない）
    settleAfterMs: settled == null ? null : settled - (start + sc.duration),
    tiles: tileSummary(start),
    memory: memSummary(start),
    extra: engine.extraStats?.() ?? null,
  };
}

async function measureAllMemory() {
  // ワーカーも含めた量。cross-origin isolated の頁でだけ使える
  if (!self.crossOriginIsolated || !performance.measureUserAgentSpecificMemory) return null;
  const r = await performance.measureUserAgentSpecificMemory();
  return r.bytes / 2 ** 20;
}

window.__bench = {
  ready,
  get engine() { return engine && { name: engine.name, version: engine.version }; },
  run: (name) => (name === "initial" ? runInitial() : runMoving(name)),
  measureAllMemory,
  setPose: (p) => engine.setPose(p),
};

// 手動実行：?run=initial,orbit,zoom
// &report=<URL> を付けると結果をそこへ POST し、返ってきた next の頁へ進む（iPhone 用・scripts/serve.mjs）
const params = new URLSearchParams(location.search);
const runs = params.get("run");
if (runs) {
  (async () => {
    const out = [];
    for (const n of runs.split(",")) out.push(await window.__bench.run(n));
    const payload = { engine: window.__bench.engine, userAgent: navigator.userAgent, step: params.get("step"), results: out };
    const pre = document.createElement("pre");
    pre.id = "bench-result";
    pre.style.cssText = "position:fixed;left:8px;top:8px;max-height:90vh;overflow:auto;background:#fffd;font:12px monospace;padding:8px;z-index:9999";
    pre.textContent = JSON.stringify(payload, null, 2);
    document.body.append(pre);
    console.log("bench-result", pre.textContent);
    const report = params.get("report");
    if (report) {
      const r = await fetch(report, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then((x) => x.json());
      if (r.next) setTimeout(() => location.assign(r.next), 3000); // 端末を少し休ませてから次へ
    }
  })();
}
