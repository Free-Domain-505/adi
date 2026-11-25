import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { SearchProvider } from './context/SearchContext'
import { ThemeProvider } from './context/ThemeContext'
import { VoiceCallProvider } from './context/VoiceCallContext'
import { startShield } from './lib/shield'
import { initAniListSync } from './lib/anilist'
import { installImageProtection } from './lib/imageProtection'
import './index.css'

startShield()
initAniListSync()
installImageProtection()

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => void r.unregister())
  }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SearchProvider>
            <VoiceCallProvider>
              <App />
            </VoiceCallProvider>
          </SearchProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
