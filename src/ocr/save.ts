// 出力の保存 — 出力先ディレクトリ(File System Access API)があればそこへ、無ければダウンロード
import type { OcrResult } from './pipeline'
import { buildXML, buildJSON, buildTXT } from './outputs'

export interface OutputSettings { txt: boolean; json: boolean; xml: boolean; viz: boolean }

type DirHandle = any // FileSystemDirectoryHandle (型は環境依存のため any)

export function supportsDirPicker(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
}

export async function pickDirectory(): Promise<DirHandle | null> {
  try { return await (window as any).showDirectoryPicker({ mode: 'readwrite' }) }
  catch { return null }
}

async function writeFile(dir: DirHandle | null, name: string, data: Blob) {
  if (dir) {
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(data); await w.close()
  } else {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(data); a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
}

const stem = (name: string) => name.replace(/\.[^/.]+$/, '')

// 認識枠を描いた可視化画像 (本家 viz 相当)
export async function makeViz(imgUrl: string, res: OcrResult): Promise<Blob> {
  const img = await loadImage(imgUrl)
  const c = document.createElement('canvas')
  c.width = res.width; c.height = res.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, res.width, res.height)
  ctx.lineWidth = Math.max(2, Math.round(res.width / 600))
  ctx.strokeStyle = '#e53935'
  for (const l of res.lines) ctx.strokeRect(l.box.x1, l.box.y1, l.box.x2 - l.box.x1, l.box.y2 - l.box.y1)
  return await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = url
  })
}

export async function saveOutputs(
  dir: DirHandle | null, imageName: string, imgUrl: string, res: OcrResult, s: OutputSettings,
) {
  const base = stem(imageName)
  if (s.txt) await writeFile(dir, base + '.txt', new Blob([buildTXT(res)], { type: 'text/plain;charset=utf-8' }))
  if (s.json) await writeFile(dir, base + '.json', new Blob([buildJSON(res, imageName)], { type: 'application/json;charset=utf-8' }))
  if (s.xml) await writeFile(dir, base + '.xml', new Blob([buildXML(res, imageName)], { type: 'application/xml;charset=utf-8' }))
  if (s.viz) await writeFile(dir, base + '_viz.png', await makeViz(imgUrl, res))
}
