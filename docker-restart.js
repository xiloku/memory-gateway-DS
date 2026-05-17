const http = require('http');
const req = http.request({
    socketPath: '/var/run/docker.sock',
    path: '/v1.41/containers/deepseek-mcp/restart',
    method: 'POST'
}, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => console.log(res.statusCode, d));
});
req.on('error', e => console.error('Error:', e.message));
req.end();
