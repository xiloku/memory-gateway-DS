# MCP 运维速查卡

## 重建容器（标准命令）

```bash
sudo docker stop deepseek-mcp && sudo docker rm deepseek-mcp
sudo docker run -d \
  --name deepseek-mcp \
  --network coolify \
  --restart unless-stopped \
  -v /opt/deepseek-mcp:/opt/deepseek-mcp \
  -v /opt/deepseek-workspace:/opt/deepseek-workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  node:20-alpine \
  sh -c "apk add --no-cache docker-cli && node /opt/deepseek-mcp/server.js"
```

> ⚠️ `--name deepseek-mcp` + `--network coolify` 缺一不可！

## 故障排查

| 排查项 | 命令 | 正常结果 |
| :--- | :--- | :--- |
| 容器状态 | `docker ps --filter "name=deepseek-mcp"` | `Up` 状态 |
| 本地握手 | `curl -s http://127.0.0.1:3200/mcp` | 返回 JSON（含 protocolVersion） |
| Traefik 路由 | `cat /data/coolify/proxy/dynamic/mcp.yml` | 文件存在 |
| 网络连通 | `docker exec coolify-proxy wget -qO- http://deepseek-mcp:3200/mcp` | 返回 JSON |

## 关键端口

| 端口 | 服务 |
| :--- | :--- |
| 3200 | MCP 容器内部 |
| 3201 | 旧 MCP（已废弃） |
| 80/443 | Traefik → mcp.xiloku.xyz |

## 已知陷阱

- `--network host` 模式会导致 Traefik 无法解析容器名 → 502
- 协议版本号 `2024-11-05` 不能改
- `search_web` / `web_fetch` 是空壳
