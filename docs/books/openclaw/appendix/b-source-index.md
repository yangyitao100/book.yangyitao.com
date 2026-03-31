# 附录 B：源码文件索引

本附录列出全书引用的所有源码文件路径，按模块分组，方便读者快速定位相关代码。

### 如何使用本附录

本索引覆盖 OpenClaw 源码中 23 个子系统、200+ 个关键文件。每个条目包含三列信息：

- **文件路径**：相对于仓库根目录的路径，可直接在 IDE 中 `Ctrl+P` 搜索打开
- **说明**：该文件的核心职责（一句话概括）
- **相关章节**：本书中详细讨论该文件的章节编号

> **阅读建议**：初次阅读本书时无需逐行浏览本附录；当你在正文中遇到某个源码引用想了解其上下文时，回到这里按模块查找即可。如果你打算对 OpenClaw 进行二次开发，本索引也是快速建立代码地图的起点。

---

## B.1 入口与核心

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/entry.ts` | 进程入口，启动哲学 | 第1章 |
| `src/channel.ts` | 通道主模块 | 第7章 |
| `src/accounts.ts` | 账户管理 | 第8章 |

---

## B.2 配置系统（`src/config/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/config/types.ts` | 配置类型定义（聚合导出） | 第3章 |
| `src/config/types.base.ts` | 基础配置类型 | 第3、5章 |
| `src/config/types.gateway.ts` | Gateway 配置类型 | 第3章 |
| `src/config/types.agents.ts` | Agent 配置类型 | 第6章 |
| `src/config/types.channels.ts` | 通道配置类型 | 第7章 |
| `src/config/types.tools.ts` | 工具配置类型 | 第10章 |
| `src/config/types.skills.ts` | 技能配置类型 | 第16章 |
| `src/config/types.cron.ts` | 定时任务配置类型 | 第12章 |
| `src/config/types.secrets.ts` | 凭证配置类型 | 第13章 |
| `src/config/types.models.ts` | 模型配置类型 | 第4章 |
| `src/config/defaults.ts` | 默认值与模型别名 | 第3、4章 |
| `src/config/schema.ts` | 配置 Schema 生成 | 第3章 |
| `src/config/zod-schema.ts` | Zod Schema 定义 | 第3章 |
| `src/config/io.ts` | 配置读写 I/O | 第3章 |
| `src/config/paths.ts` | 配置路径解析 | 第3章 |
| `src/config/includes.ts` | 配置文件 include 机制 | 第3章 |
| `src/config/env-vars.ts` | 环境变量处理 | 第3章 |
| `src/config/env-substitution.ts` | 环境变量替换 | 第3章 |
| `src/config/validation.ts` | 配置校验 | 第3章 |
| `src/config/logging.ts` | 日志配置 | 第15章 |
| `src/config/sessions.ts` | 会话配置 | 第5章 |
| `src/config/port-defaults.ts` | 默认端口定义 | 第3章 |

---

## B.3 Gateway（`src/gateway/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/gateway/config-reload.ts` | 配置热重载 | 第3章 |
| `src/gateway/config-reload-plan.ts` | 重载计划生成 | 第3章 |
| `src/gateway/server-methods/config.ts` | Gateway 配置服务端 | 第3章 |
| `src/gateway/protocol/schema/config.ts` | Gateway 协议 Schema | 第3章 |

---

## B.4 Agent 系统（`src/agents/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/agents/system-prompt.ts` | 系统提示组装 | 第6章 |
| `src/agents/tool-policy-pipeline.ts` | 工具策略管线 | 第6、10章 |
| `src/agents/tool-policy.ts` | 工具策略定义 | 第6、10章 |
| `src/agents/tool-catalog.ts` | 工具目录 | 第10章 |
| `src/agents/openclaw-tools.ts` | OpenClaw 内置工具 | 第10章 |
| `src/agents/pi-tools.ts` | Pi Agent 工具 | 第10章 |
| `src/agents/bash-tools.ts` | Bash/Exec 工具 | 第10章 |
| `src/agents/model-selection.ts` | 模型选择逻辑 | 第4章 |
| `src/agents/model-fallback.ts` | 模型降级链 | 第4章 |
| `src/agents/model-catalog.ts` | 模型目录 | 第4章 |
| `src/agents/models-config.ts` | 模型配置 | 第4章 |
| `src/agents/provider-capabilities.ts` | Provider 能力发现 | 第4章 |
| `src/agents/provider-id.ts` | Provider ID 规范化 | 第4章 |
| `src/agents/defaults.ts` | Agent 默认值 | 第6章 |
| `src/agents/agent-scope.ts` | Agent 作用域 | 第6章 |
| `src/agents/compaction.ts` | 上下文压缩 | 第5章 |
| `src/agents/context-window-guard.ts` | 上下文窗口守卫 | 第5章 |
| `src/agents/session-write-lock.ts` | 会话写锁 | 第5章 |
| `src/agents/usage.ts` | Token 用量统计 | 第4章 |
| `src/agents/failover-error.ts` | 故障转移错误处理 | 第4章 |
| `src/agents/custom-api-registry.ts` | 自定义 API 注册 | 第4章 |
| `src/agents/auth-profiles.ts` | 认证 Profile | 第4章 |
| `src/agents/auth-profiles/usage.ts` | 认证用量 | 第4章 |
| `src/agents/pi-embedded.ts` | Pi 嵌入式 Runner | 第6章 |
| `src/agents/pi-embedded-runner.ts` | Pi 嵌入式执行器 | 第6章 |
| `src/agents/pi-embedded-subscribe.ts` | Pi 嵌入式订阅 | 第6章 |

### Sub-agent 系统

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/agents/subagent-spawn.ts` | Sub-agent 创建 | 第6、18章 |
| `src/agents/subagent-control.ts` | Sub-agent 控制 | 第6、18章 |
| `src/agents/subagent-registry.ts` | Sub-agent 注册表 | 第6章 |
| `src/agents/subagent-announce.ts` | Sub-agent 完成通知 | 第6章 |
| `src/agents/subagent-depth.ts` | Sub-agent 深度控制 | 第6章 |
| `src/agents/subagent-lifecycle-events.ts` | Sub-agent 生命周期事件 | 第6章 |
| `src/agents/acp-spawn.ts` | ACP 模式 Sub-agent 创建 | 第6章 |
| `src/agents/acp-spawn-parent-stream.ts` | ACP 父流管理 | 第6章 |

### 技能系统

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/agents/skills.ts` | 技能加载主逻辑 | 第16章 |
| `src/agents/skills/config.ts` | 技能配置 | 第16章 |
| `src/agents/skills/types.ts` | 技能类型定义 | 第16章 |
| `src/agents/skills/workspace.ts` | 技能工作区 | 第16章 |
| `src/agents/skills/env-overrides.ts` | 技能环境变量覆盖 | 第16章 |
| `src/agents/skills-install.ts` | 技能安装 | 第16章 |

### 工具系统

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/agents/tools/sessions-spawn-tool.ts` | 会话创建工具 | 第6章 |
| `src/agents/tools/sessions-send-tool.ts` | 会话消息发送工具 | 第6章 |

---

## B.5 ACP（`src/acp/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/acp/server.ts` | ACP 服务端 | 第6章 |
| `src/acp/client.ts` | ACP 客户端 | 第6章 |
| `src/acp/types.ts` | ACP 类型定义 | 第6章 |
| `src/acp/control-plane/manager.ts` | ACP 控制面管理器 | 第6章 |
| `src/acp/runtime/types.ts` | ACP 运行时类型 | 第6章 |
| `src/acp/runtime/session-identity.ts` | ACP 会话身份 | 第6章 |

---

## B.6 通道系统（`src/channels/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/channels/registry.ts` | 通道注册表 | 第7章 |
| `src/channels/ids.ts` | 通道标识 | 第7章 |
| `src/channels/plugins/registry.ts` | 通道插件注册表 | 第7章 |
| `src/channels/plugins/types.ts` | 通道插件类型 | 第7章 |
| `src/channels/plugins/bundled.ts` | 内置通道插件 | 第7章 |
| `src/channels/config-matching.ts` | 配置匹配引擎 | 第7章 |
| `src/channels/channel-config.ts` | 通道配置 | 第7章 |
| `src/channels/session.ts` | 通道会话 | 第7章 |
| `src/channels/run-state-machine.ts` | 运行状态机 | 第7章 |
| `src/channels/typing.ts` | 打字指示 | 第7章 |
| `src/channels/allow-from.ts` | 来源白名单 | 第7、13章 |
| `src/channels/command-gating.ts` | 命令门控 | 第7章 |
| `src/channels/mention-gating.ts` | @提及门控 | 第7章 |
| `src/channels/inbound-debounce-policy.ts` | 入站防抖策略 | 第7章 |

---

## B.7 通道实现（`extensions/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `extensions/telegram/src/channel.ts` | Telegram 通道实现 | 第8章 |
| `extensions/telegram/src/accounts.ts` | Telegram 账户管理 | 第8章 |
| `extensions/discord/src/channel.ts` | Discord 通道实现 | 第8章 |
| `extensions/whatsapp/src/channel.ts` | WhatsApp 通道实现 | 第8章 |
| `extensions/signal/src/channel.ts` | Signal 通道实现 | 第8章 |
| `extensions/slack/src/channel.ts` | Slack 通道实现 | 第8章 |
| `extensions/feishu/src/channel.ts` | 飞书通道实现 | 第8章 |
| `extensions/feishu/src/accounts.ts` | 飞书账户管理 | 第8章 |
| `extensions/feishu/src/conversation-id.ts` | 飞书会话 ID 解析 | 第8章 |

---

## B.8 插件系统（`src/plugins/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/plugins/registry.ts` | 插件注册表 | 第9章 |
| `src/plugins/loader.ts` | 插件加载器 | 第9章 |
| `src/plugins/types.ts` | 插件类型定义 | 第9章 |
| `src/plugins/hooks.ts` | 插件钩子系统 | 第9章 |
| `src/plugins/commands.ts` | 插件命令 | 第9章 |
| `src/plugins/discovery.ts` | 插件发现 | 第9章 |
| `src/plugins/config-schema.ts` | 插件配置 Schema | 第9章 |
| `src/plugins/config-state.ts` | 插件配置状态 | 第9章 |
| `src/plugins/runtime/index.js` | 插件运行时 | 第9章 |
| `src/plugins/runtime/types.ts` | 运行时类型 | 第9章 |
| `src/plugin-sdk/config-runtime.ts` | SDK 运行时配置 | 第9章 |
| `src/plugin-sdk/config-paths.ts` | SDK 路径配置 | 第9章 |

---

## B.9 浏览器自动化（`src/browser/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/browser/profiles-service.ts` | 浏览器 Profile 服务 | 第10章 |
| `src/browser/navigation-guard.ts` | 导航安全守卫 | 第10章 |
| `src/browser/pw-role-snapshot.ts` | Playwright 角色快照 | 第10章 |
| `src/browser/snapshot-roles.ts` | 快照角色解析 | 第10章 |
| `src/browser/url-pattern.ts` | URL 模式匹配 | 第10章 |
| `src/browser/config.ts` | 浏览器配置 | 第10章 |

---

## B.10 Node 系统（`src/node-host/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/node-host/config.ts` | Node Host 配置 | 第11章 |

---

## B.11 自动回复与钩子（`src/auto-reply/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/auto-reply/skill-commands.ts` | 技能命令触发 | 第12章 |
| `src/auto-reply/reply/config-commands.ts` | 配置命令回复 | 第12章 |
| `src/auto-reply/reply/config-value.ts` | 配置值回复 | 第12章 |
| `src/auto-reply/reply/config-write-authorization.ts` | 配置写入授权 | 第13章 |

---

## B.12 安全（`src/secrets/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/secrets/configure-plan.ts` | 凭证配置计划 | 第13章 |

---

## B.13 CLI（`src/cli/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/cli/run-main.ts` | CLI 主入口 | 第14章 |
| `src/cli/argv.ts` | CLI 参数解析 | 第14章 |
| `src/cli/banner.ts` | CLI 启动横幅 | 第14章 |
| `src/cli/banner-config-lite.ts` | 轻量配置横幅 | 第14章 |

---

## B.14 日志（`src/logging/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/logging/config.ts` | 日志配置 | 第15章 |
| `src/logging/logger.ts` | 日志记录器 | 第15章 |
| `src/logging/redact.ts` | 日志脱敏 | 第15章 |
| `src/logging/levels.ts` | 日志级别定义 | 第15章 |
| `src/logging/console.ts` | 控制台日志 | 第15章 |
| `src/logging/env-log-level.ts` | 环境变量日志级别 | 第15章 |

---

## B.15 上下文引擎（`src/context-engine/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/context-engine/types.ts` | Context Engine 类型定义 | 第5章 |
| `src/context-engine/registry.ts` | Context Engine 注册表 | 第5章 |
| `src/context-engine/legacy.ts` | Legacy Context Engine 实现 | 第5章 |

---

## B.16 定时任务（`src/cron/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/cron/service.ts` | Cron 服务主入口 | 第12章 |
| `src/cron/service/ops.ts` | Cron 操作 | 第12章 |
| `src/cron/service/state.ts` | Cron 状态管理 | 第12章 |
| `src/cron/service/timer.ts` | Cron 定时器 | 第12章 |
| `src/cron/store.ts` | Cron 存储 | 第12章 |
| `src/cron/stagger.ts` | Cron 错峰调度 | 第12章 |
| `src/cron/types.ts` | Cron 类型定义 | 第12章 |

---

## B.17 Daemon 管理（`src/daemon/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/daemon/service.ts` | Daemon 服务管理 | 第3、14章 |
| `src/daemon/systemd.ts` | systemd 集成 | 第3、15章 |
| `src/daemon/systemd-unit.ts` | systemd unit 文件生成 | 第15章 |
| `src/daemon/systemd-linger.ts` | systemd linger 配置 | 第15章 |
| `src/daemon/launchd.ts` | macOS launchd 集成 | 第3章 |
| `src/daemon/launchd-plist.ts` | launchd plist 生成 | 第3章 |
| `src/daemon/schtasks.ts` | Windows 计划任务 | 第3章 |
| `src/daemon/constants.ts` | Daemon 常量 | 第3章 |
| `src/daemon/diagnostics.ts` | Daemon 诊断 | 第3、15章 |
| `src/daemon/runtime-binary.ts` | 运行时二进制定位 | 第3章 |
| `src/daemon/service-audit.ts` | 服务审计 | 第15章 |

---

## B.18 安全子系统（`src/security/`、`src/infra/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/security/audit.ts` | 安全审计引擎 | 第13章 |
| `src/security/dangerous-tools.ts` | 危险工具检测 | 第10、13章 |
| `src/security/dangerous-config-flags.ts` | 危险配置标志 | 第13章 |
| `src/security/external-content.ts` | 外部内容安全 | 第13章 |
| `src/security/fix.ts` | 安全自动修复 | 第13章 |
| `src/infra/exec-approvals.ts` | Exec 审批流 | 第13章 |
| `src/infra/exec-safety.ts` | Exec 安全策略 | 第10、13章 |
| `src/infra/net/ssrf.ts` | SSRF 防护 | 第10、15章 |
| `src/infra/heartbeat-runner.ts` | 心跳运行器 | 第12章 |

---

## B.19 会话管理（`src/sessions/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/sessions/session-id.ts` | 会话 ID 生成 | 第5章 |
| `src/sessions/send-policy.ts` | 发送策略 | 第5章 |
| `src/sessions/model-overrides.ts` | 模型覆盖 | 第5章 |
| `src/sessions/level-overrides.ts` | 级别覆盖 | 第5章 |
| `src/sessions/input-provenance.ts` | 输入来源追踪 | 第5章 |
| `src/sessions/session-lifecycle-events.ts` | 会话生命周期事件 | 第5章 |
| `src/sessions/transcript-events.ts` | 对话记录事件 | 第5章 |

---

## B.20 记忆系统（`src/memory/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/memory/index.ts` | 记忆系统入口 | 第5章 |
| `src/memory/manager.ts` | 记忆管理器 | 第5章 |
| `src/memory/hybrid.ts` | 混合搜索引擎 | 第5章 |
| `src/memory/types.ts` | 记忆类型定义 | 第5章 |

---

## B.21 TUI（`src/tui/`）

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/tui/tui.ts` | TUI 主入口 | 第14章 |
| `src/tui/commands.ts` | TUI 命令注册 | 第14章 |
| `src/tui/tui-command-handlers.ts` | TUI 命令处理器 | 第14章 |
| `src/tui/tui-event-handlers.ts` | TUI 事件处理器 | 第14章 |
| `src/tui/tui-formatters.ts` | TUI 格式化 | 第14章 |
| `src/tui/tui-local-shell.ts` | TUI 本地 Shell | 第14章 |
| `src/tui/tui-overlays.ts` | TUI 覆盖层 | 第14章 |
| `src/tui/theme/theme.ts` | TUI 主题 | 第14章 |

---

## B.22 路由与基础设施

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `src/routing/session-key.ts` | Session Key 路由解析 | 第5、7章 |
| `src/routing/resolve-route.ts` | 路由解析 | 第7章 |
| `src/infra/backoff.ts` | 退避策略 | 第4章 |
| `src/infra/restart.ts` | 重启管理 | 第3章 |
| `src/gateway/boot.ts` | Gateway 引导启动 | 第3章 |
| `src/gateway/server-startup.ts` | Gateway 服务启动 | 第3章 |
| `src/gateway/server-restart-sentinel.ts` | 重启哨兵实现 | 第3章 |
| `src/gateway/server-http.ts` | Gateway HTTP 服务 | 第3章 |
| `src/gateway/server-ws-runtime.ts` | Gateway WebSocket 运行时 | 第3章 |
| `src/gateway/channel-health-monitor.ts` | 通道健康监控 | 第15章 |
| `src/gateway/auth-rate-limit.ts` | 认证限速 | 第13章 |

---

## B.23 部署文件

| 文件路径 | 说明 | 相关章节 |
|----------|------|----------|
| `Dockerfile` | Docker 多阶段构建 | 第15章 |
| `docker-compose.yml` | Docker Compose 编排 | 第15章 |

---

> **说明**：本索引基于全书正文中引用的源码路径编制。OpenClaw 源码仓库结构可能随版本迭代而变化，建议以 `main` 分支最新代码为准。
