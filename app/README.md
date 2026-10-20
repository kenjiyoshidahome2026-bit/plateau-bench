# PLATEAU 描画ベンチマーク

PLATEAU 千代田区 LOD2 建物（3D Tiles）を、MapLibre GL JS（+ deck.gl）・CesiumJS・ortho-earth・Navara で同じカメラ経路のもとに表示し、描画性能を比べるためのページ一式です。比較条件は `../conditions.md` を参照してください。

## 使い方

```bash
npm install
npm run build
npm run preview          # http://localhost:4173/
```

- `index.html` から各エンジンのページを開けます。
- `?run=initial,orbit,zoom` を付けると、その場で計測して結果（JSON）を画面に出します（スマホでの手動計測用）。
- 計測スクリプトからは `window.__bench.run("initial" | "orbit" | "zoom")` を呼びます。

### 動作確認用の上書き

PLATEAU に繋がらない環境向けに、`?tileset=<URL>&target=lng,lat,h&scale=<距離の倍率>` で読み込むデータと注視点を差し替えられます。

```bash
python3 scripts/make-test-tiles.py public/testtiles   # 東京駅周辺に箱を並べた合成 3D Tiles
# → /cesium.html?tileset=/testtiles/tileset.json
CHROME=/path/to/chrome node scripts/smoke.mjs http://localhost:4173 "tileset=/testtiles/tileset.json"
```

## 構成

| ファイル | 役割 |
|---|---|
| `src/shared/scenario.js` | データの URL、LOD（maxSSE 16）、視野角（縦 45°）、3つのシナリオのカメラ経路 |
| `src/shared/bench.js` | 計測の口（FPS・フレーム時間・読込完了・JS ヒープ）。各エンジンのページが `registerEngine()` で登録する |
| `src/engines/*.js` | エンジンごとのページ。背景地図・地形・大気・影は切り、建物だけを描く |
| `scripts/smoke.mjs` | ヘッドレス Chromium で各ページを開き、計測とスクリーンショットを取る動作確認 |

## エンジンごとの注意

- **MapLibre + deck.gl**：deck.gl 9.4 のインターリーブ描画は MapLibre 6 の transform に未対応のため、重ね描き（`interleaved: false`）で使っています。deck.gl の `Tile3DLayer` は glTF の頂点色を使いません。
- **ortho-earth**：`@ortho-earth/globe` 2.0.2（2026-10-19 公開）。2.0.1 は `@loaders.gl` 4.5.x と組むとワーカー内で `Image is not defined` になり b3dm を描けなかったため 4.4.3 に固定していましたが、2.0.2 で直ったので固定を外し、他エンジンと同じ loaders.gl 4.5.4 で動かしています。あわせて世界図の余分な取得と起動時の描き直し（約470回→約115回）も 2.0.2 で直っています。
- **Navara**：`@navaramap/three` 0.2.1。Navara のワーカーは Draco の wasm を「自分と同じ場所」（`new URL(..., self.location.href)`）から読むため、vite の build が `dist/assets` に写しません。写さないまま計測すると、タイルの取得は数えられるのに建物が 1 棟も描けず（console に `expected magic word 00 61 73 6d`）、空の画面の数字が出ます。`vite.config.js` の `copyNavaraWasm` で build 後に写しています（v3 で修正。v2 以前の Navara の数字は無効）。b3dm の RTC の中心は glTF の `CESIUM_RTC` 拡張からだけ読み、feature table の `RTC_CENTER` は読みません（`crates/navara_cesium3dtiles/src/b3dm/parser.rs`）。`@navaramap/font` が three 0.185.1 を固定しているため、three も 0.185.1 にそろえています。
- **タイルの取得時間・転送量**：ワーカーで取得するエンジン（ortho-earth など）は頁の Resource Timing に出ないため、本計測では計測スクリプト側（DevTools Protocol）で測ります。
- **絵が出ているかの検査**：`measure.mjs` は初回表示の後にスクリーンショットを撮り、背景以外の画素の割合（`drawn_fraction`）を記録します。3% 未満の回は「絵が出ていない」として警告し、表から外します。画像は `results/<engine>-run<N>-initial.png` に残ります。
