import clsx from 'clsx'
import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { Separator } from '@/app/components/ui/separator'
import { useLyricsSettings } from '@/store/player.store'
import type { IStructuredLyric } from '@/types/responses/song'
import { isJapaneseLang } from '@/utils/language'
import { listTransliterationOptions } from '@/utils/transliterationResolver'

interface LyricsOptionsProps {
  lang?: string
  songId?: string
  pronunciationLyrics?: IStructuredLyric[]
}

const DEFAULT_VALUE = '__default__'
const OFF_VALUE = 'off'

export function LyricsOptions({
  lang,
  songId,
  pronunciationLyrics,
}: LyricsOptionsProps) {
  const { t } = useTranslation()
  const { perTrackTransliteration, setPerTrackTransliteration } =
    useLyricsSettings()

  const { rubySystems, lineSystems } =
    listTransliterationOptions(pronunciationLyrics)

  const hasTracks = rubySystems.length > 0 || lineSystems.length > 0
  if (!songId || !isJapaneseLang(lang) || !hasTracks) return null

  const override = perTrackTransliteration[songId]
  const isOverridden =
    override != null &&
    (override.ruby !== undefined || override.line !== undefined)

  const axisValue = (axis: 'ruby' | 'line') => override?.[axis] ?? DEFAULT_VALUE

  const setAxis = (axis: 'ruby' | 'line', value: string) => {
    setPerTrackTransliteration(songId, {
      [axis]: value === DEFAULT_VALUE ? undefined : value,
    })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('fullscreen.lyricsOptions.title')}
          className="relative size-9 rounded-full text-foreground drop-shadow-lg hover:bg-foreground/20 data-[state=open]:bg-foreground/20"
        >
          <Languages className="size-5" strokeWidth={2} />
          {isOverridden && (
            <span
              role="img"
              data-testid="lyrics-options-overridden"
              aria-label={t('fullscreen.lyricsOptions.overridden')}
              className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-background"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end" side="bottom">
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-medium">
              {t('fullscreen.lyricsOptions.title')}
            </span>
            {isOverridden && (
              <span className="text-xs text-muted-foreground">
                {t('fullscreen.lyricsOptions.overridden')}
              </span>
            )}
          </div>
          {rubySystems.length > 0 && (
            <AxisRow
              label={t('fullscreen.lyricsOptions.ruby')}
              value={axisValue('ruby')}
              systems={rubySystems}
              onValueChange={(value) => setAxis('ruby', value)}
            />
          )}
          {lineSystems.length > 0 && (
            <AxisRow
              label={t('fullscreen.lyricsOptions.romaji')}
              value={axisValue('line')}
              systems={lineSystems}
              onValueChange={(value) => setAxis('line', value)}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface AxisRowProps {
  label: string
  value: string
  systems: string[]
  onValueChange: (value: string) => void
}

function AxisRow({ label, value, systems, onValueChange }: AxisRowProps) {
  const { t } = useTranslation()
  const isCustom = value !== DEFAULT_VALUE

  return (
    <>
      <Separator />
      <div className="flex items-center justify-between gap-2 p-3">
        <span
          className={clsx(
            'text-sm text-balance',
            isCustom && 'font-medium text-primary',
          )}
        >
          {label}
        </span>
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="h-8 w-2/5 ring-offset-transparent focus:ring-0 focus:ring-transparent text-left">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectItem value={DEFAULT_VALUE}>
                {t('fullscreen.lyricsOptions.default')}
              </SelectItem>
              <SelectItem value={OFF_VALUE}>
                {t('fullscreen.lyricsOptions.off')}
              </SelectItem>
              {systems.map((system) => (
                <SelectItem key={system} value={system}>
                  {system}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </>
  )
}
