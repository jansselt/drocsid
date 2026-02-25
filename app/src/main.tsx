import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const VoicePopout = lazy(() => import('./components/voice/VoicePopout.tsx').then(m => ({ default: m.VoicePopout })));

const isPopout = new URLSearchParams(window.location.search).get('popout') === 'voice';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPopout ? (
      <Suspense fallback={null}>
        <VoicePopout />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
