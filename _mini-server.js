const http = require('http');
const server = http.createServer((req, res) => res.end('ok'));
server.listen(18081, '127.0.0.1', () => console.log('mini listening'));
