# 《Vue 3.6 内核探秘：从响应式到 Vapor》重写大纲

> 原书名：Vue3源码剖析
> 重写原因：Vue 3.5 Alien Signals + 3.6 Vapor Mode 已发布，旧版内容为博客系列，缺乏系统性
> 目标：以杨艺韬的文风，打造 Vue 领域最权威的源码架构专著，覆盖 Vapor 时代的全新编译模型

---

## 第一部分：全景认知

### 第1章 为什么在 2026 年重新理解 Vue
- 1.1 Vue 的三次蜕变：Options → Composition → Vapor
- 1.2 Vue 3.6 的破局：无虚拟 DOM 的响应式渲染
- 1.3 Alien Signals：响应式系统的第三次重写意味着什么
- 1.4 本书与其他 Vue 书籍有何不同
- 1.5 阅读路线图
- 🔥 深度洞察：Vue 的哲学是"渐进式"——但每一次渐进的背后，都是对整个编译-运行时边界的重新思考

### 第2章 Vue 3 源码全景图
- 2.1 Monorepo 架构：20+ 个包的依赖关系
- 2.2 构建系统：从 Rollup 到 esbuild 的演进
- 2.3 核心三角：Compiler → Reactivity → Runtime
- 2.4 从模板到像素：一次渲染的完整旅程（图解）
- 2.5 源码调试的三种姿势

## 第二部分：响应式内核

### 第3章 响应式系统设计哲学
- 3.1 响应式编程的本质：数据驱动的依赖图
- 3.2 Vue 响应式的三代实现：defineProperty → Proxy → Alien Signals
- 3.3 细粒度 vs 粗粒度响应式：Vue vs React 的根本分歧
- 3.4 与 MobX、Solid Signals、Svelte Runes 的横向对比
- 🔥 深度洞察：响应式系统的终极目标不是"检测变化"，而是"精确传播变化"——这个"精确"二字，价值千金

### 第4章 @vue/reactivity 源码深度剖析（上）
- 4.1 reactive()：Proxy 拦截器的完整实现
- 4.2 ref()：为什么需要 .value（基本类型的包装困境）
- 4.3 依赖收集：track() 的调用链路与 WeakMap 结构
- 4.4 触发更新：trigger() 的扇出机制与调度
- 4.5 computed()：惰性求值与缓存的精妙设计

### 第5章 @vue/reactivity 源码深度剖析（下）
- 5.1 effect()：响应式系统的心脏
- 5.2 effectScope()：批量管理副作用的容器
- 5.3 shallowReactive/shallowRef：浅响应式的设计权衡
- 5.4 toRaw/markRaw：逃出响应式的逃生舱
- 5.5 readonly 与 isProxy 家族 API 的实现

### 第6章 Vue 3.5 Alien Signals：响应式的第三次革命
- 6.1 为什么要第三次重写响应式系统
- 6.2 基于版本计数的惰性依赖追踪（Lazy Dependency Tracking）
- 6.3 双向链表取代 Set：内存与性能的双重优化
- 6.4 基准测试解读：提升了什么，代价是什么
- 6.5 从 Vue Reactivity 到独立 Signals 标准（TC39 提案）的影响

## 第三部分：编译器内核

### 第7章 Vue Compiler 架构总览
- 7.1 三阶段管线：Parse → Transform → Codegen
- 7.2 模板 AST 的数据结构设计
- 7.3 编译优化标志：PatchFlags 与 Block Tree
- 7.4 静态提升（Static Hoisting）：编译时的性能礼物
- 7.5 与 React Compiler、Svelte Compiler 的架构对比

### 第8章 模板编译深度剖析
- 8.1 Parser：从模板字符串到 AST 的状态机实现
- 8.2 Transform 管线：指令处理（v-if/v-for/v-model）的编译策略
- 8.3 Codegen：生成 render 函数的代码生成器
- 8.4 编译缓存与增量编译
- 8.5 SFC 编译：<script setup> 的魔法背后

### 第9章 Vapor Mode：无虚拟 DOM 的编译目标
- 9.1 Vapor 的设计动机：为什么要绕过虚拟 DOM
- 9.2 Vapor 编译输出分析：直接 DOM 操作的代码结构
- 9.3 Vapor 与 VDOM 的混合模式：渐进式迁移策略
- 9.4 性能对比：Vapor vs VDOM vs Svelte vs Solid
- 9.5 Vapor 的局限性与适用场景
- 🔥 深度洞察：Vapor 不是 VDOM 的替代品，是 VDOM 的毕业典礼——当编译器足够聪明，运行时就可以足够简单

## 第四部分：运行时内核

### 第10章 组件系统
- 10.1 createApp()：应用实例的创建与挂载
- 10.2 组件实例的数据结构：30+ 字段逐一解析
- 10.3 Setup 函数的执行上下文与 Composition API 的注入机制
- 10.4 Props 与 Emit 的类型安全实现
- 10.5 Slots 的编译与运行时协作

### 第11章 虚拟 DOM 与 Diff 算法
- 11.1 VNode 数据结构与类型标志
- 11.2 patch() 函数：节点更新的路由器
- 11.3 最长递增子序列（LIS）Diff 算法的完整实现
- 11.4 Fragment、Teleport、Suspense 的 patch 策略
- 11.5 与 React Fiber Diff 的算法对比

### 第12章 生命周期与调度
- 12.1 组件生命周期的完整时序图
- 12.2 Composition API 生命周期 Hook 的注册与触发
- 12.3 nextTick 的实现：微任务队列的巧妙利用
- 12.4 异步组件与 Suspense 的协作机制
- 12.5 KeepAlive 的缓存策略与 LRU 实现

## 第五部分：核心功能深度剖析

### 第13章 指令系统
- 13.1 v-model 的双向绑定：语法糖的编译与运行时
- 13.2 v-if / v-show 的编译策略差异
- 13.3 v-for 的 key 策略与 Diff 性能
- 13.4 自定义指令的生命周期与实现
- 13.5 指令在 Vapor Mode 下的实现变化

### 第14章 依赖注入与插件系统
- 14.1 provide/inject 的原型链实现
- 14.2 app.use() 与插件协议
- 14.3 全局属性与组件注册的内部机制
- 14.4 与 React Context 的设计差异

### 第15章 状态管理：Pinia 内核
- 15.1 defineStore() 的三种语法与统一实现
- 15.2 Store 的响应式代理机制
- 15.3 $patch 的批量更新与深合并
- 15.4 持久化与 SSR 序列化
- 15.5 与 Vuex、Redux、Zustand 的架构对比

## 第六部分：工程与生态

### 第16章 Vue Router 内核
- 16.1 路由匹配：从路径到正则的编译
- 16.2 导航守卫的执行管线
- 16.3 History API 的跨浏览器适配
- 16.4 路由懒加载与代码分割的协作

### 第17章 SSR 与同构渲染
- 17.1 renderToString 的服务端渲染管线
- 17.2 Hydration：客户端激活的匹配算法
- 17.3 Streaming SSR 的实现
- 17.4 与 Nuxt 3 的深度集成分析

### 第18章 性能工程与最佳实践
- 18.1 Vue DevTools Profiler 深度使用
- 18.2 大列表优化：虚拟滚动与分片渲染
- 18.3 Bundle Size 优化：Tree-shaking 友好的 API 设计
- 18.4 Vapor Mode 的性能调优策略

### 第19章 设计模式与架构决策
- 19.1 Vue 源码中的 10 个核心设计模式
- 19.2 渐进式哲学的工程体现：每一层都可选
- 19.3 Vue 的技术决策考古：被放弃的方案
- 19.4 Vue vs React vs Svelte vs Solid：四大框架的终极架构对比
- 19.5 展望：Vue 的下一个五年

---

**预估章节数**：19 章
**预估总字数**：约 18-22 万字
**技术版本**：Vue 3.6 + Vapor Mode + Alien Signals
