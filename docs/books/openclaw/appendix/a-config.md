# 附录 A：OpenClaw 配置速查表

本附录列出 OpenClaw 最常用的配置项，帮助读者快速查阅。所有配置项定义在 `src/config/types*.ts` 和 `src/config/defaults.ts` 中。

### 如何使用本附录

OpenClaw 配置采用 YAML 格式（`openclaw.yaml`），支持三种覆盖方式：

1. **配置文件**：在 `openclaw.yaml` 中以层级结构书写，如 `gateway.port: 19000`
2. **环境变量**：部分核心配置可通过环境变量注入（见 §A.9）
3. **CLI 参数**：运行时通过 `openclaw --port 19000` 等方式覆盖

> **查阅建议**：表中"默认值"列为空（—）的配置项，表示该值不会自动填充，需要用户显式设置才能生效。标记为 `SecretInput` 类型的字段支持直接字符串、`env:VAR_NAME` 引用或 `file:/path` 引用三种写法。完整的 JSON Schema 可通过 `openclaw config schema` 命令导出。

---

## A.1 Gateway 配置（`gateway.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `gateway.port` | number | `18789` | Gateway WS + HTTP 复用端口 |
| `gateway.bind` | string | `"loopback"` | 绑定模式：`auto` / `lan` / `loopback` / `tailnet` / `custom` |
| `gateway.customBindHost` | string | — | `bind="custom"` 时的自定义 IP |
| `gateway.mode` | string | `"local"` | `"local"` 本地启动 / `"remote"` 远程连接 |
| `gateway.channelHealthCheckMinutes` | number | `5` | 通道健康检查间隔（分钟），`0` 禁用 |
| `gateway.channelStaleEventThresholdMinutes` | number | `30` | 通道无事件超时阈值（分钟） |
| `gateway.channelMaxRestartsPerHour` | number | `10` | 每小时最大自动重启次数 |

### A.1.1 认证（`gateway.auth.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `gateway.auth.mode` | string | `"token"` | 认证模式：`none` / `token` / `password` / `trusted-proxy` |
| `gateway.auth.token` | SecretInput | — | Token 认证的共享密钥 |
| `gateway.auth.allowTailscale` | boolean | — | 允许 Tailscale 身份 Header |
| `gateway.auth.rateLimit.maxAttempts` | number | `10` | 失败次数上限 |
| `gateway.auth.rateLimit.windowMs` | number | `60000` | 滑动窗口（毫秒） |
| `gateway.auth.rateLimit.lockoutMs` | number | `300000` | 锁定时长（毫秒） |

### A.1.2 TLS（`gateway.tls.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `gateway.tls.enabled` | boolean | `false` | 启用 TLS |
| `gateway.tls.autoGenerate` | boolean | `true` | 自动生成自签名证书 |
| `gateway.tls.certPath` | string | — | PEM 证书路径 |
| `gateway.tls.keyPath` | string | — | PEM 私钥路径 |

### A.1.3 热重载（`gateway.reload.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `gateway.reload.mode` | string | `"hybrid"` | 重载策略：`off` / `restart` / `hot` / `hybrid` |
| `gateway.reload.debounceMs` | number | `300` | 防抖窗口（毫秒） |
| `gateway.reload.deferralTimeoutMs` | number | `300000` | 最大等待进行中操作时间 |

### A.1.4 远程连接（`gateway.remote.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `gateway.remote.url` | string | — | 远程 Gateway WebSocket URL |
| `gateway.remote.transport` | string | `"direct"` | 传输方式：`ssh` / `direct` |
| `gateway.remote.token` | SecretInput | — | 远程认证 Token |
| `gateway.remote.tlsFingerprint` | string | — | TLS 证书指纹（sha256） |

---

## A.2 会话配置（`session.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `session.scope` | string | `"per-sender"` | 会话范围：`per-sender` / `global` |
| `session.dmScope` | string | `"main"` | DM 会话范围：`main` / `per-peer` / `per-channel-peer` |
| `session.idleMinutes` | number | — | 空闲超时（分钟） |
| `session.typingMode` | string | `"thinking"` | 打字指示：`never` / `instant` / `thinking` / `message` |
| `session.resetTriggers` | string[] | — | 重置触发关键词 |

### A.2.1 会话重置（`session.reset.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `session.reset.mode` | string | `"daily"` | 重置模式：`daily` / `idle` |
| `session.reset.atHour` | number | `0` | 每日重置时间（0-23 本地小时） |
| `session.reset.idleMinutes` | number | — | 空闲滑动窗口（分钟） |

---

## A.3 Agent 配置（`agents.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `agents.<id>.model` | string | — | Agent 使用的模型 ID（如 `anthropic/claude-opus-4-6`） |
| `agents.<id>.systemPrompt` | string | — | 系统提示词 |
| `agents.<id>.contextTokens` | number | 默认值随模型 | 上下文窗口 Token 上限 |
| `agents.<id>.maxConcurrent` | number | 见默认 | 最大并发请求数 |
| `agents.<id>.tools` | object | — | 工具配置（allow/deny/profiles） |
| `agents.<id>.skills` | object | — | 技能配置 |

---

## A.4 模型配置（`models.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `models.<id>.id` | string | — | Provider 模型 ID |
| `models.<id>.name` | string | — | 显示名称 |
| `models.<id>.api` | string | — | API 协议（如 `anthropic-messages`） |
| `models.<id>.cost.input` | number | `0` | 输入 Token 单价 |
| `models.<id>.cost.output` | number | `0` | 输出 Token 单价 |
| `models.<id>.maxTokens` | number | `8192` | 单次最大输出 Token |

### 默认模型别名

| 别名 | 解析为 |
|------|--------|
| `opus` | `anthropic/claude-opus-4-6` |
| `sonnet` | `anthropic/claude-sonnet-4-6` |
| `gpt` | `openai/gpt-5.4` |
| `gpt-mini` | `openai/gpt-5-mini` |
| `gemini` | `google/gemini-3.1-pro-preview` |
| `gemini-flash` | `google/gemini-3-flash-preview` |

---

## A.5 通道配置（`channels.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `telegram.botToken` | SecretInput | — | Telegram Bot Token |
| `telegram.webhook.url` | string | — | Webhook URL |
| `discord.botToken` | SecretInput | — | Discord Bot Token |
| `discord.appId` | string | — | Discord 应用 ID |
| `whatsapp.phoneId` | string | — | WhatsApp 手机号 ID |
| `slack.botToken` | SecretInput | — | Slack Bot Token |
| `slack.appToken` | SecretInput | — | Slack App Token（Socket Mode） |
| `feishu.appId` | string | — | 飞书应用 ID |
| `feishu.appSecret` | SecretInput | — | 飞书应用密钥 |

---

## A.6 工具与安全配置

### A.6.1 工具（`tools.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `tools.allow` | string[] | — | 允许的工具列表 |
| `tools.deny` | string[] | — | 禁止的工具列表 |
| `tools.profiles` | string[] | — | 工具配置文件（能力包） |

### A.6.2 来源白名单（`allowFrom.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `allowFrom.users` | string[] | — | 允许交互的用户 ID 列表 |
| `allowFrom.groups` | string[] | — | 允许交互的群组 ID 列表 |

### A.6.3 Exec 审批（`approvals.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `approvals.mode` | string | — | 审批模式 |
| `approvals.allowlist` | string[] | — | 免审批命令白名单 |

### A.6.4 Sandbox（`sandbox.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `sandbox.enabled` | boolean | `false` | 启用沙箱 |
| `sandbox.docker.image` | string | — | Docker 镜像名称 |

---

## A.7 定时任务（`cron.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cron.<name>.schedule` | string | — | Cron 表达式（5/6 字段） |
| `cron.<name>.prompt` | string | — | 触发时发送的提示词 |
| `cron.<name>.agent` | string | — | 执行 Agent ID |
| `cron.<name>.channel` | string | — | 目标通道 |

---

## A.8 TTS / Talk 配置（`talk.*`）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `talk.provider` | string | `"elevenlabs"` | TTS 提供商 |
| `talk.voiceId` | string | — | 默认语音 ID |
| `talk.voiceAliases` | Record | — | 语音名称映射 |
| `talk.interruptOnSpeech` | boolean | `true` | 用户说话时停止播放 |
| `talk.silenceTimeoutMs` | number | — | 静默超时（毫秒） |

---

## A.9 环境变量

| 环境变量 | 说明 |
|----------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `DISCORD_BOT_TOKEN` | Discord Bot Token |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway 认证 Token |
| `OPENCLAW_CONFIG_PATH` | 自定义配置文件路径 |

---

## A.10 默认端口

| 端口 | 用途 |
|------|------|
| `18789` | Gateway 主端口（WS + HTTP） |
| `18790` | Bridge 端口 |
| `18791` | Browser Control 端口 |
| `18793` | Canvas Host 端口 |
| `18800-18899` | Browser CDP 端口范围 |

---

> **提示**：完整配置 Schema 可通过 `openclaw config schema` 命令查看，或参阅 `src/config/zod-schema.ts`。
