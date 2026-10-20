# TerriaJS（TerriaMap）の計測ページ

TerriaMap（コミット `6e6de6ed4133e401901ed3cb9c3fc68d4123d66c`、terriajs 8.13.0・terriajs-cesium 26.0.0＝Cesium 1.142.0 相当）に計測用の口を足した物です。3D Tiles は Terria の init ファイルで読ませ、カメラの操作と計測だけを `bench/terria-adapter.js` が行います。

## 作り方

```bash
git clone https://github.com/TerriaJS/TerriaMap.git && cd TerriaMap
git checkout 6e6de6ed4133e401901ed3cb9c3fc68d4123d66c
git apply ../terriamap.diff                      # window.viewState の公開と adapter の script タグ
cp ../init/*.json wwwroot/init/
mkdir -p wwwroot/bench && cp ../bench/terria-adapter.js ../../app/src/shared/{bench.js,scenario.js} wwwroot/bench/
yarn install && yarn gulp release
yarn start --port 3002                           # http://localhost:3002/#bench
```

- `#bench`＝PLATEAU 千代田区 LOD2、`#bench-test`＝合成テストデータ（`app/scripts/make-test-tiles.py` の出力を `wwwroot/testtiles/` に置く）。
- `?run=initial,orbit,zoom` を付けると他のエンジンと同じく計測結果を画面に出します。

## 他のエンジンとそろえるために変えた点

- 地球の面・大気・空・霧を切り、単色背景で建物だけを描く。背景地図は空の composite にする。
- maximumScreenSpaceError を 16 に固定（init ファイルの trait では受け付けないため adapter で設定）。
- Terria の描画一時停止（CesiumRenderLoopPauser）は地球の面のタイルしか見ないため、地球を消すと 3D Tiles の読込中に描画が止まる。読込中と、カメラを動かす時に `notifyRepaintRequired()` を呼んで起こしている（利用者がマウスで操作した時と同じ動き）。
- Terria の UI（左のパネルなど）はそのまま表示している。
