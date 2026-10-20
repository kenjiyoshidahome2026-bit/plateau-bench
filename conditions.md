# 描画性能ベンチマーク 比較条件

記事「PLATEAU 3D 都市モデルの描画性能比較：MapLibre・Cesium・TerriaJS・Navara・ortho-earth」のための計測条件です。

## 1. 対象エンジン

| エンジン | 入手先 | PLATEAU 3D Tiles の読み方 |
|---|---|---|
| MapLibre GL JS | npm `maplibre-gl` 6.15.0 ＋ deck.gl 9.4.0 | 3D Tiles を直接読めないため deck.gl `Tile3DLayer` で重ねる（筆者の判断）。deck.gl 9.4 のインターリーブ描画は MapLibre 6 に未対応のため重ね描き（`interleaved: false`） |
| TerriaJS | TerriaMap（terriajs 8.13.0・terriajs-cesium 26.0.0＝Cesium 1.142.0 相当） | init ファイルの `3d-tiles` 項目で読む。中身は Cesium の別版なので、Cesium との差はフレームワークの上乗せ分として読む。手順は [terria/](terria/README.md) |
| CesiumJS | npm `cesium` 1.146.0 | `Cesium3DTileset` で直接読む |
| ortho-earth | github.com/kenjiyoshidahome2026-bit/ortho-earth（npm `@ortho-earth/globe` 2.0.2） | `map.add3DTiles` で直接読む。PLATEAU は `packages/jp/assets/plateau-sets.json` で使用実績あり。2.0.1 までは `@loaders.gl` 4.5.x と組むと b3dm を描けず 4.4.3 に固定していたが、2.0.2（#494〜#496：loaders.gl 4.5 対応・世界図の余分な取得・起動時の描き直し）で固定を外し、4.5.4 で動かす |
| Navara | github.com/maplibre/navara（npm `@navaramap/three` 0.2.1） | 宣言的 API の 3D Tiles ソースで直接読む。サンプルに千代田区 LOD2 の使用例あり。b3dm の RTC 中心は glTF の `CESIUM_RTC` 拡張だけを読む。v2 以前のベンチでは Draco の wasm がビルドに写らず建物を描けていなかった（数字は無効）。v3 で修正 |

バージョンは上の表のとおり固定しました（`app/package-lock.json`）。実装は [app/](app/README.md) にあります。

## 2. データ

- **主データ**：PLATEAU 千代田区 建築物 LOD2（テクスチャなし）3D Tiles
  - `https://assets.cms.plateau.reearth.io/assets/db/070026-aa27-431b-8d53-7cc6b03244f8/13101_chiyoda-ku_pref_2023_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2_no_texture/tileset.json`
  - Navara のサンプル（`web/navara_three/example/helpers/constants.ts:303`）と同じ URL。ortho-earth が普段使う `api.plateauview.mlit.go.jp/datacatalog/3dtiles/13101-bldg-lod2-notexture-latest/` とは配信元が違う（今回の計測は全エンジンで上の URL を使う）。
- 全エンジンが **同じ tileset.json を同じオリジンから** 読む。
- 背景地図・地形・大気・影・ポストエフェクト・MSAA（アンチエイリアス）はすべて無効にし、単色背景で建物だけを描く（エンジン間の機能差を計測に混ぜないため）。
- LOD の細かさ（screen space error 相当）は全エンジンで同等に揃え、設定値を記事に載せる。既定値は Cesium の 16 に合わせる。
- 既定と変えた点（2026-10-19 の1回目の計測を受けて）：
  - MSAA：Cesium・TerriaJS は既定 4x → 1x（`msaaSamples: 1`）。deck.gl は `antialias: false`。ortho-earth は `?msaa=0`。MapLibre・Navara は既定でオフ。
  - TerriaJS：既定の `targetFrameRate: 30`（描画を 30fps に抑える）と影を外す。既定の上限は記事に注記する。
  - ortho-earth：重い時に描画解像度を 0.55 倍まで落とす動的解像度を `pinRes(true)` で固定（常に 1920×1080 で描く）。

## 3. シナリオ（カメラ経路）

画面サイズ 1920×1080、devicePixelRatio 1、縦の視野角 45° に固定（エンジンごとの既定の視野角の差でタイル数が変わらないように）。

1. **初回表示**：東京駅丸の内側上空、高度約 1,500 m・俯角 60°・北向きの固定視点でページを開く。
2. **周回**：東京駅を中心に半径約 1 km、高度 500 m で 30 秒かけて 1 周する。
3. **ズーム**：高度 10 km から 300 m まで 20 秒かけて降下する。

カメラは「注視点・距離・方位・俯角」の形で `app/src/shared/scenario.js` に定義し、各エンジンのカメラ API に変換して毎フレーム設定する。合成テストデータで、Cesium・ortho-earth・Navara の画角が一致することを確認済み。

## 4. 指標と測り方

| 指標 | 測り方 | 記事に載せる値 |
|---|---|---|
| FPS | 各エンジンが実際に描いたフレームを、エンジンの描画イベントで数える（シナリオ2・3）。MapLibre は建物を描く deck.gl の `onAfterRender`。ortho-earth は描画がワーカーなので、頁の `requestAnimationFrame` では測れない。ワーカーは同じカメラの絵を描き直すことがあるため、カメラが変わった絵だけを数える。頁の rAF の速さは「応答性」として別に載せる | 平均 FPS、フレーム時間 p95、33 ms 超のフレーム割合 |
| 初回表示までの時間 | ナビゲーション開始から、初期視点のタイルがすべて読み込まれるまで（エンジンが取得中のタイル無しと答え、読み込んだタイル数が 1 秒増えなかった時点） | 最初に建物が見えた時刻と、読込完了時刻 |
| メモリ使用量 | 1 秒ごとの JS ヒープに加え、ワーカー込みの量を `performance.measureUserAgentSpecificMemory()` で取る（ortho-earth・Navara・Cesium は描画やデコードをワーカーで行うため、メインスレッドだけでは不公平） | 最大値と終了時の値。GPU メモリは横並びで測れないため対象外と明記 |
| タイル読み込み速度 | DevTools Protocol の Network イベントでタイル要求を記録（ワーカーからの取得は頁の Resource Timing に出ないため） | 要求数、総転送量、1 タイルあたりの所要時間（中央値・p95）、初期視点の全タイル取得までの時間 |

- ブラウザキャッシュ無効（コールドスタート）で各エンジン **5 回ずつ** 計測し、中央値を採用。
- シナリオごとにブラウザを開き直す。同じ頁で続けると、前のシナリオのタイルがエンジン内に残る量がエンジンごとに違い（1回目の計測でズーム中のタイル要求が Cesium・ortho-earth だけ 0 件だった）、条件がそろわないため。周回・ズームのタイル指標は、開始姿勢で読込が落ち着いた後の要求だけを数える。
- タイル要求の失敗は理由も残し、エンジンによる取り消し（`net::ERR_ABORTED`）は失敗に数えない。
- 通信制限なしを基本とし、余力があれば「Fast 4G」相当の制限ありも追加する。

## 5. 計測環境

- **デスクトップ**：Chrome 最新版、実 GPU を持つ PC。機種・GPU・OS を記事に明記。
- **スマホ**：中位クラスの Android 端末の Chrome（USB 接続で同じスクリプトを実行）。
- クラウドのコンテナ（GPU なし）では FPS が意味を持たないため、本計測は実機で行う。コンテナでは動作確認と計測スクリプトの開発だけを行う。

## 6. 未決事項

- **ortho-earth の余分な通信**：2.0.1 までは、世界基図用の湖データ・`below_sea_land`・AW3D30 の索引を、設定で切っても読み込んでいた。2.0.2 で直った（切った物は取りに行かない）。タイルの指標は 3D Tiles の URL だけを数えている。
- **ネットワーク**：このクラウド環境からは `assets.cms.plateau.reearth.io` と `api.plateauview.mlit.go.jp` への接続が拒否される。コンテナで動作確認するには許可ドメインへの追加が必要。
