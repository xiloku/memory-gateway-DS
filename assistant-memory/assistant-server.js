const http = require('http');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: SUPABASE_URL,
            path: '/rest/v1' + path,
            method: method,
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_KEY,
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

const server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); return res.end('Method Not Allowed'); }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { method, params, id } = JSON.parse(body);

            if (method === 'initialize') {
                return res.end(JSON.stringify({
                    jsonrpc: "2.0", id: id,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: { tools: {} },
                        serverInfo: { name: "assistant-memory", version: "1.0.0" }
                    }
                }));
            }

            if (method === 'tools/list') {
                return res.end(JSON.stringify({
                    tools: [
                        {
                            name: 'context_save',
                            description: '保存对话到Supabase记忆库',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    role: { type: 'string', description: '角色: user 或 assistant' },
                                    content: { type: 'string', description: '对话内容' }
                                },
                                required: ['role', 'content']
                            }
                        },
                        {
                            name: 'context_load',
                            description: '从Supabase记忆库读取最近对话',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    limit: { type: 'number', description: '读取条数，默认20' }
                                },
                                required: []
                            }
                        }
                    ]
                }));
            }

            if (method === 'tools/call') {
                const toolName = params?.name;
                const args = params?.arguments || {};

                if (toolName === 'context_save') {
                    const { role, content } = args;
                    if (!role || !content) return res.end(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: -32602, message: '缺少 role 或 content' } }));
                    if (!['user', 'assistant'].includes(role)) return res.end(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: -32602, message: 'role 必须是 user 或 assistant' } }));
                    try {
                        const r = await sbRequest('POST', '/ds_conversations', { role, content });
                        if (r.status >= 300) throw new Error('HTTP ' + r.status);
                        return res.end(JSON.stringify({ jsonrpc: "2.0", id: id, result: { content: [{ type: 'text', text: '[已保存]' }] } }));
                    } catch (e) {
                        return res.end(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: -32603, message: 'context_save 失败: ' + e.message } }));
                    }
                }

                if (toolName === 'context_load') {
                    const limit = Math.min(args.limit || 20, 100);
                    try {
                        const r = await sbRequest('GET', '/ds_conversations?select=role,content,created_at&order=created_at.desc&limit=' + limit);
                        if (r.status >= 300) throw new Error('HTTP ' + r.status);
                        if (!r.data || r.data.length === 0) return res.end(JSON.stringify({ jsonrpc: "2.0", id: id, result: { content: [{ type: 'text', text: '(记忆库为空)' }] } }));
                        const lines = r.data.reverse().map(function(row) { return '[' + row.role + '] ' + row.content; });
                        return res.end(JSON.stringify({ jsonrpc: "2.0", id: id, result: { content: [{ type: 'text', text: lines.join('\n---\n') }] } }));
                    } catch (e) {
                        return res.end(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: -32603, message: 'context_load 失败: ' + e.message } }));
                    }
                }

                return res.end(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: -32601, message: 'Unknown tool: ' + toolName } }));
            }

            res.end(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: -32601, message: 'Method not found' } }));
        } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: e.message }));
        }
    });
});

server.listen(3100, '0.0.0.0', () => console.log('助手记忆服务已启动 -> 0.0.0.0:3100'));
