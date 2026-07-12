export function isJapaneseLang(lang?: string): boolean {
  if (!lang) return false
  const l = lang.toLowerCase()
  return l === 'ja' || l === 'jpn' || l.startsWith('ja-')
}
