// TerriaJS（TerriaMap）用の計測アダプタ。index.ejs から module として読む。
// 3D Tiles は init ファイル（init/bench.json など）で Terria に読ませ、ここではカメラの操作と読込の監視だけを行う。
import { registerEngine } from "./bench.js";
import { MAX_SSE, FOV_Y, BACKGROUND } from "./scenario.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findScene() {
  for (;;) {
    const scene = window.viewState?.terria?.cesium?.scene;
    if (scene) return scene;
    await sleep(100);
  }
}

// Terria が scene.primitives に足した Cesium3DTileset を探す（入れ子の PrimitiveCollection も見る）
function findTileset(coll) {
  for (let i = 0; i < coll.length; i++) {
    const p = coll.get(i);
    if (p && p.tileLoad && "tilesLoaded" in p) return p;
    if (p && typeof p.get === "function" && typeof p.length === "number") {
      const t = findTileset(p);
      if (t) return t;
    }
  }
  return null;
}

const scene = await findScene();
// 他のエンジンと条件をそろえる：地球の面・大気・空・霧を切り、単色背景で建物だけを描く
scene.globe.show = false;
if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
if (scene.skyBox) scene.skyBox.show = false;
if (scene.sun) scene.sun.show = false;
if (scene.moon) scene.moon.show = false;
scene.fog.enabled = false;
scene.backgroundColor = scene.backgroundColor.constructor.fromCssColorString(BACKGROUND);
let tileset = null;
while (!(tileset = findTileset(scene.primitives))) await sleep(100);
// Terria は画質の設定から SSE を計算し直すことがあるため、毎フレーム 16 に戻す
tileset.maximumScreenSpaceError = MAX_SSE;
scene.preRender.addEventListener(() => { if (tileset.maximumScreenSpaceError !== MAX_SSE) tileset.maximumScreenSpaceError = MAX_SSE; });
// Terria の描画の一時停止（CesiumRenderLoopPauser）は地球の面のタイルしか見ないため、地球を消すと
// 3D Tiles の読込中でも描画が止まり、読込が進まなくなる。読込が終わるまで描画を起こし続ける（ベンチ側の回避策）
const cesium = window.viewState.terria.cesium;
// Terria は CesiumWidget を targetFrameRate: 30・shadows: true で作る（lib/Models/Cesium.ts）。
// 他のエンジンと同じく上限なし・影なしで測るため外す。既定の 30fps 上限は記事に注記する
cesium.cesiumWidget.targetFrameRate = undefined;
scene.shadowMap.enabled = false;
scene.msaaSamples = 1; // 既定の 4x MSAA を切る（比較条件：MSAA は全エンジンで切る）
setInterval(() => { if (!tileset.tilesLoaded) cesium.notifyRepaintRequired(); }, 100);
let loaded = 0;
tileset.tileLoad.addEventListener(() => loaded++);

const camera = scene.camera;
const Cartesian3 = camera.position.constructor;
const IDENTITY = camera.transform.constructor.IDENTITY;
const toRad = (d) => (d * Math.PI) / 180;

function applyFov() {
  const f = camera.frustum, aspect = scene.canvas.clientWidth / scene.canvas.clientHeight;
  const fy = toRad(FOV_Y);
  f.fov = aspect >= 1 ? 2 * Math.atan(Math.tan(fy / 2) * aspect) : fy;
}
applyFov();
window.addEventListener("resize", applyFov);

registerEngine({
  name: "terriajs",
  version: "terriajs 8.13.0 (terriajs-cesium 26.0.0)",
  setPose(pose) {
    // プログラムからのカメラ操作は Terria の描画一時停止を解かないため、利用者の操作と同じく起こす
    cesium.notifyRepaintRequired();
    const target = Cartesian3.fromDegrees(pose.lng, pose.lat, pose.h);
    // HeadingPitchRange はプロパティを見るだけなので素の object で渡せる
    camera.lookAt(target, { heading: toRad(pose.heading), pitch: toRad(pose.pitch), range: pose.distance });
    camera.lookAtTransform(IDENTITY);
  },
  isIdle: () => tileset.tilesLoaded,
  onFrame: (cb) => scene.postRender.addEventListener(cb),
  loadedCount: () => loaded,
  extraStats: () => ({ gpuMemoryMB: tileset.totalMemoryUsageInBytes / 2 ** 20, maxSSE: tileset.maximumScreenSpaceError }),
});
