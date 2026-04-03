<div v-pre>

# 第7章 single-spa 核心机制

> "框架的灵魂不在它暴露了多少 API——在于它隐藏了多少复杂度，又在正确的地方把控制权还给你。"

> **本章要点**
> - 理解 single-spa "路由即应用边界"的设计哲学及其对微前端架构的深远影响
> - 深入 registerApplication 的参数设计，掌握内部状态机如何管理应用的完整生命周期
> - 掌握 12 种应用状态（NOT_LOADED → UNLOADING）的完整流转规则与边界条件
> - 剖析 reroute 函数的核心调度逻辑：getAppChanges 如何决定加载、挂载与卸载
> - 理解 toLoadPromise / toBootstrapPromise / toMountPromise / toUnmountPromise 四大 Promise 链的执行机制

---

如果说乾坤是中国微前端生态的代名词，那么 single-spa 就是全球微前端的基石。

这个由 Joel Denning 在 2018 年创建的框架，做了一件看似简单却意义深远的事情：**它在浏览器的路由系统和多个独立应用之间，架起了一座桥梁。** 当 URL 发生变化时，single-spa 自动判断哪些应用该加载、哪些该挂载、哪些该卸载——整个过程对用户来说是无感知的单页应用体验。

但"简单"是表象。当你打开 single-spa 的源码，你会发现：一个只有约 2000 行核心代码的框架，内部竟然维护着 12 种应用状态、一个精密的状态机、一套复杂的并发调度逻辑。每一行代码都在处理你可能从未想到过的边界情况——应用加载失败怎么办？用户在应用还没挂载完成时又切换了路由怎么办？两个应用的激活条件重叠时该如何处理？

本章将从源码层面彻底剖析 single-spa 的三大核心机制：注册（registerApplication）、状态管理（12 种状态的流转）、和调度（reroute）。读完这一章，你不仅能理解 single-spa 的每一个设计决策，更能看到乾坤、Wujie 等上层框架为什么要在 single-spa 之上做那些增强——因为你会清楚地看到 single-spa "故意不做"的部分。

## 7.1 设计哲学：路由即应用边界

### 7.1.1 一个核心假设

single-spa 的整个架构建立在一个核心假设之上：**URL 路径是划分应用边界的最自然单位。**

这个假设如此朴素，以至于很容易被忽略。但仔细想想——在一个 SPA 中，路由本来就是组织页面的方式。single-spa 只是把这个概念提升了一个层次：路由不仅组织页面，还组织应用。

```typescript
// 传统 SPA：路由 → 页面
const routes = [
  { path: '/order', component: OrderPage },
  { path: '/product', component: ProductPage },
];

// single-spa：路由 → 应用
import { registerApplication, start } from 'single-spa';

registerApplication({
  name: 'order-app',
  app: () => System.import('https://cdn.example.com/order/main.js'),
  activeWhen: '/order',
});

registerApplication({
  name: 'product-app',
  app: () => System.import('https://cdn.example.com/product/main.js'),
  activeWhen: '/product',
});

start();
```

从外部看，这只是把"组件"换成了"应用"。但这一步的跨越带来了根本性的不同：每个"应用"可以是一个**独立构建、独立部署、独立运行**的前端项目。

### 7.1.2 "不做什么"比"做什么"更重要

single-spa 最大的设计智慧不在于它做了什么，而在于它**故意不做什么**：

```typescript
// single-spa 不做的事情
interface WhatSingleSpaDoesNot {
  jsSandbox: never;       // 不提供 JS 沙箱
  cssSandbox: never;      // 不提供 CSS 隔离
  htmlEntry: never;       // 不支持 HTML Entry 加载
  communication: never;   // 不提供应用间通信机制
}

// single-spa 只做的事情
interface WhatSingleSpaDoes {
  registration: '注册应用与激活条件';
  lifecycle: '管理 bootstrap / mount / unmount 生命周期';
  routing: '监听路由变化，调度应用的挂载与卸载';
  status: '维护每个应用的状态';
}
```

这是一个极其克制的设计选择。single-spa 的定位是**微前端的调度层**——它只负责"什么时候加载什么应用"，至于应用如何隔离、如何通信、如何共享依赖，全部留给上层方案或开发者自行解决。正是这种克制，使得 single-spa 成为了微前端的"Linux 内核"——乾坤在它之上加了沙箱和 HTML Entry，Wujie 在它之上加了 iframe 隔离。如果 single-spa 自己做了太多，反而会限制上层方案的设计空间。

### 7.1.3 架构全景

```
┌─────────────────────────────────────────────────────┐
│                  浏览器路由事件                        │
│       (hashchange / popstate / pushState)            │
└────────────────────┬────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────┐
│                reroute() 调度中枢                     │
│  ┌───────────┐  ┌────────────┐  ┌─────────────┐    │
│  │getAppChg  │  │ Promise 链  │  │ 并发控制     │    │
│  │ 分类应用   │  │ load→boot→ │  │ appChangeUn │    │
│  │ 状态变更   │  │ mount→unmt │  │ derway 标志  │    │
│  └───────────┘  └────────────┘  └─────────────┘    │
└────────────────────┬────────────────────────────────┘
         ┌───────────┼──────────┐
         ▼           ▼          ▼
   ┌─────────┐ ┌──────────┐ ┌────────┐
   │ App A   │ │  App B   │ │ App C  │
   │ MOUNTED │ │ NOT_     │ │ LOAD_  │
   │         │ │ LOADED   │ │ ERROR  │
   └─────────┘ └──────────┘ └────────┘
```

整个架构可以用一句话概括：**路由变化触发 reroute，reroute 根据每个应用的激活条件和当前状态，决定执行加载、启动、挂载或卸载操作。**

> 🔥 **深度洞察：single-spa 的"管道架构"**
>
> single-spa 的架构本质上是一个**管道（Pipeline）模式**——路由事件作为输入，经过 getAppChanges 分类、Promise 链执行、状态更新三个阶段，最终输出一组 DOM 变更。这种管道架构的优势在于：每个阶段都是纯函数式的（输入决定输出），易于测试和推理。它的劣势也同样明显：整个管道是同步触发的，如果一个应用的 mount 函数执行时间过长，会阻塞后续应用的处理。理解这个权衡，才能理解为什么乾坤要在 single-spa 之上加入超时控制和并发优化。

## 7.2 注册机制：registerApplication 的参数设计与内部状态机

### 7.2.1 API 表面：四个参数的设计意图

`registerApplication` 是 single-spa 暴露给开发者的核心 API：

```typescript
// 简化后的类型定义
interface AppConfig {
  name: string;
  app: () => Promise<LifeCycles> | LifeCycles;
  activeWhen: ActivityFn | string | (ActivityFn | string)[];
  customProps?: object | ((name: string, location: Location) => object);
}

interface LifeCycles {
  bootstrap: LifeCycleFn | LifeCycleFn[];
  mount: LifeCycleFn | LifeCycleFn[];
  unmount: LifeCycleFn | LifeCycleFn[];
  unload?: LifeCycleFn | LifeCycleFn[];
}

type LifeCycleFn = (props: CustomProps) => Promise<void>;
type ActivityFn = (location: Location) => boolean;
```

**activeWhen** 是最灵活的参数，支持三种形式：

```typescript
// 形式1：字符串前缀匹配
registerApplication({
  name: 'order',
  app: () => import('./order.js'),
  activeWhen: '/order', // 匹配 /order, /order/list, /order/detail/123
});

// 形式2：函数（完全自定义）
registerApplication({
  name: 'admin',
  app: () => import('./admin.js'),
  activeWhen: (location) =>
    location.pathname.startsWith('/admin')
    && localStorage.getItem('role') === 'admin',
});

// 形式3：数组（多条件 OR）
registerApplication({
  name: 'shared-layout',
  app: () => import('./layout.js'),
  activeWhen: ['/order', '/product', '/user'],
});
```

### 7.2.2 源码剖析：registerApplication 的内部实现

```javascript
// single-spa 源码 - src/applications/apps.js（简化版）

const apps = []; // 全局应用注册表

export function registerApplication(
  appNameOrConfig, appOrLoadApp, activeWhen, customProps
) {
  // 第一步：参数归一化
  const registration = sanitizeArguments(
    appNameOrConfig, appOrLoadApp, activeWhen, customProps
  );

  // 第二步：校验——不允许重复注册
  if (getAppNames().indexOf(registration.name) !== -1)
    throw Error(`There is already an app registered with name ${registration.name}`);

  // 第三步：创建内部应用对象并放入注册表
  apps.push(
    assign(
      {
        loadErrorTime: null,
        status: NOT_LOADED,  // 关键：初始状态为 NOT_LOADED
        parcels: {},
        devtools: { overlays: { options: {}, selectors: [] } },
      },
      registration
    )
  );

  // 第四步：立即触发一次 reroute
  if (isInBrowser) {
    ensureJQuerySupport();
    reroute();
  }
}
```

参数归一化中最精巧的是 `activeWhen` 的处理——字符串、函数、数组被统一转换为一个判定函数：

```javascript
// single-spa 源码 - sanitizeActiveWhen
function sanitizeActiveWhen(activeWhen) {
  let activeWhenArray = Array.isArray(activeWhen) ? activeWhen : [activeWhen];
  activeWhenArray = activeWhenArray.map((item) =>
    typeof item === 'function' ? item : pathToActiveWhen(item)
  );
  // 返回 OR 逻辑的组合函数
  return (location) => activeWhenArray.some((fn) => fn(location));
}

function pathToActiveWhen(path, exactMatch) {
  const regex = toDynamicPathValidatorRegex(path, exactMatch);
  return (location) => {
    const route = location.href
      .replace(location.origin, '')
      .replace(location.search, '')
      .split('?')[0];
    return regex.test(route);
  };
}
```

注意 `pathToActiveWhen` 做了**前缀匹配**而非精确匹配——`'/order'` 会匹配 `/order`、`/order/list`、`/order/detail/123`。这是有意为之的设计：在微前端场景中，一个子应用通常管理一个路径前缀下的所有页面。

最后一行 `reroute()` 至关重要——每次注册新应用时，single-spa 都会立即重新评估当前 URL 下哪些应用该被激活。如果新注册的应用恰好匹配当前路由，它会立即开始加载流程，无需等待下一次路由变化。

> 🔥 **深度洞察：apps 数组而非 Map**
>
> single-spa 用**数组**而非 Map 来存储注册的应用。这不是偶然的——数组保留了注册顺序，而这个顺序在某些场景下很重要。当多个应用同时被激活时，它们的挂载顺序与注册顺序一致。如果你的共享布局应用（如导航栏）需要先于业务应用挂载，只需确保它先注册即可。这是一个通过数据结构的选择来隐式表达语义的经典案例。

## 7.3 应用状态管理：12 种状态的流转

### 7.3.1 为什么需要 12 种状态

在一般的 UI 组件生命周期中，我们习惯了简单的状态模型：创建 → 挂载 → 更新 → 卸载。但在微前端场景中，应用代码需要从远端**加载**（可能失败），加载后需要**初始化**（可能失败），初始化后需要**挂载到 DOM**（可能失败），路由变化时需要**卸载**（可能失败），某些情况下需要**彻底卸载**释放内存。每个异步操作都有"正在进行中"的过渡状态。当你把"成功/失败"和"进行中/已完成"两个维度交叉组合，12 种状态就自然浮现了。

### 7.3.2 12 种状态的完整定义

```javascript
// single-spa 源码 - src/applications/app.helpers.js

export const NOT_LOADED = 'NOT_LOADED';               // 初始状态
export const LOADING_SOURCE_CODE = 'LOADING_SOURCE_CODE'; // 正在加载代码
export const NOT_BOOTSTRAPPED = 'NOT_BOOTSTRAPPED';     // 已加载，待初始化
export const BOOTSTRAPPING = 'BOOTSTRAPPING';           // 正在初始化
export const NOT_MOUNTED = 'NOT_MOUNTED';               // 已初始化，待挂载
export const MOUNTING = 'MOUNTING';                     // 正在挂载
export const MOUNTED = 'MOUNTED';                       // 已挂载（用户可见）
export const UNMOUNTING = 'UNMOUNTING';                 // 正在卸载
export const UNLOADING = 'UNLOADING';                   // 正在完全卸载
export const LOAD_ERROR = 'LOAD_ERROR';                 // 加载失败
export const SKIP_BECAUSE_BROKEN = 'SKIP_BECAUSE_BROKEN'; // 应用已损坏
export const UPDATING = 'UPDATING';                     // 仅 Parcel 使用
```

`UPDATING` 是 Parcel API 特有的状态——Parcel 是 single-spa 提供的一种手动控制挂载/卸载的子应用模式，支持 `update` 操作。普通的 registerApplication 注册的应用不会进入这个状态。

### 7.3.3 状态流转图

```
                          ┌──────────────┐
                          │  NOT_LOADED   │ ◄───────────────────┐
                          │  (初始状态)    │                     │
                          └──────┬───────┘                     │
                                 │ 需要加载                     │
                                 ▼                             │
                          ┌──────────────┐                     │
                    ┌──── │  LOADING_     │                     │
                    │     │  SOURCE_CODE  │                     │
                    │     └──────┬───────┘                     │
                    │            │ 加载成功                      │
                    │            ▼                             │
                    │     ┌──────────────┐                     │
               加载失败    │  NOT_         │                     │
                    │     │  BOOTSTRAPPED │                     │
                    │     └──────┬───────┘                     │
                    ▼            ▼                             │
              ┌──────────┐ ┌──────────────┐                    │
              │  LOAD_   │ │ BOOTSTRAPPING│                    │
              │  ERROR   │ └──────┬───────┘                    │
              └──────────┘        │ 成功                        │
                   │              ▼                             │
                   │       ┌──────────────┐                    │
                   │       │  NOT_MOUNTED  │ ◄────────┐        │
                   │       └──────┬───────┘          │        │
                   │              │ 需要挂载           │        │
                   │              ▼                   │        │
                   │       ┌──────────────┐          │        │
                   │       │   MOUNTING    │          │        │
                   │       └──────┬───────┘          │        │
                   │              │ 成功               │        │
                   │              ▼                   │        │
                   └──────►┌──────────────┐          │        │
                  重试时    │   MOUNTED     │          │        │
                           └──────┬───────┘          │        │
                                  │ 路由变化           │        │
                                  ▼                   │        │
                           ┌──────────────┐          │        │
                           │  UNMOUNTING   │          │        │
                           └──────┬───────┘          │        │
                                  │ 成功               │        │
                                  ├─────────────────►┘        │
                                  │ 需要完全卸载                 │
                                  ▼                            │
                           ┌──────────────┐                   │
                           │  UNLOADING    │                   │
                           └──────┬───────┘                   │
                                  └──────────────────────────►┘
```

状态流转遵循几条核心规则：

**规则一：单向主流程。** 正常情况下，应用沿着 NOT_LOADED → LOADING → NOT_BOOTSTRAPPED → BOOTSTRAPPING → NOT_MOUNTED → MOUNTING → MOUNTED 的路径单向前进。

**规则二：UNMOUNTING 回到 NOT_MOUNTED。** 路由变化导致应用卸载时，状态从 MOUNTED → UNMOUNTING → NOT_MOUNTED。注意不是回到 NOT_LOADED——bootstrap 只执行一次，应用的初始化状态被保留。

**规则三：UNLOADING 回到 NOT_LOADED。** 只有显式调用 `unloadApplication` 时，应用才会走完整的卸载流程。这意味着下次激活时需要重新加载代码和执行 bootstrap。

**规则四：LOAD_ERROR 允许重试。** 加载失败不是终点——single-spa 允许在下一次路由变化时重新尝试加载。

### 7.3.4 状态判定辅助函数

```javascript
// single-spa 源码 - src/applications/app.helpers.js

export function isActive(app) {
  return app.status === MOUNTED;
}

export function shouldBeActive(app) {
  try {
    return app.activeWhen(window.location);
  } catch (err) {
    handleAppError(err, app, SKIP_BECAUSE_BROKEN);
    return false;
  }
}
```

特别注意 `shouldBeActive` 和 `isActive` 的区别：`isActive(app)` 回答"应用**现在**是否已挂载"，`shouldBeActive(app)` 回答"根据当前 URL，应用**应该**处于活跃状态吗"。当两者不一致时，就需要执行挂载或卸载操作——这个"差异"正是 reroute 的决策依据。

### 7.3.5 状态转换的幂等保护

single-spa 通过代码结构来隐式保证状态转换的合法性。每个 `toXxxPromise` 函数在入口处检查当前状态：

```javascript
// 不匹配则跳过——天然幂等
export function toBootstrapPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    if (appOrParcel.status !== NOT_BOOTSTRAPPED) {
      return appOrParcel; // 状态不对，直接返回
    }
    appOrParcel.status = BOOTSTRAPPING;
    // ... 执行 bootstrap
  });
}
```

这种"检查当前状态，不匹配则跳过"的模式，是 single-spa 处理并发的核心策略。当多个 reroute 同时发生时，一个应用可能被多次尝试挂载——但只有第一次会成功进入目标状态，后续的尝试自动跳过。

> 🔥 **深度洞察：隐式状态机 vs 显式状态机**
>
> single-spa 选择**隐式状态机**（通过 if/else 约束转换），而非显式状态机（如 XState 的状态转换表）。12 种状态的显式转换表会非常庞大，而且微前端场景中的"非法转换"通常不应该抛出错误，而是安静地跳过。但这也带来了隐患：当出现 bug 导致应用卡在某个中间状态时，没有显式的错误提示，排查变得困难。这就是为什么在生产环境中，你偶尔会看到应用莫名其妙地"消失"——它可能卡在了 BOOTSTRAPPING 或 MOUNTING 状态，永远无法前进。

## 7.4 reroute 函数深度剖析：微前端的调度中枢

### 7.4.1 reroute 的触发时机

`reroute` 是 single-spa 的心脏。它在三种情况下被调用：

```javascript
// 触发时机 1：registerApplication 时
export function registerApplication(...) {
  // ... 注册逻辑
  if (isInBrowser) { reroute(); }
}

// 触发时机 2：start() 被调用时
export function start(opts) {
  started = true;
  if (isInBrowser) { reroute(); }
}

// 触发时机 3：路由变化时
window.addEventListener('hashchange', urlReroute);
window.addEventListener('popstate', urlReroute);

// 关键：劫持 pushState 和 replaceState
const originalPushState = window.history.pushState;
window.history.pushState = function () {
  const result = originalPushState.apply(this, arguments);
  urlReroute(); // pushState 不会触发 popstate，必须手动触发 reroute
  return result;
};
```

这里有一个精妙的设计：single-spa 不仅监听浏览器的原生路由事件（`hashchange`、`popstate`），还劫持了 `history.pushState` 和 `history.replaceState`。因为在 SPA 中，子应用的路由导航通过 `pushState` 实现，而 `pushState` **不会触发 `popstate` 事件**。如果不劫持，single-spa 将无法感知子应用内部的路由变化。

### 7.4.2 getAppChanges：分类的核心逻辑

`getAppChanges` 是调度的"大脑"——它扫描所有注册的应用，根据当前状态和激活条件分入四个类别：

```javascript
// single-spa 源码 - src/applications/apps.js

export function getAppChanges() {
  const appsToUnload = [], appsToUnmount = [],
        appsToLoad = [],   appsToMount = [];

  const currentTime = new Date().getTime();

  apps.forEach((app) => {
    const appShouldBeActive =
      app.status !== SKIP_BECAUSE_BROKEN && shouldBeActive(app);

    switch (app.status) {
      case LOAD_ERROR:
        // 加载失败且超过重试间隔(200ms)，重新加载
        if (appShouldBeActive && currentTime - app.loadErrorTime >= 200) {
          appsToLoad.push(app);
        }
        break;

      case NOT_LOADED:
      case LOADING_SOURCE_CODE:
        if (appShouldBeActive) {
          appsToLoad.push(app);
        }
        break;

      case NOT_BOOTSTRAPPED:
      case NOT_MOUNTED:
        if (!appShouldBeActive && getAppUnloadInfo(toName(app))) {
          appsToUnload.push(app);
        } else if (appShouldBeActive) {
          appsToMount.push(app);
        }
        break;

      case MOUNTED:
        if (!appShouldBeActive) {
          appsToUnmount.push(app);
        }
        break;

      // BOOTSTRAPPING, MOUNTING, UNMOUNTING, UNLOADING 等过渡状态
      // 不做任何操作——等待当前操作完成
    }
  });

  return { appsToUnload, appsToUnmount, appsToLoad, appsToMount };
}
```

用一个具体场景来理解：

```typescript
// 用户从 /order 导航到 /product
// order-app:   MOUNTED + shouldBeActive=false → appsToUnmount
// product-app: NOT_LOADED + shouldBeActive=true → appsToLoad
// nav-app:     MOUNTED + shouldBeActive=true → 不变（保持挂载）
```

### 7.4.3 reroute 核心逻辑与并发控制

```javascript
// single-spa 源码 - src/navigation/reroute.js（简化版）

let appChangeUnderway = false;
let peopleWaitingOnAppChange = [];

export function reroute(pendingPromises = [], eventArguments) {
  // 并发控制：已有 reroute 在执行中则排队
  if (appChangeUnderway) {
    return new Promise((resolve, reject) => {
      peopleWaitingOnAppChange.push({ resolve, reject, eventArguments });
    });
  }

  const { appsToUnload, appsToUnmount, appsToLoad, appsToMount } =
    getAppChanges();

  if (isStarted()) {
    appChangeUnderway = true;
    return performAppChanges();
  } else {
    // start() 尚未调用：只加载，不挂载
    return loadApps();
  }

  function loadApps() {
    return Promise.resolve().then(() => {
      const loadPromises = appsToLoad.map(toLoadPromise);
      return Promise.all(loadPromises).then(callAllEventListeners);
    });
  }

  function performAppChanges() {
    return Promise.resolve().then(() => {
      // 触发 before-routing 事件
      window.dispatchEvent(
        new CustomEvent('single-spa:before-routing-event', { detail: { ... } })
      );

      // 卸载不需要的应用
      const unmountUnloadPromises = appsToUnmount
        .map(toUnmountPromise)
        .map((p) => p.then(toUnloadPromise));
      const allUnmountPromises = Promise.all(
        unmountUnloadPromises.concat(appsToUnload.map(toUnloadPromise))
      );

      // 加载并挂载新应用
      const loadThenMountPromises = appsToLoad.map((app) =>
        toLoadPromise(app).then((app) =>
          tryToBootstrapAndMount(app, allUnmountPromises)
        )
      );

      // 挂载已加载但未挂载的应用
      const mountPromises = appsToMount
        .filter((app) => appsToLoad.indexOf(app) < 0)
        .map((app) => tryToBootstrapAndMount(app, allUnmountPromises));

      return allUnmountPromises
        .then(() => {
          callAllEventListeners();
          return Promise.all(loadThenMountPromises.concat(mountPromises));
        })
        .then(finishUpAndReturn);
    });
  }

  function finishUpAndReturn() {
    const returnValue = getMountedApps();
    // 触发完成事件
    window.dispatchEvent(
      new CustomEvent('single-spa:routing-event', { detail: { ... } })
    );
    // 重置并发标志，处理排队请求
    appChangeUnderway = false;
    if (peopleWaitingOnAppChange.length > 0) {
      const next = peopleWaitingOnAppChange;
      peopleWaitingOnAppChange = [];
      reroute(next); // 排队的请求会重新调用 getAppChanges
    }
    return returnValue;
  }
}
```

并发控制解决了这样的问题：

```
T1: 用户从 /order 导航到 /product → reroute 开始执行
T2: order-app 还在 unmount，用户又导航到 /user
    → 第二个 reroute 被排队（不会立即执行）
T3: 第一个 reroute 完成 → 处理排队的 reroute
    → 重新调用 getAppChanges（基于最新状态决策）
```

排队的请求在执行时会**重新调用 getAppChanges()**——因为排队期间应用的状态可能已经发生了变化。基于过时的状态做决策会导致错误。

### 7.4.4 四大 Promise 链

**toLoadPromise：加载应用代码**

```javascript
// single-spa 源码 - src/lifecycles/load.js（简化版）

export function toLoadPromise(app) {
  return Promise.resolve().then(() => {
    if (app.loadPromise) return app.loadPromise; // 防重复加载
    if (app.status !== NOT_LOADED && app.status !== LOAD_ERROR) return app;

    app.status = LOADING_SOURCE_CODE;

    return (app.loadPromise = Promise.resolve()
      .then(() => app.loadApp(getProps(app)))
      .then((appOpts) => {
        app.loadErrorTime = null;

        // 严格校验生命周期函数
        if (!validLifecycleFn(appOpts.bootstrap))
          throw Error(`${app.name} does not export a valid bootstrap`);
        if (!validLifecycleFn(appOpts.mount))
          throw Error(`${app.name} does not export a valid mount`);
        if (!validLifecycleFn(appOpts.unmount))
          throw Error(`${app.name} does not export a valid unmount`);

        // 将生命周期函数挂载到内部对象
        app.status = NOT_BOOTSTRAPPED;
        app.bootstrap = flattenFnArray(appOpts, 'bootstrap');
        app.mount = flattenFnArray(appOpts, 'mount');
        app.unmount = flattenFnArray(appOpts, 'unmount');
        app.unload = flattenFnArray(appOpts, 'unload');

        delete app.loadPromise;
        return app;
      })
      .catch((err) => {
        delete app.loadPromise;
        app.status = LOAD_ERROR;
        app.loadErrorTime = new Date().getTime();
        handleAppError(err, app, LOAD_ERROR);
        return app;
      }));
  });
}
```

`flattenFnArray` 是一个关键的辅助函数——single-spa 允许生命周期函数是数组形式，它用 `reduce` 把多个函数串成 Promise 链：

```javascript
// 将数组形式的生命周期函数串行化
export function flattenFnArray(appOrParcel, lifecycle) {
  let fns = appOrParcel[lifecycle] || [];
  fns = Array.isArray(fns) ? fns : [fns];
  if (fns.length === 0) fns = [() => Promise.resolve()];

  return function (props) {
    return fns.reduce(
      (chain, fn) => chain.then(() => fn(props)),
      Promise.resolve()
    );
  };
}
```

这让开发者可以把初始化逻辑拆分为多个步骤：

```typescript
export const bootstrap = [
  async () => { await loadConfig(); },
  async () => { await initI18n(); },
  async () => { await initStore(); },
];
```

**toBootstrapPromise：初始化应用**

```javascript
// single-spa 源码 - src/lifecycles/bootstrap.js（简化版）

export function toBootstrapPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    if (appOrParcel.status !== NOT_BOOTSTRAPPED) return appOrParcel;

    appOrParcel.status = BOOTSTRAPPING;

    return reasonableTime(appOrParcel, 'bootstrap')
      .then(() => {
        appOrParcel.status = NOT_MOUNTED;
        return appOrParcel;
      })
      .catch((err) => {
        if (hardFail) throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
        handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
        return appOrParcel;
      });
  });
}
```

`reasonableTime` 是 single-spa 的超时控制——默认 bootstrap 超时 4000ms、mount/unmount 超时 3000ms。超时不一定导致失败（取决于 `dieOnTimeout` 配置），但会发出控制台警告。

**toMountPromise：挂载到 DOM**

```javascript
// single-spa 源码 - src/lifecycles/mount.js（简化版）

export function toMountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    if (appOrParcel.status !== NOT_MOUNTED) return appOrParcel;
    if (!shouldBeActive(appOrParcel)) return appOrParcel; // 二次确认

    appOrParcel.status = MOUNTING;

    return reasonableTime(appOrParcel, 'mount')
      .then(() => {
        appOrParcel.status = MOUNTED;
        return appOrParcel;
      })
      .catch((err) => {
        // mount 失败：先"假装成功"让 unmount 能清理半成品 DOM
        appOrParcel.status = MOUNTED;
        return toUnmountPromise(appOrParcel, true).then(() => {
          handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          return appOrParcel;
        });
      });
  });
}
```

mount 失败时的处理非常精妙——先把状态设为 MOUNTED，再调用 toUnmountPromise 清理。因为 mount 函数可能已经渲染了部分 DOM，不执行 unmount 清理会在页面上留下"半成品"。

进入 MOUNTING 之前的 `shouldBeActive` 检查是一个竞态条件防护——在等待其他应用 unmount 的过程中，用户可能已经导航到了新的 URL。

**toUnmountPromise：从 DOM 卸载**

```javascript
// single-spa 源码 - src/lifecycles/unmount.js（简化版）

export function toUnmountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    if (appOrParcel.status !== MOUNTED) return appOrParcel;

    appOrParcel.status = UNMOUNTING;

    // 先卸载所有子 Parcel
    const unmountChildren = Object.keys(appOrParcel.parcels)
      .map((id) => appOrParcel.parcels[id].unmountThisParcel());

    return Promise.all(unmountChildren)
      .then(unmountSelf, () => unmountSelf()) // 子 Parcel 失败也继续
      .then(() => {
        appOrParcel.status = NOT_MOUNTED;
        return appOrParcel;
      })
      .catch((err) => {
        handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
        return appOrParcel;
      });

    function unmountSelf() {
      return reasonableTime(appOrParcel, 'unmount');
    }
  });
}
```

关键设计：卸载时先卸载所有子 Parcel，确保卸载的完整性。

### 7.4.5 tryToBootstrapAndMount：串联与时序保证

```javascript
function tryToBootstrapAndMount(app, unmountAllPromise) {
  if (shouldBeActive(app)) {
    return toBootstrapPromise(app).then((app) =>
      unmountAllPromise.then(() =>
        shouldBeActive(app) ? toMountPromise(app) : app
      )
    );
  }
  return Promise.resolve(app);
}
```

这里隐藏着一个关键决策：**mount 必须等待所有 unmount 完成。** 因为 single-spa 没有内建沙箱——如果旧应用还没卸载完毕，新应用就开始挂载，全局变量和 DOM 操作可能冲突。

同时注意**两次** `shouldBeActive` 检查——函数入口一次，unmount 完成后一次。因为等待 unmount 的过程中，用户可能又导航了。这种"双重检查"模式在并发编程中非常常见。

完整执行时序：

```
时间线（/order → /product）：
────────────────────────────────────────────────→
│  order-app: unmount ──────┐                   │
│  product-app: load ───────┤ (并行执行)         │
│  product-app: bootstrap ──┤                   │
│         (等待 unmount) ────┤                   │
│                           ├─ product: mount   │
└───────────────────────────┴───────────────────┘
                            ▲ unmount 完成点
```

### 7.4.6 自定义事件与可扩展性

reroute 在执行过程中触发一系列自定义事件，为上层框架提供扩展点：

```javascript
// single-spa 触发的事件
'single-spa:before-routing-event'  // 路由变化前
'single-spa:app-change'            // 有应用变更时
'single-spa:no-app-change'         // 无应用变更时
'single-spa:routing-event'         // 路由处理完成
```

乾坤正是通过这些事件实现沙箱的激活/停用切换：

```typescript
// 乾坤中的事件监听（示意）
window.addEventListener('single-spa:before-routing-event', () => {
  currentSandbox?.inactive();
});
window.addEventListener('single-spa:routing-event', () => {
  newSandbox?.active();
});
```

> 🔥 **深度洞察：single-spa 的"可组合性"设计**
>
> single-spa 的自定义事件系统揭示了它的另一个设计哲学：**可组合性优于完备性。** 它不试图成为"全家桶"式微前端框架，而是通过暴露丰富的事件和钩子，让上层框架在不修改源码的前提下扩展功能。这种"核心精简 + 事件扩展"的模式降低了贡献门槛、增加了适应性、也减少了核心代码的复杂度。如果你正在设计一个框架，single-spa 的这种设计模式值得深入学习。

### 7.4.7 错误处理策略

single-spa 的错误处理是分层的：

```javascript
// 第一层：全局错误处理器
const errorHandlers = [];

export function addErrorHandler(handler) {
  if (typeof handler !== 'function')
    throw Error('single-spa error handler must be a function');
  errorHandlers.push(handler);
}

// 第二层：handleAppError——所有应用级错误的统一入口
export function handleAppError(err, app, newStatus) {
  const transformedErr = transformErr(err, app, newStatus);
  if (errorHandlers.length) {
    errorHandlers.forEach((handler) => handler(transformedErr));
  } else {
    // 没有注册处理器时，抛到全局
    setTimeout(() => { throw transformedErr; });
  }
}

// 第三层：transformErr——标准化错误对象
function transformErr(ogErr, appOrParcel, newStatus) {
  const errPrefix = `${objectType(appOrParcel)} '${toName(
    appOrParcel
  )}' died in status ${appOrParcel.status}: `;
  const result = ogErr instanceof Error ? ogErr : Error(errPrefix + ogErr);
  result.appOrParcelName = toName(appOrParcel);
  appOrParcel.status = newStatus; // 更新应用状态
  return result;
}
```

这个三层设计有几个值得注意的特点：

1. **全局错误处理器**允许上层框架统一捕获所有微前端相关的错误，实现集中式日志和监控。

2. **错误不会中断调度**。当一个应用的生命周期函数出错时，single-spa 会把该应用标记为 SKIP_BECAUSE_BROKEN 或 LOAD_ERROR，但不会影响其他应用的调度。这是微前端架构的重要特性——一个子应用崩溃不应该导致整个系统瘫痪。

3. **错误信息包含上下文**。`transformErr` 在错误消息前加上应用名称和当前状态，当你看到 "application 'order-app' died in status MOUNTING" 时，立刻就能定位是哪个应用在什么阶段出了问题。

```typescript
// 在主应用中注册全局错误处理器
import { addErrorHandler } from 'single-spa';

addErrorHandler((err) => {
  console.error('[micro-frontend error]', err);
  console.error('Application:', err.appOrParcelName);

  // 上报到监控系统
  monitor.reportError({
    type: 'micro-frontend',
    app: err.appOrParcelName,
    message: err.message,
    stack: err.stack,
  });

  // 可选：展示降级 UI
  showFallbackUI(err.appOrParcelName);
});
```

### 7.4.8 start() 与 reroute 的关系

```javascript
let started = false;

export function start(opts) {
  started = true;
  if (isInBrowser) { reroute(); }
}
```

在 reroute 内部，`isStarted()` 决定了两种完全不同的行为——start 之前只加载不挂载，start 之后执行完整流程。这让开发者可以在调用 start() 之前先注册所有应用（触发预加载），等主应用的全局布局渲染完成后再 start：

```typescript
// 注册与启动分离
registerApplication({ name: 'app-a', ... }); // 触发预加载
registerApplication({ name: 'app-b', ... }); // 触发预加载

document.addEventListener('DOMContentLoaded', () => {
  renderMainLayout().then(() => {
    start(); // DOM 容器就绪后才开始挂载子应用
  });
});
```

---

## 本章小结

- single-spa 的设计哲学是"路由即应用边界"——它只做调度，不做隔离、通信或资源管理，这种克制使其成为微前端的"最小公倍数"框架
- registerApplication 通过参数归一化将多种调用形式统一为内部格式，注册完成后立即触发 reroute 重新评估当前路由
- 12 种应用状态构成了一个隐式状态机，覆盖了从加载到卸载的完整生命周期，包括加载失败、bootstrap 失败等异常分支
- reroute 是调度中枢，通过 getAppChanges 将应用分为四类（appsToLoad / appsToMount / appsToUnmount / appsToUnload），然后通过 Promise 链执行对应操作
- 四大 Promise 链各自承担加载、初始化、DOM 挂载和 DOM 卸载的职责，通过状态检查实现幂等性
- 并发控制通过 appChangeUnderway 标志位确保同一时刻只有一个 reroute 在执行
- mount 必须等待所有 unmount 完成——这是 single-spa 在没有沙箱的情况下保证隔离性的唯一手段

## 思考题

1. **源码理解**：single-spa 的 `getAppChanges` 对处于 BOOTSTRAPPING、MOUNTING、UNMOUNTING 等"过渡状态"的应用不做任何操作。请分析这种设计选择的原因——如果对这些过渡状态的应用也做处理，会带来什么问题？

2. **设计权衡**：single-spa 选择"先卸载所有旧应用，再挂载新应用"的策略。请对比"先挂载新应用，再卸载旧应用"这种策略的优劣。在什么场景下后者可能更好？

3. **并发分析**：假设用户在 200ms 内连续导航了 3 个不同的路由（/a → /b → /c），请画出 reroute 的执行时序图，说明最终哪些应用会被挂载。

4. **架构对比**：single-spa 使用隐式状态机，而不是显式状态机（如 XState）。请分析两种方案在微前端场景下的优缺点。

5. **实践延伸**：如果两个应用的 `activeWhen` 条件重叠（即同时激活），会发生什么？single-spa 如何处理这种情况？这种处理方式有什么限制？


</div>
