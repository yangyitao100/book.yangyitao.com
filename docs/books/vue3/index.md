# Vue 3.6 内核探秘：从 Alien Signals 到 Vapor Mode

基于 Vue 3.6.x 源码，深入剖析 Alien Signals 响应式架构、Vapor Mode 无虚拟 DOM 渲染、编译器全链路——不是教你用 Vue，而是教你理解 Vue 每个设计决策背后的"为什么"。

## 适合谁读

有 Vue 使用经验、具备 TypeScript 基础、希望深入理解 Vue 3.6 内部实现原理的高级前端开发者、框架架构师、开源贡献者。

## 目录

### 开篇

- [前言](./chapters/00-preface)
- [第 1 章 为什么在 2026 年重新理解 Vue](./chapters/01-why-vue-36)

### 第二部分：响应式内核

- [第 2 章 Vue 3 源码全景图](./chapters/02-vue-source-overview)
- [第 3 章 响应式系统设计哲学](./chapters/03-reactivity-philosophy)
- [第 4 章 @vue/reactivity 源码深度剖析（上）](./chapters/04-reactivity-part1)
- [第 5 章 @vue/reactivity 源码深度剖析（下）](./chapters/05-reactivity-part2)
- [第 6 章 Vue 3.5 Alien Signals：响应式的第三次革命](./chapters/06-alien-signals)

### 第三部分：编译器内核

- [第 7 章 Vue Compiler 架构总览](./chapters/07-compiler-overview)
- [第 8 章 模板编译深度剖析](./chapters/08-template-compile)
- [第 9 章 Vapor Mode：无虚拟 DOM 的编译目标](./chapters/09-vapor-mode)

### 第四部分：运行时内核

- [第 10 章 组件系统](./chapters/10-component-system)
- [第 11 章 虚拟 DOM 与 Diff 算法](./chapters/11-vdom-diff)
- [第 12 章 生命周期与调度](./chapters/12-lifecycle-scheduler)

### 第五部分：核心功能深度剖析

- [第 13 章 指令系统](./chapters/13-directives)
- [第 14 章 依赖注入与插件系统](./chapters/14-di-plugins)
- [第 15 章 状态管理：Pinia 内核](./chapters/15-pinia)

### 第六部分：工程与生态

- [第 16 章 Vue Router 内核](./chapters/16-router)
- [第 17 章 SSR 与同构渲染](./chapters/17-ssr)
- [第 18 章 性能工程与最佳实践](./chapters/18-performance)
- [第 19 章 设计模式与架构决策](./chapters/19-patterns)

## 开始阅读

从 [前言](./chapters/00-preface) 开始你的学习之旅。
