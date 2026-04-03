<div v-pre>

# 第3章 乾坤架构总览

> "好的框架不是让你什么都能做——而是让你在做对的事情时毫不费力，做错的事情时寸步难行。"

> **本章要点**
> - 理解乾坤的三大设计哲学：HTML Entry、沙箱隔离、标准化生命周期
> - 掌握乾坤的核心依赖关系：qiankun → single-spa → import-html-entry 的三层架构
> - 通过源码走读完整理解子应用从注册到卸载的全生命周期
> - 深入分析 registerMicroApps、loadApp、start 三大核心函数的实现
> - 客观评估乾坤在 2026 年微前端生态中的真实地位与适用场景

---

2019 年 7 月，蚂蚁集团前端团队在 GitHub 上发布了一个名为 qiankun（乾坤）的开源项目。彼时 single-spa 已经是微前端领域的事实标准，但它有一个让无数开发者头疼的问题：**太底层了**。single-spa 只负责子应用的注册和生命周期调度，至于子应用怎么加载、JS 怎么隔离、CSS 怎么隔离——全部由你自己解决。

这就像给你一个操作系统内核，告诉你"进程调度做好了，至于内存管理、文件系统、网络协议栈——自己写吧。"

乾坤的回答是：**我来封装这一切。**

它在 single-spa 的生命周期调度之上，增加了 HTML Entry（通过 import-html-entry 实现子应用加载）、JS 沙箱（Proxy/Snapshot 双模式）、CSS 隔离（Shadow DOM/Scoped CSS）三大核心能力，把微前端从"理论上可行"变成了"开箱即用"。

截至 2026 年初，乾坤在 GitHub 上累计超过 16k star，npm 周下载量仍然稳定在 20k+。它不是最新的，也不是最"酷"的——但它是被最多生产环境验证过的微前端方案。在我们深入任何源码细节之前，先建立对它的全局架构认知，就像在徒步穿越一片森林之前，先在山顶看一眼全貌。

## 3.1 乾坤的设计哲学

乾坤的设计哲学可以浓缩为三个关键词：**HTML Entry**、**沙箱**、**生命周期**。这三者分别解决了微前端的三个核心问题：怎么加载子应用、怎么隔离子应用、怎么管理子应用。

### 3.1.1 HTML Entry：像使用 iframe 一样简单

在 single-spa 中，注册一个子应用需要你手动提供一个 JS Entry——一个 JavaScript 文件的 URL，single-spa 通过动态创建 `<script>` 标签来加载它。这意味着你需要：

1. 确保子应用的构建产物是一个 UMD 模块
2. 手动管理子应用的 CSS 加载
3. 处理子应用内部的静态资源路径问题
4. 解决子应用多个 JS chunk 的加载顺序

```typescript
// single-spa 的 JS Entry 模式——繁琐且易错
import { registerApplication } from 'single-spa';

registerApplication({
  name: 'app-order',
  // 你需要自己保证这个 JS 文件能正确导出生命周期
  app: () => System.import('http://localhost:7100/app.js'),
  activeWhen: '/order',
});

// 子应用必须是 UMD 格式
// CSS？自己加载。
// 图片路径？自己处理。
// 多个 chunk？自己编排。
```

乾坤的 HTML Entry 彻底改变了这个局面。它的思路极其朴素——既然子应用本身就是一个完整的 Web 应用，有自己的 HTML 入口页面，**为什么不直接获取这个 HTML，从中解析出 JS 和 CSS 资源？**

```typescript
// 乾坤的 HTML Entry 模式——简洁直观
import { registerMicroApps } from 'qiankun';

registerMicroApps([
  {
    name: 'app-order',
    // 直接给子应用的 URL，就像在浏览器地址栏输入一样
    entry: '//localhost:7100',
    container: '#micro-app-container',
    activeRule: '/order',
  },
]);
```

这个设计的精妙之处在于：**子应用完全不需要为接入微前端做任何构建配置上的妥协**。它的 HTML 文件里引用了什么 JS、什么 CSS、什么字体文件——乾坤全部自动解析、自动加载。子应用可以继续作为独立应用运行，也可以作为微前端子应用被加载。

HTML Entry 的底层实现依赖 `import-html-entry` 这个库，它的核心逻辑我们将在 3.2 节详细分析。这里先建立一个直觉：

```typescript
// import-html-entry 的核心能力（简化）
interface HtmlEntryResult {
  // 子应用的 HTML 模板（移除了 script 标签）
  template: string;
  // 一个函数：执行所有提取出的 JS 脚本，返回子应用导出的生命周期
  execScripts: () => Promise<{
    bootstrap: () => Promise<void>;
    mount: (props: any) => Promise<void>;
    unmount: (props: any) => Promise<void>;
  }>;
  // 用于获取外部样式表的内容
  getExternalStyleSheets: () => Promise<string[]>;
  // 用于获取外部脚本的内容
  getExternalScripts: () => Promise<string[]>;
}
```

> 💡 **深度洞察**：HTML Entry 的设计思想本质上是"逆向 iframe"。iframe 直接加载整个页面但无法与主应用深度通信；HTML Entry 解析页面但在主应用的上下文中执行代码——它取了 iframe 的便利性（给一个 URL 就够了），又避免了 iframe 的隔离过度问题（无法共享登录态、路由、DOM 通信）。这个设计决策奠定了乾坤"简单接入"的核心竞争力。

### 3.1.2 沙箱：隔离是微前端的生命线

如果说 HTML Entry 解决了"怎么加载"，沙箱则解决了一个更根本的问题：**多个子应用同时运行时，如何防止它们互相污染？**

JavaScript 的全局变量是所有微前端方案的噩梦。一个子应用在 `window` 上挂了一个 `__APP_CONFIG__`，另一个子应用也挂了同名属性——后者悄无声息地覆盖了前者。更隐蔽的是定时器：子应用 A 设了一个 `setInterval`，卸载时忘了清理，这个定时器就像幽灵一样在后台持续运行，污染后续加载的子应用。

乾坤为此设计了三种沙箱机制：

```typescript
// 乾坤的三种沙箱模式
type SandboxType =
  | 'LegacyProxy'    // 单例 Proxy 沙箱（兼容模式）
  | 'ProxySandbox'   // 多例 Proxy 沙箱（推荐）
  | 'SnapshotSandbox'; // 快照沙箱（降级方案，兼容 IE）

// Proxy 沙箱的核心思想
class ProxySandbox {
  private updatedValueSet = new Set<PropertyKey>();
  private fakeWindow: Record<PropertyKey, any>;
  private running = false;

  proxy: WindowProxy;

  constructor() {
    const rawWindow = window;
    // 创建一个假的 window 对象
    this.fakeWindow = Object.create(null);

    this.proxy = new Proxy(this.fakeWindow, {
      get: (target, prop) => {
        // 优先从 fakeWindow 获取（子应用设置的变量）
        if (target.hasOwnProperty(prop)) {
          return target[prop];
        }
        // 否则从真实 window 获取（原生 API）
        const value = rawWindow[prop as any];
        // 如果是函数，绑定到真实 window（如 setTimeout）
        return typeof value === 'function' ? value.bind(rawWindow) : value;
      },

      set: (target, prop, value) => {
        if (this.running) {
          target[prop] = value;
          this.updatedValueSet.add(prop);
        }
        return true;
      },
    });
  }

  active() {
    this.running = true;
  }

  inactive() {
    this.running = false;
  }
}
```

这段代码展示了 Proxy 沙箱的核心思想：**每个子应用看到的 `window` 其实是一个代理对象。** 子应用往 `window` 上写属性，实际写入的是 fakeWindow；读属性时先查 fakeWindow，找不到再查真实 window。这样多个子应用可以同时运行，各自拥有独立的"全局变量空间"，互不干扰。

快照沙箱（SnapshotSandbox）则是面向不支持 Proxy 的旧浏览器的降级方案：

```typescript
// 快照沙箱的简化实现
class SnapshotSandbox {
  private windowSnapshot: Map<string, any> = new Map();
  private modifyPropsMap: Map<string, any> = new Map();

  active() {
    // 激活时，拍下 window 的快照
    for (const prop in window) {
      this.windowSnapshot.set(prop, (window as any)[prop]);
    }
    // 恢复上次子应用运行时的修改
    this.modifyPropsMap.forEach((value, prop) => {
      (window as any)[prop] = value;
    });
  }

  inactive() {
    // 失活时，记录子应用的修改，然后恢复 window
    for (const prop in window) {
      if ((window as any)[prop] !== this.windowSnapshot.get(prop)) {
        // 记录修改
        this.modifyPropsMap.set(prop, (window as any)[prop]);
        // 恢复原值
        (window as any)[prop] = this.windowSnapshot.get(prop);
      }
    }
  }
}
```

> 💡 **深度洞察**：快照沙箱有一个致命限制——它是**单例**的。因为它直接操作真实的 window 对象，同一时刻只能有一个子应用处于激活状态。而 Proxy 沙箱通过虚拟 window 实现了**多例**隔离，可以同时运行多个子应用。这就是为什么乾坤文档中建议在需要多个子应用同时展示的场景下使用 Proxy 沙箱。理解这个区别，能帮你避开生产环境中最常见的沙箱配置陷阱。

### 3.1.3 生命周期：子应用的生老病死

微前端中的子应用不是"加载一次就完事"的静态资源——它有完整的生命周期。乾坤（通过 single-spa）定义了三个核心生命周期钩子：

```typescript
// 子应用必须导出的三个生命周期函数
export async function bootstrap(): Promise<void> {
  // 初始化：只在子应用第一次加载时调用一次
  // 适合做一次性的初始化工作，如加载 polyfill
  console.log('[order-app] bootstrapped');
}

export async function mount(props: MicroAppProps): Promise<void> {
  // 挂载：每次子应用被激活时调用
  // 在这里创建根组件、渲染 DOM
  const { container } = props;
  ReactDOM.createRoot(
    container.querySelector('#root')!
  ).render(<App />);
}

export async function unmount(props: MicroAppProps): Promise<void> {
  // 卸载：每次子应用被切走时调用
  // 在这里销毁根组件、清理副作用
  const { container } = props;
  ReactDOM.createRoot(
    container.querySelector('#root')!
  ).unmount();
}
```

这三个钩子看起来简单，但它们的调用时机和语义是整个微前端协调的基础。乾坤在 single-spa 的基础上增强了这些生命周期：

```typescript
// 乾坤增强的生命周期钩子（框架侧，非子应用侧）
interface FrameworkLifeCycles {
  beforeLoad?: (app: RegistrableApp) => Promise<void>;   // 加载前
  beforeMount?: (app: RegistrableApp) => Promise<void>;  // 挂载前
  afterMount?: (app: RegistrableApp) => Promise<void>;   // 挂载后
  beforeUnmount?: (app: RegistrableApp) => Promise<void>; // 卸载前
  afterUnmount?: (app: RegistrableApp) => Promise<void>;  // 卸载后
}

// 使用示例
registerMicroApps(apps, {
  beforeLoad: async (app) => {
    console.log(`[主应用] ${app.name} 即将加载...`);
    // 可以在这里做权限校验、加载提示等
  },
  afterMount: async (app) => {
    console.log(`[主应用] ${app.name} 已挂载`);
    // 可以在这里做埋点、性能监控等
  },
});
```

这三个设计哲学——HTML Entry、沙箱、生命周期——构成了乾坤的三根支柱。接下来我们俯瞰乾坤的依赖架构，理解这三根支柱是如何在代码层面组织起来的。

## 3.2 核心依赖关系：qiankun → single-spa → import-html-entry

### 3.2.1 三层架构

乾坤的代码架构可以用一张依赖图概括：

```
┌─────────────────────────────────────────────────────┐
│                    qiankun (乾坤)                     │
│                                                       │
│  ┌─────────────────┐  ┌────────────┐  ┌───────────┐ │
│  │  JS/CSS 沙箱     │  │  HTML Entry │  │  全局状态  │ │
│  │  (Proxy/Snapshot)│  │   适配层    │  │  通信管理  │ │
│  └────────┬────────┘  └─────┬──────┘  └───────────┘ │
│           │                 │                         │
├───────────┼─────────────────┼─────────────────────────┤
│           │       single-spa│                         │
│           │   ┌─────────────┴────────────┐            │
│           │   │  应用注册 / 路由匹配      │            │
│           │   │  生命周期调度              │            │
│           │   │  状态机管理                │            │
│           │   └──────────────────────────┘            │
├───────────┼───────────────────────────────────────────┤
│           │       import-html-entry                    │
│           │   ┌──────────────────────────┐            │
│           │   │  HTML 获取与解析          │            │
│           │   │  Script/Style 资源提取    │            │
│           │   │  JS 执行（with 沙箱）     │            │
│           │   └──────────────────────────┘            │
└───────────┴───────────────────────────────────────────┘
```

每一层的职责非常清晰：

- **import-html-entry**（底层）：负责获取子应用的 HTML，从中提取 JS 和 CSS 资源，并提供在沙箱环境中执行 JS 的能力
- **single-spa**（中层）：负责子应用的注册、路由监听、生命周期状态机管理——它决定**何时**加载、挂载、卸载子应用
- **qiankun**（上层）：在前两者之上，添加了沙箱隔离、预加载、全局状态管理、错误处理等生产级能力

### 3.2.2 single-spa：生命周期的调度中枢

single-spa 是整个微前端生命周期调度的核心。它维护了一个应用状态机，定义了子应用从注册到卸载的完整状态流转：

```typescript
// single-spa 的应用状态枚举
enum AppStatus {
  NOT_LOADED = 'NOT_LOADED',             // 已注册，未加载
  LOADING_SOURCE_CODE = 'LOADING_SOURCE_CODE', // 正在加载代码
  NOT_BOOTSTRAPPED = 'NOT_BOOTSTRAPPED', // 已加载，未初始化
  BOOTSTRAPPING = 'BOOTSTRAPPING',        // 正在初始化
  NOT_MOUNTED = 'NOT_MOUNTED',           // 已初始化，未挂载
  MOUNTING = 'MOUNTING',                  // 正在挂载
  MOUNTED = 'MOUNTED',                    // 已挂载（可见）
  UNMOUNTING = 'UNMOUNTING',              // 正在卸载
  UNLOADING = 'UNLOADING',               // 正在卸载资源
  LOAD_ERROR = 'LOAD_ERROR',             // 加载失败
  SKIP_BECAUSE_BROKEN = 'SKIP_BECAUSE_BROKEN', // 致命错误，跳过
}

// 状态流转：
// NOT_LOADED → LOADING_SOURCE_CODE → NOT_BOOTSTRAPPED
//   → BOOTSTRAPPING → NOT_MOUNTED
//     → MOUNTING → MOUNTED
//       → UNMOUNTING → NOT_MOUNTED（可重新挂载）
//     → UNLOADING → NOT_LOADED（完全卸载，需重新加载）
```

single-spa 的路由监听机制是子应用自动切换的基础：

```typescript
// single-spa 路由监听的核心实现（简化）
function setupRouteListening() {
  // 拦截 pushState 和 replaceState
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    // 路由变化后，重新评估哪些子应用应该被激活
    reroute();
    return result;
  };

  window.history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    reroute();
    return result;
  };

  // 监听 popstate 事件（浏览器前进/后退）
  window.addEventListener('popstate', () => {
    reroute();
  });

  // 监听 hashchange 事件（hash 路由模式）
  window.addEventListener('hashchange', () => {
    reroute();
  });
}

// reroute：微前端调度的心脏
function reroute() {
  const {
    appsToLoad,    // 需要加载的应用
    appsToMount,   // 需要挂载的应用
    appsToUnmount, // 需要卸载的应用
  } = getAppChanges(); // 根据当前 URL 和 activeWhen 计算

  // 先卸载不再需要的应用
  const unmountPromises = appsToUnmount.map(toUnmountPromise);
  // 加载需要的应用
  const loadPromises = appsToLoad.map(toLoadPromise);

  return Promise.all(unmountPromises).then(() => {
    // 卸载完成后，挂载新的应用
    const mountPromises = appsToMount.map(toMountPromise);
    return Promise.all([...loadPromises, ...mountPromises]);
  });
}
```

> 💡 **深度洞察**：single-spa 的 `reroute` 函数是整个微前端调度的"心跳"。每次路由变化都会触发一次 reroute，它负责计算哪些应用需要卸载、哪些需要加载、哪些需要挂载。这个设计有一个精妙之处：**卸载一定在挂载之前完成**（通过 Promise 链保证）。这避免了新旧子应用同时存在时的资源竞争问题。但这也意味着应用切换不可能是"无缝"的——新应用挂载之前，旧应用一定已经从 DOM 中消失。

### 3.2.3 import-html-entry：HTML 的拆解与执行

import-html-entry 是乾坤"HTML Entry"能力的底层实现。它做了三件事：

```typescript
// import-html-entry 的核心流程
import { importEntry } from 'import-html-entry';

// 第一步：获取 HTML 并解析
const {
  template,            // 处理后的 HTML 模板（script 标签被移除）
  execScripts,         // 执行所有提取出的 JS
  getExternalStyleSheets, // 获取外部 CSS 内容
  getExternalScripts,  // 获取外部 JS 内容
} = await importEntry('//localhost:7100');

// 第二步：将模板插入容器
document.querySelector('#container')!.innerHTML = template;

// 第三步：在沙箱中执行 JS，获取子应用的生命周期导出
const appExports = await execScripts(
  sandboxProxy,  // 沙箱的 proxy 对象作为全局上下文
  true           // 是否使用严格沙箱
);
```

`importEntry` 内部的 HTML 解析过程是这样的：

```typescript
// import-html-entry 的 HTML 解析（简化源码）
function processTpl(tpl: string, baseUrl: string) {
  const scripts: ScriptInfo[] = [];
  const styles: StyleInfo[] = [];

  // 用正则匹配所有 <script> 标签
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(tpl)) !== null) {
    const scriptTag = match[0];
    const srcMatch = scriptTag.match(/src=["']([^"']+)["']/);

    if (srcMatch) {
      // 外部脚本
      scripts.push({
        src: new URL(srcMatch[1], baseUrl).href,
        async: scriptTag.includes('async'),
      });
    } else {
      // 内联脚本
      scripts.push({
        content: match[1],
      });
    }
  }

  // 用正则匹配所有 <link rel="stylesheet"> 标签
  const styleRegex = /<link[^>]*rel=["']stylesheet["'][^>]*>/gi;
  while ((match = styleRegex.exec(tpl)) !== null) {
    const hrefMatch = match[0].match(/href=["']([^"']+)["']/);
    if (hrefMatch) {
      styles.push({
        href: new URL(hrefMatch[1], baseUrl).href,
      });
    }
  }

  // 从 HTML 中移除 script 标签，保留其余结构
  const template = tpl
    .replace(scriptRegex, '<!-- script removed by import-html-entry -->')
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi,
             '<!-- stylesheet replaced by import-html-entry -->');

  return { template, scripts, styles };
}
```

特别值得关注的是 `execScripts` 的实现——它是乾坤沙箱能力的基石：

```typescript
// execScripts 的核心：在指定的全局上下文中执行 JS
function execScripts(
  proxy: WindowProxy,
  strictGlobal: boolean,
  scripts: ScriptInfo[]
): Promise<any> {
  return scripts.reduce((chain, script) => {
    return chain.then(() => {
      const code = script.content || fetchedScriptContent;

      if (strictGlobal) {
        // 严格沙箱模式：使用 (0, eval) + with 语句
        // 将子应用的全局变量访问重定向到 proxy
        const wrappedCode = `
          ;(function(window, self, globalThis) {
            with(window) {
              ${code}
            }
          }).bind(window.proxy)(window.proxy, window.proxy, window.proxy);
        `;
        (0, eval)(wrappedCode);
      } else {
        // 非严格模式：直接 eval
        (0, eval)(code);
      }

      // 获取子应用的导出（通常挂在 window 上）
      return proxy[getGlobalAppName()] || {};
    });
  }, Promise.resolve());
}
```

这里的 `(0, eval)` 是一个经典的 JavaScript 技巧——它是间接 eval 调用，确保代码在全局作用域中执行，而不是在当前函数的闭包作用域中执行。配合 `with(window)` 语句，子应用代码中所有对全局变量的无限定访问（如 `document`、`setTimeout`）都会先在 proxy 对象上查找。

## 3.3 注册 → 加载 → 挂载 → 卸载：完整生命周期源码走读

现在我们已经理解了乾坤的三层架构和各自的职责。接下来，我们将沿着一个子应用从注册到卸载的完整生命路径，逐步走读乾坤的核心源码。

### 3.3.1 第一步：registerMicroApps——应用注册

一切的起点是 `registerMicroApps`。这是开发者接触乾坤的第一个 API：

```typescript
// 开发者这样调用
import { registerMicroApps, start } from 'qiankun';

registerMicroApps([
  {
    name: 'app-order',
    entry: '//localhost:7100',
    container: '#micro-app-container',
    activeRule: '/order',
    props: { authToken: 'xxx' },
  },
  {
    name: 'app-product',
    entry: '//localhost:7200',
    container: '#micro-app-container',
    activeRule: '/product',
  },
]);

start();
```

我们来看 `registerMicroApps` 的源码实现：

```typescript
// qiankun/src/apis.ts（简化源码）
let microApps: RegistrableApp[] = [];

function registerMicroApps(
  apps: RegistrableApp[],
  lifeCycles?: FrameworkLifeCycles
) {
  // 过滤掉已经注册过的应用（通过 name 去重）
  const unregisteredApps = apps.filter(
    (app) => !microApps.some((registeredApp) => registeredApp.name === app.name)
  );

  microApps = [...microApps, ...unregisteredApps];

  // 将每个应用注册到 single-spa
  unregisteredApps.forEach((app) => {
    const { name, activeRule, loader, props, ...appConfig } = app;

    registerApplication({
      name,
      // 关键：这里不是直接给 JS URL
      // 而是给一个返回 Promise<LifeCycles> 的函数
      app: async () => {
        // loader 是加载状态回调，可用于显示 loading
        loader?.(true);
        await frameworkStartedDefer.promise; // 等待 start() 被调用

        // loadApp 是乾坤的核心——负责加载子应用并返回生命周期
        const {
          mount,
          unmount,
          bootstrap,
          update,
        } = (await loadApp(
          { name, props, ...appConfig },
          frameworkConfiguration,
          lifeCycles
        ))();

        return {
          bootstrap,
          mount: [
            async () => loader?.(true),
            ...toArray(beforeMount),
            mount,
            ...toArray(afterMount),
            async () => loader?.(false),
          ],
          unmount: [
            async () => loader?.(true),
            ...toArray(beforeUnmount),
            unmount,
            ...toArray(afterUnmount),
            async () => loader?.(false),
          ],
          update,
        };
      },
      // activeWhen 决定何时激活这个子应用
      activeWhen: activeRule,
      customProps: props,
    });
  });
}
```

这段代码有几个关键细节值得注意：

**第一，延迟加载。** `app` 参数不是立即执行的，而是一个返回 Promise 的函数。single-spa 只在路由匹配时才会调用这个函数。这意味着注册 100 个子应用不会产生任何网络请求——只有用户真正访问某个路由时，对应的子应用才开始加载。

**第二，生命周期组合。** 乾坤在 single-spa 的 mount/unmount 基础上，通过数组组合的方式插入了 beforeMount、afterMount 等钩子。single-spa 支持将生命周期定义为函数数组，会按顺序依次执行。这是一种经典的**中间件模式**。

**第三，`frameworkStartedDefer`。** 这是一个延迟 Promise，确保 `loadApp` 不会在 `start()` 调用之前执行。这给了开发者一个初始化的时间窗口——你可以在 `registerMicroApps` 和 `start` 之间做一些准备工作（如获取全局配置）。

### 3.3.2 第二步：loadApp——应用加载

`loadApp` 是乾坤最核心、最复杂的函数。它负责：加载子应用的 HTML 和资源、创建沙箱、设置 CSS 隔离、包装生命周期钩子。

```typescript
// qiankun/src/loader.ts（简化源码，保留核心流程）
export async function loadApp(
  app: LoadableApp,
  configuration: FrameworkConfiguration,
  lifeCycles?: FrameworkLifeCycles
): Promise<ParcelConfigObjectGetter> {
  const { entry, name, container } = app;
  const {
    sandbox = true,
    singular = true,
    scopedCSS = false,
    excludeAssetFilter,
  } = configuration;

  // ========== 第一阶段：加载 HTML 并解析资源 ==========
  const {
    template,
    execScripts,
    getExternalStyleSheets,
    getExternalScripts,
  } = await importEntry(entry, {
    fetch: customFetch || window.fetch,
    getPublicPath: (entry) => entry,
    getTemplate: (tpl) => tpl,
  });

  // 等待当前正在运行的子应用完全卸载（单例模式下）
  if (singular) {
    await (prevAppUnmountedDeferred && prevAppUnmountedDeferred.promise);
  }

  // 处理 HTML 模板
  const appContent = getDefaultTplWrapper(name)(template);
  // 创建一个包裹元素
  const appWrapperElement = createElement(appContent, {
    strictStyleIsolation: configuration.strictStyleIsolation,
    scopedCSS,
    appName: name,
  });

  // ========== 第二阶段：创建沙箱 ==========
  let sandboxContainer: SandboxContainer | undefined;
  let global: WindowProxy = window;

  if (sandbox) {
    sandboxContainer = createSandboxContainer(
      name,
      // 获取挂载容器的函数
      () => getAppWrapperGetter(name, appWrapperElement, container)(),
      {
        scopedCSS,
        speedySandbox: configuration.speedySandbox,
        experimentalStyleIsolation: configuration.experimentalStyleIsolation,
        excludeAssetFilter,
      }
    );
    // 从沙箱获取代理的全局对象
    global = sandboxContainer.instance.proxy as WindowProxy;

    // 挂载沙箱的全局状态补丁
    // 包括：劫持 addEventListener、setTimeout、setInterval 等
    mountSandbox = sandboxContainer.mount;
    unmountSandbox = sandboxContainer.unmount;
  }

  // ========== 第三阶段：在沙箱中执行子应用 JS ==========
  // execScripts 会在 global（沙箱代理）环境中执行子应用的 JS
  const scriptExports: any = await execScripts(
    global,
    sandbox && !useLooseSandbox
  );

  // 获取子应用导出的生命周期
  const {
    bootstrap: appBootstrap,
    mount: appMount,
    unmount: appUnmount,
    update: appUpdate,
  } = getLifecyclesFromExports(
    scriptExports,
    name,
    global,
    sandboxContainer?.instance?.latestSetProp
  );

  // 验证生命周期是否存在
  validateExportLifecycle(appBootstrap, appMount, appUnmount);

  // ========== 第四阶段：包装生命周期并返回 ==========
  const parcelConfigGetter: ParcelConfigObjectGetter = () => {
    let appWrapperGetter: () => HTMLElement;

    return {
      name,

      bootstrap: [
        appBootstrap,
      ],

      mount: [
        // 1. 激活沙箱
        async () => {
          // 确保子应用容器在 DOM 中
          appWrapperGetter = getAppWrapperGetter(
            name,
            appWrapperElement,
            container
          );
        },
        // 2. 挂载沙箱（劫持全局 API）
        mountSandbox,
        // 3. 调用子应用的 mount
        async (props: any) => appMount({ ...props, container: appWrapperGetter() }),
      ],

      unmount: [
        // 1. 调用子应用的 unmount
        async (props: any) => appUnmount({ ...props, container: appWrapperGetter() }),
        // 2. 卸载沙箱（恢复全局 API）
        unmountSandbox,
        // 3. 清理 DOM
        async () => {
          render({ element: null, loading: true }, container);
        },
      ],
    };
  };

  return parcelConfigGetter;
}
```

这个函数的代码量虽大，但逻辑非常清晰——四个阶段依次执行：

1. **加载 HTML**：通过 import-html-entry 获取并解析子应用的 HTML
2. **创建沙箱**：根据配置创建 Proxy 或 Snapshot 沙箱
3. **执行 JS**：在沙箱环境中执行子应用的 JavaScript 代码
4. **包装生命周期**：将沙箱的激活/恢复逻辑编织进 mount/unmount 钩子

> 💡 **深度洞察**：`loadApp` 返回的不是生命周期对象本身，而是一个**工厂函数**（`ParcelConfigObjectGetter`）。这个设计允许乾坤在同一个子应用被多次加载时（如在不同的容器中作为 Parcel 加载），每次都创建独立的沙箱实例和 DOM 容器。这个"工厂模式"的选择看似微小，实则是支撑乾坤 `loadMicroApp` 手动加载能力的关键架构决策。

### 3.3.3 第三步：start——启动框架

注册完子应用后，需要调用 `start()` 来启动乾坤：

```typescript
// qiankun/src/apis.ts（简化源码）
let frameworkStarted = false;
const frameworkStartedDefer = new Deferred<void>();

export function start(opts: FrameworkConfiguration = {}) {
  // 保存框架配置
  frameworkConfiguration = {
    prefetch: true,
    singular: true,
    sandbox: true,
    ...opts,
  };

  // 预加载策略
  const {
    prefetch,
    sandbox,
    singular,
    urlRerouteOnly = defaultUrlRerouteOnly,
    ...importEntryOpts
  } = frameworkConfiguration;

  // 根据 prefetch 配置执行预加载
  if (prefetch) {
    doPrefetchStrategy(microApps, prefetch, importEntryOpts);
  }

  // 根据沙箱配置决定是否使用 loose 模式
  // 在不支持 Proxy 的环境中自动降级
  frameworkConfiguration = autoDowngradeForLowVersionBrowser(frameworkConfiguration);

  // 启动 single-spa
  startSingleSpa({ urlRerouteOnly });

  frameworkStarted = true;
  // 解锁 frameworkStartedDefer，允许 loadApp 执行
  frameworkStartedDefer.resolve();
}
```

`start` 做了三件事：

**第一，预加载。** 默认开启。乾坤会在主应用空闲时（通过 `requestIdleCallback`），提前加载其他子应用的 HTML 和 JS 资源。这样当用户真正切换到某个子应用时，资源已经在缓存中，加载速度大幅提升。

```typescript
// 预加载策略的实现（简化）
function doPrefetchStrategy(
  apps: RegistrableApp[],
  prefetchStrategy: PrefetchStrategy,
  importEntryOpts: ImportEntryOpts
) {
  // 默认策略：首个子应用挂载后，空闲时预加载其余子应用
  if (prefetchStrategy === true) {
    // 监听 single-spa 的首次 mount 事件
    const firstMountLogic = () => {
      const notMountedApps = apps.filter(
        (app) => getAppStatus(app.name) === 'NOT_MOUNTED'
      );

      // 在浏览器空闲时预加载
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
          notMountedApps.forEach(({ entry }) => {
            // 预获取 HTML 和 JS（不执行）
            importEntry(entry, importEntryOpts);
          });
        });
      }
    };

    // single-spa 提供的全局事件
    window.addEventListener('single-spa:first-mount', firstMountLogic);
  }
}
```

**第二，沙箱降级检测。** 在不支持 Proxy 的浏览器中，自动切换到 SnapshotSandbox。

**第三，启动 single-spa。** 调用 single-spa 的 `start` 函数，开始监听路由变化并触发子应用的生命周期。

### 3.3.4 第四步：挂载与卸载——运行时的协调

当用户从 `/order` 导航到 `/product`，以下是完整的事件序列：

```
用户点击导航链接
  ↓
history.pushState('/product')
  ↓
single-spa 拦截到路由变化
  ↓
reroute() 被调用
  ↓
计算 app 变更：
  - appsToUnmount: ['app-order']  (当前路由不再匹配)
  - appsToMount:   ['app-product'] (当前路由匹配)
  ↓
执行卸载序列（app-order）：
  1. beforeUnmount 钩子（乾坤）
  2. app-order.unmount()（子应用清理 DOM）
  3. 沙箱 inactive()（恢复全局变量）
  4. afterUnmount 钩子（乾坤）
  5. 清理容器 DOM
  ↓
执行挂载序列（app-product）：
  1. 如果是首次加载：
     a. loadApp()（获取 HTML、创建沙箱、执行 JS）
     b. app-product.bootstrap()（一次性初始化）
  2. 准备容器 DOM
  3. 沙箱 active()（激活隔离）
  4. beforeMount 钩子（乾坤）
  5. app-product.mount()（子应用渲染）
  6. afterMount 钩子（乾坤）
  ↓
用户看到商品页面
```

让我们用一个完整的序列图来更精确地展示这个过程：

```typescript
// 完整的挂载流程伪代码（综合 qiankun + single-spa）
async function performAppSwitch(
  appsToUnmount: AppConfig[],
  appsToMount: AppConfig[]
) {
  // Phase 1: 卸载旧应用
  await Promise.all(
    appsToUnmount.map(async (app) => {
      // single-spa 调用 unmount 数组中的每个函数
      for (const fn of app.unmount) {
        await fn(getCustomProps(app));
      }
      // 更新状态机
      app.status = AppStatus.NOT_MOUNTED;
    })
  );

  // Phase 2: 加载并挂载新应用
  await Promise.all(
    appsToMount.map(async (app) => {
      // 如果尚未加载，先加载
      if (app.status === AppStatus.NOT_LOADED) {
        app.status = AppStatus.LOADING_SOURCE_CODE;
        // 调用注册时提供的 app() 函数
        // 在乾坤中，这会触发 loadApp
        const lifecycles = await app.loadApp();
        app.bootstrap = lifecycles.bootstrap;
        app.mount = lifecycles.mount;
        app.unmount = lifecycles.unmount;
        app.status = AppStatus.NOT_BOOTSTRAPPED;
      }

      // 如果尚未 bootstrap，先 bootstrap
      if (app.status === AppStatus.NOT_BOOTSTRAPPED) {
        app.status = AppStatus.BOOTSTRAPPING;
        for (const fn of toArray(app.bootstrap)) {
          await fn(getCustomProps(app));
        }
        app.status = AppStatus.NOT_MOUNTED;
      }

      // 执行挂载
      app.status = AppStatus.MOUNTING;
      for (const fn of toArray(app.mount)) {
        await fn(getCustomProps(app));
      }
      app.status = AppStatus.MOUNTED;
    })
  );
}
```

这里有一个容易被忽视的细节：**bootstrap 只执行一次**。当用户从 `/order` 切到 `/product`，再切回 `/order` 时，`app-order` 的 bootstrap 不会再次执行——因为它的状态是 `NOT_MOUNTED` 而非 `NOT_BOOTSTRAPPED`。这意味着 bootstrap 中的初始化逻辑（如加载 polyfill、建立 WebSocket 连接）只会运行一次，后续的挂载只会调用 mount。

### 3.3.5 createSandboxContainer：沙箱的创建与管理

在 `loadApp` 中，`createSandboxContainer` 负责创建沙箱实例。我们来看它的详细实现：

```typescript
// qiankun/src/sandbox/index.ts（简化源码）
export function createSandboxContainer(
  appName: string,
  elementGetter: () => HTMLElement | ShadowRoot,
  scopedCSS: boolean,
  useLooseSandbox: boolean,
  excludeAssetFilter?: (url: string) => boolean,
  globalContext?: typeof window
) {
  let sandbox: SandboxInstance;

  if (window.Proxy) {
    sandbox = useLooseSandbox
      ? new LegacySandbox(appName, globalContext)     // 单例 Proxy 沙箱
      : new ProxySandbox(appName, globalContext);     // 多例 Proxy 沙箱
  } else {
    sandbox = new SnapshotSandbox(appName);           // 快照沙箱
  }

  // 副作用补丁——劫持全局 API
  const bootstrappingFreers: Free[] = [];
  const mountingFreers: Free[] = [];
  let sideEffectsRebuilders: Rebuilder[] = [];

  return {
    instance: sandbox,

    async mount() {
      // 激活沙箱
      sandbox.active();

      // 应用副作用补丁
      const sideEffectsRebuildersAtBootstrapping = sideEffectsRebuilders.slice();
      const sideEffectsRebuildersAtMounting = sideEffectsRebuildersAtBootstrapping.length
        ? sideEffectsRebuildersAtBootstrapping
        : [];

      // 恢复上次挂载时记录的副作用
      sideEffectsRebuildersAtMounting.forEach((rebuild) => rebuild());

      // 应用全局 API 补丁
      mountingFreers.push(
        ...patchAtMounting(
          appName,
          elementGetter,
          sandbox,
          scopedCSS,
          excludeAssetFilter
        )
      );
    },

    async unmount() {
      // 记录当前副作用，以便下次挂载时恢复
      sideEffectsRebuilders = mountingFreers.map((free) => free());
      mountingFreers.length = 0;

      // 失活沙箱
      sandbox.inactive();
    },
  };
}
```

`patchAtMounting` 是沙箱体系中最"脏"但最重要的部分——它劫持了一系列全局 API，确保子应用产生的副作用能被正确追踪和清理：

```typescript
// qiankun/src/sandbox/patchers/index.ts（简化）
function patchAtMounting(
  appName: string,
  elementGetter: () => HTMLElement | ShadowRoot,
  sandbox: SandboxInstance,
  scopedCSS: boolean,
  excludeAssetFilter?: Function
): Free[] {
  const freers: Free[] = [];

  // 1. 劫持定时器：确保子应用卸载时清理所有 setInterval/setTimeout
  freers.push(patchTimer());

  // 2. 劫持事件监听：确保子应用卸载时移除所有 addEventListener
  freers.push(patchWindowListener());

  // 3. 劫持动态样式：子应用动态创建的 <style>/<link> 标签需要被管理
  freers.push(patchDynamicAppend(
    appName,
    elementGetter,
    sandbox,
    scopedCSS,
    excludeAssetFilter
  ));

  // 4. 劫持 History API（可选）
  freers.push(patchHistoryListener());

  return freers;
}

// 定时器劫持的实现
function patchTimer(): Free {
  const rawSetInterval = window.setInterval;
  const rawClearInterval = window.clearInterval;
  const rawSetTimeout = window.setTimeout;
  const rawClearTimeout = window.clearTimeout;

  const intervalIds: number[] = [];
  const timeoutIds: number[] = [];

  // 替换全局定时器函数
  window.setInterval = (...args: any[]) => {
    const id = rawSetInterval(...args);
    intervalIds.push(id);
    return id;
  };

  window.setTimeout = (...args: any[]) => {
    const id = rawSetTimeout(...args);
    timeoutIds.push(id);
    return id;
  };

  // 返回清理函数
  return function free() {
    // 恢复原始定时器函数
    window.setInterval = rawSetInterval;
    window.clearInterval = rawClearInterval;
    window.setTimeout = rawSetTimeout;
    window.clearTimeout = rawClearTimeout;

    // 清理所有未清除的定时器
    intervalIds.forEach((id) => rawClearInterval(id));
    timeoutIds.forEach((id) => rawClearTimeout(id));

    // 返回一个 rebuilder，用于下次挂载时恢复副作用
    return function rebuild() {
      // 重新应用补丁
    };
  };
}
```

> 💡 **深度洞察**：乾坤沙箱的副作用管理采用了"记录-清理-重建"三步策略。卸载时，`free()` 函数清理副作用并返回一个 `rebuild()` 函数；下次挂载时，`rebuild()` 恢复之前的副作用状态。这意味着子应用在多次挂载/卸载之间可以保持"有状态"——比如子应用在第一次挂载时添加了一个全局事件监听器，卸载后这个监听器会被移除，但当子应用再次挂载时，监听器会被自动恢复。这是乾坤对 single-spa 的一个关键增强，也是生产环境中子应用能正确"恢复运行"的基础。

### 3.3.6 getLifecyclesFromExports：如何找到子应用的生命周期

子应用的 JS 在沙箱中执行后，乾坤需要从执行结果中提取生命周期函数。这个过程比想象中复杂：

```typescript
// qiankun/src/loader.ts（简化）
function getLifecyclesFromExports(
  scriptExports: any,
  appName: string,
  global: WindowProxy,
  globalLatestSetProp?: PropertyKey | null
) {
  // 策略一：子应用直接导出了生命周期
  if (validateExportLifecycle(scriptExports)) {
    return scriptExports;
  }

  // 策略二：子应用将生命周期挂载到 window[appName] 上
  // 这在 UMD 模式下很常见
  if (global[appName]) {
    return global[appName];
  }

  // 策略三：通过沙箱记录的最后一次 window 属性设置来推断
  // 有些子应用打包为 UMD，会将模块挂到 window 上
  // 沙箱会记录最后一次 set 操作的 key
  if (globalLatestSetProp) {
    const lifecycles = global[globalLatestSetProp];
    if (validateExportLifecycle(lifecycles)) {
      return lifecycles;
    }
  }

  // 策略四：遍历沙箱中所有被设置的属性
  // 寻找第一个包含合法生命周期导出的属性
  const { updatedValueSet } = global.__sandbox_instance__;
  for (const key of updatedValueSet) {
    const value = global[key];
    if (validateExportLifecycle(value)) {
      return value;
    }
  }

  throw new QiankunError(
    `[qiankun] 在 ${appName} 的导出中找不到生命周期函数。` +
    `请确保子应用导出了 bootstrap、mount 和 unmount。`
  );
}

function validateExportLifecycle(exports: any): boolean {
  return (
    exports &&
    typeof exports.bootstrap === 'function' &&
    typeof exports.mount === 'function' &&
    typeof exports.unmount === 'function'
  );
}
```

这段代码揭示了一个重要的实践信息：**乾坤为什么要求子应用的 webpack 配置中设置 `output.library` 和 `output.libraryTarget`？** 正是为了让子应用的生命周期导出能被可靠地获取。最稳妥的方式是：

```javascript
// 子应用的 webpack 配置
module.exports = {
  output: {
    library: `${appName}-[name]`,
    libraryTarget: 'umd',
    // 或 jsonpFunction / chunkLoadingGlobal
    chunkLoadingGlobal: `webpackJsonp_${appName}`,
  },
};
```

## 3.4 乾坤在 2026 年的地位：仍是存量项目的主流选择

### 3.4.1 客观数据

截至 2026 年初，微前端领域的格局已经发生了显著变化。让我们用数据说话：

```typescript
// 2026 年初各微前端方案的市场数据（近似值）
interface FrameworkStats {
  name: string;
  githubStars: string;
  npmWeeklyDownloads: string;
  firstRelease: number;
  maintenanceStatus: 'active' | 'maintenance' | 'archived';
  typicalUseCase: string;
}

const stats: FrameworkStats[] = [
  {
    name: 'qiankun',
    githubStars: '16k+',
    npmWeeklyDownloads: '20k+',
    firstRelease: 2019,
    maintenanceStatus: 'maintenance',
    typicalUseCase: '存量项目改造、多框架并存',
  },
  {
    name: 'Module Federation',
    githubStars: '(Webpack 内置)',
    npmWeeklyDownloads: '(Webpack/Rspack 内置)',
    firstRelease: 2020,
    maintenanceStatus: 'active',
    typicalUseCase: '新项目、同构技术栈、高性能共享',
  },
  {
    name: 'micro-app',
    githubStars: '5.5k+',
    npmWeeklyDownloads: '5k+',
    firstRelease: 2021,
    maintenanceStatus: 'active',
    typicalUseCase: '追求简单接入的新项目',
  },
  {
    name: 'wujie',
    githubStars: '4k+',
    npmWeeklyDownloads: '3k+',
    firstRelease: 2022,
    maintenanceStatus: 'active',
    typicalUseCase: '需要强隔离的场景',
  },
  {
    name: 'single-spa',
    githubStars: '13k+',
    npmWeeklyDownloads: '70k+',
    firstRelease: 2016,
    maintenanceStatus: 'active',
    typicalUseCase: '底层框架、高度定制场景',
  },
];
```

几个关键观察：

1. **single-spa 的周下载量远超乾坤**——因为很多方案（包括乾坤）底层依赖它
2. **乾坤的下载量趋于平稳**——没有大幅增长，也没有大幅下降，说明存量项目仍在使用
3. **Module Federation 已经成为新项目的首选**——尤其在统一技术栈的团队中
4. **乾坤进入 maintenance 模式**——不再有大规模的新功能开发，但仍在修复关键 bug

### 3.4.2 乾坤的优势仍然存在

尽管新方案层出不穷，乾坤在以下场景中仍然是最合理的选择：

**场景一：多框架并存。** 你的主应用是 Vue 3，但有两个老的 React 15 子应用和一个 Angular 子应用。Module Federation 在这种场景下会很痛苦——它的前提是构建工具层面的协作，而不同框架的构建配置差异巨大。乾坤的 HTML Entry 不关心子应用用什么框架、什么构建工具——只要它能产出一个可以运行的 HTML 页面。

**场景二：子应用团队不可控。** 当子应用由第三方团队或外包团队开发时，你无法要求他们使用特定的构建工具版本或输出特定的模块格式。乾坤的接入成本是所有方案中最低的——子应用几乎不需要修改构建配置。

**场景三：渐进式迁移。** 一个运行了五年的单体应用，需要逐步拆分为微前端。乾坤允许你一次只拆出一个模块，不需要重构整个构建体系。

```typescript
// 渐进式迁移的典型路径
const migrationPlan = {
  phase1: {
    action: '将主应用升级为乾坤基座',
    effort: '1-2 周',
    risk: '低——只添加了 qiankun 依赖，不修改现有代码',
    code: `
      // 主应用入口只需添加几行代码
      import { registerMicroApps, start } from 'qiankun';

      registerMicroApps([
        // 暂时不注册任何子应用
      ]);

      start();
      // 现有应用完全不受影响
    `,
  },
  phase2: {
    action: '将第一个独立模块拆为子应用',
    effort: '2-4 周',
    risk: '中——需要处理模块间的耦合',
  },
  phase3: {
    action: '逐步拆分其余模块',
    effort: '按模块规模定',
    risk: '随经验积累逐步降低',
  },
};
```

### 3.4.3 乾坤的局限性也很明确

同时，我们也要诚实地面对乾坤的问题：

**局限一：性能开销。** HTML Entry 意味着每个子应用的加载都经过"获取 HTML → 解析 → 获取 JS/CSS → 执行"的完整流程。对比 Module Federation 的"直接加载 JS 模块"，这个过程多了至少 1-2 次网络请求（HTML 本身 + 可能的额外 CSS 请求）。

**局限二：沙箱的不完美。** Proxy 沙箱无法拦截所有场景。比如通过 `document.querySelector` 获取其他子应用的 DOM 元素、通过 `eval` 在沙箱外执行代码、以及某些第三方库（如 jQuery）直接操作 `window` 的行为——这些都可能突破沙箱的隔离。

```typescript
// 沙箱无法覆盖的场景示例
const sandboxLimitations = [
  {
    scenario: 'document.querySelector 越界',
    description: '子应用可以访问到主应用甚至其他子应用的 DOM',
    workaround: '使用 Shadow DOM 模式（strictStyleIsolation: true）',
  },
  {
    scenario: '第三方库的全局副作用',
    description: '如 jQuery.noConflict()、moment.locale() 等',
    workaround: '配置 excludeAssetFilter 或使用 scopedCSS',
  },
  {
    scenario: 'CSS 全局污染',
    description: '子应用的 CSS 可能影响主应用或其他子应用',
    workaround: '启用 scopedCSS 或 Shadow DOM，但两者都有兼容性代价',
  },
  {
    scenario: 'localStorage/sessionStorage 共享',
    description: '所有子应用共享同域名下的 Storage',
    workaround: '在 key 中添加子应用前缀（需手动实现）',
  },
];
```

**局限三：维护节奏放缓。** 乾坤的核心维护者已经将精力转向了新的项目。虽然社区仍在贡献 PR，但重大功能更新已经非常稀少。如果你遇到了一个核心 bug，修复可能需要自己 fork。

### 3.4.4 选型决策框架

基于以上分析，我给出一个简明的选型建议：

```typescript
// 微前端方案选型决策树
function chooseMicroFEFramework(context: ProjectContext): string {
  // 决策点 1：是否需要多框架并存？
  if (context.hasMultipleFrameworks) {
    // 多框架场景下，运行时方案是刚需
    if (context.needStrongIsolation) {
      return 'wujie';   // 需要强隔离 → iframe 增强方案
    }
    return 'qiankun';   // 乾坤仍是最成熟的多框架方案
  }

  // 决策点 2：技术栈是否统一？
  if (context.unifiedTechStack) {
    if (context.buildToolSupported) {
      return 'Module Federation';  // 统一技术栈 → 编译时共享最优
    }
  }

  // 决策点 3：是新项目还是存量改造？
  if (context.isLegacyMigration) {
    return 'qiankun';   // 存量改造 → 接入成本最低的方案
  }

  // 决策点 4：团队规模与技术能力
  if (context.teamSize < 5) {
    return '考虑是否真的需要微前端';
  }

  return 'Module Federation';  // 新项目默认推荐
}
```

> 💡 **深度洞察**：技术选型最大的陷阱不是"选错了方案"，而是"在不需要微前端的时候引入了微前端"。如果你的项目只有一个团队在维护，构建时间在可接受范围内，技术栈统一且无迁移压力——不要用微前端。一个好的 monorepo + 合理的模块划分，能解决 80% 的"看起来需要微前端"的问题。乾坤的文档里没有告诉你这一点，但我必须说——因为我见过太多团队为了"技术先进性"引入了微前端，最终花了三个月在沙箱 bug 和样式冲突上。

### 3.4.5 乾坤源码的架构启示

抛开"用不用乾坤"的实际问题，乾坤的源码本身是一个优秀的架构案例。从中我们可以提炼出几个值得学习的设计原则：

**原则一：分层抽象。** qiankun → single-spa → import-html-entry 的三层架构，每一层只关心自己的职责。single-spa 不知道也不关心子应用是通过 HTML Entry 还是 JS Entry 加载的；import-html-entry 不知道也不关心执行的 JS 会被用于什么目的。这种分层让每一层都可以独立测试、独立替换。

**原则二：约定优于配置。** 乾坤的默认配置覆盖了 90% 的场景：默认开启沙箱、默认开启预加载、默认单例模式。开发者只需要提供 name、entry、container、activeRule 四个必填项就能跑起来。高级配置留给需要的人。

**原则三：渐进增强，优雅降级。** Proxy 沙箱 → 快照沙箱的自动切换、Shadow DOM → Scoped CSS 的手动切换——乾坤总是提供一个"基本能用"的降级方案。这让它能在更广泛的浏览器环境中运行。

```typescript
// 这种"检测能力，自动降级"的模式值得在你的项目中借鉴
function createOptimalSandbox(appName: string): SandboxInstance {
  if (typeof Proxy !== 'undefined') {
    // 最佳方案
    return new ProxySandbox(appName);
  }

  console.warn(
    `[${appName}] Proxy 不可用，降级到快照沙箱。` +
    `注意：快照沙箱不支持多个子应用同时运行。`
  );
  return new SnapshotSandbox(appName);
}
```

**原则四：可组合的生命周期。** 将 mount/unmount 定义为函数数组而非单一函数，允许框架在子应用的生命周期前后插入任意逻辑（如沙箱激活、性能监控、错误捕获）。这种"洋葱模型"在 Express 中间件、Redux 中间件中都有体现——它是处理横切关注点的经典模式。

## 本章小结

- **HTML Entry** 是乾坤区别于 single-spa 的核心创新：通过获取和解析子应用的 HTML，实现了"给一个 URL 就能接入"的极简体验
- **三层依赖架构**——qiankun（沙箱+增强）→ single-spa（生命周期调度）→ import-html-entry（HTML 加载执行）——职责清晰，分层合理
- **沙箱系统**提供了 Proxy（多例）和 Snapshot（单例/降级）两种模式，配合定时器劫持、事件监听劫持等副作用补丁，实现了基本可靠的运行时隔离
- **生命周期流转**遵循 NOT_LOADED → NOT_BOOTSTRAPPED → NOT_MOUNTED → MOUNTED 的状态机模型，bootstrap 只执行一次，mount/unmount 可多次调用
- **registerMicroApps** 通过延迟加载和工厂模式，避免了注册时的性能开销
- **loadApp** 是乾坤最核心的函数，包含 HTML 加载、沙箱创建、JS 执行、生命周期包装四个阶段
- **start** 函数启动预加载和 single-spa 路由监听，通过 Deferred Promise 与 registerMicroApps 协调执行时序
- 乾坤在 2026 年仍是**存量项目改造**和**多框架并存**场景的主流选择，但新项目应优先评估 Module Federation

---

下一章，我们将深入乾坤最具技术含量的模块——JS 沙箱。我们会逐行分析 ProxySandbox 和 SnapshotSandbox 的实现，理解 `with` 语句和 `(0, eval)` 背后的原理，以及为什么沙箱是微前端中最容易出 bug 的地方。

> 框架的价值不在于它有多新，而在于它解决了多少真实的问题。乾坤也许不是微前端的未来，但它定义了微前端的"基线"——后来者无论怎么创新，都在回答乾坤已经提出的问题。

---

### 思考题

1. **概念理解**：乾坤的 HTML Entry 和 iframe 都是"给一个 URL 加载应用"。请从 JS 执行上下文、CSS 隔离、DOM 访问、路由同步、性能开销五个维度，系统对比两者的差异。在什么场景下 iframe 反而是更好的选择？

2. **源码分析**：`loadApp` 返回的是一个工厂函数（`ParcelConfigObjectGetter`）而非直接返回生命周期对象。请分析这个设计决策的原因。如果直接返回对象会导致什么问题？提示：考虑 `loadMicroApp` 的多实例场景。

3. **实践调试**：在一个使用乾坤的项目中，子应用 A 设置了 `window.globalConfig = { theme: 'dark' }`，但子应用 B 读取 `window.globalConfig` 时得到了 `undefined`。请分析可能的原因，并给出至少两种解决方案。

4. **架构设计**：乾坤选择在运行时进行沙箱隔离（Proxy/Snapshot），而 Module Federation 选择在编译时进行模块隔离。请分析这两种策略各自的优缺点。如果你要设计一个全新的微前端框架，你会选择哪种策略？为什么？

5. **性能优化**：乾坤的预加载策略使用 `requestIdleCallback` 在浏览器空闲时加载子应用资源。请设计一个更智能的预加载策略——基于用户行为预测（如鼠标悬停在导航链接上）来决定预加载哪些子应用。给出核心实现代码。

</div>
