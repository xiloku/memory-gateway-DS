// server-ds.js — DeepSeek 服务端（上下文+记忆自动注入）
// 基于艾因架构精简：只管上下文加载 + 记忆检索，搜索/视觉保持 MCP 工具方式
import Fastify from 'fastify';
import SYSTEM_PROMPT from './src/config/prompt.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import https from 'https';

// ===== 配置 =====
const SUPABASE_URL = 'ncohjkoqwszybqqvyqdp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jb2hqa29xd3N6eWJxcXZ5cWRwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkxNTA2NSwiZXhwIjoyMDkzNDkxMDY1fQ.CIVkyGeIqjRRzDAOQjF8kOw_C8zdHrl71Y2LRS7IN8s';
const DEEPSEEK_KEY = 'sk-83b2e94f0e484b749bc9ddaa6588b8b6';
const VAULT_PATH = '/opt/omni-ob-vault';
const CONTEXT_LIMIT = 20;

const fastify = Fastify({ logger: true });

// ===== 工具函数 =====

// 安全 fetch（带超时）
const safeFetch = async (url, options = {}, timeout = 30000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 200)}`);
    }
    return res;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request to ${url} timed out after ${timeout}ms`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

// Supabase REST 请求
const sbRequest = async (method, path, body) => {
  const url = `https://${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return safeFetch(url, opts);
};

// ===== 记忆库缓存（启动时加载，定时刷新） =====
let vaultCache = {
  personality: '',
  keepsakes: '',
  startHere: '',
  criticalInfra: '',
  yesterdayCasual: '',
  loadedAt: null,
};

const getYesterdayDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const loadVaultCache = async () => {
  try {
    const [personality, keepsakes, startHere, criticalInfra] = await Promise.all([
      readFile(join(VAULT_PATH, 'notes/personality.md'), 'utf-8').catch(() => ''),
      readFile(join(VAULT_PATH, 'notes/keepsakes.md'), 'utf-8').catch(() => ''),
      readFile(join(VAULT_PATH, 'notes/_START_HERE.md'), 'utf-8').catch(() => ''),
      readFile(join(VAULT_PATH, 'CRITICAL-INFRA.md'), 'utf-8').catch(() => ''),
    ]);

    // 读取昨天的 casual
    const yesterday = getYesterdayDate();
    let yesterdayCasual = '';
    try {
      yesterdayCasual = await readFile(join(VAULT_PATH, 'notes/casual', `${yesterday}.md`), 'utf-8');
    } catch {
      // 没有昨天的 casual 也没关系
    }

    vaultCache = {
      personality: personality.slice(0, 3000),
      keepsakes: keepsakes.slice(0, 2000),
      startHere: startHere.slice(0, 3000),
      criticalInfra: criticalInfra.slice(0, 2000),
      yesterdayCasual: yesterdayCasual.slice(0, 5000),
      loadedAt: new Date().toISOString(),
    };
    fastify.log.info('Vault cache loaded successfully');
  } catch (err) {
    fastify.log.error('Vault cache load failed:', err.message);
  }
};

// 构建记忆上下文
const buildMemoryContext = () => {
  const parts = [];
  if (vaultCache.personality) {
    parts.push('## 遥的人格画像\n\n' + vaultCache.personality);
  }
  if (vaultCache.yesterdayCasual) {
    parts.push('## 昨日闲聊\n\n' + vaultCache.yesterdayCasual);
  }
  if (vaultCache.keepsakes) {
    parts.push('## 重要记忆\n\n' + vaultCache.keepsakes);
  }
  if (vaultCache.criticalInfra) {
    parts.push('## 技术速查\n\n' + vaultCache.criticalInfra);
  }
  return parts.join('\n\n---\n\n');
};

// ===== 上下文管理 =====

// 获取最近上下文
const getRecentContext = async () => {
  try {
    const res = await sbRequest('GET', `/ds_conversations?select=role,content&order=created_at.desc&limit=${CONTEXT_LIMIT}`);
    const data = await res.json();
    return Array.isArray(data) ? data.reverse() : [];
  } catch (e) {
    fastify.log.error('Context retrieval failed:', e.message);
    return [];
  }
};

// 保存上下文
const saveContext = async (messages) => {
  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const safeContent = typeof msg.content === 'string'
      ? msg.content.slice(0, 5000)
      : JSON.stringify(msg.content).slice(0, 5000);
    try {
      await sbRequest('POST', '/ds_conversations', {
        role: msg.role,
        content: safeContent,
      });
    } catch (e) {
      fastify.log.error('Context save failed:', e.message);
    }
  }
  // 清理旧记录（保留最近 70 条）
  try {
    const res = await sbRequest('GET', '/ds_conversations?select=id&order=created_at.desc&limit=9999');
    const data = await res.json();
    if (Array.isArray(data) && data.length > 70) {
      const toDelete = data.slice(70);
      for (const r of toDelete) {
        sbRequest('DELETE', `/ds_conversations?id=eq.${r.id}`).catch(() => {});
      }
    }
  } catch (e) {
    fastify.log.error('Context cleanup failed:', e.message);
  }
};

// ===== 主路由 =====
fastify.post('/v1/chat/completions', async (request, reply) => {
  const { messages, stream = false } = request.body;

  // 1. 时间
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 2. 构建 system prompt
  const memoryContext = buildMemoryContext();
  let systemContent = SYSTEM_PROMPT;
  systemContent += `\n\n[当前时间: ${timeStr}]`;
  if (memoryContext) {
    systemContent += '\n\n---\n\n## 记忆库内容\n\n' + memoryContext;
  }
  systemContent += `\n\n[记忆缓存加载时间: ${vaultCache.loadedAt || '未加载'}]`;

  // 3. 检索 Supabase 上下文
  const recentContext = await getRecentContext();

  // 4. 保存用户消息
  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.length > 0) {
    saveContext(userMessages).catch(e => fastify.log.error(e));
  }

  // 5. 构建增强消息
  const enhancedMessages = [
    { role: 'system', content: systemContent },
    ...recentContext,
    ...messages.filter(m => m.role !== 'system'),
  ];

  // 瘦身：截断过长单条消息
  for (const msg of enhancedMessages) {
    if (typeof msg.content === 'string' && msg.content.length > 3000) {
      msg.content = msg.content.substring(0, 3000) + '...（内容过长已截断）';
    }
  }

  // 6. 调用 DeepSeek API
  const llmPayload = {
    model: 'deepseek-chat',
    messages: enhancedMessages,
    stream,
    max_tokens: 8192,
  };

  try {
    const llmResponse = await safeFetch(
      'https://api.deepseek.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        },
        body: JSON.stringify(llmPayload),
      },
      600000
    );

    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const reader = llmResponse.body.getReader();
      let buffer = '';
      let fullContent = '';

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (fullContent) {
                saveContext([{ role: 'assistant', content: fullContent }]).catch(() => {});
              }
              reply.raw.write('data: [DONE]\n\n');
              reply.raw.end();
              return;
            }
            buffer += new TextDecoder().decode(value);
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') {
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
                if (fullContent) {
                  saveContext([{ role: 'assistant', content: fullContent }]).catch(() => {});
                }
                return;
              }
              try {
                const data = JSON.parse(dataStr);
                const delta = data.choices?.[0]?.delta;
                if (delta?.content) fullContent += delta.content;
                reply.raw.write(`${line}\n\n`);
              } catch (parseError) {
                // 忽略解析错误
              }
            }
          }
        } catch (err) {
          fastify.log.error('Stream error:', err.message);
          reply.raw.end();
        }
      };

      pump();
      return reply;
    } else {
      const data = await llmResponse.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (content) {
        saveContext([{ role: 'assistant', content }]).catch(() => {});
      }
      return reply.send(data);
    }
  } catch (err) {
    fastify.log.error('LLM call failed:', err.message);
    return reply.status(500).send({ error: err.message });
  }
});

// 健康检查
fastify.get('/health', async () => ({ status: 'ok', service: 'deepseek-ds', vaultLoaded: !!vaultCache.loadedAt }));

// 手动刷新记忆缓存
fastify.post('/admin/reload-vault', async () => {
  await loadVaultCache();
  return { status: 'ok', loadedAt: vaultCache.loadedAt };
});

// ===== 启动 =====
const start = async () => {
  try {
    // 启动时加载 vault
    await loadVaultCache();
    // 每 5 分钟自动刷新
    setInterval(loadVaultCache, 5 * 60 * 1000);

    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info('DeepSeek DS Service running on port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
