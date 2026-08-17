import { useTranslation } from 'react-i18next'
import {
  Content,
  ContentItem,
  ContentItemForm,
  ContentItemTitle,
  ContentSeparator,
  Header,
  HeaderDescription,
  HeaderTitle,
  Root,
} from '@/app/components/settings/section'
import { Switch } from '@/app/components/ui/switch'
import { useLyricsSettings } from '@/store/player.store'

export function LyricsSettings() {
  const { t } = useTranslation()
  const {
    preferSyncedLyrics,
    setPreferSyncedLyrics,
    preferWordLevelLyrics,
    setPreferWordLevelLyrics,
    rubyPreference,
    setRubyPreference,
    linePreference,
    setLinePreference,
  } = useLyricsSettings()

  const handleWordLevelToggle = (value: boolean) => {
    setPreferWordLevelLyrics(value)
    if (value) setPreferSyncedLyrics(true)
  }

  return (
    <Root>
      <Header>
        <HeaderTitle>{t('settings.audio.lyrics.group')}</HeaderTitle>
        <HeaderDescription>
          {t('settings.audio.lyrics.description')}
        </HeaderDescription>
      </Header>
      <Content>
        <ContentItem>
          <ContentItemTitle info={t('settings.audio.lyrics.preferSynced.info')}>
            {t('settings.audio.lyrics.preferSynced.label')}
          </ContentItemTitle>
          <ContentItemForm>
            <Switch
              checked={preferSyncedLyrics}
              onCheckedChange={setPreferSyncedLyrics}
              disabled={preferWordLevelLyrics}
            />
          </ContentItemForm>
        </ContentItem>
        <ContentItem>
          <ContentItemTitle
            info={t('settings.audio.lyrics.preferWordLevel.info')}
          >
            {t('settings.audio.lyrics.preferWordLevel.label')}
          </ContentItemTitle>
          <ContentItemForm>
            <Switch
              checked={preferWordLevelLyrics}
              onCheckedChange={handleWordLevelToggle}
            />
          </ContentItemForm>
        </ContentItem>
        <ContentItem>
          <ContentItemTitle info={t('settings.audio.lyrics.ruby.info')}>
            {t('settings.audio.lyrics.ruby.label')}
          </ContentItemTitle>
          <ContentItemForm>
            <Switch
              checked={rubyPreference === 'auto'}
              onCheckedChange={(value) =>
                setRubyPreference(value ? 'auto' : 'off')
              }
            />
          </ContentItemForm>
        </ContentItem>
        <ContentItem>
          <ContentItemTitle info={t('settings.audio.lyrics.romaji.info')}>
            {t('settings.audio.lyrics.romaji.label')}
          </ContentItemTitle>
          <ContentItemForm>
            <Switch
              checked={linePreference === 'auto'}
              onCheckedChange={(value) =>
                setLinePreference(value ? 'auto' : 'off')
              }
            />
          </ContentItemForm>
        </ContentItem>
      </Content>
      <ContentSeparator />
    </Root>
  )
}
