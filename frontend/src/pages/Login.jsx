import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-[26px]">shield_check</span>
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight text-primary">GrantGuard AI</h1>
          <p className="font-mono text-[12px] text-on-surface-variant uppercase tracking-widest mt-1">
            Compliance &amp; Evidence Engine
          </p>
        </div>

        <div className="bg-surface border border-outline-variant rounded-lg p-6 sm:p-8 shadow-sm">
          <h2 className="text-headline-md text-primary mb-1">Welcome back</h2>
          <p className="text-body-md text-on-surface-variant mb-6">Log in to your account</p>

          {error && (
            <div
              role="alert"
              className="mb-5 px-4 py-3 rounded border border-error/20 bg-error-container text-on-error-container text-body-md flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <label htmlFor="login-email" className="font-mono text-[12px] text-on-surface-variant uppercase tracking-wider">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full h-11 px-3 bg-surface border border-outline-variant rounded text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="login-password" className="font-mono text-[12px] text-on-surface-variant uppercase tracking-wider">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="w-full h-11 px-3 bg-surface border border-outline-variant rounded text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 bg-primary text-on-primary text-body-md font-medium rounded hover:bg-inverse-surface transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-on-primary/40 border-t-on-primary rounded-full animate-spin" />
                  Logging in…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">login</span>
                  Log in
                </>
              )}
            </button>
          </form>

          <p className="text-body-md text-on-surface-variant mt-6 text-center">
            Don&apos;t have an account?{' '}
            <Link to="/signup" className="text-primary font-semibold hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
