// 共通のシナリオ定義。カメラは「注視点＋距離」の形で持つ：
// { lng, lat, distance(m), heading(度・北から時計回り), pitch(度・Cesium と同じく -90＝真下) }
// h＝注視点の楕円体高（m・既定 0）。

// 動作確認用の上書き：?tileset=<URL>&target=lng,lat,h&scale=<距離の倍率>
const q = new URLSearchParams(globalThis.location?.search ?? "");

export const TILESET_URL =
  (q.get("tileset") && new URL(q.get("tileset"), globalThis.location.href).href) ??
  "https://assets.cms.plateau.reearth.io/assets/db/070026-aa27-431b-8d53-7cc6b03244f8/13101_chiyoda-ku_pref_2023_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2_no_texture/tileset.json";

export const MAX_SSE = 16; // LOD の細かさ（screen space error, px）
export const FOV_Y = 45; // 縦の視野角（度）
export const BACKGROUND = "#dfe4ea";
export const BUILDING_COLOR = "#f4f4f4";

const [tLng, tLat, tH] = (q.get("target") ?? "139.7671,35.6812,0").split(",").map(Number);
const TOKYO_STATION = { lng: tLng, lat: tLat, h: tH || 0 };
const SCALE = Number(q.get("scale") ?? 1);

// 高度 h・俯角 p の視点 → 注視点までの距離
const distFor = (height, pitchDeg) => (SCALE * height) / Math.sin((-pitchDeg * Math.PI) / 180);

export const INITIAL_POSE = { ...TOKYO_STATION, distance: distFor(1500, -60), heading: 0, pitch: -60 };

export const SCENARIOS = {
  // 1. 初回表示：固定視点で読込完了を待つ（カメラは動かさない）
  initial: { duration: 0, pose: () => INITIAL_POSE },
  // 2. 周回：半径 1 km・高度 500 m で 30 秒 1 周
  orbit: {
    duration: 30_000,
    pose: (t) => ({
      ...TOKYO_STATION,
      distance: SCALE * Math.hypot(1000, 500),
      heading: 360 * t,
      pitch: -(Math.atan2(500, 1000) * 180) / Math.PI,
    }),
  },
  // 3. ズーム：高度 10 km → 300 m を 20 秒（距離は対数で補間）
  zoom: {
    duration: 20_000,
    pose: (t) => {
      const d0 = distFor(10_000, -60), d1 = distFor(300, -60);
      return { ...TOKYO_STATION, distance: d0 * Math.pow(d1 / d0, t), heading: 0, pitch: -60 };
    },
  },
};

// 注視点の形 → カメラ位置（経緯度・高度）。数 km の範囲なので局所平面で近似する。
export function cameraPosition(pose) {
  const p = (-pose.pitch * Math.PI) / 180, h = (pose.heading * Math.PI) / 180;
  const ground = pose.distance * Math.cos(p);
  const north = -ground * Math.cos(h), east = -ground * Math.sin(h);
  const mPerDegLat = 111_320, mPerDegLng = 111_320 * Math.cos((pose.lat * Math.PI) / 180);
  return { lng: pose.lng + east / mPerDegLng, lat: pose.lat + north / mPerDegLat, alt: pose.h + pose.distance * Math.sin(p) };
}
