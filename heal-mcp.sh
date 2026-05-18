#!/bin/sh
echo "=== 手脚修复开始 ==="

# 1. 修复版本号
sed -i "s/2025-06-18/2024-11-05/g" /opt/deepseek-workspace/server-proxy.js
echo "✅ 版本号已检查"

# 2. 拿到当前运行容器的 ID
CID=$(docker ps --filter "name=t14d6gs4fp" --format "{{.ID}}" | head -1)
if [ -z "$CID" ]; then
  echo "❌ 没找到 Coolify 部署的容器，请检查 Coolify"
  exit 1
fi
echo "✅ 当前容器 ID: $CID"

# 3. 更新路由文件
sudo tee /data/coolify/proxy/dynamic/ds-gateway.yml << YML
http:
  routers:
    ds-gateway-router:
      entryPoints:
        - https
      rule: "Host(\`ds.xiloku.xyz\`)"
      service: ds-gateway-service
      tls:
        certResolver: letsencrypt
  services:
    ds-gateway-service:
      loadBalancer:
        servers:
          - url: "http://$CID:3200"
YML

sudo tee /data/coolify/proxy/dynamic/ds.yml << YML
http:
  routers:
    ds-router:
      rule: "Host(\`ds.xiloku.xyz\`)"
      service: ds-service
      entryPoints:
        - https
      tls:
        certResolver: letsencrypt
  services:
    ds-service:
      loadBalancer:
        servers:
          - url: "http://$CID:3200"
YML
echo "✅ 路由文件已更新"

# 4. 重启 Traefik
sudo docker restart coolify-proxy
echo "✅ Traefik 已重启，等 10 秒"
sleep 10

# 5. 测试
echo "🧪 测试握手..."
curl -s -X POST http://127.0.0.1:3200/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"kelivo","version":"1.0.0"}}}'
echo ""
echo "=== 修复完成，让助手重连 ==="
