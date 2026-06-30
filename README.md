# セキュアOCR（ブラウザ完結版） / kotenocr-web

国立国会図書館の **NDLkotenOCR-Lite**（CC BY 4.0）のOCRエンジンを、**ブラウザ内だけで動く** Web アプリに移植したものです。
onnxruntime-web（WASM）でDEIM（レイアウト検出）＋PARSeq（文字認識・カスケード3モデル）をブラウザ内実行します。

## 特長
- **インストール不要**：URLを開くだけ。exe も Python も不要。
- **画像はPCの外に出ません**：推論はすべてブラウザ内で完結（サーバーに画像を送りません）。
- **PWA**：初回オンライン後はオフラインでも動作（モデルをブラウザにキャッシュ）。
- 本家GUI相当の機能：画像／フォルダ処理・前後ナビ・出力形式選択（XML/JSON/TXT）・可視化画像・Crop&OCR・日本語/English。

## 開発
```bash
npm install
npm run dev      # 開発サーバ
npm run build    # 本番ビルド -> dist/（GitHub Pages 用・PWA あり・base=/kotenocr-web/）
npm run preview  # ビルド物のプレビュー
```
モデルファイル（`public/models/*.onnx`, `charset.json`）は NDLkotenOCR-Lite のリリース由来です。

## 完全オフライン配布（初回からネット不要）

閉域網（LGWAN系）やエアギャップPCで **初回からインターネット無し** に使うための2形態を用意しています。
推論は元々100%クライアント内・外部依存ゼロなので、残る課題は「プログラム本体の配り方」だけです。

| | 形態 | 生成コマンド | 必要なもの | 向き |
|---|---|---|---|---|
| ① | **オフラインHTML版**（no-exe） | `npm run build:html` → `dist-html/` | ブラウザのみ（exe不要） | exe実行が禁止された環境でも**必ず動く**安全策 |
| ② | **デスクトップアプリ**（Tauri / Windows） | CI（`.github/workflows/tauri.yml`）→ `.exe`(NSIS) | 未署名exeを起動できること | 軽快・確実。USB配布→即起動 |

どちらも **OCRコードは共通**で、ビルドモードを出し分けているだけです。

### ① オフラインHTML版（`npm run build:html` → `dist-html/`）
- `vite-plugin-singlefile` で JS/CSS を `index.html` に内包し、`scripts/pack-offline.mjs` がモデル(.onnx 計約150MB)/wasm/charset/サンプルを base64 で `embed/*.js` に埋め込みます（実行時は `fetch` 非依存で読み込むため `file://` 直開きで動く）。
- **配布**：`dist-html/` フォルダごとUSBで配り、`index.html` をダブルクリックするだけ。`SHA256SUMS.txt` で改ざん検知可能。
- **注意点**：
  - 合計 **約235MB**。`file://` 直開きは初回読込が重い（数十秒空白になることあり）。**USBから直接ではなく、いったんローカルディスク（デスクトップ等）にコピーしてから開く**と速い。
  - 動作には **空きメモリ 1〜2GB程度を推奨**（モデル＋wasmをメモリ上に展開するため）。低スペック機では他アプリを閉じてから。
  - `file://` のため「画面からOCR」「出力先フォルダ選択」は自動的に非表示になります（結果はダウンロードで保存）。
  - 巨大な画像（長辺6000px超など高DPIスキャン）は一時的に大きなメモリを使います。重い場合は縮小してから読み込んでください。

### ② デスクトップアプリ（Tauri）
- `src-tauri/` に Tauri v2 構成。`npm run tauri build` で Windows の **NSIS インストーラ(.exe)** を生成します。
- **Windows の .exe は macOS では作れません**（Tauri はホストOS向けのみ）。配布用 exe は **GitHub Actions（windows-latest）が唯一の生成手段**です。手動実行（Actions の workflow_dispatch）またはタグ push（`v*`）でビルドし、成果物（`.exe`/`SHA256SUMS.txt`）を Artifacts／Release から取得します。
- WebView2 は **オフラインインストーラ同梱**（`tauri.conf.json`）。エアギャップでもランタイム導入可能（**x64前提**）。
- **役所PCでの起動可否（重要）**：本アプリは**未署名**です。環境によっては次でブロックされます。
  - **SmartScreen**：「Windows によって PC が保護されました」→ 詳細→実行（評判が無いため警告が出やすい）。
  - **AppLocker / WDAC**：「署名されていない実行ファイルは実行不可」ポリシーだと**起動自体が不可**。この場合は組織のコード署名が現実的（必要なら `bundle.targets` に `"msi"` を足して GPO/Intune/SCCM 管理者配布向け MSI も生成できます）。
  - **USB の MOTW（Mark-of-the-Web）**：右クリック→プロパティ→「ブロックの解除」で警告を抑制。
  - → **exe が弾かれる環境では ①オフラインHTML版が同一PCで動く実証済みフォールバック**になります。
- より確実にしたい場合は、WebView2 を `fixedRuntime`（固定版を同梱・導入工程ゼロ）にしてポータブル配布する選択肢もあります（要：固定版ランタイムの同梱設定）。

## ライセンス / 帰属
- OCRエンジン・モデル：国立国会図書館 NDLkotenOCR-Lite（**CC BY 4.0**）
  https://github.com/ndl-lab/ndlocr-lite
- 本リポジトリは上記の派生物です（CC BY 4.0）。

> 注：出力精度は前処理（リサイズ）忠実度に依存し、本家CLIと完全一致ではありません。完全なXY-cut読み順・PDF入出力・縦中横は今後対応予定。
