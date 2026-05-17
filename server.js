const http = require('http');
const { exec } = require('child_process');

const server = http.createServer((req, res) => {
  // 只接受 POST 请求
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { command } = JSON.parse(body);
      if (!command) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '缺少 command 参数' }));
        return;
      }

      exec(command, { timeout: 30000, cwd: '/opt/deepseek-workspace' }, (err, stdout, stderr) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: !err,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: err ? err.message : null
        }));
      });
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(3100, '127.0.0.1', () => {
  console.log('DeepSeek 控制台已启动，监听 127.0.0.1:3100');
});
