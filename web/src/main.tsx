import * as Tooltip from '@radix-ui/react-tooltip'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.tsx'
import { connect } from './store.ts'
import './theme.css'

const root = document.getElementById('app')
if (!root) throw new Error('no #app')
connect()
createRoot(root).render(
  <StrictMode>
    <Tooltip.Provider delayDuration={150}>
      <App />
    </Tooltip.Provider>
  </StrictMode>,
)
