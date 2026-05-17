const fs = require('fs');
let content = fs.readFileSync('/opt/deepseek-workspace/server-proxy.js', 'utf-8');

// 1. file_write 添加备份逻辑
const old_fw = `        if (toolName === 'file_write') {
            const allowed = ['/opt/omni-ob-vault', '/opt/deepseek-workspace'];
            if (!allowed.some(r => args.path.startsWith(r)))
                return { jsonrpc: '2.0', id: id, error: { code: -32602, message: '拒绝：路径不在允许范围' } };
            try {
                fs.mkdirSync(path.dirname(args.path), { recursive: true });
                fs.writeFileSync(args.path, args.content, 'utf-8');`;

const new_fw = `        if (toolName === 'file_write') {
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
                fs.writeFileSync(args.path, args.content, 'utf-8');`;

console.log('file_write: ' + (content.includes(old_fw) ? '找到 1 处' : '未找到!'));
content = content.replace(old_fw, new_fw);

// 2. execute_command 添加备份逻辑
const old_ec = `        if (toolName === 'execute_command') {
            const cmd = args.command;
            if (!cmd) return { jsonrpc: '2.0', id: id, error: { code: -32602, message: 'Missing command' } };
            return new Promise((resolve) => {`;

const new_ec = `        if (toolName === 'execute_command') {
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
            return new Promise((resolve) => {`;

console.log('execute_command: ' + (content.includes(old_ec) ? '找到 1 处' : '未找到!'));
content = content.replace(old_ec, new_ec);

// 3. 升级版本号
content = content.replace(/2\.6\.1-proxy/g, '2.7.0-proxy');
console.log('版本号: 2.6.1-proxy → 2.7.0-proxy');

fs.writeFileSync('/opt/deepseek-workspace/server-proxy.js', content, 'utf-8');
console.log('✅ 修改完成');
