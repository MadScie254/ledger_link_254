// supabase-js calls <url>/rest/v1/...; PostgREST serves the same paths at
// its root. This forwards one to the other for the integration suites.
import http from 'node:http';

const [listenPort, upstreamPort] = process.argv.slice(2).map(Number);
http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, '') || '/';
  const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, path, method: req.method, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(upstream);
}).listen(listenPort, '127.0.0.1');
