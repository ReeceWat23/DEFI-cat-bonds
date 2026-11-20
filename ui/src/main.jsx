import React from 'react'
import ReactDOM from 'react-dom/client'
import { ChainProvider } from './chains/ChainProvider'
import { ThemeProvider } from './theme/ThemeProvider'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChainProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ChainProvider>
  </React.StrictMode>,
)
