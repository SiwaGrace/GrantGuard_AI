import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-page">
        <p className="auth-status">Loading…</p>
      </div>
    )
  }

  return session ? <Outlet /> : <Navigate to="/login" replace />
}
