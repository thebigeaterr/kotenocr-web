import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// オフラインHTML版の起動中ローディング(#boot, pack-offline.mjs が注入)をマウント後に除去
document.getElementById('boot')?.remove()
