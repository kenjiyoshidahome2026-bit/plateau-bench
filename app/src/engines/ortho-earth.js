import { createGlobe } from "@ortho-earth/globe";
import { registerEngine } from "../shared/bench.js";
import { TILESET_URL, MAX_SSE, FOV_Y, BACKGROUND, BUILDING_COLOR, INITIAL_POSE } from "../shared/scenario.js";

// MSAA は全エンジンで切る（比較条件）。ortho-earth の既定は「動いている間は 1x・止まると 4x」だが、
// 下の pinRes は常時 4x にしてしまうため、?msaa=0 で常時 1x に固定する（起動時に URL から読まれる）
{
  const u = new URL(location.href);
  if (!u.searchParams.has("msaa")) { u.searchParams.set("msaa", "0"); history.replaceState(null, "", u); }
}

const cssRGB01 = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// 比較のため、ortho-earth 自前の基図・地形・PLATEAU 建物・空などは全部切って 3D Tiles だけを描く
const map = await createGlobe({
  target: "#map",
  region: null,
  terrain: false,
  mesh: false,
  coastline: false,
  night: false,
  stars: false,
  sky: false,
  worldContent: false,
  worldLines: false,
  worldFill: false, // 2.0.2〜：世界帯の湖・海面下の陸を読まない（それ以前の版は無視する）
  chips: false,
  instruments: false,
  countryTip: false,
  urlHash: false,
  persistView: false,
  keyboard: false,
  clearColor: BACKGROUND,
  // 見た目を他エンジンと揃える（2026-10-19 Kenji さん「ortho は白っぽい」）：
  //  - 地面：基図の style が無いと球面を白（0.96）で塗るので、背景色 1 枚だけの style を渡して地面＝背景色にする（MapLibre 頁と同じ色）
  //  - 霧：遠景を白く霞ませる大気の霧を切る（Cesium 頁の scene.fog.enabled=false と同じ条件）
  //  - 建物色：ortho-earth は b3dm の材質を読まずテーマの建物色（既定 0.83 の灰）で塗るので、他エンジンと同じ #f4f4f4 にする
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": BACKGROUND } }] },
  fog: false,
  theme: { bldColor: cssRGB01(BUILDING_COLOR) },
  maxPitch: 89,
  debugGlobals: true,
});
map.setVerticalFieldOfView(FOV_Y);
// 動的解像度（重いと描画解像度を最大 0.55 倍まで落とす）を切り、他のエンジンと同じく常に 1920×1080 で描かせる
map.pinRes?.(true);

// 参考条件：?maxInflight=N で 3D Tiles の同時取得数を指定する（既定は低メモリ端末 3・他 6。iOS は低メモリ扱い）。
// @ortho-earth/globe の add3DTiles の maxInflight を使う＝2.0.2 より後の版で効く（2.0.2 では無視される）
const MAX_INFLIGHT = Number(new URLSearchParams(location.search).get("maxInflight")) || undefined;
const tiles = await map.add3DTiles(TILESET_URL, { maxSSE: MAX_SSE, fit: false, ...(MAX_INFLIGHT && { maxInflight: MAX_INFLIGHT }) });

// ワーカーは、頁から新しいカメラが届く前に同じカメラの絵を描き直すことがある（フェード・品質フレームなど）。
// カメラが変わった絵だけを 1 フレームとして数え、描いた総数は extraStats に別に残す
let workerFrames = 0, distinctFrames = 0;
function onDistinctWorkerFrame(cb) {
  let last = "";
  return window.__onWorkerFrame((cam) => {
    workerFrames++;
    const key = cam ? `${cam.center}|${cam.zoom}|${cam.pitch}|${cam.bearing}|${cam.centerAlt}` : String(workerFrames);
    if (key === last) return;
    last = key;
    distinctFrames++;
    cb();
  });
}

const toOrtho = (p) => ({ lng: p.lng, lat: p.lat, height: p.h, distance: p.distance, heading: p.heading, pitch: p.pitch, roll: 0 });

registerEngine({
  name: "ortho-earth",
  version: `@ortho-earth/globe ${__ORTHO_VERSION__}${MAX_INFLIGHT ? ` (maxInflight ${MAX_INFLIGHT})` : ""}`,
  setPose: (pose) => map.setCamera(toOrtho(pose)),
  // 地図の idle イベントは基図の都合でカメラを動かした後に来ないことがあるため、3D Tiles の取得中の数だけで見る
  isIdle: () => tiles.stats.inflight === 0,
  // ワーカーが実際に描いたフレームを数える（debugGlobals で生える口。main の onFrame は 1〜2 フレーム先行する）
  onFrame: (cb) => (window.__onWorkerFrame ? onDistinctWorkerFrame(cb) : map.onFrame(cb)),
  loadedCount: () => tiles.stats.loaded,
  extraStats: () => ({ ...tiles.stats, backend: map.capabilities?.()?.backend, workerFrames, distinctFrames }),
});
map.setCamera(toOrtho(INITIAL_POSE));
