# OpenClaw设计与实现

**第一本深入 AI Agent 运行时内核的架构专著。**

本书以生产级开源项目 OpenClaw 的完整源码为解剖对象，逐层拆解 Gateway 引擎、Provider 热切换、会话管理、子 Agent 编排、工具安全沙箱、技能系统、Node 设备互联等核心子系统。12 种架构模式、68 个设计决策、大量被放弃的替代方案——无论你是否使用 OpenClaw，都能直接迁移到你自己的 Agent 系统。

## 适合谁读

有系统编程经验的后端工程师、架构师、AI 基础设施开发者，以及所有想超越"调 API"、真正理解 Agent 运行时内部机理的技术人。

## 目录

- [前言](./chapters/00-preface)
- [第1章 为什么需要OpenClaw](./chapters/01-why-openclaw)
- [第2章 架构总览](./chapters/02-architecture)
- [第3章 Gateway网关引擎](./chapters/03-gateway)
- [第4章 Provider抽象层](./chapters/04-provider)
- [第5章 Session与对话管理](./chapters/05-session)
- [第6章 Agent系统](./chapters/06-agent)
- [第7章 通道架构](./chapters/07-channel-arch)
- [第8章 通道实现深度剖析](./chapters/08-channel-impl)
- [第9章 插件与扩展系统](./chapters/09-plugin)
- [第10章 工具系统](./chapters/10-tool)
- [第11章 Node系统与设备连接](./chapters/11-node)
- [第12章 定时任务与自动化](./chapters/12-scheduler)
- [第13章 安全与权限](./chapters/13-security)
- [第14章 CLI与交互界面](./chapters/14-cli)
- [第15章 部署与运维](./chapters/15-deploy)
- [第16章 技能系统](./chapters/16-skill)
- [第17章 设计模式与架构决策](./chapters/17-design-patterns)
- [第18章 构建你自己的Agent帝国](./chapters/18-build-empire)

### 附录

- [附录A 配置速查表](./appendix/a-config)
- [附录B 源码文件索引](./appendix/b-source-index)
- [附录C 对比表速查](./appendix/c-comparison)
- [附录D 开发者速查手册](./appendix/d-dev-handbook)

### 其他

- [作者简介](./chapters/author)
- [参考文献](./chapters/bibliography)
- [术语索引](./chapters/glossary)
