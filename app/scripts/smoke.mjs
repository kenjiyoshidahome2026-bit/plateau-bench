// 動作確認：各ページを開き、初回表示の計測とスクリーンショットを取る
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://localhost:4173";
const qs = process.argv[3] ?? "";
const engines = (process.argv[4] ?? "maplibre,cesium,ortho-earth,navara").split(",");
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium", args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
for (const e of engines) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on("pageerror", (x) => errs.push("pageerror: " + x.message + " @ " + (x.stack || "").split("\n").slice(1, 3).join(" | ").slice(0, 300)));
  page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));
  page.on("response", (r) => r.status() >= 400 && errs.push("http " + r.status() + " " + r.url().slice(0, 140)));
  page.on("requestfailed", (r) => errs.push("reqfail: " + r.url().slice(0, 120) + " " + r.failure()?.errorText));
  await page.goto(`${base}/${e}.html?${qs}`);
  let res;
  try {
    res = await page.evaluate(async (scs) => { const out = []; for (const s of scs) out.push(await Promise.race([window.__bench.run(s), new Promise((r) => setTimeout(() => r("timeout " + s), 90000))])); return out; }, (process.env.SCENARIOS ?? "initial").split(","));
  } catch (x) { res = "eval error: " + x.message; }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `smoke-${e}.png` });
  console.log("==", e, JSON.stringify(res));
  errs.filter((x) => !/ortho-earth.com|jaxa/.test(x)).slice(0, 10).forEach((x) => console.log("  ", x));
  await page.close();
}
await browser.close();
