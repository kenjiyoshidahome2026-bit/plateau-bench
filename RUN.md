# 計測の手順（Mac ＋ iPhone）

## 0. 準備（最初の 1 回）

- Node.js 22 以上と Google Chrome を入れておく。
- `plateau-bench.zip` を展開し、中の `app/` で依存を入れてビルドする。

```bash
cd app
npm ci              # 同梱の package-lock.json どおりに入れる（v3 から。v2 以前は npx npm@10 ci）
npm run build
```

- v3（`@ortho-earth/globe` 2.0.2）からは `overrides` が無いので、ふつうの `npm ci` で入る。v2 以前（2.0.1 + loaders.gl 4.4.3 固定）を組み直すときだけ npm 10 の `ci`（`npx npm@10 ci`）が要る。

- TerriaJS も測る場合は `terria/README.md` の手順で TerriaMap を作り、別のターミナルで `yarn start --port 3002` を動かしておく。yarn が無ければ `npx -y yarn@1.22.22` で代わりになる。Node が 22.19 より古いと依存の 1 つ（undici）が入らないので、Node を上げるか `yarn install --frozen-lockfile --ignore-engines` で入れる。

## 1. 計測の前に

- ほかのアプリは閉じる（メモリが足りずスワップが起きると、FPS も読み込み時間も悪く出る）。スクリプトはスワップが 50 MB 以上増えた回に ⚠ を出し、結果の JSON にも記録する。
- 電源につなぎ、省エネ設定でディスプレイがスリープしないようにする。
- 計測中は Chrome の窓を前面に出したまま、マウスやキーボードに触らない。

## 2. Mac（Chrome）で測る

```bash
cd app
npm run preview &                                  # http://localhost:4173
npm run measure -- --runs 5                        # 5 エンジン × 5 回 × 3 シナリオ
```

- 結果は `results/<日時>.json`（全回の生データ）と `results/<日時>.csv`（中央値の表）に出る。
- TerriaJS を外す時は `--engines maplibre,cesium,ortho-earth,navara`。
- FPS は垂直同期を切って上限なしで測る。画面のリフレッシュレートに合わせた値が欲しい時は `--vsync` を付ける。
- 1 回分の目安：初回表示の待ち（最大 60 秒）＋周回 30 秒＋ズーム 20 秒、それにブラウザの起動と終了。

## 3. iPhone（Safari）で測る

Mac と iPhone を同じ Wi-Fi につなぐ。

```bash
cd app
npm run serve -- --runs 5 --terria http://<Mac の IP>:3002   # 起動時に開く URL が表示される
```

- iPhone の Safari で表示された `http://<Mac の IP>:4173/__start` を開くと、全エンジンを順に計測し、1 つ終わるごとに自動で次へ進む。画面はスリープしないように「設定 > 画面表示と明るさ > 自動ロック」を「なし」にしておく。
- 結果は Mac の `results/iphone-<日時>.json` と `.csv` に出る。
- iPhone では Safari に JS ヒープを測る API が無いため、メモリは測れない。タイルの指標は Mac のサーバーが中継して記録した値（Mac ⇔ PLATEAU の時間を含む）。


## 4. 参考条件（各エンジンの既定の「手抜き」を外して測る）

各エンジンは既定のまま測るのが本番です。既定の振る舞いが結果を大きく動かしていると分かった 3 つは、URL の引数で外して測り比べられます。

| 引数 | エンジン | 外す物 |
|---|---|---|
| `cesiumCull=0` | CesiumJS | カメラが動いている間のタイル要求の間引き・画面の端の後回し・遠くの細部の省略（`cullRequestsWhileMoving`・`foveatedScreenSpaceError`・`dynamicScreenSpaceError`） |
| `navaraSse=1` | Navara | モバイルで LOD を自動で 8 倍粗くする倍率（`memoryBudget.sseMultiplierMin`）を 1 に |
| `maxInflight=6` | ortho-earth | 3D Tiles の同時取得数（iOS は低メモリ扱いで 3）を指定。`@ortho-earth/globe` 2.1.0 から効く（2.0.2 では無視される） |

```bash
npm run measure -- --runs 5 --vsync --engines cesium --query "cesiumCull=0" --out results-cesium-nocull
npm run serve -- --runs 5 --engines navara --query "navaraSse=1"      # iPhone
```

外したかどうかは、結果の `engine.version` に `(no-cull)`・`(sse x1)`・`(maxInflight 6)` と出ます。

## 5. 落とし穴（2026-10-20 の計測で実際に起きたこと）

- **ディスプレイが 2 台ある Mac。** Chrome はウィンドウが載っているディスプレイのリフレッシュレートに合わせて描きます。`measure.mjs` は `--window-position=0,0` で主ディスプレイに開きますが、主ディスプレイ自体が 30 Hz（4K・5K を HDMI でつないだ時など）だと、垂直同期ありの fps は 30 で頭打ちになります。システム設定 → ディスプレイ で 60 Hz にしてから測ってください。
- **垂直同期なしの CesiumJS（と TerriaJS）。** 描画ループに上限がないとタイル要求が後回しになり、初回表示が 2 倍近く遅く、回ごとにばらつきます。記事の主表は垂直同期ありの条件で取っています。
- **iPhone のスリープ。** 自動ロックで画面が消えると Safari のページが止まり、戻った時に読み直されます。「設定 > 画面表示と明るさ > 自動ロック」を「なし」に、低電力モードはオフに（オンだと自動ロックが 30 秒に固定される）。計測中は設定アプリも開かないでください。その間の回は数字が乱れます。
- **同じ URL を別の端末で開く。** `serve.mjs` は最初に結果を送った端末に固定し、別の端末の結果は断ります（`⚠ 別の端末からの結果を断りました`）。Safari のタブは 1 つにしてください。途中で `/__start` を開き直しても続きから測ります。最初からやり直すときは `/__start?reset=1`。
- **iPhone の結果の除外。** スリープなどで乱れた回は `node scripts/summarize-iphone.mjs <json>` が決まった規則で除き、除いた回を一覧にします。
- **Mac と iPhone のタイル時間は測り方が違う。** Mac は DevTools Protocol でブラウザの中から、iPhone は Mac を中継してサーバー側で測ります（Wi-Fi を 2 回通る）。エンジン同士の比較には使えますが、Mac と iPhone の値を直接比べないでください。
