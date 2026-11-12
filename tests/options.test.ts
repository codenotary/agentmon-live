import { expect, test } from 'claude-code/testing'

import { applyOptions, languageFromEnv, pickOptions, secretStrings } from '../hooks/options'
import { cfg } from '../hooks/state'

test('pickOptions merges this mod\'s entries and ignores others', () => {
  const settings = { pluginConfigs: { 'agentmon-live': { options: { language: 'de' } }, 'agentmon-live@agentmon-live': { options: { layout: 'classic' } }, 'agentmon-livex@y': { options: { learning: 'off' } }, 'other@agentmon-live': { options: { learning: 'off' } } } }
  expect(pickOptions(JSON.stringify(settings))).toEqual({ language: 'de', layout: 'classic' })
})

test('pickOptions fails open', () => {
  expect(pickOptions('not json')).toEqual({})
  expect(pickOptions('{}')).toEqual({})
  expect(pickOptions('null')).toEqual({})
  expect(pickOptions('{"pluginConfigs":{"agentmon-live":null}}')).toEqual({})
})

test('languageFromEnv takes the language of a locale the mod knows', () => {
  expect(languageFromEnv('de_CH.UTF-8')).toBe('de')
  expect(languageFromEnv('ja_JP')).toBe('ja')
  expect(languageFromEnv('C.UTF-8')).toBe(undefined)
  expect(languageFromEnv('POSIX')).toBe(undefined)
  expect(languageFromEnv('pt_BR.UTF-8')).toBe(undefined)
  expect(languageFromEnv(undefined)).toBe(undefined)
})

test('a set language beats the terminal; an unknown one falls back to it, then to English', () => {
  applyOptions({ language: 'fr' }, 'de')
  expect(cfg.lang).toBe('fr')
  applyOptions({ language: 'xx' }, 'de')
  expect(cfg.lang).toBe('de')
  expect(cfg.t.cat).toBeTruthy()
  applyOptions({}, undefined)
  expect(cfg.lang).toBe('en')
})

test('the web options default on, on the usual port, with no tab opened', () => {
  applyOptions({}, undefined)
  expect([cfg.web, cfg.webPort, cfg.webOpenOnStart, cfg.isWebLocked]).toEqual([true, 47311, false, true])
  applyOptions({ web: 'off', webPort: 50000, webOpenOnStart: true, webToken: 'off' }, undefined)
  expect([cfg.web, cfg.webPort, cfg.webOpenOnStart, cfg.isWebLocked]).toEqual([false, 50000, true, false])
})

test('a language that names something every object has is no language', () => {
  applyOptions({ language: 'constructor' }, 'toString')
  expect(cfg.lang).toBe('en')
  expect(cfg.t.off).toBe('off')
})

test('a webPort outside the unprivileged range falls back to the default', () => {
  for (const webPort of [80, 70000, 'x', 1.5]) {
    applyOptions({ webPort }, undefined)
    expect(cfg.webPort).toBe(47311)
  }
})

test('secretStrings finds an allow rule and an env value, masked, and fails open', () => {
  // Fake values, joined here so the source holds nothing a secret scanner takes for a key.
  const fake = (...parts: string[]) => parts.join('')
  const settings = {
    permissions: { allow: ['Bash(npm test:*)', `Bash(curl -H "Authorization: ${fake('Bea', 'rer abc123', 'def456ghi789')}" https://example.com)`] },
    env: { MAX_THINKING_TOKENS: '31999', SERVICE_API_KEY: fake('9f8e7d6c', '5b4a3210ffee') },
    apiKeyHelper: '/usr/local/bin/key-helper-v2-2024.sh',
    mcpServers: { api: { headers: { 'X-API-Key': fake('0a1b2c3d', '4e5f67890abc') } } },
  }
  expect(secretStrings(JSON.stringify(settings))).toEqual(['Bash(curl -H "Authorization: Bearer ***" https://example.com)', 'SERVICE_API_KEY=***', 'X-API-Key=***'])
  expect(secretStrings('not json')).toEqual([])
  expect(secretStrings('null')).toEqual([])
})
