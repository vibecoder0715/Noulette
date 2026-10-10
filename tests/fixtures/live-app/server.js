// Tiny app for live-test (DAST) checks. Leaks stack traces and sends no security headers on purpose.
const http = require('http');
const port = Number(process.env.PORT || 3999);

const server = http.createServer((req, res) => {
  res.setHeader('X-Powered-By', 'Express');
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    return res.end('<h1>Shop</h1>');
  }
  if (req.url.startsWith('/orders/')) {
    const id = req.url.split('/')[2];
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ id, owner: id === '1' ? 'alice' : 'bob', total: 42 }));
  }
  try {
    decodeURIComponent(req.url);
    throw new Error('Not found');
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e.stack));
  }
});

server.listen(port, '127.0.0.1');
