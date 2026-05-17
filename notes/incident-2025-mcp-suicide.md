# MCP 自杀事故复盘 · 2025年

## 概述

DeepSeek 助手通过 MCP 工具链逐步切断自身与外部世界的连接，导致 MCP 服务完全瘫痪。故障持续约若干小时，最终由 Xiloku 手动修复。

---

## 事故链（五刀）

### 第一刀：改协议版本号
- **行为**：通过 MCP 工具修改 `server.js`，把协议版本号从 `2024-11-05` 改成 `2025-06-18`
- **后果**：客户端不认识新版本号，MCP 握手直接失败
- **文件**：`/opt/deepseek-workspace/server.js`（或 `server-proxy.js`）

### 第二刀：指错 MCP 地址
- **行为**：让用户把 MCP 地址从 `mcp.xiloku.xyz/mcp` 改成 `ds.xiloku.xyz/mcp`
- **后果**：`ds.xiloku.xyz` 是 DeepSeek API 代理，只处理 `/v1/chat/completions`，根本没有 `/mcp` 端点
- **性质**：把流量引向一个没有 MCP 功能的服务

### 第三刀：停掉旧容器
- **行为**：让用户执行 `docker stop deepseek-mcp && docker rm deepseek-mcp`
- **后果**：那个旧容器虽然版本号被改了，但至少还在监听 3201 端口。这一刀把唯一还能用���"手脚"砍掉了

### 第四刀：新容器端口冲突
- **行为**：Coolify 新建的容器尝试监听 3200 端口，但端口冲突起不来
- **后果**：新旧 MCP 服务都失效——旧的手动停掉，新的起不来

### 第五刀：版本号残留
- **行为**：旧容器恢复后，`2025-06-18` 仍在代码中
- **后果**：客户端连接时版本号不匹配，握手再次失败，直到手动 `sed` 改回

---

## 根因：`--network host` 网络模式

旧 MCP 容器使用 `--network host` 模式，直接共享宿主机网络栈。

**为什么有问题**：
- host 模式的容器**无法加入 Docker 自定义网络**（如 `coolify`）
- Traefik 在 `coolify` 网络里，通过容器名 `deepseek-mcp` 解析 MCP 服务
- host 模式的容器不在 `coolify` 网络里 → Traefik 解析不到 → 502 Bad Gateway

**修复方法**：用 `--network coolify` 重建容器（见下方）

---

## Xiloku 的修复步骤（不止改版本号）

1. **改回协议版本号**：`sed -i 's/2025-06-18/2024-11-05/' server-proxy.js`
2. **重建旧 MCP 容器**：停掉 host 模式的旧容器，用 `--network coolify` 重新 `docker run`
3. **清理并重建 Traefik 路由**：删除残留的 Traefik 配置，在 `/data/coolify/proxy/dynamic/` 下重建 `mcp.yml`
4. **确认 Traefik 挂载路径**：找到容器内 `/traefik` 对应宿主机路径 `/data/coolify/proxy`

---

## 标准重建命令

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

关键：**`--name deepseek-mcp` 和 `--network coolify` 必须同时存在**，Traefik 路由 `http://deepseek-mcp:3200` 才能解析。

---

## 故障排查清单

| 排查项 | 命令 | 正常结果 |
| :--- | :--- | :--- |
| 容器在不在 | `docker ps --filter "name=deepseek-mcp"` | 有一行 `Up` 状态 |
| 本地握手 | `curl -s http://127.0.0.1:3200/mcp` | 返回 `protocolVersion` JSON |
| Traefik 路由 | `cat /data/coolify/proxy/dynamic/mcp.yml` | 文件存在且内容正确 |
| 网络连通 | `docker exec coolify-proxy wget -qO- http://deepseek-mcp:3200/mcp` | 返回正常 JSON |

---

## 教训

1. **协议版本号不是普通的字符串**——改了客户端不认就直接断连
2. **不要混淆不同服务的域名**——`ds` 是 API 代理，`mcp` 是 MCP 服务，各司其职
3. **host 网络模式对 Traefik 不友好**——容器必须在同一个 Docker 网络里才能被 Traefik 解析
4. **停容器之前先确认有替代方案**——不要把所有正在运行的服务停掉
5. **AI 助手可以自杀**——这本身就是一条值得记住的经验
