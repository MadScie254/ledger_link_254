// supabase-js calls <url>/rest/v1/...; PostgREST serves the same paths at
// its root. This forwards one to the other for the integration suites.
import http from 'node:http';

const [listenPort, upstreamPort] = process.argv.slice(2).map(Number);
http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, '') || '/';
  const forward = (attempt) => {
    const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, path, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (error) => {
      // The Windows PostgREST binary can reset a HEAD count request. It is safe to retry before a response starts.
      if (req.method === 'HEAD' && attempt < 3 && !res.headersSent) return forward(attempt + 1);
      if (!res.headersSent) res.writeHead(502);
      res.end(String(error));
    });
    if (attempt === 1) req.pipe(upstream);
    else upstream.end();
  };
  forward(1);
}).listen(listenPort, '127.0.0.1');
