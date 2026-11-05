import * as Tooltip from '@radix-ui/react-tooltip'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'

import { App } from './App.tsx'
import { connect, useStore } from './store.ts'
import './theme.css'

function Toasts() {
  const { theme } = useStore()
  return <Toaster position="bottom-right" richColors theme={theme === 'auto' ? 'system' : theme} />
}

const root = document.getElementById('app')
if (!root) throw new Error('no #app')
connect()
createRoot(root).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider delayDuration={150}>
        <App />
        <Toasts />
      </Tooltip.Provider>
    </MotionConfig>
  </StrictMode>,
)
