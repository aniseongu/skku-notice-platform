const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HealthController } = require('../dist/app');

test('health returns a minimal status', () => {
  assert.deepEqual(new HealthController().health(), { status: 'ok' });
});
