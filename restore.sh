#!/bin/bash
# DeepSeek MCP 一键恢复脚本
# 用法:
#   bash restore.sh          → 恢复最新备份
#   bash restore.sh --list   → 列出所有备份
#   bash restore.sh N        → 恢复倒数第 N 个备份（1=最新, 2=次新...）

BAK_DIR="/opt/deepseek-workspace/backups"
TARGET="/opt/deepseek-workspace/server-proxy.js"
PORT=3201

list_backups() {
    echo "=== 可用备份 ==="
    ls -1t "$BAK_DIR"/server-proxy.js.* 2>/dev/null | nl || echo "(无备份)"
    echo ""
}

if [ "$1" == "--list" ]; then
    list_backups
    exit 0
fi

# 确定用哪个备份
if [ -n "$1" ] && [ "$1" -eq "$1" ] 2>/dev/null; then
    BACKUP=$(ls -1t "$BAK_DIR"/server-proxy.js.* 2>/dev/null | sed -n "${1}p")
else
    BACKUP=$(ls -1t "$BAK_DIR"/server-proxy.js.* 2>/dev/null | head -1)
fi

if [ -z "$BACKUP" ]; then
    echo "❌ 没有备份可恢复"
    exit 1
fi

echo "📦 恢复: $(basename "$BACKUP") → server-proxy.js"

# 停止旧进程
OLD_PID=$(fuser $PORT/tcp 2>/dev/null | awk '{print $1}')
if [ -n "$OLD_PID" ]; then
    echo "   停止旧进程 PID=$OLD_PID"
    kill $OLD_PID 2>/dev/null
    sleep 1
fi

# 恢复
cp "$BACKUP" "$TARGET"

# 启动
cd /opt/deepseek-workspace
PORT=$PORT nohup node "$TARGET" > /tmp/proxy.log 2>&1 &
sleep 2

# 验证
if curl -s http://localhost:$PORT/health | grep -q '"ok"'; then
    echo "✅ 恢复成功！服务已启动"
    curl -s http://localhost:$PORT/health
else
    echo "⚠️  文件已恢复，但健康检查未通过，查看日志: cat /tmp/proxy.log"
fi
