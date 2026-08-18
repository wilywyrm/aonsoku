import { isDesktop } from '@/utils/desktop'

/**
 * Must match STREAM_SANITIZER_SCHEME in
 * electron/main/core/streamSanitizer.ts.
 */
const STREAM_SANITIZER_SCHEME = 'aonsoku-stream'

/**
 * Routes FLAC streams through the Electron main process sanitizer, which
 * strips trailing junk that makes Chromium's demuxer abort playback with
 * "FFmpegDemuxer: PTS is not defined". Non-FLAC songs and web builds keep
 * the original URL.
 */
export function wrapFlacStreamUrl(url: string, suffix?: string): string {
  if (!url || !isDesktop()) return url
  if (suffix?.toLowerCase() !== 'flac') return url

  return `${STREAM_SANITIZER_SCHEME}://flac/?src=${encodeURIComponent(url)}`
}
