'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const sessionSecret = 'test-session-secret-that-is-long-enough';
const sessionId = 'test-session';
const reportId = '11111111-1111-4111-8111-111111111111';
const expires = Date.now() + 60_000;
const reports = new Map([[reportId, { state: 'pending', createdAt: new Date().toISOString() }]]);
const centers = new Map();
const sessions = new Map([[sessionId, { expiresAt: new Date(expires).toISOString() }]]);

const store = {
  collection(name) {
    const records = name === 'sessions' ? sessions : name === 'centers' ? centers : reports;
    return {
      where() { return this; },
      orderBy() { return this; },
      async get() {
        return { docs: [...records].map(([id, row]) => ({ id, data: () => row })) };
      },
      doc(id) {
        return {
          async get() {
            const row = records.get(id);
            return {
              exists: !!row,
              get: key => row?.[key],
            };
          },
          async create(value) { records.set(id, value); },
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

async function call(method, body, path = `/api/admin/reports/${reportId}`) {
  const req = {
    method,
    url: path,
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

test('evacuation center descriptions are saved and included in public data', async () => {
  const description = 'A temporary shelter near the barangay hall.';
  const created = await call('POST', {
    name: 'Barangay Sta. Rita Covered Court / Multi-Purpose Hall',
    description,
    lat: 14.8489169,
    lon: 120.2909341,
  }, '/api/admin/centers');

  assert.equal(created.status, 201);
  assert.equal(created.body.description, description);

  const published = await call('GET', undefined, '/api/public');
  assert.equal(published.status, 200);
  assert.equal(published.body.centers[0].description, description);
});
