// A local stand-in for Supabase for end-to-end runs: /rest/v1 is forwarded
// to PostgREST, and /auth/v1 answers password sign-in and "who is this
// token" for the users in tests/db/fixture.sql. Test-only: the password and
// signing secret below exist nowhere else.
import http from 'node:http';
import crypto from 'node:crypto';

const [listenPort, postgrestPort] = process.argv.slice(2).map(Number);
const SECRET = 'local-test-secret-local-test-secret-0123456789';
const PASSWORD = 'e2e-password';
const USERS = {
  'owner@example.com': '00000000-0000-0000-0000-000000000001',
  'member@example.com': '00000000-0000-0000-0000-000000000004',
  'advocate@example.com': '00000000-0000-0000-0000-000000000007',
  'treasurer@example.com': '00000000-0000-0000-0000-000000000008',
  'counter@example.com': '00000000-0000-0000-0000-000000000009',
};

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(payload) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
function verify(token) {
  const [header, payload, signature] = String(token || '').split('.');
  if (!signature) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  if (expected !== signature) return null;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}
const userFor = (claims) => ({
  id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email,
  email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
});

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (req.method === 'OPTIONS') return send(res, 204);

  if (url.pathname.startsWith('/auth/v1/')) {
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = await readBody(req);
      const id = USERS[String(email || '').toLowerCase()];
      if (!id || password !== PASSWORD) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const claims = { sub: id, email: email.toLowerCase(), role: 'authenticated', aud: 'authenticated', exp: expiresAt };
      return send(res, 200, {
        access_token: sign(claims), token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
        refresh_token: `refresh-${id}`, user: userFor(claims),
      });
    }
    if (url.pathname === '/auth/v1/user') {
      const claims = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
      return claims ? send(res, 200, userFor(claims)) : send(res, 401, { msg: 'Invalid token' });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname === '/auth/v1/invite') return send(res, 200, {});
    return send(res, 404, { msg: `Not stubbed: ${url.pathname}` });
  }

  const path = req.url.replace(/^\/rest\/v1/, '') || '/';
  const upstream = http.request({ host: '127.0.0.1', port: postgrestPort, path, method: req.method, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => send(res, 502, { message: String(e) }));
  req.pipe(upstream);
}).listen(listenPort, '127.0.0.1');
