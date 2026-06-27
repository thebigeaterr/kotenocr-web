# 古典籍OCR（ブラウザ完結版） / kotenocr-web

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
npm run build    # 本番ビルド -> dist/
npm run preview  # ビルド物のプレビュー
```
モデルファイル（`public/models/*.onnx`, `charset.json`）は NDLkotenOCR-Lite のリリース由来です。

## ライセンス / 帰属
- OCRエンジン・モデル：国立国会図書館 NDLkotenOCR-Lite（**CC BY 4.0**）
  https://github.com/ndl-lab/ndlocr-lite
- 本リポジトリは上記の派生物です（CC BY 4.0）。

> 注：出力精度は前処理（リサイズ）忠実度に依存し、本家CLIと完全一致ではありません。完全なXY-cut読み順・PDF入出力・縦中横は今後対応予定。
