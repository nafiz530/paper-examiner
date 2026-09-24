import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { I18nProvider, useI18n } from './i18n'
import { SettingsProvider } from './lib/SettingsContext'
import { TopBar } from './components/TopBar'
import { SettingsModal } from './components/SettingsModal'
import { HomePage } from './pages/HomePage'
import { ExaminePage } from './pages/ExaminePage'
import { ReportPage } from './pages/ReportPage'
import { AboutPage, DocsPage, PrivacyPage } from './pages/InfoPages'

function Shell() {
  const { t } = useI18n()
  const [showSettings, setShowSettings] = useState(false)
  return (
    <div className="app-shell">
      <TopBar onOpenSettings={() => setShowSettings(true)} />
      <Routes>
        <Route path="/" element={<HomePage onOpenSettings={() => setShowSettings(true)} />} />
        <Route path="/examine/:id" element={<ExaminePage />} />
        <Route path="/report/:id" element={<ReportPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer className="site-footer">
        <span>{t('footer.tagline')}</span>
      </footer>
      <AnimatePresence>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <SettingsProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </SettingsProvider>
    </I18nProvider>
  )
}
