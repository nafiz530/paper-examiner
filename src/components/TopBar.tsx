import { Link, NavLink } from 'react-router-dom'
import { Layers3, LockKeyhole, Settings2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { LanguageMenu } from './LanguageMenu'

export function TopBar({ onOpenSettings, saved }: { onOpenSettings: () => void; saved?: boolean }) {
  const { t } = useI18n()
  const nav = [
    { to: '/docs', label: t('nav.docs') },
    { to: '/about', label: t('nav.about') },
    { to: '/privacy', label: t('nav.privacy') },
  ]
  return (
    <nav className="topbar">
      <Link to="/" className="brand">
        <span className="brand__mark"><Layers3 size={18} /></span>
        <span>Paper Examiner</span>
      </Link>
      <div className="topbar__right">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => 'text-button' + (isActive ? ' is-active' : '')}>
            {n.label}
          </NavLink>
        ))}
        <LanguageMenu />
        <span className="privacy"><LockKeyhole size={14} /> {saved ? '✓' : ''}</span>
        <button className="icon-button" aria-label={t('settings.title')} onClick={onOpenSettings}>
          <Settings2 size={18} />
        </button>
      </div>
    </nav>
  )
}
