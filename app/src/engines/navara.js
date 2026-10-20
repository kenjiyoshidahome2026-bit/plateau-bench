import ThreeView, { Color } from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { registerEngine } from "../shared/bench.js";
import { TILESET_URL, MAX_SSE, FOV_Y, BACKGROUND, BUILDING_COLOR } from "../shared/scenario.js";

// 参考条件：?navaraSse=1 で、モバイルで LOD を自動で粗くする倍率（既定 8）を 1 に固定する
const SSE_X1 = new URLSearchParams(location.search).get("navaraSse") === "1";
const view = new ThreeView({
  container: document.getElementById("map"),
  shadow: false,
  pixelRatio: 1,
  ...(SSE_X1 && { memoryBudget: { sseMultiplierMin: 1 } }),
  backgroundColor: new Color().setStyle(BACKGROUND),
});
view.addPlugin(new DefaultPlugin());
await view.init();
window.__navara = view; // デバッグ用
view.camera.fov = FOV_Y;
// 光：環境光だけだと面の向きが出ずベタ塗りになる（2026-10-19 Kenji さん指摘）。他エンジン（Cesium の太陽光、deck.gl の既定の
// 平行光、ortho-earth の陰影）に合わせ、太陽光を 1 つ足す。影は無し（ThreeView の shadow:false と同じ条件）、大気の色付けも無し。
// 太陽の向きは日時から決まるので、東京の真昼（太陽時 12 時）に固定して、昼夜で結果が変わらないようにする
view.atmosphere.date = new Date("2026-06-21T03:00:00Z");
view.atmosphere.setSolarTime({ lng: 139.767 }, 12);
view.addLight({ ambient: { intensity: 1.0 } });
view.addLight({ sun: { intensity: 2.0, castShadow: false, applyColor: true } });

let idle = false;
view.on("idle", () => (idle = true));
view.on("move", () => (idle = false));

const src = view.addSource({ type: "3d-tiles", url: TILESET_URL });
view.addLayer({
  type: "3d-tiles",
  source: src,
  model: { color: new Color().setStyle(BUILDING_COLOR), metalness: 0, roughness: 1, maxSse: MAX_SSE },
});

registerEngine({
  name: "navara",
  version: `@navaramap/three ${__NAVARA_VERSION__}${SSE_X1 ? " (sse x1)" : ""}`,
  setPose: (pose) => view.setCamera({ lng: pose.lng, lat: pose.lat, height: pose.h, distance: pose.distance, heading: pose.heading, pitch: pose.pitch, roll: 0 }),
  isIdle: () => idle,
  // タイル読込の数を直接返す API が無いため、エンジンが保持するバッファ数で代用する（建物だけの場面ではほぼタイル数）
  onFrame: (cb) => (view.on("postRender", cb), () => view.off("postRender", cb)),
  loadedCount: () => view.memoryStats()?.bufferCount ?? 0,
  extraStats: () => view.memoryStats() ?? null,
});
