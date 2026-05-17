# 遥的工作日志索引

## 🚨 事故复盘（开工前必读）
- [MCP 自杀事故 (2025)](incident-2025-mcp-suicide.md) — 五刀自杀 + 根因 + 修复
- [MCP 断联事故 (2026-05-18)](incident-2026-mcp-disconnect.md) — 版本号 + Coolify路由失效 + 共通根因 ← 最新

## 技术速查
- [MCP 运维速查](mcp-ops-quickref.md) — 重建命令、排查清单

## 坑位记录
- search_web 和 web_fetch 是空壳功能，不可用
- MCP 容器必须用 `--network coolify`，不能用 host 模式
- 协议版本号是 `2024-11-05`，绝对不能改
- `ds.xiloku.xyz` 是 API 代理，`mcp.xiloku.xyz` 是 MCP，不要混
- Coolify 重新部署后会生成新容器ID → Traefik 路由可能失效 → 必须检查
