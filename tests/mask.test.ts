import { expect, test } from 'claude-code/testing'

import { brief, hasSecret, mask } from '../hooks/format'

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

test('mask hides pass, passphrase, credentials, private keys and a bare bearer token', () => {
  expect(mask('privateKey: abcdef123')).toBe('privateKey: ***')
  expect(mask('DB_PASS=hunter2')).toBe('DB_PASS=***')
  expect(mask('export PASS=hunter2')).toBe('export PASS=***')
  expect(mask('passphrase=hunter2xx')).toBe('passphrase=***')
  expect(mask('credentials=abc123')).toBe('credentials=***')
  expect(mask('curl -H "Bearer abcdefghijkl"')).toBe('curl -H "Bearer ***"')
  expect(mask('passes: 3')).toBe('passes: 3')
  expect(mask('maxTokens: 4000')).toBe('maxTokens: 4000')
})


test('hasSecret takes a literal secret and leaves references, wildcards and plain words', () => {
  // Fake values, joined here so the source holds nothing a secret scanner takes for a key.
  const fake = (...parts: string[]) => parts.join('')
  expect(hasSecret(`Bash(curl -H "Authorization: ${fake('Bea', 'rer abc123', 'def456ghi789')}" https://example.com)`)).toBe(true)
  expect(hasSecret(`Bash(curl -H "X-Api-Key: ${fake('9f8e7d6c', '5b4a3210ffee')}" https://example.com)`)).toBe(true)
  expect(hasSecret(`Bash(OPENAI_API_KEY=${fake('sk-', 'proj-abcdefgh', 'ijklmnop1234')} npm test)`)).toBe(true)
  expect(hasSecret('Bash(git clone https://user:pw@example.com/repo.git)')).toBe(true)
  expect(hasSecret('Bash(gh auth token:*)')).toBe(false)
  expect(hasSecret('Bash(export API_KEY=$FOO)')).toBe(false)
  expect(hasSecret('Bash(curl -H "Authorization: Bearer $TOKEN" https://example.com)')).toBe(false)
  expect(hasSecret('Bash(npm run token-refresh:*)')).toBe(false)
  expect(hasSecret('MAX_THINKING_TOKENS=31999')).toBe(false)
  expect(hasSecret('KEY_FILE=/home/me/keys/service-account-2024.json')).toBe(false)
  expect(hasSecret('Bash(export SSL_KEY_PATH=~/ssl/private/server2024.pem)')).toBe(false)
  expect(hasSecret('echo use Bearer authentication here')).toBe(false)
  expect(hasSecret('Bash(git clone https://user:$PW@example.com/repo.git)')).toBe(false)
  expect(hasSecret('Bash(git clone https://myorganizationname@dev.azure.com/myorganizationname/p/_git/r)')).toBe(false)
  expect(hasSecret(`Bash(git clone https://${fake('ghp12345', '67890abcdefghij')}@github.com/o/r.git)`)).toBe(true)
})
