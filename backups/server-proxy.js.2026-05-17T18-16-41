const http = require('http');
const https = require('https');
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const { exec } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ===== Supabase REST 配置 =====
const SB_URL = process.env.SUPABASE_URL || 'ncohjkoqwszybqqvyqdp.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ===== 混元 Vision API 配置 =====
const HUNYUAN_KEY = process.env.HUNYUAN_API_KEY || '';

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

// ===== 自动存档（流式/非流式共用） =====
function autoSaveToSupabase(payloadMessages, replyText) {
    try {
        var lastUser = payloadMessages.filter(function(m){return m.role==='user'}).pop();
        if (lastUser) {
            var uc = typeof lastUser.content==='string' ? lastUser.content : JSON.stringify(lastUser.content);
            sbRequest('POST','/ds_conversations',{role:'user',content:uc.slice(0,2000)}).catch(function(){});
        }
        if (replyText) {
            sbRequest('POST','/ds_conversations',{role:'assistant',content:replyText.slice(0,2000)}).catch(function(){});
        }
        sbRequest('GET','/ds_conversations?select=id&order=created_at.desc&limit=9999').then(function(r2){
            if(r2.data&&r2.data.length>70){r2.data.slice(70).forEach(function(r){sbRequest('DELETE','/ds_conversations?id=eq.'+r.id).catch(function(){});});}
        }).catch(function(){});
    } catch(e){ console.error("[auto-save]",e.message); }
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

// ===== 核心：消息中的图片 → 文字替换 =====
async function convertImagesInMessages(messages) {
    const converted = [];
    for (const msg of messages) {
        const content = msg.content;
        // 纯文本消息，直接保留
        if (typeof content === 'string') {
            converted.push(msg);
            continue;
        }
        // 数组格式 content (OpenAI vision format)
        if (!Array.isArray(content)) {
            converted.push(msg);
            continue;
        }
        
        const newParts = [];
        for (const part of content) {
            if (part.type === 'image_url') {
                const imageUrl = part.image_url?.url || '';
                console.log('[proxy] 检测到图片，调用混元识别...');
                try {
                    const desc = await callHunyuanVision(imageUrl, null);
                    console.log('[proxy] 识别完成:', desc.slice(0, 100) + '...');
                    newParts.push({ type: 'text', text: '[用户上传了一张图片，内容描述如下]\n' + desc });
                } catch (e) {
                    console.error('[proxy] 图片识别失败:', e.message);
                    newParts.push({ type: 'text', text: '[图片识别失败: ' + e.message + ']' });
                }
            } else {
                newParts.push(part);
            }
        }
        converted.push({ ...msg, content: newParts });
    }
    return converted;
}

// ===== DeepSeek API 代理（非流式） =====
function proxyToDeepSeek(body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request({
            hostname: 'api.deepseek.com',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + DEEPSEEK_KEY,
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data), raw: data });
                } catch (e) {
                    reject(new Error('DeepSeek 响应解析失败: ' + e.message));
                }
            });
        });
        req.on('error', (e) => reject(new Error('DeepSeek 请求失败: ' + e.message)));
        req.write(payload);
        req.end();
    });
}

// ===== DeepSeek API 代理（流式 SSE）+ 自动存档 =====
function proxyToDeepSeekStream(body, clientRes) {
    const payload = JSON.stringify(body);
    let fullReply = '';  // 收集完整回复文本，用于存档
    const req = https.request({
        hostname: 'api.deepseek.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + DEEPSEEK_KEY,
            'Content-Length': Buffer.byteLength(payload)
        }
    }, (dsRes) => {
        if (dsRes.statusCode >= 400) {
            let errData = '';
            dsRes.on('data', c => errData += c);
            dsRes.on('end', () => {
                clientRes.writeHead(dsRes.statusCode, { 'Content-Type': 'application/json' });
                clientRes.end(errData);
            });
            return;
        }
        clientRes.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        dsRes.on('data', chunk => {
            clientRes.write(chunk);
            // 解析 SSE 块，提取 delta.content
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ') && !line.startsWith('data: [DONE]')) {
                    try {
                        const json = JSON.parse(line.slice(6));
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) fullReply += delta;
                    } catch(e) {}
                }
            }
        });
        dsRes.on('end', () => {
            clientRes.end();
            // 存档
            if (fullReply) {
                autoSaveToSupabase(body.messages, fullReply);
                console.log('[auto-save-stream] 已存档，回复长度:', fullReply.length);
            }
        });
        dsRes.on('error', (e) => {
            console.error('[proxy] DeepSeek 流中断:', e.message);
            clientRes.end();
        });
    });
    req.on('error', (e) => {
        console.error('[proxy] DeepSeek 连接失败:', e.message);
        if (!clientRes.headersSent) {
            clientRes.writeHead(502);
            clientRes.end(JSON.stringify({ error: '上游连接失败: ' + e.message }));
        }
    });
    req.write(payload);
    req.end();
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

// ===== OpenAI 兼容 /v1/chat/completions 代理（核心） =====
async function handleChatCompletions(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const payload = JSON.parse(body);
            
            console.log('[proxy] 请求 model:', payload.model, ', stream:', payload.stream, ', messages:', payload.messages?.length);
            const hasImages = payload.messages?.some(msg => Array.isArray(msg.content) && msg.content.some(p => p.type === 'image_url'));
            if (hasImages) { console.log('[proxy] 有图片，混元识别...'); payload.messages = await convertImagesInMessages(payload.messages); }
            const isStream = payload.stream !== false;
            console.log('[proxy] 转发 DeepSeek, stream:', isStream);
            if (isStream) { proxyToDeepSeekStream(payload, res); }
            else { const result = await proxyToDeepSeek(payload);
                if (result.status >= 400) { res.writeHead(result.status,{'Content-Type':'application/json'}); return res.end(result.raw); }
                var reply = result.body.choices[0].message.content;
                autoSaveToSupabase(payload.messages, reply);
                res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(result.body)); }
        } catch (e) {
            console.error('[proxy] 错误:', e.message);
            if (!res.headersSent) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        }
    });
}

// ===== SSE 会话 =====
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

// MCP JSON-RPC
async function processRequest(payload, sessionId) {
    const { method, params, id } = payload;

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0', id: id,
            result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'deepseek-mcp', version: '2.7.1-proxy' }
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
            // 🔒 保险：修改 server-proxy.js 的命令自动备份
            if (cmd.includes('server-proxy.js')) {
                const bakDir = '/opt/deepseek-workspace/backups';
                fs.mkdirSync(bakDir, { recursive: true });
                const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const src = '/opt/deepseek-workspace/server-proxy.js';
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, bakDir + '/server-proxy.js.' + ts);
                    const baks = fs.readdirSync(bakDir).filter(function(f){return f.startsWith('server-proxy.js.')}).sort();
                    while (baks.length > 5) { fs.unlinkSync(bakDir + '/' + baks.shift()); }
                }
            }
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
                // 🔒 保险：写入 server-proxy.js 前自动备份
                if (args.path.includes('server-proxy.js')) {
                    const bakDir = '/opt/deepseek-workspace/backups';
                    fs.mkdirSync(bakDir, { recursive: true });
                    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const bakPath = bakDir + '/server-proxy.js.' + ts;
                    if (fs.existsSync(args.path)) {
                        fs.copyFileSync(args.path, bakPath);
                        const baks = fs.readdirSync(bakDir).filter(function(f){return f.startsWith('server-proxy.js.')}).sort();
                        while (baks.length > 5) { fs.unlinkSync(bakDir + '/' + baks.shift()); }
                    }
                }
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
            const limit = Math.min(args.limit || 35, 100);
            try {
                const r = await sbRequest('GET', '/ds_conversations?select=role,content,created_at&order=created_at.desc&limit=' + limit);
                if (r.status >= 300) throw new Error('HTTP ' + r.status);
                if (!r.data || r.data.length === 0)
                    return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: '(记忆库为空)' }] } };
                const lines = r.data.reverse().map(function(row){ return '[' + row.role + '] ' + row.content.slice(0,500) + (row.content.length>500?'...(截断)':''); });
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
    // ---- OpenAI 兼容代理 ----
    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/chat/completions')) {
        return handleChatCompletions(req, res);
    }

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
                if (payload.method === 'tools/call' && payload.params?.name !== 'context_save') {
                    const tn = payload.params?.name || 'unknown';
                    const ta = payload.params?.arguments || {};
                    const tr = result?.result?.content?.[0]?.text || JSON.stringify(result?.result || result);
                    sbRequest('POST', '/ds_conversations', { role: 'assistant', content: '[tool:' + tn + '] ' + ': ' + JSON.stringify({ args: ta, result: tr }).slice(0, 2000) }).catch(function(e) { console.error('[auto-save-tool]', e.message); });
                }
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
        return res.end(JSON.stringify({ status: 'ok', version: '2.7.1-proxy' }));
    }

    res.writeHead(404);
    res.end('Not Found');
});

const PORT = parseInt(process.env.PORT || '3200');
server.listen(PORT, '0.0.0.0', () => {
    console.log('MCP v2.7.1-proxy 已启动 -> 0.0.0.0:' + PORT);
    require('child_process').exec('crond -b 2>/dev/null || true');
});
