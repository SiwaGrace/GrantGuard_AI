import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import UploadModal from './UploadModal'
import ChatWidget from './ChatWidget'

function NavItem({ to, icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-3 border-l-4 transition-colors ${
          isActive
            ? 'bg-primary-container text-on-primary-container font-bold border-primary'
            : 'border-transparent text-secondary hover:bg-surface-container-high'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className={`material-symbols-outlined ${isActive ? 'filled-icon' : ''}`}>{icon}</span>
          <span className="font-label-caps text-label-caps uppercase">{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function AppShell({ children }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  useEffect(() => {
    function onOpenUpload() {
      setUploadOpen(true)
    }
    window.addEventListener('grantguard:open-upload', onOpenUpload)
    return () => window.removeEventListener('grantguard:open-upload', onOpenUpload)
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    navigate('/login', { replace: true })
  }

  function handleUploadGrant() {
    setDrawerOpen(false)
    setUploadOpen(true)
  }

  const nav = (
    <>
      <button
        onClick={handleUploadGrant}
        className="mb-8 w-full bg-primary text-on-primary py-2 px-4 notched-card hover:bg-surface-tint transition-colors flex items-center justify-center gap-2 font-label-caps text-label-caps uppercase tracking-widest"
      >
        <span className="material-symbols-outlined filled-icon">upload</span>
        Upload Grant
      </button>

      <nav className="flex-1 space-y-2">
        <NavItem to="/portfolio" icon="folder_shared" label="Portfolio" onClick={() => setDrawerOpen(false)} />
        <NavItem to="/" icon="dashboard" label="Dashboard" onClick={() => setDrawerOpen(false)} />
        <NavItem to="/alerts" icon="notification_important" label="Alerts" onClick={() => setDrawerOpen(false)} />
        <NavItem to="/settings" icon="settings" label="Settings" onClick={() => setDrawerOpen(false)} />
      </nav>

      <div className="mt-auto pt-6 border-t border-outline-variant">
        <ul className="space-y-2">
          <li>
            <button
              className="w-full flex items-center gap-3 px-4 py-2 text-secondary hover:bg-surface-container-high transition-colors text-left"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              <span className="material-symbols-outlined">logout</span>
              <span className="font-label-caps text-label-caps uppercase">
                {signingOut ? 'Signing out…' : 'Sign Out'}
              </span>
            </button>
          </li>
        </ul>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md h-screen overflow-hidden flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col h-screen w-64 shrink-0 border-r border-outline-variant bg-surface-container-lowest py-6 px-4">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-surface-container-high rounded flex items-center justify-center inkwell-border">
            <span className="material-symbols-outlined text-primary">account_balance</span>
          </div>
          <div>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">
              GrantGuard AI
            </h1>
            <p className="font-label-caps text-label-caps text-secondary uppercase">
              NGO Compliance Vault
            </p>
          </div>
        </div>
        <div className="flex-1 flex flex-col">{nav}</div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 h-16 bg-surface-container-lowest border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <button
            className="text-secondary hover:text-primary transition-colors p-1"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">account_balance</span>
            <span className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">
              GrantGuard AI
            </span>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-surface-container-lowest flex flex-col border-r border-outline-variant py-6 px-4">
            <div className="flex items-center justify-between px-2 mb-8">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">account_balance</span>
                <span className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">
                  GrantGuard AI
                </span>
              </div>
              <button
                className="text-secondary hover:text-primary transition-colors p-1"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 flex flex-col">{nav}</div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 lg:px-10 pt-20 md:pt-0 pb-16 lg:py-10">
            <div className="max-w-7xl mx-auto">{children}</div>
          </div>
        </div>
      </main>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <ChatWidget />
    </div>
  )
}