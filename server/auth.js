// Password hashing and login sessions.
// Passwords: PBKDF2-SHA256 with a random salt (built into Cloudflare, no extra library).
// Sessions: a random token lives in an HttpOnly cookie; the database stores only its hash.

import { HttpError, utcStamp } from './util.js';

const ITERATIONS = 100000;
const SESSION_HOURS = 72;
export const COOKIE_NAME = 'isp_session';

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const expected = fromB64(parts[3]);
  const actual = new Uint8Array(await pbkdf2(password, fromB64(parts[2]), parseInt(parts[1], 10)));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function checkPasswordRules(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'password: must be at least 8 characters');
  }
  if (password.length > 128) throw new HttpError(400, 'password: is too long');
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function cookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

export async function createSession(db, request, userId, ip) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = utcStamp(new Date(Date.now() + SESSION_HOURS * 3600 * 1000));
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
    db
      .prepare('INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token), userId, expires, ip || null, (request.headers.get('user-agent') || '').slice(0, 200)),
  ]);
  return cookie(request, token, SESSION_HOURS * 3600);
}

function readToken(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export async function getSessionUser(db, request) {
  const token = readToken(request);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1`
    )
    .bind(await sha256Hex(token))
    .first();
  return row || null;
}

export async function destroySession(db, request) {
  const token = readToken(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  return cookie(request, '', 0);
}
