import http from 'http';
let n = 0;
export const calls = [];
export const plans = {}; // id -> plan object (POST /v1/plans, GET /v1/plans/:id)
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
      if (req.method === 'POST' && req.url === '/v1/plans') {
        if (!(b.item?.amount > 0)) { res.statusCode = 400; return res.end(JSON.stringify({ error: { description: 'amount is required' } })); }
        const plan = { id: `plan_mock${++n}`, entity: 'plan', period: b.period, interval: b.interval, item: { ...b.item }, notes: b.notes };
        plans[plan.id] = plan;
        return res.end(JSON.stringify(plan));
      }
      const pm = req.url.match(/^\/v1\/plans\/([^/?]+)$/);
      if (req.method === 'GET' && pm) {
        if (plans[pm[1]]) return res.end(JSON.stringify(plans[pm[1]]));
        res.statusCode = 400; return res.end(JSON.stringify({ error: { description: 'The id provided does not exist' } }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}
