# 結果（2026-10-19〜20）

| フォルダ | 端末・条件 | 中身 |
|---|---|---|
| `m1-mac-mini/vsync60/` | M1 Mac mini 16 GB・Chrome・垂直同期あり・ディスプレイ 60 Hz | **記事の主表**。4 エンジン（00-28-43）と TerriaJS（01-10-06）を別々に測った。各 5 回 |
| `m1-mac-mini/novsync/` | 同・垂直同期なし（上限なしの fps） | 4 エンジン（23-12-57）と TerriaJS（01-02-05） |
| `m1-mac-mini/vsync30-reference/` | 同・垂直同期あり・ディスプレイ 30 Hz | 参考。fps は 30 で頭打ち（主ディスプレイが 30 Hz だった時の計測） |
| `m1-mac-mini/cesium-nocull-vsync60/` | 主表と同じ条件の CesiumJS・間引きを外した版（`cesiumCull=0` に当たる） | 参考 |
| `m1-mac-mini/cesium-novsync-recheck/` | 垂直同期なしの CesiumJS・初回表示だけ 3 回 | 初回表示の遅さとばらつきの再現 |
| `iphone16pro/main/` | iPhone 16 Pro・iOS 18.7・Safari 26.6.1・Mac mini が中継 | **iPhone の主表**。5 エンジン × 3 シナリオ × 5 回（途中で 1 巡やり直したので一部 6 回） |
| `iphone16pro/navara-sse1/` | 同・Navara の倍率 1（`navaraSse=1` に当たる） | 参考 |
| `iphone16pro/ortho-earth-maxinflight6/` | 同・ortho-earth の同時取得数 6（`maxInflight=6` に当たる） | 参考。計測時は globe 2.0.2 の該当行を書き換えた版で測った（版の表示は `(inflight 6)`） |

- JSON は全回の生データ、CSV はその中央値です。`*-runN-initial.png` は初回表示のスクリーンショット。
- iPhone の主表の CSV は除外前の集計です。記事の数字は `node scripts/summarize-iphone.mjs iphone16pro/main/*.json` の出力（スリープで乱れた 2 回を除いた物）です。
- 計測した日の回線は家庭の Wi-Fi です。初回表示とタイルの時間は回線に左右されます。
