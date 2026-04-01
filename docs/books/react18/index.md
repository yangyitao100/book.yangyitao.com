# React 内核探秘：从源码理解 React 18/19

从零手写 React 核心，逐模块解剖 React 18 Fiber 架构，深入 React 19 + Compiler 时代的设计哲学。

本书采取"分层递进"的方法，分为上下两个部分：上半部分从零手写精简版 React（对应 React 最初形态），帮助读者建立直觉；下半部分深入 React 18 Fiber 架构的完整实现，并在关键章节引入 React 19 和 React Compiler 的对比分析。

## 适合谁读

有一定 React 使用经验、希望深入理解 React 内部机制的前端开发者。无论你是想突破技术瓶颈的一线工程师、准备大厂面试的候选人，还是设计 UI 框架的架构师，本书都将为你提供源码级的确切答案。

## 章节目录

- [前言](./chapters/00-preface) — 写作动机、本书定位与阅读指南
- [第1章 为什么在 2026 年重新理解 React](./chapters/01-why-react-19) — 四次范式跃迁、React 19 三大破局、源码环境准备
- [第2章 初始化渲染（精简版）](./chapters/02原始版-初始化渲染/01.本章介绍) — 虚拟 DOM、createElement、render
- [第3章 函数组件与类组件（精简版）](./chapters/03原始版-函数组件与类组件/01.本章介绍) — 组件模型、事件合成、ref
- [第4章 DOM Diff（精简版）](./chapters/04原始版-DOMDIFF/01.本章介绍) — diff 算法原理与实现
- [第5章 类组件的生命周期（精简版）](./chapters/05原始版-类组件的生命周期/01.本章介绍) — 生命周期函数源码实现
- [第6章 性能优化相关特性（精简版）](./chapters/06原始版-性能优化相关特性/01.本章介绍) — PureComponent、memo
- [第7章 Hooks（精简版）](./chapters/07原始版-Hooks/01.本章介绍) — useState、useEffect、useMemo 等
- [第8章 Fiber 架构理论体系](./chapters/08Fiber架构理论体系/01.本章介绍) — Fiber 节点、双缓冲、工作循环、并发模式
- [第9章 Fiber 架构 - 初始化渲染](./chapters/09Fiber架构-初始化渲染/01.本章介绍) — createRoot、beginWork、completeWork、commitWork
- [第10章 合成事件系统](./chapters/10Fiber架构-合成事件系统/01.本章介绍) — 事件注册、派发、合成事件
- [第11章 组件更新与 DOM Diff](./chapters/11Fiber架构-组件更新/01.本章介绍) — 单节点/多节点 diff
- [第12章 Hooks 源码实现](./chapters/12Fiber架构-Hooks/01.本章介绍) — useReducer、useState、useEffect、useLayoutEffect
- [第13章 Lane 模型与优先级](./chapters/13Fiber架构-Lane模型与优先级/01.本章介绍) — 二进制运算、优先级体系
- [第14章 调度系统](./chapters/14Fiber架构-调度系统/01.本章介绍) — Scheduler、任务优先级、更新队列
- [第15章 同步渲染与并发渲染](./chapters/15Fiber架构-同步渲染与并发渲染/01.本章介绍) — 同步/并发模式对比

## 开始阅读

从 [前言](./chapters/00-preface) 开始你的学习之旅，或直接跳到 [第1章](./chapters/01-why-react-19) 了解为什么在 2026 年重新理解 React。
