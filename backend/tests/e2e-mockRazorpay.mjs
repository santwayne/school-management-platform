import http from 'http';
let n = 0;
export const calls = [];
export function startMock(port) {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = body ? JSON.parse(body) : {};
      calls.push({ method: req.method, url: req.url, body: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/subscriptions') return res.end(JSON.stringify({ id: `sub_mock${++n}`, short_url: 'https://rzp.io/x', status: 'created' }));
      if (req.url === '/v1/orders') return res.end(JSON.stringify({ id: `order_mock${++n}`, amount: b.amount, status: 'created' }));
      if (/\/v1\/subscriptions\/.+\/cancel/.test(req.url)) return res.end(JSON.stringify({ status: 'cancelled' }));
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}
