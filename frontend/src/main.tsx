import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

// Apply persisted theme before first paint to prevent flash
;(function () {
  try {
    const raw = localStorage.getItem('thermobird-theme')
    const saved = raw ? JSON.parse(raw)?.state?.theme : null
    const theme = saved === 'light' ? 'light' : 'dark'
    document.documentElement.classList.add(theme)
  } catch {
    document.documentElement.classList.add('dark')
  }
})()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
