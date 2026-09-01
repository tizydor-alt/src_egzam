import { QUESTIONS } from './questions.js';

const SESSION_SECONDS = 30 * 24 * 60 * 60;
// The free Workers plan allows only a small amount of CPU time per request.
// WebCrypto PBKDF2 remains deliberately expensive, but must fit that limit.
const PIN_ITERATIONS = 20000;
const encoder = new TextEncoder();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

async function bodyOf(request) {
  try { return await request.json(); } catch { return null; }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function randomToken(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: PIN_ITERATIONS }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validCredentials(username, pin) {
  return /^[a-z0-9_-]{3,24}$/.test(username) && /^\d{6}$/.test(String(pin || ''));
}

function cookieValue(request, name) {
  const cookies = request.headers.get('cookie') || '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `src_session=${encodeURIComponent(token)}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `src_session=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;
}

async function createSession(env, username, request) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await env.DB.prepare('INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)').bind(tokenHash, username, expiresAt).run();
  return sessionCookie(token, request);
}

async function authenticatedUser(env, request) {
  const token = cookieValue(request, 'src_session');
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const session = await env.DB.prepare('SELECT username FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(tokenHash, now).first();
  return session?.username || null;
}

async function authRoute(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    const username = await authenticatedUser(env, request);
    return json({ authenticated: Boolean(username), username });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await bodyOf(request);
    const username = normalizeUsername(body?.username);
    const pin = String(body?.pin || '');
    if (!validCredentials(username, pin)) return json({ error: 'Login: 3–24 znaki (litery, cyfry, _ lub -). PIN musi mieć dokładnie 6 cyfr.' }, 400);
    const salt = randomToken(16);
    const pinHash = await hashPin(pin, salt);
    try {
      await env.DB.prepare('INSERT INTO users (username, pin_hash, pin_salt) VALUES (?, ?, ?)').bind(username, pinHash, salt).run();
    } catch {
      return json({ error: 'Ten login jest już zajęty.' }, 409);
    }
    const cookie = await createSession(env, username, request);
    return json({ ok: true, username }, 201, { 'set-cookie': cookie });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await bodyOf(request);
    const username = normalizeUsername(body?.username);
    const pin = String(body?.pin || '');
    if (!validCredentials(username, pin)) return json({ error: 'Nieprawidłowy login lub PIN.' }, 401);
    const user = await env.DB.prepare('SELECT username, pin_hash, pin_salt, failed_attempts, locked_until FROM users WHERE username = ?').bind(username).first();
    const now = Math.floor(Date.now() / 1000);
    if (!user) {
      await hashPin(pin, 'unknown-user-timing-salt');
      return json({ error: 'Nieprawidłowy login lub PIN.' }, 401);
    }
    if (user.locked_until > now) return json({ error: `Za dużo błędnych prób. Spróbuj ponownie za ${Math.ceil((user.locked_until - now) / 60)} min.` }, 429);
    const candidateHash = await hashPin(pin, user.pin_salt);
    if (!safeEqual(candidateHash, user.pin_hash)) {
      const failures = (user.failed_attempts || 0) + 1;
      const lockedUntil = failures >= 5 ? now + 15 * 60 : 0;
      await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE username = ?').bind(failures, lockedUntil, username).run();
      return json({ error: lockedUntil ? 'Za dużo błędnych prób. Konto zablokowane na 15 minut.' : 'Nieprawidłowy login lub PIN.' }, lockedUntil ? 429 : 401);
    }
    await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE username = ?').bind(username).run();
    await env.DB.prepare('DELETE FROM sessions WHERE username = ? OR expires_at <= ?').bind(username, now).run();
    const cookie = await createSession(env, username, request);
    return json({ ok: true, username }, 200, { 'set-cookie': cookie });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = cookieValue(request, 'src_session');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(request) });
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (url.pathname.startsWith('/api/auth/')) {
        const response = await authRoute(request, env, url);
        return response || json({ error: 'Nie znaleziono.' }, 404);
      }

      const user = await authenticatedUser(env, request);
      if (!user) return json({ error: 'Zaloguj się, aby korzystać z quizu.' }, 401);

      if (request.method === 'GET' && url.pathname === '/api/questions') return json({ questions: QUESTIONS });

      if (request.method === 'GET' && url.pathname === '/api/progress') {
        const { results } = await env.DB.prepare(
          'SELECT question_nr, mastered, correct_count, wrong_count, last_answer, updated_at FROM progress WHERE user_id = ?'
        ).bind(user).all();
        return json({ user, progress: results });
      }

      if (request.method === 'POST' && url.pathname === '/api/progress') {
        const body = await bodyOf(request);
        const nr = Number(body?.questionNr);
        const mastered = body?.mastered === true ? 1 : 0;
        if (!QUESTIONS.some(q => q.nr === nr)) return json({ error: 'Nieznany numer pytania.' }, 400);
        await env.DB.prepare(`
          INSERT INTO progress (user_id, question_nr, mastered, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, question_nr) DO UPDATE SET mastered = excluded.mastered, updated_at = CURRENT_TIMESTAMP
        `).bind(user, nr, mastered).run();
        return json({ ok: true, questionNr: nr, mastered: Boolean(mastered) });
      }

      if (request.method === 'POST' && url.pathname === '/api/answer') {
        const body = await bodyOf(request);
        const nr = Number(body?.questionNr);
        const answer = String(body?.answer || '').toUpperCase();
        const question = QUESTIONS.find(q => q.nr === nr);
        if (!question || !['A', 'B', 'C'].includes(answer)) return json({ error: 'Nieprawidłowa odpowiedź.' }, 400);
        const correct = answer === question.poprawna;
        await env.DB.prepare(`
          INSERT INTO progress (user_id, question_nr, correct_count, wrong_count, last_answer, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, question_nr) DO UPDATE SET
            correct_count = correct_count + excluded.correct_count,
            wrong_count = wrong_count + excluded.wrong_count,
            last_answer = excluded.last_answer,
            updated_at = CURRENT_TIMESTAMP
        `).bind(user, nr, correct ? 1 : 0, correct ? 0 : 1, answer).run();
        return json({ ok: true, correct, correctAnswer: question.poprawna });
      }

      return json({ error: 'Nie znaleziono.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'Błąd bazy danych lub konfiguracji aplikacji.' }, 500);
    }
  }
};
