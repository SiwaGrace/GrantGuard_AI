import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import './index.css'
import './app.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <Toaster
      position="top-right"
      gutter={10}
      toastOptions={{
        duration: 4000,
        style: {
          fontFamily: "'Work Sans', system-ui, sans-serif",
          borderRadius: 4,
          background: 'var(--color-surface)',
          color: 'var(--color-on-surface)',
          border: '1px solid var(--color-outline-variant)',
        },
      }}
    />
  </StrictMode>,
)
