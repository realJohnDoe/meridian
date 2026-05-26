import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import NodeInheritanceDebugger from './NodeInheritanceDebugger'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NodeInheritanceDebugger />
  </StrictMode>,
)
