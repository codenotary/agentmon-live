// Kiro Crew mounts this as a side-panel tab and as a page. React comes from Kiro Crew's page, so there is nothing to build.
import { createElement, useEffect, useState } from 'react'

// Through Kiro Crew's own address, so the tab also works on a phone or another machine that reaches the gateway.
const URL = '/apps/agentmon-live/api/'

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
