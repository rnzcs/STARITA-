'use strict';

const crypto = require('node:crypto');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const bounds = { minLat: 14.838, maxLat: 14.862, minLon: 120.277, maxLon: 120.307 };
const attempts = new Map();
let firestore;

function db() {
  if (firestore) return firestore;
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!encoded) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is not configured.');
  const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
  firestore = getFirestore(app);
  return firestore;
}

function json(res, status, value, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, content] of Object.entries(headers)) res.setHeader(name, content);
  res.end(JSON.stringify(value));
}

function limited(key, maximum, windowMs) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.until <= now) {
    attempts.set(key, { count: 1, until: now + windowMs });
    return false;
  }
  record.count += 1;
  return record.count > maximum;
}

function validCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= bounds.minLat && lat <= bounds.maxLat
    && lon >= bounds.minLon && lon <= bounds.maxLon;
}

async function body(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body || '{}'); } catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }); }
    }
    return req.body || {};
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }); }
}

async function objectBody(req) {
  const value = await body(req);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Invalid JSON request.'), { status: 400 });
  }
  return value;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function cookieOptions(req, maxAge) {
  const secure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function sessionSecret() {
  const value = process.env.SAFEPATH_SESSION_SECRET || '';
  if (value.length < 32) throw new Error('SAFEPATH_SESSION_SECRET must be at least 32 characters.');
  return value;
}

function signedSession(req) {
  const token = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('sp_admin='));
  if (!token) return false;
  let value;
  try { value = decodeURIComponent(token.slice('sp_admin='.length)); } catch { return false; }
  const [id, expires, signature] = value.split('.');
  if (!id || !expires || !signature || Number(expires) <= Date.now()) return false;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(`${id}.${expires}`).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right) ? { id, expires: Number(expires) } : false;
}

async function isAdmin(req, store) {
  const session = signedSession(req);
  if (!session) return false;
  const snapshot = await store.collection('sessions').doc(session.id).get();
  return snapshot.exists && Date.parse(snapshot.get('expiresAt')) === session.expires;
}

function sessionCookie(req, id, expires, maxAge) {
  const payload = `${id}.${expires}`;
  const signature = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `sp_admin=${encodeURIComponent(`${payload}.${signature}`)}; ${cookieOptions(req, maxAge)}`;
}

function publicReport(snapshot) {
  const row = snapshot.data();
  return { id: snapshot.id, kind: row.kind, condition: row.condition, lat: row.lat, lon: row.lon, points: row.points, createdAt: row.createdAt };
}

function adminReport(snapshot) {
  const row = snapshot.data();
  return { ...publicReport(snapshot), name: row.name || '', phone: row.phone || '', state: row.state, updatedAt: row.updatedAt };
}

function reportSort(a, b) {
  const priority = { pending: 0, active: 1, resolved: 2, rejected: 3 };
  return priority[a.state] - priority[b.state] || b.createdAt.localeCompare(a.createdAt);
}

async function handler(req, res) {
  try {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Request origin is not allowed.' });
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const store = db();

    if (req.method === 'GET' && url.pathname === '/api/public') {
      const [reportSnapshot, centerSnapshot] = await Promise.all([
        store.collection('reports').where('state', '==', 'active').get(),
        store.collection('centers').orderBy('name').get(),
      ]);
      return json(res, 200, {
        reports: reportSnapshot.docs.map(publicReport).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        centers: centerSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/reports') {
      if (limited(`report:${ip}`, 30, 15 * 60 * 1000)) return json(res, 429, { error: 'Too many reports from this connection. Try again later.' });
      const value = await objectBody(req);
      const kind = value.kind;
      const condition = value.condition;
      const lat = Number(value.lat);
      const lon = Number(value.lon);
      const points = kind === 'area'
        ? Array.isArray(value.points) ? value.points.map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : point) : value.points
        : [[lat, lon]];
      if (!['road', 'area'].includes(kind) || !['flooded', 'blocked'].includes(condition)) {
        return json(res, 400, { error: 'Choose a valid report type and condition.' });
      }
      if (kind === 'road' && !validCoordinate(lat, lon)) return json(res, 400, { error: 'The selected road must be within Barangay Sta. Rita.' });
      if (kind === 'area' && (!Array.isArray(points) || points.length < 3 || points.length > 100
        || points.some(point => !Array.isArray(point) || point.length !== 2 || !validCoordinate(Number(point[0]), Number(point[1]))))) {
        return json(res, 400, { error: 'Draw an area with 3 to 100 points inside Barangay Sta. Rita.' });
      }
      const centerLat = kind === 'road' ? lat : points.reduce((sum, point) => sum + Number(point[0]), 0) / points.length;
      const centerLon = kind === 'road' ? lon : points.reduce((sum, point) => sum + Number(point[1]), 0) / points.length;
      const name = String(value.name || '').trim().slice(0, 80);
      const phone = String(value.phone || '').trim().slice(0, 30);
      if (phone && !/^[+()\d .-]{7,30}$/.test(phone)) return json(res, 400, { error: 'Enter a valid phone number or leave it blank.' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await store.collection('reports').doc(id).create({
        kind, condition, lat: centerLat, lon: centerLon, points, name, phone, state: 'pending', createdAt: now, updatedAt: now,
      });
      return json(res, 201, { id, state: 'pending', message: 'Report sent to the barangay team for review.' });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      if (limited(`login:${ip}`, 8, 15 * 60 * 1000)) return json(res, 429, { error: 'Too many sign-in attempts. Try again later.' });
      const password = process.env.SAFEPATH_ADMIN_PASSWORD || '';
      if (password.length < 16) throw new Error('SAFEPATH_ADMIN_PASSWORD must be at least 16 characters.');
      const value = await objectBody(req);
      const supplied = crypto.scryptSync(String(value.password || ''), sessionSecret().slice(0, 16), 64);
      const expected = crypto.scryptSync(password, sessionSecret().slice(0, 16), 64);
      if (!crypto.timingSafeEqual(supplied, expected)) return json(res, 401, { error: 'Incorrect admin password.' });
      attempts.delete(`login:${ip}`);
      const id = crypto.randomBytes(32).toString('base64url');
      const expires = Date.now() + 8 * 60 * 60 * 1000;
      await store.collection('sessions').doc(id).create({ expiresAt: new Date(expires).toISOString() });
      return json(res, 200, { authenticated: true }, { 'Set-Cookie': sessionCookie(req, id, expires, 8 * 60 * 60) });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/session') {
      return json(res, 200, { authenticated: await isAdmin(req, store) });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      const session = signedSession(req);
      if (!session || !(await isAdmin(req, store))) return json(res, 401, { error: 'Admin sign-in required.' });
      await store.collection('sessions').doc(session.id).delete();
      return json(res, 200, { authenticated: false }, { 'Set-Cookie': `sp_admin=; ${cookieOptions(req, 0)}` });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      if (!(await isAdmin(req, store))) return json(res, 401, { error: 'Admin sign-in required.' });
      if (req.method === 'GET' && url.pathname === '/api/admin/reports') {
        const snapshot = await store.collection('reports').get();
        return json(res, 200, { reports: snapshot.docs.map(adminReport).sort(reportSort) });
      }
      const reportMatch = url.pathname.match(/^\/api\/admin\/reports\/([0-9a-f-]+)$/i);
      if (req.method === 'DELETE' && reportMatch) {
        const reference = store.collection('reports').doc(reportMatch[1]);
        const snapshot = await reference.get();
        if (!snapshot.exists) return json(res, 404, { error: 'Report not found.' });
        if (!['resolved', 'rejected'].includes(snapshot.get('state'))) {
          return json(res, 409, { error: 'Only resolved or rejected reports can be deleted.' });
        }
        await reference.delete();
        return json(res, 200, { id: reportMatch[1], deleted: true });
      }
      if (req.method === 'PATCH' && reportMatch) {
        const { action } = await objectBody(req);
        const states = { approve: 'active', reject: 'rejected', resolve: 'resolved' };
        if (!Object.hasOwn(states, action)) return json(res, 400, { error: 'Choose approve, reject, or resolve.' });
        const completedActions = { approve: 'approved', reject: 'rejected', resolve: 'resolved' };
        const expectedState = action === 'resolve' ? 'active' : 'pending';
        const reference = store.collection('reports').doc(reportMatch[1]);
        const snapshot = await reference.get();
        if (!snapshot.exists) return json(res, 404, { error: 'Report not found.' });
        if (snapshot.get('state') !== expectedState) {
          return json(res, 409, { error: `Only ${expectedState} reports can be ${completedActions[action]}.` });
        }
        await reference.update({ state: states[action], updatedAt: new Date().toISOString() });
        return json(res, 200, { id: reportMatch[1], state: states[action] });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/centers') {
        const value = await objectBody(req);
        const name = String(value.name || '').trim();
        const lat = Number(value.lat), lon = Number(value.lon);
        if (!name || name.length > 100 || !validCoordinate(lat, lon)) return json(res, 400, { error: 'Enter a center name and choose a map location inside Barangay Sta. Rita.' });
        const item = { id: crypto.randomUUID(), name, lat, lon, createdAt: new Date().toISOString() };
        await store.collection('centers').doc(item.id).create(item);
        return json(res, 201, item);
      }
      const centerMatch = url.pathname.match(/^\/api\/admin\/centers\/([A-Za-z0-9_-]+)$/);
      if (req.method === 'DELETE' && centerMatch) {
        const reference = store.collection('centers').doc(centerMatch[1]);
        const snapshot = await reference.get();
        if (!snapshot.exists) return json(res, 404, { error: 'Evacuation center not found.' });
        await reference.delete();
        return json(res, 200, { id: centerMatch[1], deleted: true });
      }
    }
    return json(res, 404, { error: 'API endpoint not found.' });
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' });
    if (!error.status) console.error(error);
  }
}

module.exports = handler;
