import assert from 'node:assert/strict';
import test from 'node:test';
import { b64urlEncode, decryptApiKey, encryptApiKey, importMasterKey, looksLikeGeminiKey } from '../../supabase/functions/byok/crypto.ts';

const MASTER = 'a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s'; // 32 x "k"
const USER = '00000000-0000-0000-0000-000000000001';
const KEY = `AIza${'A'.repeat(35)}`;
// Produced by the Python worker module (tests/test_byok_crypto.py reads the same vector).
const VECTOR = 'aWlpaWlpaWlpaWlpm82CFXO54EW6FaA52lZkJtPlP0teevcNZHwPgEmJpx5G89PtYPFfXvVYdQ6IB5-Wqx6Ka1xirQ';

test('Edge Function and Python worker use the same ciphertext format', async () => {
  const key = await importMasterKey(MASTER);
  assert.equal(await decryptApiKey(key, USER, VECTOR), KEY);
  assert.equal(await encryptApiKey(key, USER, KEY, new Uint8Array(12).fill(0x69)), VECTOR);
});

test('ciphertext is bound to its user and rejects tampering', async () => {
  const key = await importMasterKey(MASTER);
  const stored = await encryptApiKey(key, USER, KEY);
  assert.notEqual(stored, await encryptApiKey(key, USER, KEY), 'a fresh IV is used each time');
  assert.equal(await decryptApiKey(key, USER, stored), KEY);
  await assert.rejects(decryptApiKey(key, '00000000-0000-0000-0000-000000000002', stored));
  const bytes = Buffer.from(stored, 'base64url');
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decryptApiKey(key, USER, b64urlEncode(bytes)));
  await assert.rejects(decryptApiKey(key, USER, 'AAAA'));
});

test('master key must be 32 bytes and key format is checked', async () => {
  await assert.rejects(importMasterKey('c2hvcnQ'), /32 bytes/);
  assert.equal(looksLikeGeminiKey(KEY), true);
  for (const bad of ['', 'AIza', `AIza${'!'.repeat(35)}`, `sk-${'a'.repeat(40)}`, null, 12]) assert.equal(looksLikeGeminiKey(bad), false);
});

test('accepts both Gemini key formats (AIza and AQ.) and nothing else', () => {
  assert.equal(looksLikeGeminiKey(`AQ.${'a'.repeat(50)}`), true);
  assert.equal(looksLikeGeminiKey(`AQ.Ab8RN6J${'x'.repeat(40)}`), true);
  assert.equal(looksLikeGeminiKey('AQ.short'), false);
  assert.equal(looksLikeGeminiKey(`AQ-${'a'.repeat(50)}`), false);
  assert.equal(looksLikeGeminiKey(`AQ.${'a'.repeat(30)} x`), false);
});
