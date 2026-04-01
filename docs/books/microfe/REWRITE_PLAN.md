# 《微前端架构深度剖析：从原理到生产》重写大纲

> 原书名：微前端源码剖析
> 重写原因：乾坤/single-spa 已不是唯一选择，Module Federation 2.0、Rspack、Web Components 等新方案涌现；旧版仅 8 篇博客，远未达到书籍系统性
> 目标：以杨艺韬的文风，打造微前端领域最全面的架构与源码专著，覆盖 2026 年全部主流方案

---

## 第一部分：微前端的本质

### 第1章 为什么需要微前端
- 1.1 单体前端的五大痛点：构建慢、部署耦合、技术债、团队瓶颈、升级困难
- 1.2 微前端不是银弹：什么时候不该用（比你想象的多）
- 1.3 微前端的演进史：iframe → 路由分发 → 运行时加载 → 编译时共享
- 1.4 2026 年微前端技术版图：六大方案的定位与适用场景
- 1.5 本书的独特价值与阅读路线
- 🔥 深度洞察：微前端的本质不是"拆前端"，是"让不同团队以不同速度独立演进"——理解这一点，你就能在所有方案中做出正确选型

### 第2章 微前端核心问题域
- 2.1 应用加载：如何在运行时动态加载远程代码
- 2.2 JS 隔离：如何防止全局变量污染
- 2.3 CSS 隔离：如何防止样式冲突
- 2.4 应用通信：如何在微应用间传递数据
- 2.5 路由管理：如何统一管理子应用的路由
- 2.6 依赖共享：如何避免重复加载公共库
- 2.7 六大问题的解决策略谱系（表格对比各方案）

## 第二部分：运行时隔离方案——乾坤

### 第3章 乾坤架构总览
- 3.1 乾坤的设计哲学：HTML Entry + 沙箱 + 生命周期
- 3.2 核心依赖关系：qiankun → single-spa → import-html-entry
- 3.3 注册 → 加载 → 挂载 → 卸载：完整生命周期源码走读
- 3.4 乾坤在 2026 年的地位：仍是存量项目的主流选择

### 第4章 JS 沙箱机制深度剖析
- 4.1 三代沙箱的演进：SnapshotSandbox → LegacySandbox → ProxySandbox
- 4.2 快照沙箱：暴力但可靠的全量 diff
- 4.3 单实例代理沙箱：Proxy 的性能优化
- 4.4 多实例代理沙箱：fakeWindow 的精妙设计
- 4.5 沙箱的边界与逃逸：那些隔离不了的东西
- 4.6 手写实现三种沙箱核心逻辑（源码对照）
- 🔥 深度洞察：完美的 JS 隔离在浏览器中是不可能的——理解边界比追求完美更重要

### 第5章 CSS 隔离与资源加载
- 5.1 CSS 隔离三策略：Shadow DOM、Scoped CSS、Dynamic Stylesheet
- 5.2 import-html-entry 源码剖析：HTML → Scripts + Styles + Template
- 5.3 子应用资源的预加载策略
- 5.4 资源加载失败的容错与重试机制

### 第6章 乾坤的应用间通信
- 6.1 initGlobalState：基于发布订阅的全局状态
- 6.2 Props 传递：父子应用的直接通信
- 6.3 loadMicroApp：手动加载模式的实现
- 6.4 通信方案的性能与复杂度权衡

## 第三部分：路由驱动方案——single-spa

### 第7章 single-spa 核心机制
- 7.1 设计哲学：路由即应用边界
- 7.2 注册机制：registerApplication 的参数设计与内部状态机
- 7.3 应用状态管理：12 种状态的流转
- 7.4 reroute 函数深度剖析：微前端的调度中枢

### 第8章 single-spa 的路由拦截
- 8.1 对 pushState/replaceState 的 monkey-patch
- 8.2 popstate/hashchange 的统一处理
- 8.3 路由变化 → 应用加载/卸载的完整链路
- 8.4 与 React Router / Vue Router 的共存策略

## 第四部分：编译时共享方案——Module Federation

### 第9章 Module Federation 设计哲学
- 9.1 从"独立构建独立部署"到"运行时共享模块"
- 9.2 核心概念：Host、Remote、Shared、Exposes
- 9.3 Module Federation 1.0 → 2.0 的架构跃迁
- 9.4 与运行时加载方案（乾坤/single-spa）的本质区别
- 🔥 深度洞察：Module Federation 不是微前端方案，是模块共享基础设施——它的野心远大于"拆前端"

### 第10章 Webpack 5 Module Federation 源码
- 10.1 ContainerPlugin：如何将模块暴露为远程入口
- 10.2 ContainerReferencePlugin：如何消费远程模块
- 10.3 SharePlugin：共享依赖的版本协商机制
- 10.4 运行时加载流程：从 remoteEntry.js 到模块实例化
- 10.5 Chunk 分割与依赖去重的协作

### 第11章 Module Federation 2.0 与 Rspack
- 11.1 MF 2.0 的新能力：类型安全、运行时插件、动态远程
- 11.2 Rspack 中的 Module Federation：Rust 编译的性能优势
- 11.3 @module-federation/enhanced 运行时源码分析
- 11.4 跨框架（React + Vue）的 Module Federation 实践
- 11.5 MF 2.0 的生产部署策略

## 第五部分：其他方案与前沿

### 第12章 Web Components 与微前端
- 12.1 Shadow DOM：浏览器原生的隔离机制
- 12.2 Custom Elements 作为微应用容器
- 12.3 Lit 框架的微前端实践
- 12.4 Web Components 的局限：SSR、表单、Accessibility

### 第13章 iframe 的复兴：Wujie 与新一代方案
- 13.1 为什么 iframe 又回来了
- 13.2 Wujie 的架构：WebComponent + iframe + Proxy
- 13.3 iframe 通信的现代方案：MessageChannel、BroadcastChannel
- 13.4 iframe 的性能优化：预加载、资源共享

### 第14章 其他前沿方案
- 14.1 Garfish（字节跳动）：乾坤的继承者
- 14.2 Micro App（京东）：WebComponent 路线的实践
- 14.3 Import Maps：浏览器原生的模块加载
- 14.4 Server-Driven UI 与微前端的融合趋势

## 第六部分：工程实践

### 第15章 微前端选型决策框架
- 15.1 团队规模 × 技术债 × 部署频率：三维选型矩阵
- 15.2 乾坤 vs Module Federation vs Wujie vs iframe：终极对比
- 15.3 渐进式迁移策略：从单体到微前端的三个阶段
- 15.4 何时放弃微前端（回归单体的勇气）

### 第16章 微前端的 DevOps 与工程化
- 16.1 独立构建 + 独立部署的 CI/CD 管线设计
- 16.2 版本管理：语义化版本 + 兼容性矩阵
- 16.3 监控与可观测性：如何定位跨应用问题
- 16.4 灰度发布与 A/B 测试在微前端中的实现

### 第17章 微前端性能工程
- 17.1 首屏性能：预加载 vs 懒加载的权衡
- 17.2 公共依赖提取与共享策略
- 17.3 沙箱的性能开销与优化
- 17.4 LCP / FID / CLS 在微前端场景下的优化

### 第18章 设计模式与架构决策
- 18.1 微前端中的 10 个核心设计模式
- 18.2 隔离 vs 共享：微前端永恒的张力
- 18.3 被放弃的方案与失败案例的教训
- 18.4 微前端的下一个五年：Web Components 标准化、Server Islands、Edge Rendering
- 🔥 深度洞察：微前端的终极形态不是"前端的微服务"，而是"模块的联邦"——当边界足够清晰，隔离就不再必要

---

**预估章节数**：18 章
**预估总字数**：约 16-20 万字
**技术版本**：乾坤 2.x / single-spa 6.x / Module Federation 2.0 / Rspack 1.x / Wujie
