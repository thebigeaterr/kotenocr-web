// NDL古典籍OCR ブラウザ移植 — 推論パイプライン
// 元実装: ndl-lab/ndlocr-lite (src/deim.py, src/parseq.py, src/ocr.py) を忠実に移植
// DEIM(レイアウト検出) -> 行抽出 -> 読み順 -> PARSeq カスケード(30/50/100字) 文字認識

import type * as Ort from 'onnxruntime-web'
import { bilinearResize, bicubicResize, rotate90ccw, type Img } from './resize'

// ndl.yaml のクラス定義 (index -> name)
export const CLASS_NAMES = [
  'text_block', 'line_main', 'line_caption', 'line_ad', 'line_note',
  'line_note_tochu', 'block_fig', 'block_ad', 'block_pillar', 'block_folio',
  'block_rubi', 'block_chart', 'block_eqn', 'block_cfm', 'block_eng',
  'block_table', 'line_title',
]
// XML TYPE 用の日本語名 (本家 ndl_parser のカテゴリ表記に準拠)
export const CLASS_TYPE_JA: Record<string, string> = {
  line_main: '本文', line_caption: 'キャプション', line_ad: '広告文字',
  line_note: '注', line_note_tochu: '割注', line_title: '標題',
}

const DEIM_INPUT = 800
const DEIM_CONF_THRESHOLD = 0.25
const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD = [0.229, 0.224, 0.225]
const PARSEQ_H = 24
// カスケードモデル: key=最大字数, 入力幅
const REC_MODELS = [
  { key: 30, file: 'parseq30.onnx', width: 256 },
  { key: 50, file: 'parseq50.onnx', width: 384 },
  { key: 100, file: 'parseq100.onnx', width: 768 },
] as const

export interface LineBox {
  x1: number; y1: number; x2: number; y2: number
  classIndex: number; className: string; conf: number; charCount: number; vertical: boolean
}
export interface OcrLine { box: LineBox; text: string }
export interface OcrResult {
  text: string
  lines: OcrLine[]
  vertical: boolean
  width: number
  height: number
  ms: number
}
export type Progress = (p: { stage: string; done?: number; total?: number; message?: string }) => void

function newCanvas(w: number, h: number): OffscreenCanvas { return new OffscreenCanvas(w, h) }

export class Pipeline {
  private ort: typeof Ort
  private base: string
  private deim!: Ort.InferenceSession
  private rec = new Map<number, Ort.InferenceSession>()
  private recWidth = new Map<number, number>()
  private charset: string[] = []
  private cascade = true

  constructor(ort: typeof Ort, base: string) { this.ort = ort; this.base = base }

  setCascade(on: boolean) { this.cascade = on }

  async load(onProgress: Progress) {
    onProgress({ stage: 'charset', message: '文字セット読込中' })
    const csJson = await (await fetch(this.base + 'models/charset.json')).json()
    this.charset = Array.from(csJson.charset as string)
    if (this.charset.length !== 7141) throw new Error(`charset length ${this.charset.length} != 7141`)

    const opts: Ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
    onProgress({ stage: 'model', message: 'レイアウトモデル読込中 (DEIM)' })
    this.deim = await this.ort.InferenceSession.create(this.base + 'models/deim.onnx', opts)
    for (const m of REC_MODELS) {
      onProgress({ stage: 'model', message: `文字認識モデル読込中 (${m.key}字)` })
      this.rec.set(m.key, await this.ort.InferenceSession.create(this.base + 'models/' + m.file, opts))
      this.recWidth.set(m.key, m.width)
    }
  }

  // ---------- DEIM レイアウト検出 ----------
  private async detect(bmp: ImageBitmap): Promise<LineBox[]> {
    const W = bmp.width, H = bmp.height
    const maxWH = Math.max(W, H)

    // 本家 deim.py: 正方(黒)パディング後 PIL bicubic で 800x800 に縮小
    const sq = newCanvas(maxWH, maxWH)
    const sctx = sq.getContext('2d')!
    sctx.fillStyle = 'black'; sctx.fillRect(0, 0, maxWH, maxWH)
    sctx.drawImage(bmp, 0, 0)
    const sqData = sctx.getImageData(0, 0, maxWH, maxWH)
    const id = bicubicResize({ data: sqData.data, width: maxWH, height: maxWH }, DEIM_INPUT, DEIM_INPUT).data

    const n = DEIM_INPUT * DEIM_INPUT
    const input = new Float32Array(3 * n)
    for (let i = 0; i < n; i++) {
      const r = id[i * 4] / 255, g = id[i * 4 + 1] / 255, b = id[i * 4 + 2] / 255
      input[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0]
      input[n + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1]
      input[2 * n + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2]
    }
    const inNames = this.deim.inputNames
    const feeds: Record<string, Ort.Tensor> = {}
    feeds[inNames[0]] = new this.ort.Tensor('float32', input, [1, 3, DEIM_INPUT, DEIM_INPUT])
    feeds[inNames[1]] = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(DEIM_INPUT), BigInt(DEIM_INPUT)]), [1, 2])

    const out = await this.deim.run(feeds)
    const on = this.deim.outputNames
    const labels = toNum(out[on[0]].data)
    const boxes = toNum(out[on[1]].data)
    const scores = toNum(out[on[2]].data)
    const charCounts = on.length >= 4 ? toNum(out[on[3]].data) : null

    const scale = maxWH / DEIM_INPUT
    const dets: LineBox[] = []
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] <= DEIM_CONF_THRESHOLD) continue
      // 本家 deim.py は (boxes*scale).astype(int32) ＝ ゼロ方向への切り捨て
      let x1 = Math.trunc(boxes[i * 4] * scale), y1 = Math.trunc(boxes[i * 4 + 1] * scale)
      let x2 = Math.trunc(boxes[i * 4 + 2] * scale), y2 = Math.trunc(boxes[i * 4 + 3] * scale)
      x1 = clamp(x1, 0, maxWH); x2 = clamp(x2, 0, maxWH); y1 = clamp(y1, 0, maxWH); y2 = clamp(y2, 0, maxWH)
      if (x2 - x1 < 1 || y2 - y1 < 1) continue
      const classIndex = Math.round(labels[i]) - 1
      const className = CLASS_NAMES[classIndex] ?? `cls${classIndex}`
      dets.push({
        x1, y1, x2, y2, classIndex, className, conf: scores[i],
        charCount: charCounts ? charCounts[i] : 100,
        vertical: (y2 - y1) > (x2 - x1),
      })
    }
    let lines = dets.filter(d => d.className.startsWith('line'))
    if (lines.length === 0) lines = dets
    return dedupe(lines, 0.6)
  }

  // ---------- 簡易読み順 (完全XY-cutはP2) ----------
  private order(lines: LineBox[]): { ordered: LineBox[]; vertical: boolean } {
    if (lines.length <= 1) return { ordered: lines, vertical: lines[0]?.vertical ?? true }
    const vertical = lines.filter(l => l.vertical).length / lines.length > 0.5
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
    const it = lines.map(l => ({ l, cx: (l.x1 + l.x2) / 2, cy: (l.y1 + l.y2) / 2, w: l.x2 - l.x1, h: l.y2 - l.y1 }))
    const ordered: LineBox[] = []
    if (vertical) {
      const tol = Math.max(8, med(it.map(i => i.w)) * 0.6)
      const cols: (typeof it)[] = []
      for (const x of [...it].sort((a, b) => b.cx - a.cx)) {
        const col = cols.find(c => Math.abs(c[0].cx - x.cx) <= tol)
        if (col) col.push(x); else cols.push([x])
      }
      for (const col of cols) { col.sort((a, b) => a.cy - b.cy); for (const x of col) ordered.push(x.l) }
    } else {
      const tol = Math.max(6, med(it.map(i => i.h)) * 0.6)
      const rows: (typeof it)[] = []
      for (const y of [...it].sort((a, b) => a.cy - b.cy)) {
        const row = rows.find(r => Math.abs(r[0].cy - y.cy) <= tol)
        if (row) row.push(y); else rows.push([y])
      }
      for (const row of rows) { row.sort((a, b) => a.cx - b.cx); for (const y of row) ordered.push(y.l) }
    }
    return { ordered, vertical }
  }

  // ---------- PARSeq (単一モデル) ----------
  private async recOne(key: number, bmp: ImageBitmap, box: LineBox): Promise<string> {
    const session = this.rec.get(key)!
    const W = this.recWidth.get(key)!
    const w = box.x2 - box.x1, h = box.y2 - box.y1
    if (w < 1 || h < 1) return ''
    // 本家 parseq.py: ネイティブ解像度でクロップ -> (縦長なら90°CCW回転) -> cv2 bilinear で (W,24)
    const cc = newCanvas(w, h)
    const cctx = cc.getContext('2d')!
    cctx.drawImage(bmp, box.x1, box.y1, w, h, 0, 0, w, h)
    let crop: Img = { data: cctx.getImageData(0, 0, w, h).data, width: w, height: h }
    if (h > w) crop = rotate90ccw(crop)
    const id = bilinearResize(crop, W, PARSEQ_H).data

    const n = W * PARSEQ_H
    const input = new Float32Array(3 * n)
    for (let i = 0; i < n; i++) {
      input[i] = id[i * 4 + 2] / 127.5 - 1.0       // B
      input[n + i] = id[i * 4 + 1] / 127.5 - 1.0   // G
      input[2 * n + i] = id[i * 4] / 127.5 - 1.0   // R
    }
    const feeds: Record<string, Ort.Tensor> = {}
    feeds[session.inputNames[0]] = new this.ort.Tensor('float32', input, [1, 3, PARSEQ_H, W])
    const out = await session.run(feeds)
    const logits = out[session.outputNames[0]]
    const data = toNum(logits.data)
    const dims = logits.dims as number[]
    const seq = dims[1], vocab = dims[2]
    let text = ''
    for (let t = 0; t < seq; t++) {
      let best = 0, bestVal = -Infinity, off = t * vocab
      for (let v = 0; v < vocab; v++) { const val = data[off + v]; if (val > bestVal) { bestVal = val; best = v } }
      if (best === 0) break
      text += this.charset[best - 1] ?? ''
    }
    return text
  }

  // 元 process_cascade のルーティング/エスカレーションを行単位で再現
  private async recognize(bmp: ImageBitmap, box: LineBox): Promise<string> {
    if (!this.cascade) return this.recOne(100, bmp, box)
    const cnt = Math.round(box.charCount)
    let start: number = cnt === 3 ? 30 : cnt === 2 ? 50 : 100
    if (start === 30) { const r = await this.recOne(30, bmp, box); if (r.length < 25) return r; start = 50 }
    if (start === 50) { const r = await this.recOne(50, bmp, box); if (r.length < 45) return r; start = 100 }
    return this.recOne(100, bmp, box)
  }

  async run(bmp: ImageBitmap, onProgress: Progress): Promise<OcrResult> {
    const t0 = (globalThis.performance?.now?.() ?? 0)
    onProgress({ stage: 'detect', message: 'レイアウト検出中' })
    const lines = await this.detect(bmp)
    const { ordered, vertical } = this.order(lines)
    const results: OcrLine[] = []
    for (let i = 0; i < ordered.length; i++) {
      onProgress({ stage: 'recognize', done: i, total: ordered.length, message: `文字認識中 ${i + 1}/${ordered.length}` })
      results.push({ box: ordered[i], text: await this.recognize(bmp, ordered[i]) })
    }
    return {
      text: results.map(r => r.text).join('\n'),
      lines: results, vertical, width: bmp.width, height: bmp.height,
      ms: (globalThis.performance?.now?.() ?? 0) - t0,
    }
  }
}

function iou(a: LineBox, b: LineBox): number {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1)
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2)
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1), inter = iw * ih
  if (inter <= 0) return 0
  const aA = (a.x2 - a.x1) * (a.y2 - a.y1), aB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / (aA + aB - inter)
}
function dedupe(lines: LineBox[], thr: number): LineBox[] {
  const kept: LineBox[] = []
  for (const l of lines) { if (!kept.some(k => iou(k, l) > thr)) kept.push(l) }
  return kept
}
function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v }
function toNum(d: Ort.Tensor['data']): number[] | Float32Array {
  if (d instanceof Float32Array) return d
  if (d instanceof BigInt64Array) { const o = new Array(d.length); for (let i = 0; i < d.length; i++) o[i] = Number(d[i]); return o }
  const a = d as ArrayLike<number>, o = new Array(a.length)
  for (let i = 0; i < a.length; i++) o[i] = Number(a[i])
  return o
}
