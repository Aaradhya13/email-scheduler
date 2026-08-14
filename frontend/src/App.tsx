import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AppLayout from './components/AppLayout'
import ComposePage from './pages/ComposePage'
import EmailDetailPage from './pages/EmailDetailPage'
import LoginPage from './pages/LoginPage'
import MailboxPage from './pages/MailboxPage'
import './App.css'

function ProtectedApp() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="loading-screen">Loading Outbox Labs...</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/scheduled" replace />} />
        <Route path="/scheduled" element={<MailboxPage type="scheduled" />} />
        <Route path="/sent" element={<MailboxPage type="sent" />} />
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/email/:id" element={<EmailDetailPage />} />
        <Route path="*" element={<Navigate to="/scheduled" replace />} />
      </Routes>
    </AppLayout>
  )
}

function LoginRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="loading-screen">Loading Outbox Labs...</div>
  }

  if (user) {
    return <Navigate to="/scheduled" replace />
  }

  return <LoginPage />
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/*" element={<ProtectedApp />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
