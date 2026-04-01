# Vue 3.6 源码全解：从 Alien Signals 到 Vapor Mode

基于 Vue 3.6.x 源码，深入剖析 Alien Signals 响应式架构、Vapor Mode 无虚拟 DOM 渲染、编译器全链路——不是教你用 Vue，而是教你理解 Vue 每个设计决策背后的"为什么"。

## 适合谁读

有 Vue 使用经验、具备 TypeScript 基础、希望深入理解 Vue 3.6 内部实现原理的高级前端开发者、框架架构师、开源贡献者。

## 目录

- [前言](./chapters/00-preface)
- [第 1 章 为什么在 2026 年重新理解 Vue](./chapters/01-why-vue-36)
- [第 2 章 代码管理策略-monorepo](./chapters/01.代码管理策略-monorepo)
- [第 3 章 项目构建流程和源码调试方法](./chapters/02.项目构建流程和源码调试方法)
- [第 4 章 Vue3响应式核心原理](./chapters/03.Vue3响应式核心原理)
- [第 5 章 Vue3响应式系统源码实现1](./chapters/04.Vue3响应式系统源码实现1)
- [第 6 章 Vue3响应式系统源码实现2](./chapters/05.Vue3响应式系统源码实现2)
- [第 7 章 reactive、ref相关api源码实现](./chapters/06.reactive、ref相关api源码实现)
- [第 8 章 故事要从createApp讲起](./chapters/07.故事要从createApp讲起)
- [第 9 章 虚拟Node到真实Node的路其实很长](./chapters/08.虚拟Node到真实Node的路其实很长)
- [第 10 章 组件渲染和更新流程](./chapters/09.组件渲染和更新流程)
- [第 11 章 名动江湖的diff算法](./chapters/10.名动江湖的diff算法)
- [第 12 章 编译优化之Block Tree 与 PatchFlags](./chapters/11.编译优化之Block Tree 与 PatchFlags)
- [第 13 章 编译过程介绍及分析模版AST的生成过程](./chapters/12.编译过程介绍及分析模版AST的生成过程)
- [第 14 章 从AST到render函数（transform与代码生成）](./chapters/13.从AST到render函数（transform与代码生成）)

## 开始阅读

从 [前言](./chapters/00-preface) 开始你的学习之旅。
