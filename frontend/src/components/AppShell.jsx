import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function NavItem({ to, icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg font-mono text-[12px] leading-4 font-medium duration-200 ease-in-out ${
          isActive
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant hover:bg-surface-variant'
        }`
      }
    >
      <span className="material-symbols-outlined text-[20px] leading-none">{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

export default function AppShell({ children }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    navigate('/login', { replace: true })
  }

  const nav = (
    <>
      <div className="px-3 pt-4 pb-4">
        <p className="font-mono text-[12px] leading-4 text-on-surface-variant uppercase tracking-widest">
          Analysis Engine
        </p>
      </div>
      <nav className="flex-1 space-y-1">
        <NavItem to="/" icon="dashboard" label="Portfolio" onClick={() => setDrawerOpen(false)} />
      </nav>
      <div className="mt-auto pt-3 border-t border-outline-variant/50 space-y-1">
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-on-surface-variant hover:bg-surface-variant font-mono text-[12px] leading-4 font-medium duration-200 ease-in-out text-left"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          <span className="material-symbols-outlined text-[20px] leading-none">logout</span>
          <span>{signingOut ? 'Signing out…' : 'Sign Out'}</span>
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-background text-on-background font-sans">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col h-screen w-64 fixed left-0 top-0 border-r border-outline-variant bg-surface-container-low z-40">
        <div className="px-5 pt-6 pb-4 border-b border-outline-variant">
          <div className="font-sans text-[20px] font-bold text-primary tracking-tight">
            GrantGuard AI
          </div>
          <p className="font-mono text-[12px] leading-4 text-on-surface-variant mt-1">
            Compliance &amp; Evidence Engine
          </p>
        </div>
        <div className="flex-1 flex flex-col px-3 py-2">{nav}</div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 h-16 bg-surface border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <button
            className="text-on-surface-variant hover:text-primary transition-colors p-1"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <span className="font-sans text-[20px] font-bold text-primary tracking-tight">
            GrantGuard AI
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-surface-variant border border-outline-variant" />
        </div>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-surface-container-low flex flex-col border-r border-outline-variant shadow-[0_0_40px_rgba(0,0,0,0.15)]">
            <div className="flex items-center justify-between px-5 h-16 border-b border-outline-variant">
              <span className="font-sans text-[20px] font-bold text-primary tracking-tight">
                GrantGuard AI
              </span>
              <button
                className="text-on-surface-variant hover:text-primary transition-colors p-1"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 flex flex-col px-3 py-2">{nav}</div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="lg:ml-64 min-h-screen">
        <div className="pt-16 lg:pt-0 px-4 sm:px-6 lg:px-10 pb-16">
          <div className="max-w-[1440px] mx-auto pt-6 lg:pt-10">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
