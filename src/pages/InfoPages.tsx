import { useI18n } from '../i18n'

export function DocsPage() {
  const { t } = useI18n()
  const sections = [
    [t('docs.how'), t('docs.howText')],
    [t('docs.keys'), t('docs.keysText')],
    [t('docs.inputs'), t('docs.inputsText')],
    [t('docs.lang'), t('docs.langText')],
    [t('docs.limits'), t('docs.limitsText')],
  ]
  return <InfoShell title={t('docs.title')} intro={t('docs.intro')} sections={sections} />
}

export function AboutPage() {
  const { t } = useI18n()
  const sections = [
    [t('about.mission'), t('about.missionText')],
    [t('about.seo'), t('about.seoText')],
  ]
  return <InfoShell title={t('about.title')} intro={t('about.text')} sections={sections} />
}

export function PrivacyPage() {
  const { t } = useI18n()
  const sections = [
    [t('privacy.data'), t('privacy.dataText')],
    [t('privacy.keys'), t('privacy.keysText')],
  ]
  return <InfoShell title={t('privacy.title')} intro={t('privacy.intro')} sections={sections} />
}

function InfoShell({ title, intro, sections }: { title: string; intro: string; sections: string[][] }) {
  return (
    <main className="info-page">
      <header className="info-hero">
        <div className="eyebrow">Paper Examiner</div>
        <h1>{title}</h1>
        <p>{intro}</p>
      </header>
      <div className="info-sections">
        {sections.map(([h, b]) => (
          <section className="info-section" key={h}><h2>{h}</h2><p>{b}</p></section>
        ))}
      </div>
    </main>
  )
}
