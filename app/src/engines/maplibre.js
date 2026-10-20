import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { Tile3DLayer } from "@deck.gl/geo-layers";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";
import { registerEngine } from "../shared/bench.js";
import { TILESET_URL, MAX_SSE, FOV_Y, BACKGROUND, cameraPosition } from "../shared/scenario.js";

maplibregl.setWorkerUrl(workerUrl); // バンドル後は import.meta.url から辿れないので明示する

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": BACKGROUND } }] },
  center: [139.7671, 35.6812],
  zoom: 15,
  maxPitch: 85,
  pixelRatio: 1,
  attributionControl: false,
});
map.setVerticalFieldOfView(FOV_Y);

let tileset = null;
// 建物は deck.gl の canvas が描くので、FPS は MapLibre の render ではなく deck.gl が描いたフレームで数える
const deckFrameFns = new Set();
const overlay = new MapboxOverlay({
  // deck.gl 9.4 のインターリーブ描画は MapLibre 6 の transform に未対応のため、重ね描き（別 canvas・同じカメラ）にする
  interleaved: false,
  useDevicePixels: false,
  deviceProps: { webgl: { antialias: false } }, // MSAA は全エンジンで切る（比較条件）
  onAfterRender: () => { for (const fn of deckFrameFns) fn(); },
  layers: [
    new Tile3DLayer({
      id: "plateau",
      data: TILESET_URL,
      loader: Tiles3DLoader,
      loadOptions: { tileset: { maximumScreenSpaceError: MAX_SSE } },
      _lighting: "pbr",
      onTilesetLoad: (t) => (tileset = t),
    }),
  ],
});
map.addControl(overlay);

map.once("load", () => {
  registerEngine({
    name: "maplibre+deck.gl",
    version: `maplibre-gl ${maplibregl.getVersion()}`,
    setPose(pose) {
      const c = cameraPosition(pose);
      map.jumpTo(map.calculateCameraOptionsFromTo([c.lng, c.lat], c.alt, [pose.lng, pose.lat], pose.h));
    },
    // tileset.isLoaded()＝今の視点で要るタイルが揃った
    isIdle: () => !!tileset && tileset.isLoaded() && map.loaded(),
    onFrame: (cb) => (deckFrameFns.add(cb), () => deckFrameFns.delete(cb)),
    loadedCount: () => tileset?.stats?.get("Tiles Loaded")?.count ?? 0,
    extraStats: () => tileset && { tilesLoaded: tileset.stats?.get("Tiles Loaded")?.count, gpuMemoryMB: tileset.gpuMemoryUsageInBytes / 2 ** 20 },
  });
});
