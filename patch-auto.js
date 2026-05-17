const fs = require('fs');
let code = fs.readFileSync('/opt/deepseek-workspace/server-proxy.js', 'utf8');

const oldStr = '                const result = await Promise.resolve(processRequest(payload, sessionId));\n                if (!sessionRes) {';

const newStr = '                const result = await Promise.resolve(processRequest(payload, sessionId));\n                if (payload.method === \'tools/call\' && payload.params?.name !== \'context_save\') {\n                    const tn = payload.params?.name || \'unknown\';\n                    const ta = payload.params?.arguments || {};\n                    const tr = result?.result?.content?.[0]?.text || JSON.stringify(result?.result || result);\n                    sbRequest(\'POST\', \'/ds_conversations\', { role: \'tool\', content: tn + \': \' + JSON.stringify({ args: ta, result: tr }).slice(0, 2000) }).catch(function(e) { console.error(\'[auto-save-tool]\', e.message); });\n                }\n                if (!sessionRes) {';

if (code.includes(oldStr)) {
    code = code.replace(oldStr, newStr);
    fs.writeFileSync('/opt/deepseek-workspace/server-proxy.js', code);
    console.log('OK: patched');
} else {
    console.log('FAIL: pattern not found, trying substring match');
    // try matching on key parts
    if (code.includes('processRequest(payload, sessionId)')) {
        console.log('  - processRequest line found');
    }
    if (code.includes('if (!sessionRes) {')) {
        console.log('  - sessionRes line found');
    }
}
