import { expect, test } from 'claude-code/testing'

import { applyOptions, languageFromEnv, pickOptions } from '../hooks/options'
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
