// Kiro Crew mounts this as a side-panel tab and as a page. React comes from Kiro Crew's page, so there is nothing to build.
import { createElement, useEffect, useState } from 'react'

// shortcut: the server moves to the next port when another program holds this one, and the tab then stays empty; read the port from the app's route if that happens.
const URL = 'http://127.0.0.1:47311/'

// shortcut: Kiro Crew's address names the open chat in `?sid=`, which is not a published contract; without it the page shows its last pick.
const chatOf = () => new URLSearchParams(location.search).get('sid') ?? ''

export default function AgentMonPanel() {
  const [chat, setChat] = useState(chatOf)
  // Kiro Crew changes chats with pushState, which fires no event.
  useEffect(() => {
    const timer = setInterval(() => setChat(chatOf()), 1000)
    return () => clearInterval(timer)
  }, [])
  // Only the hash changes between chats, so the page does not reload.
  const src = chat ? `${URL}#kiro=${encodeURIComponent(chat)}` : URL
  return createElement('iframe', { src, title: 'AgentMon Live', style: { width: '100%', height: '100%', minHeight: 480, border: 0, display: 'block' } })
}
