// 出力フォーマット生成 — 本家 ndlocr-lite の XML / JSON / TXT 形式に準拠
import type { OcrResult } from './pipeline'
import { CLASS_NAMES, CLASS_TYPE_JA } from './pipeline'

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// 本家: <OCRDATASET><PAGE><LINE TYPE X Y WIDTH HEIGHT CONF PRED_CHAR_CNT ORDER STRING/></PAGE></OCRDATASET>
export function buildXML(res: OcrResult, imageName: string): string {
  const lines = res.lines.map((l, i) => {
    const b = l.box
    const type = CLASS_TYPE_JA[b.className] ?? b.className
    return `    <LINE TYPE="${xmlEscape(type)}" X="${b.x1}" Y="${b.y1}" WIDTH="${b.x2 - b.x1}" HEIGHT="${b.y2 - b.y1}"`
      + ` CONF="${b.conf.toFixed(3)}" PRED_CHAR_CNT="${b.charCount.toFixed(3)}" ORDER="${i + 1}" STRING="${xmlEscape(l.text)}" />`
  }).join('\n')
  return `<OCRDATASET>\n<PAGE IMAGENAME="${xmlEscape(imageName)}" WIDTH="${res.width}" HEIGHT="${res.height}">\n${lines}\n</PAGE>\n</OCRDATASET>\n`
}

// 本家 ocr.py の JSON 形式
export function buildJSON(res: OcrResult, imageName: string): string {
  const contents = res.lines.map((l, i) => {
    const b = l.box, w = b.x2 - b.x1, h = b.y2 - b.y1
    const ci = CLASS_NAMES.indexOf(b.className)
    return {
      boundingBox: [[b.x1, b.y1], [b.x1, b.y1 + h], [b.x1 + w, b.y1], [b.x1 + w, b.y1 + h]],
      id: i,
      isVertical: b.vertical ? 'true' : 'false',
      text: l.text,
      isTextline: 'true',
      confidence: Number(b.conf.toFixed(3)),
      class_index: ci >= 0 ? ci : 1,
    }
  })
  return JSON.stringify({
    contents: [contents],
    imginfo: { img_width: res.width, img_height: res.height, img_path: imageName, img_name: imageName },
  }, null, 2)
}

export function buildTXT(res: OcrResult): string {
  return res.lines.map(l => l.text).join('\n')
}
