# 附录 D：开发者速查手册

本附录为 OpenClaw 开发者和运营者提供日常最常用的配置项、CLI 命令和关键文件的快速参考。

---

## D.1 关键配置项 Top 10

以下是最常调整的 10 个配置项，覆盖 90% 的日常场景。配置文件为 `openclaw.yaml`（JSON5 格式）。

| # | 配置项 | 默认值 | 说明 | 参考章节 |
|---|--------|--------|------|---------|
| 1 | `models.default` | — | 默认使用的 LLM 模型 ID（如 `anthropic/claude-sonnet-4`） | 第 4 章 |
| 2 | `models.fallback` | `[]` | 降级模型列表，按顺序尝试 | 第 4 章 |
| 3 | `gateway.port` | `18789` | Gateway 监听端口 | 第 3 章 |
| 4 | `gateway.bind` | `"loopback"` | 绑定模式：`auto` / `lan` / `loopback` / `tailnet` / `custom` | 第 3 章 |
| 5 | `gateway.auth.mode` | `"token"` | 认证模式：`none` / `token` / `password` / `trusted-proxy` | 第 13 章 |
| 6 | `agents.main.systemPromptMode` | `"full"` | 系统提示模式：`full` / `minimal` / `none` | 第 6 章 |
| 7 | `agentContextTokens` | `200000` | 全局上下文窗口上限（token 数） | 第 5 章 |
| 8 | `exec.security` | `"allowlist"` | 命令执行安全级别：`deny` / `allowlist` / `full` | 第 13 章 |
| 9 | `gateway.reload.mode` | `"hybrid"` | 热重载模式：`off` / `restart` / `hot` / `hybrid` | 第 3 章 |
| 10 | `cron.enabled` | `true` | 是否启用定时任务调度器 | 第 12 章 |

### 快速示例

```yaml
# openclaw.yaml 最小可用配置
models:
  default: anthropic/claude-sonnet-4
  fallback:
    - openai/gpt-4o
    - google/gemini-2.5-pro

gateway:
  port: 18789
  bind: loopback
  auth:
    mode: token

exec:
  security: allowlist
```

---

## D.2 CLI 命令速查

### D.2.1 Gateway 管理

| 命令 | 说明 |
|------|------|
| `openclaw gateway start` | 启动 Gateway 守护进程 |
| `openclaw gateway stop` | 停止 Gateway |
| `openclaw gateway restart` | 重启 Gateway |
| `openclaw gateway status` | 查看 Gateway 运行状态 |
| `openclaw gateway logs` | 查看 Gateway 日志 |
| `openclaw gateway logs --rotate` | 日志轮转 |

### D.2.2 配置与认证

| 命令 | 说明 |
|------|------|
| `openclaw wizard` | 交互式配置向导 |
| `openclaw auth` | 配置 LLM Provider 认证 |
| `openclaw config schema` | 导出配置 JSON Schema |
| `openclaw config validate` | 验证配置文件 |

### D.2.3 Agent 与会话

| 命令 | 说明 |
|------|------|
| `openclaw chat` | 启动 TUI 交互界面 |
| `openclaw chat --agent <name>` | 指定 Agent 启动对话 |
| `openclaw chat --model <id>` | 临时覆盖模型 |
| `openclaw sessions list` | 列出活跃会话 |

### D.2.4 诊断与安全

| 命令 | 说明 |
|------|------|
| `openclaw doctor` | 运行 12+ 子系统诊断 |
| `openclaw security audit` | 执行安全审计（30+ 检查项） |
| `openclaw security audit --fix` | 审计并自动修复 |
| `openclaw security audit --deep` | 深度审计（包含网关探测） |

### D.2.5 技能管理

| 命令 | 说明 |
|------|------|
| `openclaw skills list` | 列出已安装技能 |
| `openclaw skills install <name>` | 安装技能 |
| `openclaw skills install <name> --via <pm>` | 通过指定包管理器安装（brew/npm/go/uv） |

### D.2.6 备份与维护

| 命令 | 说明 |
|------|------|
| `openclaw backup create` | 创建完整备份 |
| `openclaw backup restore <path>` | 恢复备份 |

### D.2.7 TUI 斜杠命令

在交互界面中可使用以下斜杠命令：

| 命令 | 说明 | 分类 |
|------|------|------|
| `/agent <name>` | 切换到指定 Agent | 导航 |
| `/session <id>` | 切换到指定会话 | 导航 |
| `/model <id>` | 运行时切换模型 | 模型控制 |
| `/think <level>` | 调整思维链级别 | 模型控制 |
| `/fast` | 切换到快速模型 | 模型控制 |
| `/status` | 显示当前状态 | 可观测性 |
| `/verbose` | 切换详细输出模式 | 可观测性 |
| `/reasoning` | 切换推理显示 | 可观测性 |
| `/usage` | 显示 token 使用量 | 可观测性 |
| `/elevated` | 调整权限级别 | 安全 |
| `/abort` | 取消当前操作 | 流控 |

---

## D.3 关键文件速查

### D.3.1 用户工作区文件

这些文件放在你的工作区根目录（默认 `~/.openclaw/workspace/`），由你维护：

| 文件 | 用途 | 是否必需 | 参考章节 |
|------|------|---------|---------|
| `SOUL.md` | Agent 的身份与人格定义——"你是谁" | 推荐 | 第 2、6 章 |
| `AGENTS.md` | Agent 的工作规范与流程——"你的工作流程" | 推荐 | 第 2、6 章 |
| `USER.md` | 用户画像——"你在帮谁" | 推荐 | 第 2 章 |
| `TOOLS.md` | 本地工具配置备注（设备名、SSH 地址等） | 可选 | 第 10 章 |
| `IDENTITY.md` | Agent 自我认同（名字、emoji、头像） | 可选 | 第 6 章 |
| `MEMORY.md` | Agent 的长期记忆（策划的重要信息） | 可选 | 第 5 章 |
| `BOOT.md` | 启动自举指令（执行后自动删除） | 可选 | 第 3 章 |
| `HEARTBEAT.md` | 心跳检查清单 | 可选 | 第 12 章 |
| `memory/*.md` | 日记式记忆文件（按日期） | 自动生成 | 第 5 章 |
| `skills/*/SKILL.md` | 自定义技能定义 | 可选 | 第 16 章 |

### D.3.2 系统配置文件

| 文件 | 位置 | 用途 |
|------|------|------|
| `openclaw.yaml` | `~/.openclaw/openclaw.yaml` | 主配置文件 |
| `gateway.log` | `~/.openclaw/logs/gateway.log` | Gateway 运行日志 |
| `sessions/` | `~/.openclaw/sessions/` | 会话持久化数据 |
| `state/` | `~/.openclaw/state/` | 系统状态数据 |

### D.3.3 技能文件结构

一个标准技能目录的结构：

```
skills/
  my-skill/
    SKILL.md          # 技能定义（必需）
    references/       # 参考资料（可选）
    scripts/          # 辅助脚本（可选）
```

`SKILL.md` 的关键字段：

```markdown
---
name: my-skill
description: 技能的一句话描述（会注入到 Agent 的系统提示中）
userInvocable: true        # 是否支持 /my-skill 斜杠命令
disableModelInvocation: false  # 是否对模型隐藏
---

# 技能名称

具体的操作指南和流程说明...
```

---

## D.4 常见错误速查

| 错误消息 | 解决方案 |
|----------|----------|
| `Gateway not running` | `openclaw gateway start` |
| `ECONNREFUSED 127.0.0.1:3577` | 检查端口冲突：`lsof -i :3577` |
| `401 Unauthorized` (Provider) | `openclaw auth` 重新配置凭证 |
| `429 Too Many Requests` | 等待冷却或切换备用 Provider |
| `Context window exceeded` | 降低 `agentContextTokens` 或切换大窗口模型 |
| `SSRF blocked` | 检查目标是否为私有 IP |
| `Pairing required` | 在设备上重新扫描配对码 |
| `Channel ERROR` | 检查通道 Token/Webhook 配置 |
| `ENOSPC` | 清理日志：`openclaw gateway logs --rotate` |

---

## D.5 Token 成本速查

| 操作类型 | 典型 Token 消耗 | 月度估算 |
|---------|---------------|---------|
| Cron 日报 | ~2,000/次 | ~$0.9（1次/天） |
| 心跳（无事） | ~100/次 | ~$9（200次/天） |
| 心跳（处理事务） | ~500/次 | ~$1.1（5次/天） |
| 事件钩子 | 0（无 LLM 调用） | $0 |
| **典型月度合计** | | **~$11** |

> **来源**：第 12 章定时任务与自动化。基于 Claude Sonnet 定价估算。

---

> **提示**：本手册为快速参考用途。各配置项和命令的完整说明，请参考对应章节和附录 A（配置速查表）。
