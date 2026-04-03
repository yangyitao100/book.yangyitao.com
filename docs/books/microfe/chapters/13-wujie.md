<div v-pre>

# 第13章 iframe 的复兴：Wujie 与新一代方案

> "被判了死刑的技术，往往只是在等待一个正确的使用方式。"

> **本章要点**
> - 理解 iframe 方案"死而复生"的技术背景与根本原因
> - 深入 Wujie 的三层架构：WebComponent（渲染层）+ iframe（JS 执行层）+ Proxy（桥接层）
> - 掌握 iframe 通信的现代方案：从 postMessage 到 MessageChannel、BroadcastChannel 的进化
> - 理解 Wujie 的 Proxy 劫持机制：location、history、document 的精确拦截
> - 学会 iframe 场景下的性能优化：预加载、资源共享与降级策略

---

2019 年，乾坤横空出世，用 Proxy 沙箱取代 iframe 成为微前端的主流隔离方案。那时候，iframe 几乎被整个社区判了"死刑"——性能差、体验割裂、路由无法同步、弹窗不能居中。每一篇微前端选型文章都会在 iframe 方案旁边画一个大大的叉号。

然而，2022 年腾讯开源了 Wujie。它做了一件所有人都觉得不可能的事情：**用 iframe 实现了比 Proxy 沙箱更完美的 JS 隔离，同时解决了 iframe 所有的传统痛点。**

Wujie 的设计哲学是：把 iframe 当作一个隐藏的 JS 执行沙箱，而不是一个可见的渲染容器。子应用的 DOM 不渲染在 iframe 内部，而是通过 Web Components 投射到主应用的真实文档流中。这个看似简单的思路转换，彻底改变了 iframe 的工程价值。

本章将从源码层面深入剖析 Wujie 的架构设计。你会看到它如何将浏览器原生的 iframe 隔离能力、Web Components 的渲染能力和 Proxy 的劫持能力三者融合，打造出一个兼顾隔离性与用户体验的微前端方案。

## 13.1 为什么 iframe 又回来了

### 13.1.1 Proxy 沙箱的天花板

第 4 章我们深入分析了乾坤的 Proxy 沙箱机制。它聪明、优雅，但有一个无法回避的根本性限制：**Proxy 只能拦截通过代理对象访问的属性，无法拦截对原始 window 对象的直接访问。**

```typescript
// 乾坤 Proxy 沙箱的核心逻辑（简化版）
function createProxySandbox(appName: string) {
  const fakeWindow = Object.create(null);
  const proxy = new Proxy(fakeWindow, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const value = (window as any)[prop];
      return typeof value === 'function' ? value.bind(window) : value;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  return proxy;
}

// 问题场景一：eval 中的代码直接访问真实 window
eval('window.globalVar = 123'); // 沙箱无法拦截

// 问题场景二：第三方库内部直接写 window.xxx = yyy
// 沙箱只能通过改写 script 的执行上下文来"尽力"拦截

// 问题场景三：with + Proxy 的 Symbol.unscopables 逃逸
```

这些并非理论上的边界情况。在实际生产环境中，大量第三方库（地图 SDK、富文本编辑器、监控 SDK）都会直接操作 `window` 对象。乾坤为此做了大量的补丁和兼容处理，但本质上是一场**无尽的打地鼠游戏**。

```typescript
// Proxy 沙箱在实践中遇到的典型问题清单
interface ProxySandboxIssues {
  // 逃逸问题
  evalEscape: '通过 eval/new Function 执行的代码可能逃逸沙箱';
  scriptTagEscape: '动态创建的 script 标签默认在全局作用域执行';
  iframeEscape: '子应用如果自己创建 iframe，其中的代码完全不受沙箱管控';

  // 兼容问题
  thirdPartySDK: '高德地图、百度统计等 SDK 直接操作 window';
  webWorkerContext: 'Worker 线程不受主线程 Proxy 沙箱影响';
  cssVarLeak: 'CSS 变量通过 :root 设置，影响全局文档';

  // 性能问题
  frequentAccess: '高频属性访问（如动画帧中的 requestAnimationFrame）经过 Proxy 有可测量的开销';
  memoryLeak: '沙箱卸载时如果清理不彻底，闭包引用导致内存泄漏';
}
```

### 13.1.2 iframe 的天然优势被重新审视

与 Proxy 沙箱的"模拟隔离"相比，iframe 提供的是**浏览器级别的原生隔离**：

```typescript
const iframe = document.createElement('iframe');
document.body.appendChild(iframe);
const iframeWindow = iframe.contentWindow!;

// 完全独立的全局对象
console.log(iframeWindow.window === window);   // false
console.log(iframeWindow.document === document); // false

// 完全独立的 JS 执行上下文
iframeWindow.eval('var x = 1');
console.log(typeof x); // "undefined" —— 主应用完全不受影响

// 完全独立的原型链
console.log(iframeWindow.Array === Array);   // false
console.log(iframeWindow.Object === Object); // false
```

iframe 的隔离不是"尽力而为"，而是"铜墙铁壁"。这是 V8 引擎层面的上下文隔离——同一个浏览器进程中，不同的 iframe 拥有完全独立的 JavaScript 执行环境、独立的全局对象。无论子应用的代码多么"放肆"，都不可能污染主应用。

### 13.1.3 传统 iframe 的四大缺陷与 Wujie 的破局

既然 iframe 隔离这么好，为什么之前被抛弃了？因为传统用法下的四个致命缺陷：**路由状态丢失**（刷新后 iframe src 回到初始值）、**弹窗无法居中**（Modal 只能在 iframe 可视区域内定位）、**性能开销**（每个 iframe 约 10-20MB 内存）、**通信原始**（只能通过 postMessage 传递可序列化数据）。

Wujie 的核心洞察可以用一句话概括：**iframe 的问题不在于隔离——而在于渲染。把 iframe 的渲染职责剥离出来，只保留它的隔离能力，一切问题都迎刃而解。**

```typescript
// 传统 iframe：既负责 JS 隔离，也负责 DOM 渲染
// ┌─────────────────────────┐
// │  主应用                   │
// │  ┌───────────────────┐  │
// │  │  iframe            │  │  ← 渲染被困在 iframe 内部
// │  │  子应用 DOM + JS    │  │
// │  └───────────────────┘  │
// └─────────────────────────┘

// Wujie：iframe 只负责 JS 隔离，DOM 通过 WebComponent 渲染
// ┌─────────────────────────┐
// │  主应用                   │
// │  ┌───────────────────┐  │
// │  │  WebComponent      │  │  ← 子应用 DOM 在这里渲染
// │  │  (Shadow DOM)      │  │
// │  └───────────────────┘  │
// │  [hidden iframe]        │  ← JS 在这里执行（用户看不到）
// └─────────────────────────┘
```

> 🔥 **深度洞察：技术的"第二次机会"**
>
> iframe 的回归是技术演进中一个有趣的现象：**被宣判死亡的技术，往往不是技术本身有问题，而是当时的使用方式有问题。** jQuery 的核心思想至今影响着所有 DOM 操作库。XML 在配置文件领域依然繁荣。iframe 也是如此——当我们换一种方式使用它，只取隔离之长、避渲染之短，它就从"最差方案"变成了"接近完美的方案"。这提醒我们：在评估一项技术时，要区分"技术的固有属性"和"使用方式的局限性"。

## 13.2 Wujie 的架构：WebComponent + iframe + Proxy

### 13.2.1 架构总览

Wujie 的架构由三个核心层组成，每一层都有明确的职责：

```typescript
interface WujieArchitecture {
  // 第一层：渲染层 —— Web Component + Shadow DOM
  renderLayer: {
    role: '承载子应用的 DOM 渲染';
    technology: 'Custom Element + Shadow DOM';
    benefit: '子应用 DOM 在主应用文档流中，弹窗/滚动行为正常';
  };
  // 第二层：执行层 —— 隐藏 iframe
  executionLayer: {
    role: '子应用 JS 代码的执行沙箱';
    technology: '隐藏的 iframe (src = 同域空白页)';
    benefit: '浏览器级别的完美 JS 隔离';
  };
  // 第三层：桥接层 —— Proxy 劫持
  bridgeLayer: {
    role: '将 iframe 中的 JS 操作桥接到主应用的 DOM';
    technology: 'Proxy 劫持 iframe 的 document、location、history';
    benefit: 'JS 在 iframe 中执行，但操作的是 Shadow DOM 里的 DOM 节点';
  };
}
```

三层协作的核心数据流：子应用 JS 在 iframe 中调用 `document.querySelector('#app')` → Proxy 拦截 document 访问并重定向到 Shadow DOM → Shadow DOM 中的真实 DOM 被操作 → 浏览器渲染 → 用户在主应用页面中看到子应用内容。

### 13.2.2 隐藏 iframe 的创建

Wujie 创建 iframe 的方式非常讲究：

```typescript
// Wujie 源码分析：创建隐藏的 iframe 沙箱
// 文件路径：src/iframe.ts
function createIframeSandbox(
  appName: string,
  url: string,
  mainHostPath: string
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  const attrsMaps: Record<string, string> = {
    // 关键：src 指向主应用的同域空白页，而不是 about:blank
    // 因为同域才能自由通信，才能访问 contentWindow
    src: mainHostPath,
    style: 'display:none',
    name: appName,
  };
  Object.keys(attrsMaps).forEach((key) => {
    iframe.setAttribute(key, attrsMaps[key]);
  });
  document.body.appendChild(iframe);
  return iframe;
}
```

两个关键设计决策：**第一，iframe 是 `display:none` 的**——它永远不可见，唯一作用是提供独立的 JS 执行上下文。**第二，iframe 的 src 指向主应用的同域页面**——如果 iframe 跨域，主应用将无法访问 `contentWindow`，整个 Proxy 桥接方案就崩塌了。

```typescript
// 同域 vs 跨域的区别
iframe.src = '/empty.html'; // 同域
iframe.contentWindow; // ✅ 可以访问，可以注入代码

iframe.src = 'https://other-domain.com'; // 跨域
iframe.contentWindow; // ❌ SecurityError
```

### 13.2.3 Web Component 渲染容器

Wujie 使用 Custom Element 和 Shadow DOM 作为子应用的渲染容器：

```typescript
// Wujie 源码分析：Web Component 的定义
// 文件路径：src/shadow.ts
class WujieApp extends HTMLElement {
  connectedCallback() {
    // open 模式允许外部通过 element.shadowRoot 访问，调试友好
    const shadowRoot = this.attachShadow({ mode: 'open' });
    // Shadow DOM 内的 CSS 天然隔离
    // 子应用的样式不泄漏到主应用，主应用的样式不侵入子应用
  }
}

if (!customElements.get('wujie-app')) {
  customElements.define('wujie-app', WujieApp);
}

// 最终的 DOM 结构
// <wujie-app data-app-name="order-app">
//   #shadow-root (open)
//     <html>
//       <head><style>...子应用的样式...</style></head>
//       <body>...子应用的 DOM...</body>
//     </html>
// </wujie-app>
```

Shadow DOM 提供 CSS 隔离，与 iframe 的 JS 隔离形成互补。同时 Shadow DOM 在主应用文档流中，子应用的弹窗可以用 `position: fixed` 相对于浏览器视口定位，滚动行为也与主应用一致。

### 13.2.4 Proxy 桥接：让 JS 和 DOM "跨界"协作

Wujie 最精妙的设计在桥接层。子应用的 JS 在 iframe 中执行，但需要操作 Shadow DOM 中的 DOM 节点。Proxy 正是这座桥梁：

```typescript
// Wujie 源码分析：Proxy 劫持 iframe 的 document
// 文件路径：src/proxy.ts
function patchDocumentEffect(
  iframeWindow: Window,
  shadowRoot: ShadowRoot
): void {
  const iframeDocument = iframeWindow.document;

  // 劫持 querySelector —— 查询重定向到 Shadow DOM
  Object.defineProperty(iframeDocument, 'querySelector', {
    get() {
      return function(selector: string) {
        return shadowRoot.querySelector(selector);
      };
    },
  });

  // 劫持 querySelectorAll
  Object.defineProperty(iframeDocument, 'querySelectorAll', {
    get() {
      return function(selector: string) {
        return shadowRoot.querySelectorAll(selector);
      };
    },
  });

  // 劫持 getElementById
  Object.defineProperty(iframeDocument, 'getElementById', {
    get() {
      return function(id: string) {
        return shadowRoot.querySelector(`#${id}`);
      };
    },
  });

  // 劫持 document.head 和 document.body
  Object.defineProperty(iframeDocument, 'head', {
    get: () => shadowRoot.querySelector('head') as HTMLHeadElement,
  });
  Object.defineProperty(iframeDocument, 'body', {
    get: () => shadowRoot.querySelector('body') as HTMLBodyElement,
  });
  Object.defineProperty(iframeDocument, 'documentElement', {
    get: () => shadowRoot.firstElementChild as HTMLHtmlElement,
  });
}
```

效果是：子应用执行 `document.getElementById('app')` 时，实际查的是 Shadow DOM 中的 `#app` 元素。子应用对此完全无感——它认为自己在操作一个正常的 `document`，但所有 DOM 操作都被透明地重定向到了主应用文档流中的 Shadow DOM。

```typescript
// 桥接效果的完整示意
// 子应用代码（在 iframe 中执行）：

// 1. DOM 查询 —— 查的是 Shadow DOM
const app = document.getElementById('app');

// 2. DOM 修改 —— 改的是 Shadow DOM 中的节点
app.innerHTML = '<h1>Hello from Sub App</h1>';

// 3. DOM 追加 —— 追加到 Shadow DOM 的 body
const newDiv = document.createElement('div');
newDiv.textContent = '动态创建的元素';
document.body.appendChild(newDiv);

// 4. 事件绑定 —— 绑定在 Shadow DOM 中的元素上
document.querySelector('.btn')?.addEventListener('click', () => {
  console.log('按钮被点击');
});

// 用户看到的效果：
// 所有内容出现在主应用页面中，而不是隐藏的 iframe 里
// 子应用的代码完全不知道自己被"偷梁换柱"了
```

### 13.2.5 location 与 history 的劫持

路由同步是传统 iframe 方案的最大痛点。Wujie 通过劫持 iframe 的 `location` 和 `history` 对象来解决：

```typescript
// Wujie 源码分析：location 劫持
function patchLocationEffect(iframeWindow: Window, appUrl: string): void {
  const proxyLocation = new Proxy({} as Location, {
    get(target, prop: keyof Location) {
      // 读取 location 属性时，返回子应用的真实 URL 信息
      // 而不是 iframe 的同域空白页地址 '/empty.html'
      if (prop === 'href') return appUrl;
      if (prop === 'origin') return new URL(appUrl).origin;
      if (prop === 'pathname') return new URL(appUrl).pathname;
      if (prop === 'search') return new URL(appUrl).search;
      if (prop === 'hash') return new URL(appUrl).hash;

      if (prop === 'replace' || prop === 'assign') {
        return (url: string) => {
          updateAppUrl(url);
          syncToMainRouter(url);
        };
      }
      return iframeWindow.location[prop];
    },
    set(target, prop, value) {
      if (prop === 'href') {
        updateAppUrl(value as string);
        syncToMainRouter(value as string);
        return true;
      }
      return false;
    },
  });

  Object.defineProperty(iframeWindow, '__WUJIE_LOCATION__', {
    get: () => proxyLocation,
  });
}

// history 劫持
function patchHistoryEffect(iframeWindow: Window, appName: string): void {
  const rawPushState = iframeWindow.history.pushState.bind(iframeWindow.history);
  const rawReplaceState = iframeWindow.history.replaceState.bind(iframeWindow.history);

  iframeWindow.history.pushState = function(state: any, title: string, url?: string | null) {
    const absoluteUrl = resolveUrl(url, appName);
    syncMainAppUrl(appName, absoluteUrl);  // 同步到主应用 URL
    rawPushState(state, title, url);       // 保持 iframe 内部 history 栈正确
    dispatchRouteChangeEvent(appName, absoluteUrl);
  };

  iframeWindow.history.replaceState = function(state: any, title: string, url?: string | null) {
    const absoluteUrl = resolveUrl(url, appName);
    syncMainAppUrl(appName, absoluteUrl);
    rawReplaceState(state, title, url);
  };

  // 浏览器前进/后退按钮同步
  iframeWindow.addEventListener('popstate', () => {
    syncMainAppUrl(appName, iframeWindow.location.href);
  });
}
```

通过这一系列劫持，子应用调用 `router.push('/detail/123')` 时，内部触发的 `history.pushState` 被 Wujie 拦截，主应用 URL 同步更新，用户刷新页面后可以恢复子应用路由状态。浏览器前进/后退按钮也正常工作。

### 13.2.6 createElement 与 appendChild 的分流

子应用动态创建资源时（`<script>`、`<style>`、`<link>` 标签），Wujie 需要将它们分流到正确的层：

```typescript
// 资源分流的核心逻辑
function patchAppendChild(iframeWindow: Window, shadowRoot: ShadowRoot): void {
  const rawHeadAppendChild = iframeWindow.document.head.appendChild
    .bind(iframeWindow.document.head);

  iframeWindow.document.head.appendChild = function<T extends Node>(node: T): T {
    const element = node as unknown as HTMLElement;

    if (element.tagName === 'SCRIPT') {
      // JS 资源：留在 iframe 中执行，保持 JS 隔离
      return rawHeadAppendChild(node);
    }

    if (element.tagName === 'STYLE' || element.tagName === 'LINK') {
      // CSS 资源：注入到 Shadow DOM 的 head，保持 CSS 在渲染层生效
      const shadowHead = shadowRoot.querySelector('head');
      if (shadowHead) shadowHead.appendChild(node);
      return node;
    }

    return rawHeadAppendChild(node);
  };
}

// 分流规则：
// <script> → iframe（JS 隔离层）
// <style>/<link> → Shadow DOM（渲染层）
// 其他 DOM 操作 → Shadow DOM（渲染层）
```

### 13.2.7 降级模式（Degrade Mode）

当子应用与主应用跨域时，Wujie 无法访问 iframe 的 `contentWindow`，Proxy 桥接方案失效。Wujie 为此提供了降级模式：

```typescript
// Wujie 源码分析：降级模式
function shouldDegrade(appUrl: string): boolean {
  const mainOrigin = window.location.origin;
  const appOrigin = new URL(appUrl).origin;
  return mainOrigin !== appOrigin;
}

class WujieSandbox {
  degrade: boolean;

  constructor(options: WujieSandboxOptions) {
    this.degrade = options.degrade ?? shouldDegrade(options.url);

    if (this.degrade) {
      // 降级模式：使用传统的可见 iframe
      // 丧失弹窗居中等体验优化，但保持基本隔离
      this.createVisibleIframe(options.url);
    } else {
      // 正常模式：隐藏 iframe + Shadow DOM + Proxy 桥接
      this.createHiddenIframe(options.url);
      this.createShadowRoot(options.name);
      this.setupProxyBridge();
    }
  }
}
```

正常模式与降级模式的能力对比：

| 特性 | 正常模式 | 降级模式 |
|------|---------|---------|
| JS 隔离 | 完美（iframe 原生） | 完美（iframe 原生） |
| CSS 隔离 | 完美（Shadow DOM） | 完美（iframe 原生） |
| 弹窗居中 | 相对视口居中 | 只在 iframe 内居中 |
| 路由同步 | 完整同步 | 需要 postMessage |
| 通信 | 直接访问 | 仅 postMessage |

> 🔥 **深度洞察：架构设计中的"降级思维"**
>
> Wujie 的降级模式体现了一个重要的架构设计原则：**不要为 100% 的完美而牺牲 100% 的可用性。** 很多开源框架追求架构的纯粹性——如果核心假设不成立就直接报错。Wujie 选择了更务实的路径：正常模式提供最佳体验，降级模式保证基本可用。你的系统不需要在所有条件下都完美——它需要在最优条件下出色，在最差条件下可用。

## 13.3 iframe 通信的现代方案：MessageChannel、BroadcastChannel

### 13.3.1 postMessage 的局限性

传统 iframe 通信依赖 `window.postMessage`，在微前端场景下有明显痛点：

```typescript
// postMessage 的痛点
// 1. 广播式通信：所有 message 监听器都会收到，需手动过滤
// 2. 无类型安全：event.data 是 any 类型
// 3. 无法建立点对点通道：需在消息体中加 target 字段做路由
// 4. 安全隐患：origin 校验不严格容易被利用

window.addEventListener('message', (event) => {
  if (event.origin !== 'https://main-app.example.com') return;
  const { target, type, payload } = event.data;
  if (target !== 'order-app') return; // 手动过滤，不够优雅
  // 处理消息...
});
```

### 13.3.2 MessageChannel：点对点的私有通道

`MessageChannel` 创建一对关联的端口，只有持有端口的双方才能通信：

```typescript
// MessageChannel 基于此构建子应用通信管理器
class MicroAppChannelManager {
  private channels = new Map<string, MessageChannel>();
  private handlers = new Map<string, Map<string, Function>>();

  createChannel(appName: string): MessagePort {
    const channel = new MessageChannel();
    this.channels.set(appName, channel);

    channel.port1.onmessage = (event: MessageEvent) => {
      this.dispatch(appName, event.data);
    };
    channel.port1.start();
    channel.port2.start();
    return channel.port2; // 传递给子应用
  }

  // 通过 postMessage 的 transfer 参数传递端口给 iframe
  transferToIframe(appName: string, iframe: HTMLIFrameElement): void {
    const channel = this.channels.get(appName);
    if (!channel) return;
    // MessagePort 是 Transferable 对象，传递后主应用失去 port2 访问权
    iframe.contentWindow!.postMessage(
      { type: '__WUJIE_PORT_INIT__', appName },
      '*',
      [channel.port2]
    );
  }

  send(appName: string, message: any): void {
    this.channels.get(appName)?.port1.postMessage(message);
  }

  on(appName: string, type: string, handler: Function): void {
    if (!this.handlers.has(appName)) this.handlers.set(appName, new Map());
    this.handlers.get(appName)!.set(type, handler);
  }

  private dispatch(appName: string, data: any): void {
    this.handlers.get(appName)?.get(data.type)?.(data.payload);
  }
}
```

### 13.3.3 BroadcastChannel：一对多的发布-订阅

当需要一条消息通知所有子应用时（用户登出、主题切换），`BroadcastChannel` 是更好的选择：

```typescript
// 同名 channel 的所有实例都能互相通信
// 主应用
const bc = new BroadcastChannel('micro-fe-bus');
bc.postMessage({ type: 'THEME_CHANGE', payload: { theme: 'dark' } });

// 子应用 A（iframe 中）
const bcA = new BroadcastChannel('micro-fe-bus');
bcA.onmessage = (event) => {
  if (event.data.type === 'THEME_CHANGE') applyTheme(event.data.payload.theme);
};

// BroadcastChannel 特点：
// 1. 同源限制：只有同源页面才能通信
// 2. 自动广播：所有订阅者都会收到
// 3. 跨标签页：甚至可以跨浏览器标签页通信
```

在微前端场景中，完整的通信方案通常组合使用三种机制：

```typescript
// 分层通信策略
class MicroFeBus {
  private channelManager: MicroAppChannelManager;
  private broadcastChannel: BroadcastChannel;
  private eventHandlers = new Map<string, Set<Function>>();

  constructor(namespace: string = 'wujie-bus') {
    this.channelManager = new MicroAppChannelManager();
    this.broadcastChannel = new BroadcastChannel(namespace);
    this.broadcastChannel.onmessage = (event: MessageEvent) => {
      this.emit(event.data.type, event.data.payload);
    };
  }

  sendTo(appName: string, type: string, payload: any): void {
    this.channelManager.send(appName, { type, payload });
  }

  broadcast(type: string, payload: any): void {
    this.broadcastChannel.postMessage({ type, payload });
  }

  on(type: string, handler: Function): () => void {
    if (!this.eventHandlers.has(type)) this.eventHandlers.set(type, new Set());
    this.eventHandlers.get(type)!.add(handler);
    return () => { this.eventHandlers.get(type)?.delete(handler); };
  }

  private emit(type: string, payload: any): void {
    this.eventHandlers.get(type)?.forEach((handler) => handler(payload));
  }
}
```

### 13.3.4 Wujie 正常模式的通信优势

在 Wujie 的正常模式下（非降级），通信比上面的方案更直接。因为 iframe 与主应用同域，主应用可以直接访问 `contentWindow`：

```typescript
// 直接访问——不需要序列化，可以传递函数
const iframeWindow = iframe.contentWindow!;
iframeWindow.__WUJIE_DATA__ = {
  user: { id: 123, name: '杨艺韬' },
  theme: 'dark',
  // postMessage 做不到的：传递函数引用
  showGlobalModal: (config: ModalConfig) => {
    mainApp.modal.show(config);
  },
};

// Wujie 在此基础上构建了结构化的事件总线
class EventBus {
  private events = new Map<string, Set<Function>>();

  $emit(event: string, ...args: any[]): void {
    this.events.get(event)?.forEach((handler) => {
      try { handler(...args); } catch (e) { console.error(e); }
    });
  }

  $on(event: string, handler: Function): void {
    if (!this.events.has(event)) this.events.set(event, new Set());
    this.events.get(event)!.add(handler);
  }

  $off(event: string, handler?: Function): void {
    if (!handler) { this.events.delete(event); return; }
    this.events.get(event)?.delete(handler);
  }

  $once(event: string, handler: Function): void {
    const wrapper = (...args: any[]) => { handler(...args); this.$off(event, wrapper); };
    this.$on(event, wrapper);
  }
}

// 全局事件总线，主应用和所有子应用共享同一个实例
const bus = new EventBus();
bus.$on('order:created', (orderId: string) => {
  bus.$emit('cart:refresh');
});
```

> 🔥 **深度洞察：通信方案的选择不在于"最新"，而在于"最匹配"**
>
> MessageChannel 和 BroadcastChannel 是较新的 API，但不意味着它们在所有场景下都优于 postMessage。在 Wujie 正常模式下，直接的对象引用传递比任何消息通道都高效——没有序列化开销、支持函数传递、同步执行。只有在降级模式（跨域）下，才需要回退到 MessageChannel/postMessage。**选择通信方案的首要原则不是技术的新旧，而是约束条件允许什么。**

## 13.4 iframe 的性能优化：预加载、资源共享

### 13.4.1 iframe 的性能瓶颈分析

即使在 Wujie 的架构下，iframe 依然有不可忽视的性能开销。我们可以将其分为三个层面：

```typescript
interface IframePerformanceCost {
  // 第一层：创建开销
  creation: {
    contextInit: '每个 iframe 初始化独立 V8 上下文（~2-5ms）';
    documentParsing: '空白页的 document 也需要解析和构建（~1ms）';
    memoryBaseline: '独立上下文的基线内存占用（~10-20MB）';
  };

  // 第二层：资源加载开销
  resourceLoading: {
    htmlFetch: '获取子应用的 HTML 入口文件';
    cssFetch: '获取并解析子应用的所有 CSS';
    jsFetch: '获取并执行子应用的所有 JS';
    duplicateResources: '多个子应用可能重复加载 React、Vue 等公共依赖';
  };

  // 第三层：运行时开销
  runtime: {
    proxyOverhead: 'Proxy 劫持在高频 DOM 操作下的微小延迟';
    domBridge: 'DOM 操作从 iframe 桥接到 Shadow DOM 的额外开销';
    eventDispatch: '事件在 Shadow DOM 边界上的传播处理';
  };
}
```

理解了开销的来源，我们才能对症下药。

### 13.4.2 预加载：空闲时间的利用

Wujie 利用 `requestIdleCallback` 在浏览器空闲时提前创建子应用的 iframe 和加载资源：

```typescript
// Wujie 源码分析：预加载机制
interface PreloadConfig {
  name: string;
  url: string;
  exec?: boolean; // 是否预执行 JS（默认仅预加载资源）
}

function preloadApp(configs: PreloadConfig[]): void {
  const requestIdle = window.requestIdleCallback || ((cb: Function) => setTimeout(cb, 1));

  requestIdle(() => {
    configs.forEach(async (config) => {
      const { name, url, exec = false } = config;

      // 第一步：预加载 HTML 并解析资源链接
      const html = await fetchAppHtml(url);
      const { scripts, styles } = parseHtml(html);

      // 第二步：并行预加载所有 JS 和 CSS，存入缓存
      await Promise.all([
        ...styles.map((u) => fetchResource(u).then((css) => cacheStore.set(`css:${u}`, css))),
        ...scripts.map((u) => fetchResource(u).then((js) => cacheStore.set(`js:${u}`, js))),
      ]);

      // 第三步：如果配置了 exec，预创建 iframe 并执行 JS
      if (exec) {
        const sandbox = new WujieSandbox({ name, url });
        await sandbox.execScripts(scripts);
        sandboxCache.set(name, sandbox); // 缓存沙箱实例
      }
    });
  });
}

// 基于路由的智能预加载策略
function smartPreload(currentRoute: string): void {
  const preloadMap: Record<string, PreloadConfig[]> = {
    '/': [
      { name: 'product-app', url: '/product/', exec: true },
      { name: 'order-app', url: '/order/' },
    ],
    '/product': [
      { name: 'order-app', url: '/order/', exec: true },
      { name: 'cart-app', url: '/cart/' },
    ],
  };
  const configs = preloadMap[currentRoute];
  if (configs) preloadApp(configs);
}
```

`requestIdleCallback` 确保预加载在浏览器一帧的空闲时间中执行，不影响当前页面的交互性能：

```
// 浏览器的一帧（16.67ms @ 60fps）
// ┌─────────────────────────────────────────────────┐
// │ Input │ JS │ Layout │ Paint │ Composite │ Idle  │
// │ events│    │        │       │           │ Time  │
// └─────────────────────────────────────────────────┘
//                                             ↑
//                                    requestIdleCallback
//                                    在这里执行预加载
//
// 如果主要任务提前完成，剩余的空闲时间用于预加载
// 如果这一帧很忙，预加载推迟到下一帧的空闲时间
// 预加载永远不会阻塞用户交互
```

### 13.4.3 资源共享与缓存

多个子应用加载相同公共依赖（React、Vue 等）时，资源缓存可以避免重复请求：

```typescript
class ResourceCache {
  private cache = new Map<string, string>();
  private fetchingPromises = new Map<string, Promise<string>>();

  async get(url: string): Promise<string> {
    if (this.cache.has(url)) return this.cache.get(url)!;

    // 请求去重：同一资源被多个子应用同时请求，只发一次网络请求
    if (this.fetchingPromises.has(url)) return this.fetchingPromises.get(url)!;

    const promise = fetch(url).then((res) => res.text()).then((content) => {
      this.cache.set(url, content);
      this.fetchingPromises.delete(url);
      return content;
    });
    this.fetchingPromises.set(url, promise);
    return promise;
  }
}
```

更进一步，可以将主应用已加载的公共库直接注入到子应用的 iframe 中：

```typescript
// 公共依赖共享：避免子应用重复加载
function injectSharedDeps(iframeWindow: Window): void {
  const sharedLibs = ['React', 'ReactDOM', 'dayjs', 'lodash'];
  sharedLibs.forEach((name) => {
    const lib = (window as any)[name];
    if (lib) (iframeWindow as any)[name] = lib;
  });
}

// 注意事项：
// 1. 共享的库必须版本兼容
// 2. 有状态的框架（React、Vue）共享需要谨慎——上下文可能冲突
// 3. 建议优先共享纯函数式的工具库（lodash、dayjs 等）
```

### 13.4.4 保活模式（Keep-Alive）

对于频繁切换的子应用，Wujie 的保活模式保留完整状态，避免每次切换都重新初始化：

```typescript
class WujieSandbox {
  alive: boolean;

  mount(container: HTMLElement): void {
    if (this.alive && this.isInitialized) {
      // 保活模式：子应用已初始化过
      // 只需将 Web Component 重新插入容器，无需重建 iframe / 重执行 JS
      container.appendChild(this.getHostElement());
      this.execLifecycle('activated');
      return;
    }
    // 首次挂载：完整初始化
    this.initSandbox();
    this.loadResources();
    this.execScripts();
  }

  unmount(): void {
    if (this.alive) {
      // 保活模式：不销毁，只从 DOM 移除 Web Component
      this.getHostElement().remove();
      this.execLifecycle('deactivated');
      return;
    }
    // 非保活：完全销毁
    this.destroySandbox();
  }
}

// 性能收益：
// 切换时间：非保活 500-2000ms → 保活 10-50ms
// 用户状态：非保活丢失 → 保活完整保留（表单、滚动位置等）
// 代价：内存持续占用（以空间换时间）
// 适用：高频切换的核心子应用，如标签页模式
```

### 13.4.5 与其他新一代方案的对比

Wujie 并非唯一重新审视 iframe 的方案。2022-2025 年间，社区涌现了多个相关方案：

| 方案 | 核心机制 | JS 隔离 | 渲染位置 | 独特之处 |
|------|---------|---------|---------|---------|
| **Wujie（腾讯）** | WebComponent + 隐藏 iframe + Proxy | iframe 原生 | Shadow DOM | 唯一真正用 iframe 做 JS 隔离的方案 |
| **micro-app（京东）** | WebComponent + Proxy 沙箱 | Proxy 模拟 | Shadow DOM | API 更简洁，类 Web Component 使用方式 |
| **Garfish（字节）** | Proxy 沙箱 + HTML Entry | Proxy 模拟 | DOM 直接挂载 | 企业级方案，插件生态丰富 |

关键差异：Wujie 是唯一一个用"真正的 iframe"做 JS 隔离的方案。micro-app 和 Garfish 虽然也用了 WebComponent 或类似技术，但 JS 隔离仍依赖 Proxy 沙箱。这意味着 Wujie 在 JS 隔离的完整性上有先天优势——代价是子应用必须能配置为同域，否则降级。

```typescript
// 选择建议
function chooseScheme(scenario: {
  isolationRequirement: 'strict' | 'moderate' | 'loose';
  crossOrigin: boolean;
  teamSize: 'small' | 'medium' | 'large';
  existingStack: string;
}): string {
  const { isolationRequirement, crossOrigin, teamSize } = scenario;

  if (isolationRequirement === 'strict' && !crossOrigin) {
    return 'Wujie —— 需要完美隔离且可以配置同域';
  }

  if (isolationRequirement === 'moderate' && teamSize === 'large') {
    return 'Garfish —— 企业级方案，插件生态丰富';
  }

  if (teamSize === 'small') {
    return 'micro-app —— API 简洁，上手成本低';
  }

  return '根据具体约束条件综合评估';
}
```

> 🔥 **深度洞察：技术选型中的"不可能三角"**
>
> 微前端方案面临一个类似于 CAP 定理的"不可能三角"：**完美隔离、极致性能、开发体验——三者很难同时达到最优。** iframe 方案（Wujie）选择了完美隔离，在性能和开发体验上做了妥协；Module Federation 选择了极致性能和 DX，在隔离上做了妥协；Proxy 沙箱方案（乾坤）试图三者兼顾，结果是三者都达到了"够用"但没有"极致"。理解这个三角关系，比记住任何一个方案的 API 都重要——它帮助你在面对新方案时快速判断其取舍。

## 本章小结

- iframe 的"复兴"不是技术的倒退，而是**使用方式的进化**：将 iframe 从渲染容器降格为 JS 执行沙箱，保留其完美隔离的天然优势，规避其体验缺陷
- Wujie 的三层架构——WebComponent（渲染）+ iframe（执行）+ Proxy（桥接）——是一个精妙的职责分离设计：每一层只做自己最擅长的事
- Proxy 劫持的核心对象：`document`（DOM 操作重定向到 Shadow DOM）、`location`（URL 映射到子应用真实地址）、`history`（路由同步到主应用）、`createElement/appendChild`（资源分流）
- 降级模式是务实的架构设计：正常模式最佳体验，跨域场景退回可见 iframe 保证基本可用
- iframe 通信三种方案各有适用场景：直接引用（同域最优）、MessageChannel（点对点）、BroadcastChannel（一对多广播）
- 性能优化三板斧：预加载（requestIdleCallback + 智能预测）、资源缓存（去重 + 共享）、保活模式（以空间换时间）

---

## 思考题

1. **架构理解**：Wujie 将 iframe 用作隐藏的 JS 执行沙箱，而非可见的渲染容器。这种"职责分离"的设计思想，在其他技术领域是否有类似的案例？请举例分析。

2. **源码分析**：Wujie 的 Proxy 桥接层需要劫持 iframe 的 `document` 上的大量属性和方法。请思考：有哪些 DOM API 是难以完美劫持的？它们可能导致什么兼容性问题？

3. **方案对比**：在第 4 章我们分析了乾坤的 Proxy 沙箱，在本章我们分析了 Wujie 的 iframe 沙箱。请从隔离完整性、性能开销、兼容性、开发体验四个维度，系统对比这两种隔离方案。

4. **性能优化**：假设你的微前端应用有 8 个子应用，用户在一次会话中平均访问其中 3 个。请设计一个预加载策略，在保证首屏性能的前提下，最大化后续子应用的切换速度。

5. **开放讨论**：随着浏览器对 Web Components、Import Maps、Shadow DOM 的支持越来越完善，你认为 Wujie 这种"曲线救国"的方案会长期存在，还是会被更原生的方案取代？

</div>
