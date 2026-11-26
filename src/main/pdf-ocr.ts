/**
 * Zero-dependency Scanned PDF Image Extraction & Pure-JS PNG Encoder.
 *
 * Enables ZHIXU's existing Vision Model (VM) tier (e.g. Ollama qwen2.5vl:7b / qwen-vl-max)
 * to OCR image-only scanned PDFs without any native C++ canvas/sharp binaries.
 */

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBytes, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([len, typeBytes, data, crcBuf])
}

/**
 * Pure-JS PNG encoder supporting grayscale (1ch), RGB (3ch), and RGBA (4ch) pixel buffers.
 * Automatically downscales oversized scanned pages to `maxDim` pixels so Vision models run fast.
 */
export function encodeRawImageToPng(
  width: number,
  height: number,
  data: Uint8Array | Uint8ClampedArray,
  channels: 1 | 3 | 4,
  maxDim = 1600
): Buffer {
  if (width <= 0 || height <= 0) throw new Error('Invalid image dimensions')
  const expected = width * height * channels
  if (data.length < expected) {
    throw new Error(`Pixel buffer too short: expected >= ${expected}, got ${data.length}`)
  }

  let outW = width
  let outH = height
  let src = data

  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height)
    outW = Math.max(1, Math.round(width * scale))
    outH = Math.max(1, Math.round(height * scale))
    const resized = new Uint8Array(outW * outH * channels)
    for (let y = 0; y < outH; y += 1) {
      const sy = Math.min(height - 1, Math.floor((y * height) / outH))
      for (let x = 0; x < outW; x += 1) {
        const sx = Math.min(width - 1, Math.floor((x * width) / outW))
        const si = (sy * width + sx) * channels
        const di = (y * outW + x) * channels
        for (let c = 0; c < channels; c += 1) {
          resized[di + c] = data[si + c]
        }
      }
    }
    src = resized
  }

  // Build PNG scanlines (filter type 0 = None per row)
  const rowBytes = outW * channels
  const raw = Buffer.alloc((rowBytes + 1) * outH)
  for (let y = 0; y < outH; y += 1) {
    const rowStart = y * (rowBytes + 1)
    raw[rowStart] = 0
    const srcOffset = y * rowBytes
    for (let i = 0; i < rowBytes; i += 1) {
      raw[rowStart + 1 + i] = src[srcOffset + i]
    }
  }

  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(outW, 0)
  ihdr.writeUInt32BE(outH, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = colorType
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const compressed = deflateSync(raw, { level: 6 })
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))])
}

type PdfImageLike = {
  width?: number
  height?: number
  data?: Uint8Array | Uint8ClampedArray
  kind?: number
}

function inferChannels(img: PdfImageLike): 1 | 3 | 4 | null {
  const width = img.width ?? 0
  const height = img.height ?? 0
  if (width <= 0 || height <= 0 || !img.data) return null
  const pixels = width * height
  if (img.data.length === pixels * 4) return 4
  if (img.data.length === pixels * 3) return 3
  if (img.data.length === pixels) return 1
  // 1-bit monochrome bitmap (kind === 1 in pdfjs)
  if (img.kind === 1 && img.data.length >= Math.ceil(width / 8) * height) return 1
  return null
}

function expand1BitToGrayscale(width: number, height: number, packed: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(width * height)
  const stride = Math.ceil(width / 8)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const byte = packed[y * stride + (x >> 3)] ?? 0
      const bit = (byte >> (7 - (x & 7))) & 1
      out[y * width + x] = bit ? 255 : 0
    }
  }
  return out
}

async function resolvePdfObj(
  pool: { get: (id: string, cb?: (obj: unknown) => void) => unknown; has?: (id: string) => boolean },
  id: string,
  timeoutMs = 2500
): Promise<PdfImageLike | null> {
  return await new Promise<PdfImageLike | null>(resolve => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(null)
      }
    }, timeoutMs)
    try {
      const done = (obj: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve((obj && typeof obj === 'object' ? obj : null) as PdfImageLike | null)
      }
      if (pool.has && pool.has(id)) {
        done(pool.get(id))
      } else {
        pool.get(id, done)
      }
    } catch {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(null)
      }
    }
  })
}

/**
 * Extracts the largest embedded raster image from a scanned PDF page and returns a PNG buffer.
 */
export async function extractScannedPdfPagePng(
  page: {
    getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>
    objs: { get: (id: string, cb?: (obj: unknown) => void) => unknown; has?: (id: string) => boolean }
    commonObjs?: { get: (id: string, cb?: (obj: unknown) => void) => unknown; has?: (id: string) => boolean }
  },
  ops: Record<string, number>
): Promise<Buffer | null> {
  try {
    const opList = await page.getOperatorList()
    const candidates: PdfImageLike[] = []
    const paintImageOps = new Set(
      [ops.paintImageXObject, ops.paintJpegXObject, ops.paintImageXObjectRepeat].filter(
        (v): v is number => typeof v === 'number'
      )
    )

    for (let i = 0; i < opList.fnArray.length; i += 1) {
      const fn = opList.fnArray[i]
      const args = opList.argsArray[i] as unknown[] | undefined
      if (!args || !args.length) continue

      if (fn === ops.paintInlineImageXObject && typeof args[0] === 'object' && args[0]) {
        candidates.push(args[0] as PdfImageLike)
        continue
      }

      if (paintImageOps.has(fn) && typeof args[0] === 'string') {
        const objId = args[0]
        const img =
          (await resolvePdfObj(page.objs, objId)) ??
          (page.commonObjs ? await resolvePdfObj(page.commonObjs, objId) : null)
        if (img) candidates.push(img)
      }
    }

    // Pick the largest valid raster image (typical scanned page is 1 full-page scan image)
    let best: { img: PdfImageLike; channels: 1 | 3 | 4; area: number } | null = null
    for (const img of candidates) {
      const ch = inferChannels(img)
      if (!ch || !img.width || !img.height || !img.data) continue
      const area = img.width * img.height
      if (area < 10_000) continue // Ignore tiny icons/logos (<100x100)
      if (!best || area > best.area) {
        best = { img, channels: ch, area }
      }
    }

    if (!best || !best.img.width || !best.img.height || !best.img.data) return null
    const pixels = best.img.width * best.img.height
    const pixelData =
      best.channels === 1 && best.img.data.length < pixels
        ? expand1BitToGrayscale(best.img.width, best.img.height, best.img.data)
        : best.img.data
    return encodeRawImageToPng(best.img.width, best.img.height, pixelData, best.channels)
  } catch {
    return null
  }
}

export const SCANNED_PDF_OCR_PROMPT =
  '这是一页扫描版 PDF 文档图像。请忠实、完整地识别并转录页面中的全部中文/英文正文、标题层级和表格数据（表格用 Markdown 表格输出）。严格忠于图像可见文字，不要编造或总结省略。'
