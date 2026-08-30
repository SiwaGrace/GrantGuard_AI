import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('Please enter a valid email address.')
      return
    }
    if (!password) {
      setError('Please enter your password.')
      return
    }

    setSubmitting(true)
    const { error: authError } = await signIn(email.trim(), password)
    setSubmitting(false)

    if (authError) {
      if (authError.message === 'Email not confirmed') {
        setError('Your email has not been confirmed yet. Please check your inbox.')
      } else {
        setError(authError.message)
      }
      return
    }

    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-surface-container-low flex items-center justify-center px-4 py-10 font-body-md text-on-surface">
      <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant notched-br flex flex-col relative overflow-hidden">
        {/* Blueprint grid accents */}
        <div className="absolute inset-0 pointer-events-none opacity-5 blueprint-grid text-primary" />
        <div className="absolute top-0 left-0 w-full h-[1px] bg-primary" />
        <div className="absolute top-0 left-0 h-full w-[1px] bg-primary" />

        <div className="p-8 relative z-10 flex flex-col gap-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-container text-on-primary-container rounded-sm mb-2 border border-outline-variant">
              <span className="material-symbols-outlined filled-icon text-[24px]">assured_workload</span>
            </div>
            <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface">
              Secure Your Compliance Vault
            </h1>
            <p className="text-body-sm text-body-sm text-secondary max-w-[280px] mx-auto">
              Trusted by NGOs worldwide for traceable grant management.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="px-4 py-3 border border-error bg-error-container text-on-error-container text-body-md flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div className="space-y-5">
              <div className="flex flex-col gap-1">
                <label htmlFor="login-email" className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                  Organizational Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="user@ngo.org"
                  className="bg-transparent border-0 border-b border-outline hover:border-primary focus:border-primary focus:outline-none px-0 py-2 font-source-code text-source-code text-on-surface placeholder:text-on-surface-variant/50 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="login-password" className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                  Access Protocol
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-transparent border-0 border-b border-outline hover:border-primary focus:border-primary focus:outline-none px-0 py-2 font-source-code text-source-code text-on-surface placeholder:text-on-surface-variant/50 transition-colors"
                  />
                  <button
                    type="button"
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-secondary hover:text-primary transition-colors"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-4 mt-8 pt-4 border-t border-outline-variant border-dashed">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 px-4 bg-primary text-on-primary font-label-caps text-label-caps tracking-wider flex items-center justify-center gap-2 hover:bg-surface-tint transition-colors notched-br disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-on-primary/40 border-t-on-primary rounded-full animate-spin" />
                    AUTHENTICATING…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">login</span>
                    AUTHENTICATE
                  </>
                )}
              </button>
              <Link
                to="/signup"
                className="w-full py-3 px-4 bg-transparent border border-outline text-primary font-label-caps text-label-caps tracking-wider flex items-center justify-center gap-2 hover:bg-surface-container transition-colors notched-br"
              >
                <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                CREATE ACCOUNT
              </Link>
            </div>
          </form>

          <div className="text-center">
            <p className="text-body-sm text-body-sm text-secondary">
              By accessing this vault, you agree to the{' '}
              <Link to="/signup" className="text-primary hover:underline">Audit Logs</Link> &{' '}
              <Link to="/signup" className="text-primary hover:underline">Terms of Service</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}