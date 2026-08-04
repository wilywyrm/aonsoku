/**
 * FLAC tail sanitizer.
 *
 * Some FLAC files contain garbage bytes appended after the final audio
 * frame (e.g. a chunk of the stream duplicated by a faulty writer or
 * download). libFLAC-based players never read those bytes because
 * STREAMINFO tells them when the stream is complete, but Chromium demuxes
 * with ffmpeg's raw FLAC parser, which reads to EOF, loses sync inside the
 * garbage and emits a packet without a PTS. Chromium treats that as a fatal
 * demuxer error ("FFmpegDemuxer: PTS is not defined") and kills playback.
 *
 * This module rewrites the byte stream on the fly: it locates the final
 * frame (the validated frame header whose starting sample + block size
 * equals STREAMINFO's total samples) and replaces everything after it that
 * looks like another frame header with zero bytes. Zero bytes contain no
 * FLAC sync pattern, so ffmpeg binds the final frame to EOF and parses the
 * stream cleanly. The output has exactly the same length as the input,
 * which keeps Content-Length and HTTP range semantics intact.
 */

export interface FlacStreamMeta {
  totalSamples: number
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** Block size of all but the last frame, when the stream is fixed-blocksize. */
  fixedBlockSize: number | null
}

const FLAC_MAGIC = 0x664c6143 // 'fLaC'
const STREAMINFO_BLOCK_TYPE = 0
const STREAMINFO_BLOCK_LENGTH = 34

/** 'fLaC' magic + metadata block header + STREAMINFO body. */
export const STREAM_META_HEADER_BYTES = 8 + STREAMINFO_BLOCK_LENGTH

const BLOCK_SIZES = [
  0, 192, 576, 1152, 2304, 4608, 0, 0, 256, 512, 1024, 2048, 4096, 8192, 16384,
  32768,
]

const SAMPLE_RATES = [
  0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000,
  96000,
]

const BITS_PER_SAMPLE = [0, 8, 12, 0, 16, 20, 24, 32]

const CRC8_TABLE = (() => {
  const table = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff
    }
    table[i] = crc
  }
  return table
})()

function crc8(buffer: Uint8Array, start: number, end: number): number {
  let crc = 0
  for (let i = start; i < end; i++) {
    crc = CRC8_TABLE[crc ^ buffer[i]]
  }
  return crc
}

/**
 * Parses STREAMINFO from the first bytes of a FLAC file.
 * Requires at least STREAM_META_HEADER_BYTES bytes.
 */
export function parseStreamInfo(buffer: Uint8Array): FlacStreamMeta | null {
  if (buffer.length < STREAM_META_HEADER_BYTES) return null

  const magic =
    (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3]
  if (magic !== FLAC_MAGIC) return null

  const blockType = buffer[4] & 0x7f
  const blockLength = (buffer[5] << 16) | (buffer[6] << 8) | buffer[7]
  if (blockType !== STREAMINFO_BLOCK_TYPE) return null
  if (blockLength !== STREAMINFO_BLOCK_LENGTH) return null

  const body = buffer.subarray(8, STREAM_META_HEADER_BYTES)
  const minBlockSize = (body[0] << 8) | body[1]
  const maxBlockSize = (body[2] << 8) | body[3]
  const sampleRate = (body[10] << 12) | (body[11] << 4) | (body[12] >> 4)
  const channels = ((body[12] >> 1) & 0x07) + 1
  const bitsPerSample = (((body[12] & 0x01) << 4) | (body[13] >> 4)) + 1
  const totalSamples =
    (body[13] & 0x0f) * 0x100000000 +
    body[14] * 0x1000000 +
    ((body[15] << 16) | (body[16] << 8) | body[17])

  if (sampleRate === 0) return null

  return {
    totalSamples,
    sampleRate,
    channels,
    bitsPerSample,
    fixedBlockSize:
      minBlockSize === maxBlockSize && minBlockSize > 0 ? minBlockSize : null,
  }
}

type FrameHeaderResult =
  | { status: 'invalid' }
  | { status: 'incomplete' }
  | {
      status: 'valid'
      headerLength: number
      blockSize: number
      startSample: number | null
    }

const INVALID: FrameHeaderResult = { status: 'invalid' }
const INCOMPLETE: FrameHeaderResult = { status: 'incomplete' }

/**
 * Attempts to parse a FLAC frame header at `offset`, validating reserved
 * bits, field consistency against STREAMINFO and the header CRC-8.
 */
export function parseFrameHeader(
  buffer: Uint8Array,
  offset: number,
  meta: FlacStreamMeta,
): FrameHeaderResult {
  const available = buffer.length - offset
  if (available < 2) return INCOMPLETE
  if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xfe) !== 0xf8) {
    return INVALID
  }
  if (available < 5) return INCOMPLETE

  const variableBlockSize = (buffer[offset + 1] & 0x01) === 1
  const blockSizeCode = buffer[offset + 2] >> 4
  const sampleRateCode = buffer[offset + 2] & 0x0f
  if (blockSizeCode === 0 || sampleRateCode === 15) return INVALID

  const channelCode = buffer[offset + 3] >> 4
  const bpsCode = (buffer[offset + 3] >> 1) & 0x07
  if ((buffer[offset + 3] & 0x01) !== 0) return INVALID
  if (channelCode > 10) return INVALID

  const channels = channelCode <= 7 ? channelCode + 1 : 2
  if (channels !== meta.channels) return INVALID
  if (bpsCode === 3) return INVALID

  const bitsPerSample = BITS_PER_SAMPLE[bpsCode]
  if (bitsPerSample !== 0 && bitsPerSample !== meta.bitsPerSample) {
    return INVALID
  }

  // Frame/sample number, encoded like extended UTF-8 (up to 7 bytes).
  const first = buffer[offset + 4]
  let extraBytes: number
  if ((first & 0x80) === 0) extraBytes = 0
  else if ((first & 0xe0) === 0xc0) extraBytes = 1
  else if ((first & 0xf0) === 0xe0) extraBytes = 2
  else if ((first & 0xf8) === 0xf0) extraBytes = 3
  else if ((first & 0xfc) === 0xf8) extraBytes = 4
  else if ((first & 0xfe) === 0xfc) extraBytes = 5
  else if (first === 0xfe) extraBytes = 6
  else return INVALID
  // Frame numbers (fixed blocksize) are at most 31 bits => 6 encoded bytes.
  if (!variableBlockSize && extraBytes > 5) return INVALID

  let headerLength = 4 + 1 + extraBytes
  if (blockSizeCode === 6) headerLength += 1
  else if (blockSizeCode === 7) headerLength += 2
  if (sampleRateCode === 12) headerLength += 1
  else if (sampleRateCode === 13 || sampleRateCode === 14) headerLength += 2
  headerLength += 1 // trailing CRC-8
  if (available < headerLength) return INCOMPLETE

  let codedNumber =
    extraBytes === 0 ? first : first & (0x7f >> (extraBytes + 1))
  for (let i = 1; i <= extraBytes; i++) {
    const byte = buffer[offset + 4 + i]
    if ((byte & 0xc0) !== 0x80) return INVALID
    codedNumber = codedNumber * 64 + (byte & 0x3f)
  }

  let cursor = offset + 5 + extraBytes
  let blockSize: number
  if (blockSizeCode === 6) {
    blockSize = buffer[cursor] + 1
    cursor += 1
  } else if (blockSizeCode === 7) {
    blockSize = ((buffer[cursor] << 8) | buffer[cursor + 1]) + 1
    cursor += 2
  } else {
    blockSize = BLOCK_SIZES[blockSizeCode]
  }

  let sampleRate: number
  if (sampleRateCode === 0) {
    sampleRate = meta.sampleRate
  } else if (sampleRateCode <= 11) {
    sampleRate = SAMPLE_RATES[sampleRateCode]
  } else if (sampleRateCode === 12) {
    sampleRate = buffer[cursor] * 1000
    cursor += 1
  } else {
    const value = (buffer[cursor] << 8) | buffer[cursor + 1]
    sampleRate = sampleRateCode === 13 ? value : value * 10
    cursor += 2
  }
  if (sampleRate !== meta.sampleRate) return INVALID

  if (crc8(buffer, offset, cursor) !== buffer[cursor]) return INVALID

  let startSample: number | null
  if (variableBlockSize) {
    startSample = codedNumber
  } else if (meta.fixedBlockSize !== null) {
    startSample = codedNumber * meta.fixedBlockSize
  } else {
    startSample = null
  }

  return { status: 'valid', headerLength, blockSize, startSample }
}

export interface FlacTailSanitizerOptions {
  /** Absolute file offset of the first byte this sanitizer will receive. */
  baseOffset: number
  /** STREAMINFO data, required to sanitize responses not starting at 0. */
  meta?: FlacStreamMeta | null
  /** Previously detected junk offset; bytes at/after it are zeroed. */
  zeroFrom?: number | null
  /** Called once STREAMINFO has been parsed from the stream. */
  onMeta?: (meta: FlacStreamMeta) => void
  /** Called when trailing junk is detected, with its absolute offset. */
  onJunkDetected?: (zeroFrom: number) => void
}

type SanitizerPhase = 'header' | 'frames' | 'zeroing' | 'passthrough'

/**
 * Push-based byte stream rewriter. Feed it the response body in order;
 * it returns buffers totalling exactly the bytes fed in, with any junk
 * trailing the FLAC stream replaced by zero bytes.
 */
export class FlacTailSanitizer {
  private phase: SanitizerPhase
  private meta: FlacStreamMeta | null
  private zeroFrom: number | null
  private pending: Buffer = Buffer.alloc(0)
  /** Absolute file offset of pending[0]. */
  private pendingOffset: number
  /** Absolute offset of the next metadata block header (header phase). */
  private nextBlockHeaderOffset = 4
  private finalFrameSeen = false
  private readonly onMeta?: (meta: FlacStreamMeta) => void
  private readonly onJunkDetected?: (zeroFrom: number) => void

  constructor(options: FlacTailSanitizerOptions) {
    this.pendingOffset = options.baseOffset
    this.meta = options.meta ?? null
    this.zeroFrom = options.zeroFrom ?? null
    this.onMeta = options.onMeta
    this.onJunkDetected = options.onJunkDetected

    if (this.zeroFrom !== null) {
      this.phase = 'zeroing'
    } else if (options.baseOffset === 0) {
      this.phase = 'header'
    } else if (this.meta && this.meta.totalSamples > 0) {
      this.phase = 'frames'
    } else {
      this.phase = 'passthrough'
    }
  }

  push(chunk: Uint8Array): Buffer[] {
    if (chunk.length === 0) return []

    const output: Buffer[] = []

    if (this.phase === 'passthrough') {
      output.push(Buffer.from(chunk))
      return output
    }
    if (this.phase === 'zeroing') {
      this.emitZeroed(Buffer.from(chunk), this.pendingOffset, output)
      this.pendingOffset += chunk.length
      return output
    }

    this.pending =
      this.pending.length === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.pending, chunk])

    if (this.phaseIs('header')) this.processHeader(output)
    if (this.phaseIs('frames')) this.processFrames(output)
    if (this.phaseIs('passthrough')) this.drainPending(output)

    return output
  }

  /** Reads the phase in a way TypeScript cannot over-narrow across calls. */
  private phaseIs(phase: SanitizerPhase): boolean {
    return this.phase === phase
  }

  flush(): Buffer[] {
    const output: Buffer[] = []
    if (this.pending.length === 0) return output

    if (this.phase === 'zeroing') {
      this.emitZeroed(this.pending, this.pendingOffset, output)
    } else {
      output.push(this.pending)
    }
    this.pendingOffset += this.pending.length
    this.pending = Buffer.alloc(0)
    return output
  }

  /** Walks 'fLaC' magic + metadata blocks; hands off to frame scanning. */
  private processHeader(output: Buffer[]): void {
    if (this.meta === null) {
      if (this.pending.length < STREAM_META_HEADER_BYTES) return
      const meta = parseStreamInfo(this.pending)
      if (meta === null || meta.totalSamples === 0) {
        this.phase = 'passthrough'
        this.drainPending(output)
        return
      }
      this.meta = meta
      this.onMeta?.(meta)
    }

    while (true) {
      const headerStart = this.nextBlockHeaderOffset - this.pendingOffset
      if (this.pending.length < headerStart + 4) {
        // Emit metadata bytes we have already walked past.
        this.emitPlain(Math.min(headerStart, this.pending.length), output)
        return
      }

      const isLastBlock = (this.pending[headerStart] & 0x80) !== 0
      const blockLength =
        (this.pending[headerStart + 1] << 16) |
        (this.pending[headerStart + 2] << 8) |
        this.pending[headerStart + 3]
      this.nextBlockHeaderOffset += 4 + blockLength

      if (isLastBlock) {
        const framesStart = this.nextBlockHeaderOffset - this.pendingOffset
        this.emitPlain(Math.min(framesStart, this.pending.length), output)
        this.phase = 'frames'
        this.processFrames(output)
        return
      }
    }
  }

  /**
   * Scans audio frames for the final frame of the stream, then treats any
   * later byte sequence that parses as a valid frame header as junk.
   */
  private processFrames(output: Buffer[]): void {
    const meta = this.meta
    if (meta === null) {
      this.phase = 'passthrough'
      this.drainPending(output)
      return
    }

    const data = this.pending
    const length = data.length
    let index = 0
    let emitLimit = length

    while (index < length) {
      if (data[index] !== 0xff) {
        index++
        continue
      }
      if (index + 1 >= length) {
        emitLimit = index
        break
      }
      if ((data[index + 1] & 0xfe) !== 0xf8) {
        index++
        continue
      }

      const result = parseFrameHeader(data, index, meta)
      if (result.status === 'incomplete') {
        emitLimit = index
        break
      }
      if (result.status === 'invalid') {
        index++
        continue
      }

      if (this.finalFrameSeen) {
        // A valid frame header after the stream's final frame: trailing
        // junk. Everything from here on gets zeroed.
        this.zeroFrom = this.pendingOffset + index
        this.phase = 'zeroing'
        this.onJunkDetected?.(this.zeroFrom)
        break
      }

      if (
        result.startSample !== null &&
        result.startSample + result.blockSize === meta.totalSamples
      ) {
        this.finalFrameSeen = true
      }
      index += result.headerLength
    }

    if (this.phase === 'zeroing') {
      this.emitZeroed(this.pending, this.pendingOffset, output)
      this.pendingOffset += this.pending.length
      this.pending = Buffer.alloc(0)
      return
    }

    this.emitPlain(emitLimit, output)
  }

  private emitPlain(byteCount: number, output: Buffer[]): void {
    if (byteCount <= 0) return
    output.push(this.pending.subarray(0, byteCount))
    this.pending = this.pending.subarray(byteCount)
    this.pendingOffset += byteCount
  }

  private drainPending(output: Buffer[]): void {
    if (this.pending.length === 0) return
    output.push(this.pending)
    this.pendingOffset += this.pending.length
    this.pending = Buffer.alloc(0)
  }

  private emitZeroed(
    buffer: Buffer,
    absoluteStart: number,
    output: Buffer[],
  ): void {
    if (this.zeroFrom === null) {
      output.push(buffer)
      return
    }
    const keep = this.zeroFrom - absoluteStart
    if (keep <= 0) {
      output.push(Buffer.alloc(buffer.length))
    } else if (keep >= buffer.length) {
      output.push(buffer)
    } else {
      const copy = Buffer.from(buffer)
      copy.fill(0, keep)
      output.push(copy)
    }
  }
}
