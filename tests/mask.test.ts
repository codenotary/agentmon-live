import { expect, test } from 'claude-code/testing'

import { brief, mask } from '../hooks/format'

test('mask hides JSON-quoted secret keys', () => {
  expect(mask('{"password": "hunter2"}')).toBe('{"password": "***"}')
  expect(mask('{"token":"abcd1234"}')).toBe('{"token":"***"}')
  expect(mask('"aws_secret_access_key": "wJalrXUtnFEMI/K7MDENG"')).toBe('"aws_secret_access_key": "***"')
})

test('mask hides the token after an Authorization token scheme', () => {
  expect(mask('Authorization: token gho_16C7e42F292c6912E7710c838347Ae178B4a')).toBe('Authorization: token ***')
})

test('mask hides known token shapes', () => {
  for (const s of ['gho_16C7e42F292c6912E7710c838347Ae178B4a', 'ghs_abcdefghijklmnopqrstuvwx', 'hf_abcdefghijklmnopqrstuvwxyz', 'xoxa-1234567890-abc', 'xoxs-1234567890-abc', 'xapp-1-A0123-4567', 'whsec_abcdefghijklmnopqrstuvwxyz', 'ya29.a0AfH6SMBabcdefghijklmnop'])
    expect(mask(`x ${s} y`)).toBe('x *** y')
  expect(mask('curl https://hooks.slack.com/services/T0000/B0000/XXXXXXXX')).toBe('curl https://***')
})

test('mask hides signatures but not signals', () => {
  expect(mask('https://b.s3.amazonaws.com/f?X-Amz-Signature=abc123def&x=1')).toBe('https://b.s3.amazonaws.com/f?X-Amz-Signature=***&x=1')
  expect(mask('https://a.blob.core.windows.net/c?sv=2020&sig=abc%2Bdef')).toBe('https://a.blob.core.windows.net/c?sv=2020&sig=***')
  expect(mask('kill signal 9 sent')).toBe('kill signal 9 sent')
})

test('mask hides a whole PEM private key', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nabcdef\n-----END RSA PRIVATE KEY-----\ndone'
  expect(mask(pem)).toBe('-----BEGIN RSA PRIVATE KEY-----***\ndone')
  expect(mask('-----BEGIN PRIVATE KEY-----\nMIIEcut')).toBe('-----BEGIN PRIVATE KEY-----***')
})

test('mask hides password flags', () => {
  expect(mask('sshpass -p hunter2 ssh host')).toBe('sshpass -p *** ssh host')
  expect(mask('redis-cli -h db -a hunter2 ping')).toBe('redis-cli -h db -a *** ping')
  expect(mask('tool --password hunter2 run')).toBe('tool --password *** run')
  expect(mask('tool --password=hunter2 run')).toBe('tool --password=*** run')
})

test('mask on a long secret-ish line stays fast', () => {
  const s = `${'-----BEGIN '.repeat(5000)}${'token '.repeat(20_000)}${'a'.repeat(50_000)}`
  const t = performance.now()
  mask(s)
  brief({ command: s })
  expect(performance.now() - t).toBeLessThan(500)
})
