// iPhone の結果（serve.mjs の results/iphone-*.json）を、記事の表と同じ除外の決まりで中央値にする。
//
//   node scripts/summarize-iphone.mjs results/iphone16pro/main/iphone-2026-10-20T01-48-07-884Z.json
//
// 除外の決まり（2026-10-20 の計測で決めた物。除いた回は件数とともに表示する）
//   1. User-Agent に iPhone を含まない回（同じ URL を別の端末で開いた結果が混ざった）
//   2. 初回表示で settledMs が無い回（読込完了に届く前に頁が裏に回った＝スリープなど）
//   3. 周回・ズームで fpsMean が 20 未満の回（計測中に Safari が裏に回った）
// 中央値は measure.mjs と同じ：小さい順に並べて (n-1)/2 番目
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("使い方: node scripts/summarize-iphone.mjs <iphone-*.json>"); process.exit(1); }
const data = JSON.parse(readFileSync(file, "utf8"));

const median = (xs) => { const s = xs.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const groups = new Map(), dropped = [];
for (const r of data.results) {
  const engine = r.engine?.version ?? r.engine?.name ?? "?";
  if (!/iPhone/.test(r.userAgent ?? "")) { dropped.push(`${engine}: iPhone 以外の端末 (${(r.userAgent ?? "").slice(0, 40)}…)`); continue; }
  for (const x of r.results ?? []) {
    if (x.scenario === "initial" && x.settledMs == null) { dropped.push(`${engine} initial: 読込完了に届かず`); continue; }
    if (x.scenario !== "initial" && typeof x.fpsMean === "number" && x.fpsMean < 20) { dropped.push(`${engine} ${x.scenario}: ${x.fpsMean.toFixed(1)} fps（裏に回った）`); continue; }
    const k = `${engine}\t${x.scenario}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
}

const f = (v, d = 0) => (v == null ? "" : v.toFixed(d));
console.log("| engine | scenario | n | settled ms | settle after ms | fps | p95 ms | main fps | tiles | tile MB | tile median ms |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const [k, xs] of groups) {
  const [engine, sc] = k.split("\t"), m = (fn) => median(xs.map(fn));
  console.log(`| ${engine} | ${sc} | ${xs.length} | ${f(m((x) => x.settledMs))} | ${f(m((x) => x.settleAfterMs))} | ${f(m((x) => x.fpsMean), 1)} | ${f(m((x) => x.frameP95Ms), 1)} | ${f(m((x) => x.mainThreadFps), 1)} | ${f(m((x) => x.serverTiles?.requests))} | ${f(m((x) => (x.serverTiles?.bytes ?? NaN) / 2 ** 20))} | ${f(m((x) => x.serverTiles?.medianMs))} |`);
}
if (dropped.length) { console.log(`\n除いた回（${dropped.length}）`); for (const d of dropped) console.log(`- ${d}`); }
