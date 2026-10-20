# plateau-bench

PLATEAU 千代田区 LOD2 建物（3D Tiles）を、5 つのブラウザ地図エンジンで同じ条件・同じカメラ経路のもとに表示し、描画性能を比べるための一式です。誰でも同じ手順で測り直せるように、計測のページ・計測スクリプト・計測した生データをすべて置いています。

*A benchmark that shows the PLATEAU Chiyoda LOD2 buildings (3D Tiles) in five browser map engines under the same conditions and camera paths. Pages, measurement scripts and the raw results are all here so anyone can re-run it. Docs are in Japanese; commands and code read as they are.*

| エンジン | 版 | 3D Tiles の読み方 |
|---|---|---|
| MapLibre GL JS ＋ deck.gl | maplibre-gl 6.15.0・deck.gl 9.4.0 | deck.gl の `Tile3DLayer` を重ねる |
| CesiumJS | cesium 1.146.0 | `Cesium3DTileset` |
| TerriaJS | terriajs 8.13.0（TerriaMap） | init ファイルの `3d-tiles` |
| Navara | @navaramap/three 0.2.1 | 3D Tiles ソース |
| ortho-earth | @ortho-earth/globe 2.0.2 | `map.add3DTiles` |

## 何を測るか

画面 1920×1080・devicePixelRatio 1・縦の視野角 45°・MSAA なし・背景は単色で、建物だけを描きます。LOD の細かさ（screen space error）は全エンジンで 16 にそろえています。

1. **初回表示**：東京駅上空・高度 1,500 m・俯角 60° の固定視点で、頁を開いてから読み込みと描画が落ち着くまでの時間
2. **周回**：東京駅を中心に半径 1 km・高度 500 m で 30 秒 1 周。fps・フレーム時間の p95・止まってから描き終わるまでの時間
3. **ズーム**：高度 10 km から 300 m まで 20 秒で降下。同上

ほかに、取得したタイルの数・量・時間、JS ヒープ、レンダラー／GPU プロセスのメモリ、スワップの増え方、初回表示のスクリーンショット（絵が出ていない回は自動で無効にする）を記録します。条件の詳細は [conditions.md](conditions.md)。

## 測り方

```bash
cd app
npm ci
npm run build
npm run preview &                                   # http://localhost:4173
npm run measure -- --runs 5 --vsync                 # Mac の Chrome（垂直同期あり）
npm run serve -- --runs 5 --terria http://<Mac の IP>:3002   # iPhone の Safari（Mac が中継する）
```

手順の全部と、実際の計測で起きた落とし穴（2 画面の Mac・iPhone のスリープ・別の端末の結果が混ざる など）は [RUN.md](RUN.md) にあります。TerriaJS の用意は [terria/README.md](terria/README.md)。

## 結果

2026-10-19〜20 に M1 Mac mini（16 GB）と iPhone 16 Pro で測った生データ（JSON・CSV・スクリーンショット）を [results/](results/README.md) に置いています。iPhone の集計は `node scripts/summarize-iphone.mjs <json>` で、記事の表と同じ除外の決まりのまま再現できます。

## ライセンス

このリポジトリのコードは MIT です。各エンジンとデータは、それぞれのライセンスに従います（PLATEAU のデータは国土交通省の利用規約）。

筆者は ortho-earth の作者です。どのエンジンも既定の設定を使い、外した既定は conditions.md と RUN.md に書き出しています。条件の偏りに気づいたら Issue で教えてください。
