import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return session ? <Outlet /> : <Navigate to="/login" replace />
}
