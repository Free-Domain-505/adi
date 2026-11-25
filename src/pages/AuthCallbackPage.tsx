import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthPage from './AuthPage'

export default function AuthCallbackPage() {
  const { user } = useAuth()
  if (user) return <Navigate to="/home" replace />
  return <AuthPage />
}
