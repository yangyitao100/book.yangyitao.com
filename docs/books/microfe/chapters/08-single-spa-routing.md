<div v-pre>

# 第8章 single-spa 的路由拦截

> "所有微前端框架的路由系统，本质上都是在回答同一个问题：如何在浏览器只有一个地址栏的约束下，让多个独立应用各自认为自己拥有完整的路由控制权。"

> **本章要点**
>
> - 理解 single-spa 对 `history.pushState` / `replaceState` 的 monkey-patch 机制及其设计动机
> - 掌握 `popstate` 与 `hashchange` 事件的统一拦截与延迟触发策略
> - 追踪从 URL 变化到子应用加载/挂载/卸载的完整调用链路
> - 深入理解 `reroute` 函数——single-spa 路由系统的心脏
> - 掌握 single-spa 与 React Router / Vue Router 共存的原理与实战策略
> - 理解路由拦截中的边界条件：快速连续导航、前进/后退、hash 模式兼容

---

打开浏览器的开发者工具，在控制台输入 `history.pushState`，你会得到一个原生函数。再在一个接入了 single-spa 的项目里做同样的事——你得到的不再是浏览器的原生实现，而是一个被 single-spa 精心包装过的函数。

这不是 bug，这是 single-spa 整个路由系统的基石。

微前端的核心难题之一，是**路由的所有权归属**。在传统单页应用（SPA）中，整个应用只有一个路由系统——React Router、Vue Router 或者 Angular Router，它们独占浏览器的 History API，监听 URL 变化，决定渲染什么内容。一切井然有序。

但在微前端架构下，主应用和每个子应用可能各自携带自己的路由系统。当用户点击导航从 `/order/list` 跳转到 `/product/detail/42`，这个 URL 变化需要触发三件事：

1. **single-spa 层面**：识别出这是一次跨应用导航——订单子应用需要卸载，商品子应用需要加载并挂载
2. **商品子应用的 Router**：识别出 `/product/detail/42` 匹配其内部的 `Detail` 路由，渲染对应组件
3. **主应用的 Router**（如果存在）：可能需要更新导航栏的高亮状态

三个路由系统，一次 URL 变化，三种不同的响应——而且必须按正确的顺序执行。如果商品子应用的 Router 在 single-spa 完成挂载之前就尝试渲染，页面会崩溃。如果 single-spa 在子应用的 Router 注册好事件监听之前就触发了路由事件，子应用会错过这次导航。

single-spa 的解法，是**从源头掌控一切路由事件的分发**。它通过 monkey-patch 浏览器的 History API 和拦截路由事件，建立了一个中央路由调度层。所有的 URL 变化必须先经过 single-spa 的处理，然后才会被分发到各个子应用的路由系统。

本章将从源码层面，完整拆解这个路由拦截机制的每一个细节。

## 8.1 对 pushState / replaceState 的 monkey-patch

### 8.1.1 为什么需要拦截 History API

浏览器的 History API 有一个广为人知的设计缺陷：**调用 `history.pushState()` 或 `history.replaceState()` 不会触发任何事件。**

```typescript
// 浏览器原生行为
history.pushState({ page: 1 }, '', '/new-url');
// URL 变了，但不会触发 popstate 事件
// 不会触发 hashchange 事件
// 没有任何事件通知任何人 URL 已经改变
```

这意味着如果一个子应用调用了 `history.pushState()` 来改变 URL，single-spa 完全不知道发生了什么。它无法判断当前 URL 是否仍然匹配当前活跃的子应用，更无法触发必要的应用切换。

`popstate` 事件只在用户点击浏览器的前进/后退按钮时触发，而绝大多数 SPA 的导航是通过编程式调用 `pushState` / `replaceState` 完成的。这是一个致命的信息盲区。

single-spa 的解法直接而暴力：**劫持原生方法，在每次调用时手动触发路由检查。**

### 8.1.2 patchedUpdateState 的源码实现

以下是 single-spa 对 `pushState` 和 `replaceState` 进行 monkey-patch 的核心代码：

```typescript
// single-spa/src/navigation/navigation-events.js

// 第一步：保存原始方法的引用
const originalPushState = window.history.pushState;
const originalReplaceState = window.history.replaceState;

/**
 * 创建一个包装函数，在调用原始 History 方法后触发路由重评估
 * @param updateState - 原始的 pushState 或 replaceState 方法
 * @param methodName - 方法名称，用于创建自定义事件
 */
function patchedUpdateState(updateState: typeof history.pushState, methodName: string) {
  return function (this: History, ...args: Parameters<typeof history.pushState>) {
    // 记录 URL 变化前的状态
    const urlBefore = window.location.href;

    // 调用原始的 pushState 或 replaceState
    const result = updateState.apply(this, args);

    // 记录 URL 变化后的状态
    const urlAfter = window.location.href;

    // 只有 URL 真正发生了变化，才触发路由重评估
    if (urlBefore !== urlAfter) {
      // 创建并派发一个自定义的 popstate 事件
      // 注意：这里用的是 PopStateEvent，不是自定义事件类型
      // 这样做是为了让所有监听 popstate 的代码（包括子应用的 Router）
      // 能够正常接收到这个事件
      window.dispatchEvent(
        createPopStateEvent(window.history.state, methodName)
      );
    }

    return result;
  };
}

// 创建模拟的 PopStateEvent
function createPopStateEvent(state: any, methodName: string): PopStateEvent {
  let evt;
  try {
    // 现代浏览器
    evt = new PopStateEvent('popstate', { state });
  } catch (err) {
    // IE 11 兼容
    evt = document.createEvent('PopStateEvent');
    (evt as any).initPopStateEvent('popstate', false, false, state);
  }

  // 在事件对象上标记触发来源
  // 这个标记至关重要——它让 single-spa 的 popstate 监听器能够区分
  // "真正的浏览器前进/后退" 和 "pushState/replaceState 触发的模拟事件"
  (evt as any).singleSpa = true;
  (evt as any).singleSpaTrigger = methodName; // 'pushState' 或 'replaceState'

  return evt;
}

// 第二步：替换全局方法
window.history.pushState = patchedUpdateState(originalPushState, 'pushState');
window.history.replaceState = patchedUpdateState(originalReplaceState, 'replaceState');
```

这段代码的精妙之处在于几个关键设计决策：

**决策一：只在 URL 真正变化时触发事件。** `replaceState` 经常被用来更新 state 对象但不改变 URL（比如 React Router 的 `replace` 功能）。如果每次调用都触发路由重评估，会导致不必要的性能开销和潜在的无限循环。

**决策二：派发标准的 `PopStateEvent` 而非自定义事件。** 子应用的路由框架（React Router、Vue Router）只监听 `popstate` 事件。如果 single-spa 派发一个自定义事件类型（比如 `single-spa:routing-event`），子应用的 Router 无法感知到路由变化。使用标准的 `PopStateEvent` 确保了与所有路由框架的兼容性。

**决策三：在事件对象上打标记。** 通过 `evt.singleSpa = true` 和 `evt.singleSpaTrigger`，single-spa 的内部逻辑可以区分事件来源。这在后续的事件处理中至关重要。

### 8.1.3 monkey-patch 的执行时机

一个容易被忽视的细节是：这段 monkey-patch 代码在 single-spa 的模块加载阶段就立即执行，而不是等到 `start()` 被调用。

```typescript
// navigation-events.js 是一个模块
// 以下代码在模块被 import 时就执行，而不是在某个函数内部

// 立即执行：替换 History API
window.history.pushState = patchedUpdateState(originalPushState, 'pushState');
window.history.replaceState = patchedUpdateState(originalReplaceState, 'replaceState');

// 立即执行：注册事件监听
window.addEventListener('popstate', urlReroute);
window.addEventListener('hashchange', urlReroute);
```

为什么要这么早？因为如果在 `start()` 调用之前有子应用注册并触发了路由变化，这些变化不能被遗漏。single-spa 需要从第一刻就掌控所有的路由信息。

> **深度洞察：monkey-patch 的哲学问题**
>
> 对全局 API 进行 monkey-patch 是一个充满争议的技术决策。它违反了"不要修改你不拥有的对象"的编程原则，也可能与其他同样进行 monkey-patch 的库产生冲突。但在微前端的语境下，这几乎是唯一可行的方案——浏览器没有提供原生的 "navigation" 事件（注：Navigation API 在 2023 年才开始被部分浏览器支持，且当时的兼容性不足以用于生产），而 single-spa 必须在所有路由变化发生时得到通知。这是一个**权衡了现实约束的务实选择**，而不是一个优雅的设计。理解这种权衡思维，对架构师而言比掌握具体实现更重要。

## 8.2 popstate / hashchange 的统一处理

### 8.2.1 urlReroute：路由事件的统一入口

当 URL 发生变化时——无论是通过 monkey-patched 的 `pushState`/`replaceState` 触发的模拟事件，还是用户点击浏览器前进/后退按钮触发的真实 `popstate` 事件，甚至是 hash 模式下的 `hashchange` 事件——它们最终都会汇聚到同一个处理函数：`urlReroute`。

```typescript
// single-spa/src/navigation/navigation-events.js

/**
 * 所有路由事件的统一入口
 * 无论事件来源如何，最终都调用 reroute()
 */
function urlReroute(evt: PopStateEvent | HashChangeEvent): void {
  reroute([], arguments);
}

// 注册监听器
window.addEventListener('hashchange', urlReroute);
window.addEventListener('popstate', urlReroute);
```

`urlReroute` 本身极其简单——它只是 `reroute` 的一个薄封装。但围绕它的事件监听机制却暗藏玄机。

### 8.2.2 事件拦截与延迟触发

single-spa 不仅要监听路由事件，还要**控制这些事件何时被子应用接收到**。这是整个路由拦截机制中最精妙的部分。

问题是这样的：当一次路由变化触发了子应用的切换（比如卸载 App A，加载并挂载 App B），single-spa 需要确保 App B 的路由监听器在 App B 完全挂载之后才接收到路由事件。否则，App B 的 Router 可能在 DOM 容器还不存在的时候就试图渲染，导致崩溃。

single-spa 的解法是：**拦截子应用注册的 popstate/hashchange 事件监听器，在 reroute 完成后才统一触发。**

```typescript
// single-spa/src/navigation/navigation-events.js

// 存储被拦截的事件监听器
const capturedEventListeners: Record<string, Function[]> = {
  hashchange: [],
  popstate: [],
};

// 保存原始的 addEventListener 和 removeEventListener
const originalAddEventListener = window.addEventListener;
const originalRemoveEventListener = window.removeEventListener;

/**
 * 重写 window.addEventListener
 * 拦截对 popstate 和 hashchange 的监听注册
 */
window.addEventListener = function (
  eventName: string,
  fn: EventListenerOrEventListenerObject,
  ...rest: any[]
) {
  if (typeof fn === 'function') {
    if (
      (eventName === 'hashchange' || eventName === 'popstate') &&
      // 确保不是 single-spa 自己注册的监听器
      !capturedEventListeners[eventName].some((listener) => listener === fn)
    ) {
      // 不调用原始的 addEventListener
      // 而是将监听器保存到 capturedEventListeners 中
      capturedEventListeners[eventName].push(fn);
      return;
    }
  }

  // 其他事件类型正常注册
  return originalAddEventListener.apply(this, [eventName, fn, ...rest]);
};

/**
 * 重写 window.removeEventListener
 * 同步维护 capturedEventListeners
 */
window.removeEventListener = function (
  eventName: string,
  fn: EventListenerOrEventListenerObject,
  ...rest: any[]
) {
  if (typeof fn === 'function') {
    if (eventName === 'hashchange' || eventName === 'popstate') {
      capturedEventListeners[eventName] = capturedEventListeners[eventName].filter(
        (listener) => listener !== fn
      );
      return;
    }
  }

  return originalRemoveEventListener.apply(this, [eventName, fn, ...rest]);
};
```

这段代码的效果是：当 React Router 调用 `window.addEventListener('popstate', handlePop)` 时，这个 `handlePop` 函数**并不会真正注册到浏览器上**。它被 single-spa "截获"并存放在 `capturedEventListeners.popstate` 数组中。

那这些被截获的监听器何时执行呢？答案在 `reroute` 完成之后的回调中：

```typescript
/**
 * 在 reroute 完成后，手动触发所有被截获的事件监听器
 * 确保子应用的 Router 在应用挂载完成后才接收到路由事件
 */
function callCapturedEventListeners(eventArguments: IArguments | any[]): void {
  if (eventArguments) {
    const eventType = eventArguments[0]?.type;

    if (eventType) {
      const listeners = capturedEventListeners[eventType];
      if (listeners && listeners.length > 0) {
        listeners.forEach((listener) => {
          try {
            listener.apply(window, eventArguments);
          } catch (err) {
            // 单个监听器的错误不应阻止其他监听器的执行
            setTimeout(() => {
              throw err;
            });
          }
        });
      }
    }
  }
}
```

### 8.2.3 事件流的完整时序

让我们用一个具体的场景来理解完整的事件流。假设用户从 `/order/list`（订单子应用）点击导航跳转到 `/product/detail/42`（商品子应用）：

```
用户点击链接
    │
    ▼
React Router 调用 history.pushState(null, '', '/product/detail/42')
    │
    ▼
命中 monkey-patched 的 pushState
    │
    ├── 1. 调用原始 pushState → URL 更新为 /product/detail/42
    │
    ├── 2. urlBefore !== urlAfter → 需要触发路由重评估
    │
    └── 3. window.dispatchEvent(new PopStateEvent('popstate'))
              │
              ▼
        single-spa 的 urlReroute 监听器被触发
        （因为 single-spa 自己的监听器是通过原始 addEventListener 注册的）
              │
              ▼
        调用 reroute()
              │
              ├── 4. 计算需要卸载的应用：[订单子应用]
              ├── 5. 计算需要加载的应用：[商品子应用]
              ├── 6. 执行卸载：调用订单子应用的 unmount 生命周期
              ├── 7. 执行加载：加载商品子应用的资源
              ├── 8. 执行挂载：调用商品子应用的 mount 生命周期
              │       └── 商品子应用的 React Router 此时初始化
              │           并通过 window.addEventListener('popstate', handlePop)
              │           注册监听器 → 被 single-spa 截获存入 capturedEventListeners
              │
              └── 9. reroute 完成
                      │
                      ▼
                callCapturedEventListeners(popstateEvent)
                      │
                      ▼
                商品子应用的 React Router 的 handlePop 被调用
                      │
                      ▼
                React Router 读取当前 URL /product/detail/42
                匹配到 Detail 路由，渲染商品详情组件
```

这个时序保证了一个关键不变式：**子应用的路由框架永远在应用挂载完成之后才接收到路由事件。**

> **深度洞察：事件拦截的双刃剑**
>
> 拦截 `addEventListener` 是一个影响全局的操作。如果某个第三方库（比如一个统计 SDK）也监听了 `popstate` 事件用于页面浏览追踪，它的监听器也会被 single-spa 截获和延迟触发。在大多数场景下这不会造成问题——统计数据晚几毫秒收到无伤大雅。但如果某个库依赖于 `popstate` 事件的精确触发时机来做关键逻辑判断，就可能出现难以调试的 bug。这就是为什么理解 single-spa 的路由拦截机制如此重要——**当你不知道路由事件被拦截了，你甚至不知道该往哪个方向排查问题。**

### 8.2.4 hash 模式的特殊处理

虽然现代 SPA 大多使用 history 模式，但 hash 模式（URL 形如 `/#/order/list`）仍然在一些场景下被使用——比如不需要服务端配置的静态部署环境。single-spa 同时监听 `hashchange` 事件来兼容这种模式。

```typescript
// hash 变化可能同时触发 popstate 和 hashchange
// single-spa 需要避免重复处理

// 在 urlReroute 中，通过 reroute 内部的去重机制确保
// 即使同一次 URL 变化同时触发了两个事件，也只执行一次应用切换

let lastUrl = window.location.href;

function urlReroute(evt: PopStateEvent | HashChangeEvent): void {
  const currentUrl = window.location.href;

  // 如果 URL 没有变化，跳过处理
  // 这处理了某些浏览器中 popstate 和 hashchange 同时触发的情况
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    reroute([], arguments);
  }
}
```

需要注意的是，在某些浏览器中（特别是旧版本的 Chrome 和 Firefox），修改 hash 既会触发 `hashchange` 事件也会触发 `popstate` 事件。single-spa 通过 URL 比对来避免重复触发 `reroute`。

## 8.3 路由变化到应用加载 / 卸载的完整链路

### 8.3.1 reroute：路由系统的心脏

`reroute` 是 single-spa 中最核心的函数，没有之一。每当路由发生变化，`reroute` 负责计算当前 URL 下哪些应用应该被激活、哪些应该被卸载，然后按正确的顺序执行相应的生命周期。

```typescript
// single-spa/src/navigation/reroute.js

// reroute 的核心状态
let appChangeUnderway = false;   // 是否正在进行应用切换
let peopleWaitingOnAppChange: Array<{
  resolve: Function;
  reject: Function;
  eventArguments: any;
}> = [];                          // 等待中的路由变化队列

/**
 * reroute 的主函数
 * @param pendingPromises - 来自 registerApplication 的待处理 Promise
 * @param eventArguments - 触发本次 reroute 的原始事件参数
 */
export function reroute(
  pendingPromises: Array<any> = [],
  eventArguments?: IArguments | any[]
): Promise<void> {
  // 关键判断：是否有正在进行中的应用切换？
  if (appChangeUnderway) {
    // 如果是，将本次路由变化加入等待队列
    // 等当前切换完成后再处理
    return new Promise((resolve, reject) => {
      peopleWaitingOnAppChange.push({
        resolve,
        reject,
        eventArguments,
      });
    });
  }

  // 第一步：根据当前 URL 将所有已注册的应用分为四类
  const {
    appsToUnload,    // 需要卸载的应用（从 MOUNTED → NOT_MOUNTED → NOT_LOADED）
    appsToUnmount,   // 需要取消挂载的应用（从 MOUNTED → NOT_MOUNTED）
    appsToLoad,      // 需要加载的应用（从 NOT_LOADED → LOADING_SOURCE_CODE）
    appsToMount,     // 需要挂载的应用（从 NOT_MOUNTED → MOUNTED）
  } = getAppChanges();

  // 第二步：判断 single-spa 是否已经 start()
  if (isStarted()) {
    // 已经 start() → 执行完整的应用切换
    appChangeUnderway = true;
    return performAppChanges();
  } else {
    // 还没有 start() → 只加载应用，不挂载
    return loadApps();
  }

  // ... performAppChanges 和 loadApps 的实现见后文
}
```

### 8.3.2 getAppChanges：应用分类算法

`getAppChanges` 是 reroute 的第一步——根据当前 URL 和每个应用的 `activeWhen` 函数，将所有已注册的应用分为四类：

```typescript
// single-spa/src/applications/apps.js

interface AppChanges {
  appsToLoad: Application[];     // 需要加载的
  appsToMount: Application[];    // 需要挂载的
  appsToUnmount: Application[];  // 需要卸载的
  appsToUnload: Application[];   // 需要彻底卸载的
}

export function getAppChanges(): AppChanges {
  const appsToLoad: Application[] = [];
  const appsToMount: Application[] = [];
  const appsToUnmount: Application[] = [];
  const appsToUnload: Application[] = [];

  // 遍历所有已注册的应用
  const apps = getAppNames().map(getAppByName);

  apps.forEach((app) => {
    // shouldBeActive() 调用用户注册时提供的 activeWhen 函数
    // 传入当前的 window.location，返回 boolean
    const appShouldBeActive = shouldBeActive(app);

    switch (getAppStatus(app)) {
      case NOT_LOADED:
      case LOADING_SOURCE_CODE:
        // 应用还没加载，且当前 URL 匹配 → 需要加载
        if (appShouldBeActive) {
          appsToLoad.push(app);
        }
        break;

      case NOT_BOOTSTRAPPED:
      case NOT_MOUNTED:
        // 应用已加载但未挂载，且当前 URL 匹配 → 需要挂载
        if (!appChangeUnderway && appShouldBeActive) {
          appsToMount.push(app);
        }
        break;

      case MOUNTED:
        // 应用已挂载，但当前 URL 不匹配 → 需要卸载
        if (!appShouldBeActive) {
          appsToUnmount.push(app);
        }
        break;

      // ... 其他状态的处理
    }
  });

  return { appsToLoad, appsToMount, appsToUnmount, appsToUnload };
}

/**
 * 判断应用是否应该在当前 URL 下激活
 */
function shouldBeActive(app: Application): boolean {
  try {
    return app.activeWhen(window.location);
  } catch (err) {
    handleAppError(err, app);
    return false;
  }
}
```

这段逻辑看似简单，但它揭示了 single-spa 应用状态机的核心设计：应用不是简单的"加载"和"未加载"两种状态，而是有一个完整的生命周期状态机。

```
NOT_LOADED → LOADING_SOURCE_CODE → NOT_BOOTSTRAPPED → NOT_MOUNTED ⇆ MOUNTED
                                                            │
                                                            ▼
                                                      UNLOADING → NOT_LOADED
```

### 8.3.3 performAppChanges：应用切换的编排

`performAppChanges` 是 reroute 的核心执行逻辑——它按正确的顺序执行应用的卸载、加载和挂载：

```typescript
async function performAppChanges(): Promise<void> {
  // 派发自定义事件，通知外部"路由切换开始"
  window.dispatchEvent(
    new CustomEvent('single-spa:before-routing-event', {
      detail: {
        appsByNewStatus: {
          MOUNTED: appsToMount.map((app) => app.name),
          NOT_MOUNTED: appsToUnmount.map((app) => app.name),
        },
        newUrl: window.location.href,
        oldUrl: lastUrl,
      },
    })
  );

  try {
    // 阶段 1：并行执行卸载和加载
    // 卸载不再匹配的应用 && 加载新匹配的应用可以同时进行
    // 这是一个重要的性能优化

    // 1a. 卸载需要卸载的应用
    const unmountPromises = appsToUnmount.map((app) => {
      return tryToUnmountApp(app);
    });

    // 1b. 同时加载需要加载的应用（如果还没加载）
    // 注意：加载完成后还需要 bootstrap
    const loadAndMountPromises = appsToLoad.map(async (app) => {
      // 加载应用代码
      await tryToLoadApp(app);

      // 加载完成后再次检查：此应用是否仍然应该被激活？
      // 因为在异步加载期间，URL 可能又发生了变化
      if (shouldBeActive(app)) {
        // 执行 bootstrap
        await tryToBootstrapApp(app);
        // 等所有卸载完成后才挂载（确保 DOM 容器已清理）
        await Promise.all(unmountPromises);
        // 执行 mount
        await tryToMountApp(app);
      }
    });

    // 1c. 对已加载但未挂载的应用直接挂载
    const mountPromises = appsToMount
      .filter((app) => !appsToLoad.includes(app))
      .map(async (app) => {
        // 同样需要等卸载完成
        await Promise.all(unmountPromises);
        await tryToBootstrapApp(app);
        await tryToMountApp(app);
      });

    // 等待所有操作完成
    await Promise.all([
      ...unmountPromises,
      ...loadAndMountPromises,
      ...mountPromises,
    ]);

    // 阶段 2：处理 unload 队列中的应用
    const unloadPromises = appsToUnload.map((app) => {
      return tryToUnloadApp(app);
    });
    await Promise.all(unloadPromises);

  } finally {
    // 无论成功还是失败，都需要：
    // 1. 标记应用切换已完成
    appChangeUnderway = false;

    // 2. 触发被截获的路由事件监听器
    callCapturedEventListeners(eventArguments);

    // 3. 派发路由切换完成事件
    window.dispatchEvent(
      new CustomEvent('single-spa:routing-event', {
        detail: {
          appsByNewStatus: getAppStatusesByName(),
        },
      })
    );

    // 4. 检查等待队列中是否有待处理的路由变化
    // 如果在本次切换期间有新的路由变化，递归处理
    if (peopleWaitingOnAppChange.length > 0) {
      const nextPending = peopleWaitingOnAppChange;
      peopleWaitingOnAppChange = [];

      // 递归调用 reroute 处理下一个待处理的路由变化
      reroute(nextPending);
    }
  }
}
```

这段代码中有几个值得深入分析的设计决策：

**并发控制：串行化路由变化。** `appChangeUnderway` 标志位确保同一时间只有一次应用切换在进行。新的路由变化被排入队列，等当前切换完成后再处理。这避免了并发修改 DOM 带来的竞态条件。

**二次检查：加载后再次验证。** 在异步加载应用代码期间，用户可能已经又导航到了别的页面。`shouldBeActive(app)` 的二次检查防止了"加载了但已经不需要挂载"的浪费。

**卸载先于挂载。** 挂载新应用之前必须等待旧应用卸载完成。这不仅是因为 DOM 容器可能被复用，更是因为旧应用可能持有事件监听器、定时器等资源，必须先清理干净。

### 8.3.4 生命周期的调用保证

single-spa 对每个生命周期函数的调用提供了严格的保证：

```typescript
/**
 * 尝试挂载应用
 * 包含超时控制和错误处理
 */
async function tryToMountApp(app: Application): Promise<void> {
  if (shouldBeActive(app)) {
    try {
      // 调用子应用导出的 mount 函数
      // 附带超时控制（默认无超时，可配置）
      await reasonableTime(
        app,
        app.mount({
          name: app.name,
          singleSpa,
          mountParcel: mountParcel.bind(app),
          // 传递用户在 registerApplication 时提供的自定义 props
          ...app.customProps,
        }),
        'mount',
        app.timeouts.mount
      );

      // mount 成功，更新应用状态
      setAppStatus(app, MOUNTED);

    } catch (err) {
      // mount 失败，不是简单地抛出错误
      // 而是将应用标记为 SKIP_BECAUSE_BROKEN
      // 避免后续的 reroute 反复尝试挂载一个已知会失败的应用
      setAppStatus(app, SKIP_BECAUSE_BROKEN);
      handleAppError(err, app, SKIP_BECAUSE_BROKEN);
    }
  }
}

/**
 * 超时控制包装器
 * 确保生命周期函数不会无限期挂起
 */
function reasonableTime<T>(
  app: Application,
  promise: Promise<T>,
  description: string,
  timeout?: {
    millis: number;
    dieOnTimeout: boolean;
    warningMillis?: number;
  }
): Promise<T> {
  if (!timeout) return promise;

  const { millis, dieOnTimeout, warningMillis } = timeout;

  return new Promise((resolve, reject) => {
    let finished = false;

    // 设置警告定时器
    if (warningMillis) {
      setTimeout(() => {
        if (!finished) {
          console.warn(
            `single-spa: ${app.name}'s ${description} lifecycle ` +
            `has not resolved or rejected for ${warningMillis}ms`
          );
        }
      }, warningMillis);
    }

    // 设置超时定时器
    const timeoutId = setTimeout(() => {
      if (!finished) {
        const error = new Error(
          `${description} lifecycle for ${app.name} timed out after ${millis}ms`
        );
        if (dieOnTimeout) {
          reject(error);
        } else {
          console.error(error);
          // 不 reject，让它继续等待
        }
      }
    }, millis);

    promise
      .then((val) => {
        finished = true;
        clearTimeout(timeoutId);
        resolve(val);
      })
      .catch((err) => {
        finished = true;
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}
```

### 8.3.5 快速连续导航的处理

一个经常出现在生产环境中的场景是用户快速连续点击导航。假设用户在 200ms 内连续点击了三个不同的菜单项：

```
时间轴：
0ms    → 点击"订单"  → pushState('/order')
80ms   → 点击"商品"  → pushState('/product')
160ms  → 点击"用户"  → pushState('/user')
```

single-spa 的处理流程：

```typescript
// 第一次点击：/order
// appChangeUnderway = false → 立即执行 reroute()
// appChangeUnderway = true

// 第二次点击（80ms 后）：/product
// appChangeUnderway = true → 加入 peopleWaitingOnAppChange 队列
// 此时第一次的 reroute 还在执行（可能正在加载订单子应用）

// 第三次点击（160ms 后）：/user
// appChangeUnderway = true → 再次加入队列

// 第一次 reroute 完成后：
// 1. appChangeUnderway = false
// 2. 处理 peopleWaitingOnAppChange 队列
// 3. 递归调用 reroute()
// 4. 此时 URL 已经是 /user
// 5. getAppChanges() 基于当前 URL（/user）计算
// 6. 订单子应用被卸载（刚挂载就卸载），用户子应用被加载和挂载
// 7. 商品子应用从未被挂载（被跳过了）

// 关键优化：中间状态（/product）被自然跳过
// single-spa 不会白白加载商品子应用——因为队列处理时 URL 已经不是 /product 了
```

这种"最终一致"的处理策略确保了即使面对快速连续的导航，系统也不会进入混乱状态。中间的过渡 URL 会被自然跳过，只有用户最终停留的 URL 才会生效。

> **深度洞察：队列化 vs 取消化**
>
> single-spa 选择了"队列化"策略而非"取消化"策略。另一种可行的设计是：当新的路由变化到来时，取消当前正在执行的 reroute，立即开始新的 reroute。这在理论上更高效——不需要等待一个即将被卸载的应用完成挂载。但取消化策略的问题是：子应用的生命周期函数可能有副作用（比如 mount 中向服务端注册了一个 WebSocket 连接），打断一个执行到一半的生命周期可能导致资源泄漏。队列化策略虽然稍慢，但保证了每个生命周期都能完整执行。这又是一个**安全性 vs 性能**的经典权衡。

## 8.4 与 React Router / Vue Router 的共存策略

### 8.4.1 核心矛盾：谁是路由的真正主人

在微前端架构中，存在两层路由系统：

```
┌──────────────────────────────────────────────────────┐
│                     浏览器 URL                        │
│  https://app.example.com/product/detail/42?tab=spec  │
└─────────────────────────┬────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │     single-spa 路由层          │
          │  负责：匹配 /product → 商品    │
          │        子应用应该激活          │
          └───────────────┬───────────────┘
                          │
          ┌───────────────┴───────────────┐
          │  子应用路由层（React Router）   │
          │  负责：匹配 /product/detail/42 │
          │        → 渲染 Detail 组件     │
          │        ?tab=spec              │
          │        → 激活 Spec 标签页      │
          └───────────────────────────────┘
```

两层路由各司其职：single-spa 只关心 URL 的"前缀"部分来决定激活哪个子应用；子应用的 Router 关心完整的 URL 路径来决定渲染哪个页面组件。

但它们共享同一个 `window.location` 和同一个 History API——这就是矛盾的根源。

### 8.4.2 React Router 的共存方案

React Router（v6+）支持 `basename` 配置，这是与 single-spa 共存的关键：

```typescript
// 子应用注册（主应用中）
import { registerApplication, start } from 'single-spa';

registerApplication({
  name: 'product-app',
  app: () => System.import('@myorg/product-app'),
  // single-spa 只匹配前缀
  activeWhen: (location) => location.pathname.startsWith('/product'),
  customProps: {
    basename: '/product',
  },
});

start();
```

```tsx
// 商品子应用的入口 - React + React Router v6
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

let root: ReturnType<typeof createRoot> | null = null;

// single-spa 生命周期：挂载
export async function mount(props: { basename: string; container?: HTMLElement }) {
  const { basename, container } = props;

  const mountPoint = container || document.getElementById('product-app-container')!;

  root = createRoot(mountPoint);
  root.render(
    <BrowserRouter basename={basename}>
      <Routes>
        {/* 这里的路径是相对于 basename 的 */}
        {/* /product/list → 匹配 /list */}
        <Route path="/list" element={<ProductList />} />
        {/* /product/detail/42 → 匹配 /detail/:id */}
        <Route path="/detail/:id" element={<ProductDetail />} />
        {/* /product → 匹配 / */}
        <Route path="/" element={<Navigate to="/list" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

// single-spa 生命周期：卸载
export async function unmount(props: { container?: HTMLElement }) {
  if (root) {
    root.unmount();
    root = null;
  }
}

// single-spa 生命周期：启动
export async function bootstrap() {
  // 可以在这里做一次性初始化
}
```

`basename` 的作用是告诉 React Router："你只需要关心 `/product` 之后的部分。" 当 URL 是 `/product/detail/42` 时，React Router 看到的路径是 `/detail/42`，正好匹配 `/detail/:id` 路由。

### 8.4.3 Vue Router 的共存方案

Vue Router 的配置思路类似，通过 `base` 选项实现路由前缀隔离：

```typescript
// 商品子应用的入口 - Vue 3 + Vue Router 4
import { createApp, App as VueApp } from 'vue';
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import RootComponent from './App.vue';

let app: VueApp | null = null;
let router: ReturnType<typeof createRouter> | null = null;

const routes: RouteRecordRaw[] = [
  { path: '/list', component: () => import('./views/ProductList.vue') },
  { path: '/detail/:id', component: () => import('./views/ProductDetail.vue') },
  { path: '/', redirect: '/list' },
];

export async function mount(props: { basename: string; container?: HTMLElement }) {
  const { basename, container } = props;

  // 创建 Router 实例，使用 basename 作为 base
  router = createRouter({
    // createWebHistory 接受 base 参数
    history: createWebHistory(basename),
    routes,
  });

  app = createApp(RootComponent);
  app.use(router);

  const mountPoint = container || document.getElementById('product-app-container')!;
  app.mount(mountPoint);
}

export async function unmount() {
  if (app) {
    app.unmount();
    app = null;
    router = null;
  }
}

export async function bootstrap() {
  // 一次性初始化
}
```

### 8.4.4 跨应用导航的实现

子应用之间的导航需要特别注意——子应用的 Router 只能管理自己路由前缀下的导航。跨应用导航需要通过 `history.pushState` 触发，让 single-spa 接管：

```typescript
// ❌ 错误方式：在商品子应用中用 React Router 导航到订单页
// React Router 只知道 /product/* 路由，/order/list 对它来说是未知路由
import { useNavigate } from 'react-router-dom';

function ProductDetail() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/order/list')}>
      {/* 这不会触发 single-spa 的应用切换！ */}
      查看相关订单
    </button>
  );
}

// ✅ 正确方式：使用 single-spa 提供的导航 API
import { navigateToUrl } from 'single-spa';

function ProductDetail() {
  return (
    <button onClick={() => navigateToUrl('/order/list')}>
      查看相关订单
    </button>
  );
}

// navigateToUrl 的实现非常简单
export function navigateToUrl(url: string): void {
  // 解析 URL
  const parsed = parseUri(url);
  const currentUrl = window.location.href;

  if (url.indexOf('#') === 0) {
    // hash-only 的 URL
    window.location.hash = url;
  } else {
    // 使用（已被 monkey-patch 的）pushState
    // 这会触发整个路由拦截链路
    window.history.pushState(null, '', url);
  }
}
```

还有一种更优雅的封装方式——创建一个跨框架的导航 Hook / Composable：

```typescript
// shared/navigation.ts
// 跨框架的导航工具

import { navigateToUrl } from 'single-spa';

/**
 * 判断目标 URL 是否属于当前子应用
 */
function isInternalNavigation(targetUrl: string, basename: string): boolean {
  const path = new URL(targetUrl, window.location.origin).pathname;
  return path.startsWith(basename);
}

/**
 * 智能导航：自动判断使用子应用 Router 还是 single-spa
 */
export function createSmartNavigate(basename: string) {
  return function smartNavigate(
    targetUrl: string,
    internalNavigate: (path: string) => void
  ): void {
    if (isInternalNavigation(targetUrl, basename)) {
      // 应用内导航：使用子应用自己的 Router
      const internalPath = targetUrl.replace(basename, '') || '/';
      internalNavigate(internalPath);
    } else {
      // 跨应用导航：使用 single-spa
      navigateToUrl(targetUrl);
    }
  };
}

// React 子应用中使用
// hooks/useSmartNavigate.ts
import { useNavigate } from 'react-router-dom';
import { createSmartNavigate } from '@myorg/shared-navigation';

export function useSmartNavigate(basename: string) {
  const navigate = useNavigate();
  const smartNavigate = createSmartNavigate(basename);

  return (targetUrl: string) => {
    smartNavigate(targetUrl, (path) => navigate(path));
  };
}
```

### 8.4.5 路由状态同步的陷阱

在实际项目中，最容易踩的坑是**路由状态不同步**。以下是几个典型场景和解决方案：

**陷阱一：子应用挂载时 URL 已经变了**

```typescript
// 问题场景：
// 1. single-spa 开始加载子应用 A（异步操作，耗时 500ms）
// 2. 加载过程中用户又点了导航，URL 变了
// 3. 子应用 A 加载完成，mount 被调用
// 4. 但此时 URL 已经不匹配了

// single-spa 的保护机制（前面提到的二次检查）
// 在 tryToMountApp 中会再次调用 shouldBeActive(app)
// 如果返回 false，不会执行 mount
```

**陷阱二：子应用内部路由守卫与 single-spa 生命周期的冲突**

```typescript
// Vue Router 的路由守卫可能阻止导航
const router = createRouter({
  history: createWebHistory('/product'),
  routes,
});

router.beforeEach((to, from) => {
  if (!isAuthenticated()) {
    // 问题：这个守卫只能阻止 Vue Router 内部的导航
    // 无法阻止 single-spa 的应用切换
    // 如果用户通过浏览器前进/后退到达这个路由
    // Vue Router 的守卫可以阻止页面渲染
    // 但 single-spa 仍然认为这个应用已经挂载
    return '/login';
  }
});

// 解决方案：在 single-spa 的 activity function 中也加入认证检查
registerApplication({
  name: 'product-app',
  app: () => System.import('@myorg/product-app'),
  activeWhen: (location) => {
    // 在 activeWhen 中检查认证状态
    if (!isAuthenticated() && location.pathname.startsWith('/product')) {
      // 重定向到登录页
      // 注意：不能在这里调用 navigateToUrl，会导致无限循环
      // 应该返回 false，让主应用的路由处理重定向
      return false;
    }
    return location.pathname.startsWith('/product');
  },
});
```

**陷阱三：子应用卸载后的异步回调**

```typescript
// React 子应用中的常见问题
function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    // 发起 API 请求
    fetchProducts().then((data) => {
      // 危险！如果在请求期间子应用被卸载了
      // 这个 setProducts 会触发 React 警告
      // "Can't perform a React state update on an unmounted component"
      setProducts(data);
    });
  }, []);

  // ...
}

// 解决方案：使用 AbortController 或 cleanup
function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    fetchProducts({ signal: controller.signal })
      .then((data) => setProducts(data))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Failed to fetch products:', err);
        }
      });

    // 子应用卸载时（unmount → React root.unmount() → cleanup 执行）
    return () => controller.abort();
  }, []);

  // ...
}
```

### 8.4.6 主应用路由的最佳实践

主应用（通常被称为"容器应用"或"shell"）自身也可以有路由需求——比如登录页、404 页面、全局布局切换。但主应用的路由必须与 single-spa 的路由拦截和平共处：

```tsx
// 主应用（Shell）的路由配置 - React 示例
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';

function ShellApp() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 主应用自己管理的路由 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/403" element={<ForbiddenPage />} />
        <Route path="/404" element={<NotFoundPage />} />

        {/* 带布局的路由 */}
        <Route element={<MainLayout />}>
          {/* 子应用挂载点 */}
          {/* 使用通配符让 React Router 不要拦截子应用的路径 */}
          <Route path="/*" element={<MicroAppContainer />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

/**
 * 子应用的挂载容器
 * 它只负责提供 DOM 节点，不参与子应用的路由决策
 */
function MicroAppContainer() {
  return (
    <div id="micro-app-container">
      {/* 子应用会被 single-spa 挂载到这个容器中 */}
      {/* 这个组件本身不做任何事，只是占位 */}
    </div>
  );
}

/**
 * 主布局：导航栏 + 子应用区域
 */
function MainLayout() {
  return (
    <div className="shell-layout">
      <nav className="shell-nav">
        <NavLink to="/order/list">订单管理</NavLink>
        <NavLink to="/product/list">商品管理</NavLink>
        <NavLink to="/user/profile">用户中心</NavLink>
      </nav>
      <main className="shell-content">
        <Outlet />
      </main>
    </div>
  );
}
```

这里有一个微妙但关键的设计原则：**主应用的路由应该尽可能"薄"**。主应用只管理那些不属于任何子应用的页面（登录、404 等），以及全局布局。子应用挂载区域用一个通配符路由 `/*` 匹配，把路由决策权交给 single-spa。

### 8.4.7 完整的路由分层架构

让我们把所有的知识串联起来，形成一个完整的路由分层架构图：

```
┌──────────────────────────────────────────────────────────┐
│                        浏览器层                           │
│  history.pushState / replaceState / popstate / hashchange │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────┐
│                   single-spa 拦截层                       │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────────────────┐  │
│  │ monkey-patched   │  │ 拦截 addEventListener        │  │
│  │ pushState /      │  │ 截获子应用注册的              │  │
│  │ replaceState     │  │ popstate / hashchange 监听器  │  │
│  └────────┬─────────┘  └──────────────┬───────────────┘  │
│           │                           │                  │
│           └───────────┬───────────────┘                  │
│                       ▼                                  │
│              ┌─────────────────┐                         │
│              │    urlReroute   │                         │
│              └────────┬────────┘                         │
│                       ▼                                  │
│              ┌─────────────────┐                         │
│              │     reroute     │                         │
│              │  ┌───────────┐  │                         │
│              │  │getAppChgs │  │                         │
│              │  │performApp │  │                         │
│              │  │Changes    │  │                         │
│              │  └───────────┘  │                         │
│              └────────┬────────┘                         │
│                       │                                  │
│                       ▼                                  │
│          callCapturedEventListeners                      │
│          (延迟触发子应用的路由监听器)                      │
└────────────────────────┬─────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  React Router │ │  Vue Router  │ │ Angular      │
│  basename:    │ │  base:       │ │ Router       │
│  /order       │ │  /product    │ │ base-href:   │
│               │ │              │ │ /admin       │
│  只处理       │ │  只处理       │ │  只处理       │
│  /order/*     │ │  /product/*  │ │  /admin/*    │
└──────────────┘ └──────────────┘ └──────────────┘
```

这个分层架构的优雅之处在于：每一层只关心自己的职责，且层与层之间的交互通过标准的浏览器 API（`popstate` 事件、`window.location`）进行。子应用的 Router 甚至不知道 single-spa 的存在——它以为自己直接和浏览器打交道，但实际上所有的路由事件都经过了 single-spa 的过滤和编排。

> **深度洞察：透明代理模式**
>
> single-spa 的路由拦截实质上是一个**透明代理**（Transparent Proxy）。子应用的路由框架通过标准的浏览器 API 与 single-spa 交互，但它们并不知道中间存在一个代理层。这种设计的最大优势是：子应用不需要为微前端做任何特殊适配——相同的代码既可以独立运行，也可以作为微前端子应用运行。你只需要在入口文件中导出 single-spa 生命周期函数，内部的路由逻辑完全不需要修改。这种"对子应用透明"的设计理念，是 single-spa 能够成为微前端事实标准的根本原因之一。

---

**思考题**

1. **Navigation API 的影响**：Chrome 102+ 支持了新的 Navigation API（`navigation.addEventListener('navigate', ...)`），它能原生监听所有导航事件（包括 `pushState`），理论上不再需要 monkey-patch。如果 single-spa 要迁移到 Navigation API，路由拦截机制需要做哪些改变？这种迁移的主要障碍是什么？

2. **事件拦截的边界**：假设一个第三方统计 SDK 在 single-spa 加载之前就通过 `window.addEventListener('popstate', tracker)` 注册了路由追踪监听器。这个监听器会被 single-spa 截获吗？为什么？如果不会，这会导致什么问题？

3. **并发路由变化的优化**：当前 single-spa 使用"队列化"策略处理快速连续导航——前一次 reroute 完成后才处理下一次。请设计一种"可取消"的 reroute 策略：如果新的路由变化到来时，当前正在执行的应用生命周期可以被安全取消。你需要考虑哪些边界条件？如何保证生命周期的完整性？

4. **多层嵌套的路由冲突**：假设主应用使用 React Router，子应用 A 也使用 React Router，而子应用 A 又通过 single-spa Parcel 嵌入了一个使用 Vue Router 的微组件。在这种三层嵌套的场景下，路由事件会如何传播？可能出现哪些冲突？如何设计一套规范来避免这些问题？

5. **调试技巧**：在生产环境中遇到"点击导航后子应用没有切换"的问题，你会如何利用本章所学的知识进行排查？请列出你会检查的五个关键点，并解释每个检查点的原理。

</div>
