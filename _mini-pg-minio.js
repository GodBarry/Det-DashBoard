const http = require('http');
const { Pool } = require('pg');
const Minio = require('minio');
(async () => {
  const pool = new Pool({ connectionString: 'postgres://det:det_password@localhost:5432/det_dashboard' });
  await pool.query('select 1');
  const client = new Minio.Client({ endPoint:'localhost', port:9000, useSSL:false, accessKey:'minioadmin', secretKey:'minioadmin' });
  const ok = await client.bucketExists('zbh-datasets').catch(() => false);
  if (!ok) await client.makeBucket('zbh-datasets');
  const server = http.createServer((req, res) => res.end('ok pg minio'));
  globalThis.s = server;
  process.on('beforeExit', c => console.error('beforeExit', c));
  process.on('exit', c => console.error('exit', c));
  server.listen(18082, '127.0.0.1', () => console.log('mini pg minio listening'));
})();
