// オフラインHTML版のパッケージング
// `OFFLINE_HTML=1 vite build`（→ dist-html/, singlefile で JS/CSS は index.html に内包済み）の後段。
//   1. モデル/charset/wasm を base64 化して embed/*.js に出力（self.__OCR_EMBED__ に投入）
//   2. サンプル画像を data URL で埋め込む（__OCR_SAMPLES__）
//   3. 起動中ローディング表示＋embedの読込 <script> を <body> 直後に差し込む（appより先に実行＝classic）
//   4. 冗長ファイル（dist-html/models, 別ファイルのwasm 等）を削除
// 生成された dist-html/ フォルダ一式が「USBで配って file:// で開くだけ」のオフライン版。
//
// 重要: wasm は **Vite が dist-html に実際に出力した .wasm** を埋め込む（バンドルが参照するものと必ず一致させる）。
// node_modules から名前推測で拾うと、将来 onnxruntime-web の既定 wasm 変種が変わったとき
// file:// で InferenceSession.create が無言失敗し、ネット非接続では発見が遅れるため。
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'dist-html')
const embedDir = join(out, 'embed')
const indexHtml = join(out, 'index.html')

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

if (!existsSync(indexHtml)) fail('dist-html/index.html が無い。先に `OFFLINE_HTML=1 vite build` が必要。')

// Vite が dist-html 配下に emit した wasm を再帰的に探す（バンドル参照と同一実体＝単一情報源）
function findEmittedWasm(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { const r = findEmittedWasm(p); if (r) return r }
    else if (n.endsWith('.wasm')) return p
  }
  return null
}
const emittedWasm = findEmittedWasm(out)
if (!emittedWasm) fail('dist-html 内に Vite が出力した .wasm が見つからない（ビルドが不完全）。')

const sources = {
  charset: join(root, 'public', 'models', 'charset.json'),
  deim: join(root, 'public', 'models', 'deim.onnx'),
  parseq30: join(root, 'public', 'models', 'parseq30.onnx'),
  parseq50: join(root, 'public', 'models', 'parseq50.onnx'),
  parseq100: join(root, 'public', 'models', 'parseq100.onnx'),
  wasm: emittedWasm,
}

mkdirSync(embedDir, { recursive: true })
const scriptTags = []
let totalB64 = 0
for (const [key, file] of Object.entries(sources)) {
  if (!existsSync(file)) fail(`見つからない: ${file}`)
  const data = readFileSync(file)
  if (data.length === 0) fail(`空ファイル: ${file}`) // 破損インストール検知
  const b64 = data.toString('base64')
  totalB64 += b64.length
  // 文字列リテラルに base64（特殊文字なし）。self.__OCR_EMBED__ へ投入。
  writeFileSync(join(embedDir, `${key}.js`), `(self.__OCR_EMBED__=self.__OCR_EMBED__||{}).${key}=${JSON.stringify(b64)};\n`)
  scriptTags.push(`<script src="./embed/${key}.js"></script>`)
  console.log(`  embed/${key}.js  (${(b64.length / 1048576).toFixed(1)} MB base64)`)
}

// サンプル画像は data URL で埋め込む（file:// では相対fetch不可・<img>→canvas転写はtaintで toBlob 不可）
const sampleFiles = {
  'sample_yoko.png': join(root, 'public', 'samples', 'sample_yoko.png'),
  'sample_tate.png': join(root, 'public', 'samples', 'sample_tate.png'),
}
const sampleMap = {}
for (const [name, file] of Object.entries(sampleFiles)) {
  if (existsSync(file)) sampleMap[name] = 'data:image/png;base64,' + readFileSync(file).toString('base64')
}
writeFileSync(join(embedDir, 'samples.js'), `self.__OCR_SAMPLES__=${JSON.stringify(sampleMap)};\n`)
scriptTags.push('<script src="./embed/samples.js"></script>')
console.log(`  embed/samples.js  (${Object.keys(sampleMap).length} 枚)`)

// 起動中ローディング表示: 埋め込み(計約234MB)は parser-blocking で読込中は画面が空白になり、
// USB直開きでは数十秒の無反応＝故障と誤認されがち。最初に出る静的メッセージで安心させる。
// (#boot は main.tsx がマウント後に除去する)
const boot = `<div id="boot" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-family:system-ui,'Hiragino Kaku Gothic ProN',sans-serif;color:#444;background:#fff;text-align:center;line-height:1.8;z-index:9999">
<div>📦 オフラインOCRを起動中…<br><small style="color:#888">初回の読み込みに数十秒かかる場合があります（USBから直接開いた場合は特に）。<br>遅いときは、フォルダごとPCのデスクトップにコピーしてから開いてください。</small></div>
</div>`

// index.html に [ローディング → embed読込] を <body> 直後に差し込む（app(deferred module)より先に実行）。
// 冪等化: 既に注入済み(./embed/ を含む)なら二重注入しない。
let html = readFileSync(indexHtml, 'utf8')
if (html.includes('./embed/')) {
  console.log('  (index.html は注入済み → スキップ)')
} else {
  const inject = `\n${boot}\n${scriptTags.join('\n')}\n`
  html = /<body[^>]*>/.test(html) ? html.replace(/(<body[^>]*>)/, `$1${inject}`) : inject + html
  writeFileSync(indexHtml, html)
}

// 冗長ファイルを削除（モデルは埋め込み済み・wasmは別ファイル不要）
function rmWasm(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) rmWasm(p)
    else if (n.endsWith('.wasm')) { rmSync(p); console.log(`  rm ${p.replace(out + '/', '')}`) }
  }
}
const modelsDir = join(out, 'models')
if (existsSync(modelsDir)) { rmSync(modelsDir, { recursive: true, force: true }); console.log('  rm models/') }
rmWasm(out)

// 整合性マニフェスト: USB配送途中の改ざん検知用に dist-html 配下の SHA-256 を出力。
function sha256(p) { return createHash('sha256').update(readFileSync(p)).digest('hex') }
function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (n !== 'SHA256SUMS.txt') acc.push(p)
  }
  return acc
}
const sums = walk(out).sort().map((p) => `${sha256(p)}  ${p.replace(out + '/', '')}`).join('\n') + '\n'
writeFileSync(join(out, 'SHA256SUMS.txt'), sums)
console.log('  SHA256SUMS.txt 生成（改ざん検知用）')

// 結果サイズ
function dirSize(dir) {
  let s = 0
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    s += statSync(p).isDirectory() ? dirSize(p) : statSync(p).size
  }
  return s
}
console.log(`\n✓ オフラインHTML版を生成: dist-html/`)
console.log(`  合計サイズ: ${(dirSize(out) / 1048576).toFixed(0)} MB（うち埋め込みbase64 ${(totalB64 / 1048576).toFixed(0)} MB）`)
console.log(`  → このフォルダごとUSBで配り、index.html をダブルクリックで開けばオフライン動作。`)
