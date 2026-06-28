// 本家と同一の前処理を再現するための厳密リサイズ実装 (RGBA前提)
// - bilinearResize: OpenCV cv2.resize(INTER_LINEAR) 相当 (PARSeq用)
// - bicubicResize:  Pillow Image.resize(BICUBIC, アンチエイリアス付き) 相当 (DEIM用)
// - rotate90ccw:    cv2.ROTATE_90_COUNTERCLOCKWISE 相当

export interface Img { data: Uint8ClampedArray; width: number; height: number }

// cv2 ROTATE_90_COUNTERCLOCKWISE: 出力 (w=h_src, h=w_src), dst[Y][X]=src[X][w_src-1-Y]
export function rotate90ccw(src: Img): Img {
  const w = src.width, h = src.height
  const dstW = h, dstH = w
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  for (let Y = 0; Y < dstH; Y++) {
    const srcX = w - 1 - Y
    for (let X = 0; X < dstW; X++) {
      const si = (X * w + srcX) * 4
      const di = (Y * dstW + X) * 4
      out[di] = src.data[si]; out[di + 1] = src.data[si + 1]
      out[di + 2] = src.data[si + 2]; out[di + 3] = src.data[si + 3]
    }
  }
  return { data: out, width: dstW, height: dstH }
}

// OpenCV INTER_LINEAR: src座標 = (dst+0.5)*scale - 0.5、境界はreplicate
export function bilinearResize(src: Img, W: number, H: number): Img {
  const sw = src.width, sh = src.height, s = src.data
  const out = new Uint8ClampedArray(W * H * 4)
  const scaleX = sw / W, scaleY = sh / H
  for (let dy = 0; dy < H; dy++) {
    let fy = (dy + 0.5) * scaleY - 0.5
    let sy = Math.floor(fy), ay = fy - sy
    if (sy < 0) { sy = 0; ay = 0 }
    let sy1 = sy + 1
    if (sy >= sh - 1) { sy = sh - 1; sy1 = sy; ay = 0 }
    for (let dx = 0; dx < W; dx++) {
      let fx = (dx + 0.5) * scaleX - 0.5
      let sx = Math.floor(fx), ax = fx - sx
      if (sx < 0) { sx = 0; ax = 0 }
      let sx1 = sx + 1
      if (sx >= sw - 1) { sx = sw - 1; sx1 = sx; ax = 0 }
      const w00 = (1 - ax) * (1 - ay), w01 = ax * (1 - ay), w10 = (1 - ax) * ay, w11 = ax * ay
      const i00 = (sy * sw + sx) * 4, i01 = (sy * sw + sx1) * 4
      const i10 = (sy1 * sw + sx) * 4, i11 = (sy1 * sw + sx1) * 4
      const di = (dy * W + dx) * 4
      for (let c = 0; c < 4; c++) {
        out[di + c] = Math.round(w00 * s[i00 + c] + w01 * s[i01 + c] + w10 * s[i10 + c] + w11 * s[i11 + c])
      }
    }
  }
  return { data: out, width: W, height: H }
}

// ---- Pillow BICUBIC (アンチエイリアス付き分離畳み込み) ----
function cubic(x: number): number {
  const a = -0.5
  x = Math.abs(x)
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a
  return 0
}

interface Coeffs { bounds: Int32Array; kk: Float64Array; ksize: number }
function precompute(inSize: number, outSize: number): Coeffs {
  const scale = inSize / outSize
  const filterscale = Math.max(scale, 1.0)
  const support = 2.0 * filterscale
  const ksize = Math.ceil(support) * 2 + 1
  const bounds = new Int32Array(outSize * 2)
  const kk = new Float64Array(outSize * ksize)
  const ss = 1.0 / filterscale
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale
    let xmin = Math.floor(center - support + 0.5); if (xmin < 0) xmin = 0
    let xmax = Math.floor(center + support + 0.5); if (xmax > inSize) xmax = inSize
    xmax -= xmin
    const off = xx * ksize
    let ww = 0
    for (let x = 0; x < xmax; x++) { const w = cubic((x + xmin - center + 0.5) * ss); kk[off + x] = w; ww += w }
    if (ww !== 0) for (let x = 0; x < xmax; x++) kk[off + x] /= ww
    bounds[xx * 2] = xmin; bounds[xx * 2 + 1] = xmax
  }
  return { bounds, kk, ksize }
}

function resampleH(src: Img, outW: number): Img {
  const { bounds, kk, ksize } = precompute(src.width, outW)
  const out = new Uint8ClampedArray(outW * src.height * 4)
  for (let y = 0; y < src.height; y++) {
    const rowOff = y * src.width
    for (let xx = 0; xx < outW; xx++) {
      const xmin = bounds[xx * 2], xmax = bounds[xx * 2 + 1], koff = xx * ksize
      let r = 0, g = 0, b = 0, a = 0
      for (let x = 0; x < xmax; x++) {
        const w = kk[koff + x], si = (rowOff + xmin + x) * 4
        r += w * src.data[si]; g += w * src.data[si + 1]; b += w * src.data[si + 2]; a += w * src.data[si + 3]
      }
      const di = (y * outW + xx) * 4
      out[di] = Math.round(r); out[di + 1] = Math.round(g); out[di + 2] = Math.round(b); out[di + 3] = Math.round(a)
    }
  }
  return { data: out, width: outW, height: src.height }
}

function resampleV(src: Img, outH: number): Img {
  const { bounds, kk, ksize } = precompute(src.height, outH)
  const out = new Uint8ClampedArray(src.width * outH * 4)
  for (let yy = 0; yy < outH; yy++) {
    const ymin = bounds[yy * 2], ymax = bounds[yy * 2 + 1], koff = yy * ksize
    for (let x = 0; x < src.width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let y = 0; y < ymax; y++) {
        const w = kk[koff + y], si = ((ymin + y) * src.width + x) * 4
        r += w * src.data[si]; g += w * src.data[si + 1]; b += w * src.data[si + 2]; a += w * src.data[si + 3]
      }
      const di = (yy * src.width + x) * 4
      out[di] = Math.round(r); out[di + 1] = Math.round(g); out[di + 2] = Math.round(b); out[di + 3] = Math.round(a)
    }
  }
  return { data: out, width: src.width, height: outH }
}

export function bicubicResize(src: Img, W: number, H: number): Img {
  // Pillow と同じく 横→縦 の2パス
  return resampleV(resampleH(src, W), H)
}
