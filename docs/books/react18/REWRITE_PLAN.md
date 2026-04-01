# 《React 19 内核探秘：从源码到架构》重写大纲

> 原书名：React18内核探秘
> 重写原因：React 19 + Compiler 时代已到来，旧版内容以课程讲义风格为主，缺乏书籍的系统性和专业度
> 目标：以杨艺韬的文风（叙事开场、递进设问、精准类比、深度洞察），打造 React 领域最深入的源码架构专著

---

## 第一部分：认知重建

### 第1章 为什么在 2026 年重新理解 React
- 1.1 从 jQuery 到 React 19：前端框架的四次范式跃迁
- 1.2 React 19 的三大破局：Compiler、Server Components、Actions
- 1.3 useMemo 的终结与心智模型的重建
- 1.4 本书与其他 React 书籍有何不同（对比表）
- 1.5 阅读路线图
- 🔥 深度洞察：为什么 React 每一次革命都不是关于"更快"，而是关于"更少的心智负担"

### 第2章 React 源码全景图
- 2.1 仓库结构：monorepo 里的 30+ 个包
- 2.2 核心包依赖关系图（react → react-dom → react-reconciler → scheduler）
- 2.3 编译时 vs 运行时：React Compiler 如何改变代码边界
- 2.4 从 JSX 到屏幕像素：一次渲染的完整旅程（10 步图解）
- 2.5 调试源码的三种姿势（源码构建、Chrome DevTools、React DevTools Profiler）

## 第二部分：运行时内核

### 第3章 虚拟 DOM 的设计哲学
- 3.1 为什么需要虚拟 DOM（不是为了快，是为了跨平台和可编程）
- 3.2 React Element 的数据结构深度解析
- 3.3 从 createElement 到 jsx()：编译器入口的变迁
- 3.4 与 Vue 的 VNode、Svelte 的无 VDOM 方案横向对比
- 🔥 深度洞察：虚拟 DOM 不是优化手段，是抽象层——理解这一点改变你对整个前端的认知

### 第4章 Fiber 架构：React 的操作系统
- 4.1 从 Stack Reconciler 到 Fiber：为什么要重写整个引擎
- 4.2 Fiber Node 数据结构逐字段解析（30+ 字段的设计意图）
- 4.3 双缓冲树（Double Buffering）：current 与 workInProgress
- 4.4 Fiber 树的构建过程：beginWork 与 completeWork 的递归协作
- 4.5 时间切片（Time Slicing）的实现原理
- 4.6 与操作系统进程调度的类比

### 第5章 调度器：React 的 CPU 调度算法
- 5.1 Scheduler 包的独立性与设计目标
- 5.2 优先级模型：Lane 系统深度剖析（31 条车道的设计）
- 5.3 任务队列与过期机制：小顶堆的工程实现
- 5.4 从 requestIdleCallback 到 MessageChannel：浏览器调度策略的演进
- 5.5 饥饿问题与优先级反转的处理
- 🔥 深度洞察：React 的调度器本质是在浏览器里实现了一个微型操作系统内核

### 第6章 Reconciliation：Diff 算法的真相
- 6.1 O(n) Diff 的三个假设与现实约束
- 6.2 单节点 Diff：type + key 的快速判断
- 6.3 多节点 Diff：两轮遍历算法的源码实现
- 6.4 key 的本质：为什么 index 作 key 是灾难
- 6.5 React 19 中 Diff 的优化变化
- 6.6 与 Vue3 最长递增子序列算法的对比

### 第7章 Commit 阶段：从虚拟到真实
- 7.1 三个子阶段：Before Mutation → Mutation → Layout
- 7.2 DOM 操作的批量化处理
- 7.3 Effect 的执行时机与调度
- 7.4 Passive Effects（useEffect）vs Layout Effects（useLayoutEffect）
- 7.5 Offscreen 组件与预渲染

## 第三部分：状态管理内核

### 第8章 Hooks 的实现原理
- 8.1 Hooks 的链表存储结构：为什么不能条件调用
- 8.2 useState 源码：从 mountState 到 updateState 的完整链路
- 8.3 useReducer：与 useState 的统一实现
- 8.4 useEffect 的完整生命周期（挂载→更新→清理→卸载）
- 8.5 useRef：最简单的 Hook 为什么最容易误用
- 8.6 useMemo 与 useCallback：手动优化时代的遗产

### 第9章 React 19 新 Hooks 与 API
- 9.1 useTransition 与 startTransition：并发更新的用户空间入口
- 9.2 useDeferredValue：延迟渲染的优雅实现
- 9.3 useOptimistic：乐观更新的第一公民支持
- 9.4 useFormStatus 与 useActionState：表单场景的革命
- 9.5 use() Hook：Promise 与 Context 的统一消费接口
- 9.6 React 19 Hooks 的完整 API 设计哲学

### 第10章 并发模式深度解析
- 10.1 什么是并发渲染（不是多线程，是可中断渲染）
- 10.2 Transition 的实现机制：entangled transitions
- 10.3 Suspense 的挂起与恢复：Promise 协议深度剖析
- 10.4 Selective Hydration：服务端渲染的并发策略
- 10.5 并发模式下的状态一致性保证（tearing 问题与解决方案）
- 🔥 深度洞察：并发的本质不是"做得更快"，而是"让用户感觉更快"——这是 React 团队最反直觉的设计决策

## 第四部分：编译时革命

### 第11章 React Compiler 深度剖析
- 11.1 为什么需要编译器：手动优化的认知负担
- 11.2 编译器架构：从 Babel 插件到独立编译管线
- 11.3 React 的规则（Rules of React）：编译器的核心假设
- 11.4 自动记忆化的实现原理：静态分析 + 依赖追踪
- 11.5 编译前后代码对比：useMemo/useCallback 如何被消除
- 11.6 编译器的局限性与逃生舱
- 11.7 与 Vue Compiler、Svelte Compiler、Solid Compiler 的横向对比

### 第12章 JSX 编译与代码转换
- 12.1 JSX → React.createElement → jsx()：两代编译目标
- 12.2 新 JSX Transform 的设计动机与实现
- 12.3 TypeScript 中的 JSX 类型推导
- 12.4 自定义 JSX pragma 与跨框架兼容

## 第五部分：Server Components 与全栈架构

### 第13章 React Server Components 架构
- 13.1 RSC 的设计动机：零 bundle size 的组件
- 13.2 Server Component vs Client Component：边界划分的艺术
- 13.3 RSC Wire Protocol：服务端如何序列化组件树
- 13.4 流式渲染（Streaming SSR）的实现原理
- 13.5 RSC 与 Next.js App Router 的深度集成
- 13.6 RSC 的性能模型与适用场景分析

### 第14章 Server Actions 与数据流
- 14.1 从 API Routes 到 Server Actions：服务端调用范式的进化
- 14.2 "use server" 指令的编译时处理
- 14.3 Actions 与表单：渐进增强的全栈表单
- 14.4 乐观更新与错误处理的统一模型
- 14.5 安全性考量：Server Actions 的攻击面分析

## 第六部分：合成事件与 DOM

### 第15章 合成事件系统
- 15.1 事件委托：从 document 到 root 的演进
- 15.2 事件优先级与调度器的协作
- 15.3 React 19 中事件系统的简化
- 15.4 与原生事件的交互与冲突处理

### 第16章 DOM 更新与渲染管线
- 16.1 属性设置：className、style、dangerouslySetInnerHTML 的处理
- 16.2 受控组件与非受控组件的 DOM 同步机制
- 16.3 Portal 的实现原理
- 16.4 Hydration 不匹配的检测与恢复

## 第七部分：生态与工程实践

### 第17章 状态管理库的内核机制
- 17.1 Context 的性能问题与 useSyncExternalStore
- 17.2 Redux Toolkit 与 React 19 的协作模式
- 17.3 Zustand 的极简设计哲学
- 17.4 Jotai 与原子化状态管理
- 17.5 选型决策框架

### 第18章 React 性能工程
- 18.1 性能分析工具链：Profiler API、React DevTools、Chrome Performance
- 18.2 渲染瀑布的识别与消除
- 18.3 React Compiler 时代的性能优化策略变化
- 18.4 大列表虚拟化与 Suspense 分片加载
- 18.5 Memory Leak 的常见模式与检测

### 第19章 设计模式与架构决策
- 19.1 React 源码中的 10 个核心设计模式
- 19.2 从 Class 到 Hooks 到 Compiler：API 设计哲学的三次演进
- 19.3 React 的技术决策考古：被放弃的方案（Algebraic Effects、Prepack）
- 19.4 React vs Vue vs Svelte vs Solid：四大框架的终极架构对比
- 19.5 展望：React 的下一个十年

---

**预估章节数**：19 章
**预估总字数**：约 18-22 万字
**技术版本**：React 19.x + React Compiler
