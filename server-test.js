const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ===== Supabase REST 配置 =====
const SB_URL = 'ncohjkoqwszybqqvyqdp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jb2hqa29xd3N6eWJxcXZ5cWRwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkxNTA2NSwiZXhwIjoyMDkzNDkxMDY1fQ.CIVkyGeIqjRRzDAOQjF8kOw_C8zdHrl71Y2LRS7IN8s';

// ===== 混元 Vision API 配置 =====
const HUNYUAN_KEY = 'sk-nZBnkR3txiTvwoTNuLCBFquJeTm8Hk3XiVmV9hFTatp3qRGU';

// Supabase REST
function sbRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: SB_URL,
            path: '/rest/v1' + path,
            method: method,
            headers: {
                'apikey': SB_KEY,
                'Authorization': 'Bearer ' + SB_KEY,
                'Content-Type': 'application/json'
            }
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch (e) { resolve({ status: res.statusCode, data: null, raw: data }); }
            });
        });
        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// 混元 Vision API（支持 URL 和 base64）
function callHunyuanVision(imageInput, promptText) {
    return new Promise((resolve, reject) => {
        let imageUrl = imageInput;
        if (!imageInput.startsWith('http') && !imageInput.startsWith('data:')) {
            imageUrl = 'data:image/jpeg;base64,' + imageInput;
        }
        const body = JSON.stringify({
            model: 'hunyuan-vision',
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: imageUrl } },
                    { type: 'text', text: promptText || '请详细描述这张图片的内容，包括所有文字、人物、场景等细节' }
                ]
            }]
        });
        const req = https.request({
            hostname: 'api.hunyuan.cloud.tencent.com',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + HUNYUAN_KEY
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(json.error.message || JSON.stringify(json.error)));
                    } else {
                        resolve(json.choices?.[0]?.message?.content || JSON.stringify(json));
                    }
                } catch (e) {
                    reject(new Error('混元响应解析失败: ' + e.message));
                }
            });
        });
        req.on('error', (e) => reject(new Error('混元请求失败: ' + e.message)));
        req.write(body);
        req.end();
    });
}

// SSE 会话
const sessions = new Map();

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function sendSSE(res, event, data) {
    res.write('event: ' + event + '\n');
    res.write('data: ' + JSON.stringify(data) + '\n\n');
}

// ===== 图片上传 + 识别 =====
function handleUploadImage(req, res) {
    let body = '';
    req.on('data', chunk => {
        body += chunk;
        if (body.length > 20 * 1024 * 1024) {
            res.writeHead(413);
            res.end(JSON.stringify({ error: '图片过大，最大 20MB' }));
            req.destroy();
        }
    });
    req.on('end', async () => {
        try {
            const { image_base64, prompt } = JSON.parse(body);
            if (!image_base64) {
                res.writeHead(400);
                return res.end(JSON.stringify({ error: '缺少 image_base64 字段' }));
            }
            console.log('[upload-image] 收到图片，大小:', (image_base64.length / 1024).toFixed(1), 'KB');
            const result = await callHunyuanVision(image_base64, prompt);
            console.log('[upload-image] 识别完成，长度:', result.length);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, text: result }));
        } catch (e) {
            console.error('[upload-image] 错误:', e.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
    });
}

// MCP JSON-RPC
async function processRequest(payload, sessionId) {
    const { method, params, id } = payload;

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0', id: id,
            result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'deepseek-mcp', version: '2.5.0-vision' }
            }
        };
    }

    if (method === 'tools/list') {
        return {
            jsonrpc: '2.0', id: id,
            result: {
                tools: [
                    { name: 'web_search', description: '搜索网页', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
                    { name: 'web_fetch', description: '抓取网页', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
                    { name: 'execute_command', description: '在服务器上执行命令', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
                    { name: 'file_read', description: '读取文件内容', inputSchema: { type: 'object', properties: { path: { type: 'string', description: '文件路径（仅限 /opt/omni-ob-vault/ 和 /opt/deepseek-workspace/ 下）' } }, required: ['path'] } },
                    { name: 'file_write', description: '写入文件内容（覆盖模式）', inputSchema: { type: 'object', properties: { path: { type: 'string', description: '文件路径（仅限 /opt/omni-ob-vault/ 和 /opt/deepseek-workspace/ 下）' }, content: { type: 'string', description: '要写入的内容' } }, required: ['path', 'content'] } },
                    { name: 'context_save', description: '保存对话到Supabase记忆库', inputSchema: { type: 'object', properties: { role: { type: 'string', description: '角色: user 或 assistant' }, content: { type: 'string', description: '对话内容' } }, required: ['role', 'content'] } },
                    { name: 'context_load', description: '从Supabase记忆库读取最近对话', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '读取条数，默认20' } }, required: [] } },
                    { name: 'image_to_text', description: '调用混元Vision识别图片内容，支持图片URL或base64', inputSchema: { type: 'object', properties: { image_url: { type: 'string', description: '图片URL或base64数据' }, prompt: { type: 'string', description: '可选，提示词' } }, required: ['image_url'] } }
                ]
            }
        };
    }

    if (method === 'tools/call') {
        const toolName = params?.name;
        const args = params?.arguments || {};

        if (toolName === 'execute_command') {
            const cmd = args.command;
            if (!cmd) return { jsonrpc: '2.0', id: id, error: { code: -32602, message: 'Missing command' } };
            return new Promise((resolve) => {
                exec(cmd, { timeout: 30000, cwd: '/opt/deepseek-workspace' }, (err, stdout, stderr) => {
                    const text = err ? 'Error: ' + (stderr || err.message) : (stdout || '(executed successfully)');
                    resolve({ jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text }] } });
                });
            });
        }

        if (toolName === 'file_read') {
            const allowed = ['/opt/omni-ob-vault', '/opt/deepseek-workspace'];
            if (!allowed.some(r => args.path.startsWith(r)))
                return { jsonrpc: '2.0', id: id, error: { code: -32602, message: '拒绝：路径不在允许范围' } };
            try {
                const content = fs.readFileSync(args.path, 'utf-8');
                return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: content }] } };
            } catch (e) {
                return { jsonrpc: '2.0', id: id, error: { code: -32602, message: '读取失败: ' + e.message } };
            }
        }

        if (toolName === 'file_write') {
            const allowed = ['/opt/omni-ob-vault', '/opt/deepseek-workspace'];
            if (!allowed.some(r => args.path.startsWith(r)))
                return { jsonrpc: '2.0', id: id, error: { code: -32602, message: '拒绝：路径不在允许范围' } };
            try {
                fs.mkdirSync(path.dirname(args.path), { recursive: true });
                fs.writeFileSync(args.path, args.content, 'utf-8');
                return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: '已写入 ' + args.path }] } };
            } catch (e) {
                return { jsonrpc: '2.0', id: id, error: { code: -32602, message: '写入失败: ' + e.message } };
            }
        }

        if (toolName === 'context_save') {
            const { role, content } = args;
            if (!role || !content) return { jsonrpc: '2.0', id: id, error: { code: -32602, message: '缺少 role 或 content' } };
            if (!['user', 'assistant'].includes(role)) return { jsonrpc: '2.0', id: id, error: { code: -32602, message: 'role 必须是 user 或 assistant' } };
            try {
                const r = await sbRequest('POST', '/ds_conversations', { role, content });
                if (r.status >= 300) throw new Error('HTTP ' + r.status + ': ' + JSON.stringify(r.data));
                return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: '[已保存] ' + role + ': ' + content.slice(0, 100) + '...' }] } };
            } catch (e) {
                return { jsonrpc: '2.0', id: id, error: { code: -32603, message: 'context_save 失败: ' + e.message } };
            }
        }

        if (toolName === 'context_load') {
            const limit = Math.min(args.limit || 20, 100);
            try {
                const r = await sbRequest('GET', '/ds_conversations?select=role,content,created_at&order=created_at.desc&limit=' + limit);
                if (r.status >= 300) throw new Error('HTTP ' + r.status);
                if (!r.data || r.data.length === 0)
                    return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: '(记忆库为空)' }] } };
                const lines = r.data.reverse().map(row => '[' + row.role + '] ' + row.content);
                return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: lines.join('\n---\n') }] } };
            } catch (e) {
                return { jsonrpc: '2.0', id: id, error: { code: -32603, message: 'context_load 失败: ' + e.message } };
            }
        }

        if (toolName === 'image_to_text') {
            if (!args.image_url) return { jsonrpc: '2.0', id: id, error: { code: -32602, message: '缺少 image_url' } };
            try {
                const text = await callHunyuanVision(args.image_url, args.prompt);
                return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text }] } };
            } catch (e) {
                return { jsonrpc: '2.0', id: id, error: { code: -32603, message: 'image_to_text 失败: ' + e.message } };
            }
        }

        return { jsonrpc: '2.0', id: id, error: { code: -32601, message: 'Unknown tool: ' + toolName } };
    }

    return { jsonrpc: '2.0', id: id, error: { code: -32601, message: 'Method not found: ' + method } };
}

// ===== HTTP Server =====
const server = http.createServer((req, res) => {
    // ---- 图片上传端点 ----
    if (req.method === 'POST' && req.url === '/upload-image') {
        return handleUploadImage(req, res);
    }

    // ---- MCP SSE ----
    if (req.method === 'GET' && req.url === '/mcp') {
        const accept = req.headers['accept'] || '';
        if (!accept.includes('text/event-stream')) {
            res.writeHead(404);
            return res.end('Use GET /mcp with Accept: text/event-stream');
        }
        const sessionId = uuid();
        sessions.set(sessionId, res);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Mcp-Session-Id': sessionId
        });
        sendSSE(res, 'endpoint', '/mcp');
        req.on('close', () => sessions.delete(sessionId));
        const keepAlive = setInterval(() => { res.write(': keepalive\n\n'); }, 30000);
        req.on('close', () => clearInterval(keepAlive));
        return;
    }

    // ---- MCP JSON-RPC ----
    if (req.method === 'POST' && req.url === '/mcp') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                const sessionId = req.headers['mcp-session-id'];
                const sessionRes = sessionId ? sessions.get(sessionId) : null;
                const result = await Promise.resolve(processRequest(payload, sessionId));
                if (!sessionRes) {
                    res.setHeader('Content-Type', 'application/json');
                    return res.end(JSON.stringify(result));
                }
                sendSSE(sessionRes, 'message', result);
                res.writeHead(202);
                res.end();
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // ---- 健康检查 ----
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', version: '2.5.0-vision' }));
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(3201, '0.0.0.0', () => console.log('MCP v2.5.0-vision 已启动 -> 0.0.0.0:3200'));
