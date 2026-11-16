'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const sessionSecret = 'test-session-secret-that-is-long-enough';
const sessionId = 'test-session';
const reportId = '11111111-1111-4111-8111-111111111111';
const expires = Date.now() + 60_000;
const reports = new Map([[reportId, { state: 'pending', createdAt: new Date().toISOString() }]]);
const sessions = new Map([[sessionId, { expiresAt: new Date(expires).toISOString() }]]);

const store = {
  collection(name) {
    const records = name === 'sessions' ? sessions : reports;
    return {
      doc(id) {
        return {
          async get() {
            const row = records.get(id);
            return {
              exists: !!row,
              get: key => row?.[key],
            };
          },
          async update(value) { Object.assign(records.get(id), value); },
          async delete() { records.delete(id); },
        };
      },
    };
  },
};

const appPath = require.resolve('firebase-admin/app');
const firestorePath = require.resolve('firebase-admin/firestore');
require(appPath);
require(firestorePath);
require.cache[appPath].exports = {
  ...require.cache[appPath].exports,
  cert: value => value,
  getApps: () => [{}],
  initializeApp: () => ({}),
};
require.cache[firestorePath].exports = {
  ...require.cache[firestorePath].exports,
  getFirestore: () => store,
};

process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from('{"project_id":"test"}').toString('base64');
process.env.SAFEPATH_SESSION_SECRET = sessionSecret;
process.env.SAFEPATH_ADMIN_PASSWORD = 'test-admin-password-long-enough';

const handler = require('../api/handler');
const payload = `${sessionId}.${expires}`;
const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
const cookie = `sp_admin=${encodeURIComponent(`${payload}.${signature}`)}`;

async function call(method, body) {
  const req = {
    method,
    url: `/api/admin/reports/${reportId}`,
    headers: { host: 'safepath.test', origin: 'https://safepath.test', cookie },
    socket: { encrypted: true },
    body,
  };
  const res = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
  };
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test('admin report actions enforce valid state transitions', async () => {
  const resolvePending = await call('PATCH', { action: 'resolve' });
  assert.equal(resolvePending.status, 409);
  assert.equal(reports.get(reportId).state, 'pending');

  const deletePending = await call('DELETE');
  assert.equal(deletePending.status, 409);
  assert.equal(reports.get(reportId).state, 'pending');

  const approve = await call('PATCH', { action: 'approve' });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.state, 'active');

  const resolveActive = await call('PATCH', { action: 'resolve' });
  assert.equal(resolveActive.status, 200);
  assert.equal(resolveActive.body.state, 'resolved');
});
