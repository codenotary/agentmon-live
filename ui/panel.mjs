// Kiro Crew mounts this as a side-panel tab and as a page. React comes from Kiro Crew's page, so there is nothing to build.
import { createElement } from 'react'

// shortcut: the server moves to the next port when another program holds this one, and the tab then stays empty; read the port from the app's route if that happens.
const URL = 'http://127.0.0.1:47311/'

export default function AgentMonPanel() {
  return createElement('iframe', { src: URL, title: 'AgentMon Live', style: { width: '100%', height: '100%', minHeight: 480, border: 0, display: 'block' } })
}
