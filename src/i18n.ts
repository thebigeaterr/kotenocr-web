// 本家 ndlocr-lite-gui/uicomponent/localelabel.py のラベルに準拠
export type Lang = 'ja' | 'en'

export const T = {
  appTitle: { ja: 'NDLOCR-Lite-GUI', en: 'NDLOCR-Lite-GUI' },
  brand: { ja: '古典籍OCR', en: 'Koten OCR' },
  tagline: { ja: 'ブラウザ完結・インストール不要', en: 'Runs in your browser — no install' },
  explain: {
    ja: '処理対象と出力先を選択して「OCR」ボタンを押してください',
    en: 'Please select target images and output folder, then press OCR',
  },
  captureMode: { ja: '画面からOCR', en: 'OCR from Screen' },
  processImage: { ja: '画像ファイルを処理する', en: 'Process an Image' },
  processFolder: { ja: 'フォルダ内の画像を処理する', en: 'Process Images in a Folder' },
  selectOutput: { ja: '出力先を選択する', en: 'Select Output Directory' },
  target: { ja: '処理対象：', en: 'Target Path:' },
  output: { ja: '出力先：', en: 'Output Path:' },
  outputDownload: { ja: '（ブラウザのダウンロード）', en: '(Browser downloads)' },
  ocr: { ja: 'OCR', en: 'OCR' },
  cropOcr: { ja: '範囲を選んでOCR', en: 'Select area & OCR' },
  stopOcr: { ja: 'OCRを中断', en: 'Stop OCR' },
  cancelRequested: {
    ja: '中断を要求しました。現在の処理が終わり次第停止します……',
    en: 'Stop requested. OCR will stop after the current operation……',
  },
  saveViz: { ja: '認識箇所の可視化画像を保存する', en: 'Save Visualization Results' },
  outputFormat: { ja: '出力形式の選択', en: 'Custom Setting' },
  preview: { ja: '処理結果プレビュー', en: 'Preview of Result' },
  prev: { ja: '前の画像', en: 'Prev Image' },
  next: { ja: '次の画像', en: 'Next Image' },
  settingTitle: { ja: '設定', en: 'Setting' },
  settingExplain: { ja: '出力形式を選択してください', en: 'Please select output format' },
  close: { ja: '閉じる', en: 'Close' },
  cropHint: { ja: 'プレビュー上をドラッグして範囲を選択', en: 'Drag on the preview to select a region' },
  resultTitle: { ja: 'OCR結果', en: 'OCR Result' },
  ready: { ja: '準備完了', en: 'Ready' },
  loading: { ja: 'モデル読込中', en: 'Loading models' },
  loadingNote: { ja: '初回のみモデル(約180MB)を読み込みます', en: 'Models (~180MB) load only on first use' },
  copy: { ja: 'コピー', en: 'Copy' },
  noTarget: { ja: '処理対象を選択してください', en: 'Select target image(s) first' },
  done: { ja: '完了', en: 'Done' },
  privacy: {
    ja: '処理はすべてブラウザ内で完結します（画像はPCの外に出ません）',
    en: 'Everything runs in your browser (images never leave your PC)',
  },
  engine: {
    ja: '国立国会図書館 NDLkotenOCR-Lite (CC BY 4.0) をベースに、ブラウザ向けに再構築しています',
    en: 'Rebuilt for the browser, based on NDLkotenOCR-Lite by the National Diet Library (CC BY 4.0)',
  },
} as const

export type TKey = keyof typeof T
export function tr(k: TKey, lang: Lang): string { return T[k][lang] }
