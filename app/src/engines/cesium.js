import "./cesium-base.js";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { registerEngine } from "../shared/bench.js";
import { TILESET_URL, MAX_SSE, FOV_Y, BACKGROUND } from "../shared/scenario.js";

const widget = new Cesium.CesiumWidget("map", {
  baseLayer: false,
  globe: false,
  skyBox: false,
  skyAtmosphere: false,
  useBrowserRecommendedResolution: true, // CSS px で描く＝devicePixelRatio 1 相当
  msaaSamples: 1, // 既定の 4x MSAA を切る（比較条件：MSAA は全エンジンで切る）
});
const scene = widget.scene;
scene.renderError.addEventListener((_, e) => console.error("cesium renderError", e?.stack || e));
scene.backgroundColor = Cesium.Color.fromCssColorString(BACKGROUND);
scene.fog.enabled = false;
if (scene.sun) scene.sun.show = false;
if (scene.moon) scene.moon.show = false;
// 出典表示は記事側で明記する（計測の邪魔にならないよう隠す）
document.head.append(Object.assign(document.createElement("style"), { textContent: ".cesium-widget-credits{display:none!important}" }));

// Cesium の fov は横長画面では横の視野角＝縦 FOV_Y になるよう換算する
function applyFov() {
  const f = scene.camera.frustum, aspect = scene.canvas.clientWidth / scene.canvas.clientHeight;
  const fy = Cesium.Math.toRadians(FOV_Y);
  f.fov = aspect >= 1 ? 2 * Math.atan(Math.tan(fy / 2) * aspect) : fy;
}
applyFov();
window.addEventListener("resize", applyFov);

// 参考条件：?cesiumCull=0 で、動いている間の間引き・後回し（Cesium の既定）を切る
const NO_CULL = new URLSearchParams(location.search).get("cesiumCull") === "0";
const tileset = await Cesium.Cesium3DTileset.fromUrl(TILESET_URL, {
  maximumScreenSpaceError: MAX_SSE,
  ...(NO_CULL && { cullRequestsWhileMoving: false, foveatedScreenSpaceError: false, dynamicScreenSpaceError: false }),
});
scene.primitives.add(tileset);
window.__cesium = { scene, tileset, Cesium, widget }; // デバッグ用
let loaded = 0;
tileset.tileLoad.addEventListener(() => loaded++);

registerEngine({
  name: "cesium",
  version: `cesium ${Cesium.VERSION}${NO_CULL ? " (no-cull)" : ""}`,
  setPose(pose) {
    const target = Cesium.Cartesian3.fromDegrees(pose.lng, pose.lat, pose.h);
    scene.camera.lookAt(target, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(pose.heading), Cesium.Math.toRadians(pose.pitch), pose.distance));
    scene.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  },
  isIdle: () => tileset.tilesLoaded,
  onFrame: (cb) => scene.postRender.addEventListener(cb),
  loadedCount: () => loaded,
  extraStats: () => ({ gpuMemoryMB: tileset.totalMemoryUsageInBytes / 2 ** 20 }),
});
