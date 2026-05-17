const fs = require('fs');
let f = fs.readFileSync('/opt/deepseek-workspace/server-proxy.js', 'utf8');

// 1. context_load 默认 35
f = f.replace('args.limit || 20', 'args.limit || 35');
console.log('1. context_load 默认 → 35');

// 2. 自动存档
var anchor = "res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(result.body));";
var autoSave = [
    '                // ---- 自动存档到 Supabase ----',
    '                try {',
    "                    var lastUser = payload.messages.filter(function(m){return m.role==='user'}).pop();",
    "                    if (lastUser) {",
    "                        var uc = typeof lastUser.content==='string' ? lastUser.content : JSON.stringify(lastUser.content);",
    "                        sbRequest('POST','/ds_conversations',{role:'user',content:uc.slice(0,2000)}).catch(function(){});",
    "                    }",
    "                    var reply = result.body.choices[0].message.content;",
    "                    if (reply) sbRequest('POST','/ds_conversations',{role:'assistant',content:reply.slice(0,2000)}).catch(function(){});",
    "                    sbRequest('GET','/ds_conversations?select=id&order=created_at.desc&limit=9999').then(function(r2){",
    "                        if(r2.data&&r2.data.length>70){r2.data.slice(70).forEach(function(r){sbRequest('DELETE','/ds_conversations?id=eq.'+r.id).catch(function(){});});}",
    "                    }).catch(function(){});",
    '                } catch(e){ console.error("[auto-save]",e.message); }'
].join('\n');

if (f.indexOf(anchor) > -1) {
    f = f.replace(anchor, autoSave + '\n                ' + anchor);
    console.log('2. 自动存档 → 已插入');
} else {
    console.log('2. 锚点未找到！');
}

// 3. 格式化优化
f = f.replace(
    "const lines = r.data.reverse().map(row => '[' + row.role + '] ' + row.content);",
    "const lines = r.data.reverse().map(function(row){ return '[' + row.role + '] ' + row.content.slice(0,500) + (row.content.length>500?'...(截断)':''); });"
);
console.log('3. 格式化 → 已优化');

fs.writeFileSync('/opt/deepseek-workspace/server-proxy.js', f);
console.log('✅ 补丁全部完成');
