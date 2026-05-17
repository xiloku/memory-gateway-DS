#!/bin/sh
# watchdog.sh - 每1分钟由 crond 触发
# 同时守护 server-proxy.js (3201) 和 server-ds.js (3000)
# server-proxy: 连续3次失败 → 自动回滚 → 重启容器
# server-ds: 挂了直接拉起

# ============ server-ds.js (3000) - auto-restart ============
node -e "
const net = require('net');
const s = net.connect({port:3000, host:'127.0.0.1'}, () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
s.setTimeout(3000, () => { s.destroy(); process.exit(1); });
"

if [ $? -ne 0 ]; then
    echo "[watchdog] server-ds.js 端口3000不可达，拉起..." >> /tmp/watchdog.log
    nohup node /opt/deepseek-workspace/server-ds.js >> /tmp/server-ds.log 2>&1 &
    echo "[watchdog] server-ds.js 已拉起, PID=$!" >> /tmp/watchdog.log
fi

# ============ server-proxy.js (3201) - rollback on 3 failures ============
STATE="/opt/deepseek-workspace/.watchdog-state"
RESTORED="/opt/deepseek-workspace/.watchdog-restored"

node -e "
const net = require('net');
const s = net.connect({port:3201, host:'127.0.0.1'}, () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
s.setTimeout(3000, () => { s.destroy(); process.exit(1); });
"

if [ $? -eq 0 ]; then
    echo "0" > "$STATE"
    exit 0
fi

# --- 端口不可达 ---
COUNT=$(cat "$STATE" 2>/dev/null || echo "0")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$STATE"

if [ "$COUNT" -ge 3 ] && [ ! -f "$RESTORED" ]; then
    echo "[watchdog] server-proxy 连续 $COUNT 次失败，触发自动回滚" >> /tmp/watchdog.log
    touch "$RESTORED"
    LATEST=$(ls -1t /opt/deepseek-workspace/backups/server-proxy.js.* 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
        cp "$LATEST" /opt/deepseek-workspace/server-proxy.js
        echo "[watchdog] 已恢复: $LATEST，重启容器" >> /tmp/watchdog.log
        node -e "
        const h = require('http');
        h.request({socketPath:'/var/run/docker.sock',path:'/v1.41/containers/deepseek-mcp/restart',method:'POST'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))}).end();
        " >> /tmp/watchdog.log 2>&1
    fi
fi