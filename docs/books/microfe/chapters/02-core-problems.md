<div v-pre>

# 第2章 微前端核心问题域

> "框架会过时，但问题永存。理解微前端的六大核心问题，比学会任何一个框架都重要。"

> **本章要点**
> - 应用加载：运行时动态加载远程代码的三种模式——HTML Entry、JS Entry、Module Federation
> - JS 隔离：从快照沙箱到 Proxy 沙箱，理解全局变量污染的本质与防御策略
> - CSS 隔离：Shadow DOM、Scoped CSS、CSS Modules 三大方案的原理与边界
> - 应用通信：发布订阅、Props 传递、共享状态——微应用间数据传递的架构抉择
> - 路由管理：如何在主应用与多个子应用之间统一管理浏览器路由
> - 依赖共享：如何避免重复加载 React/Vue 等公共库，以及版本冲突的解决策略
> - 六大问题的解决策略谱系：一张表看清 qiankun、single-spa、Module Federation、Wujie、Web Components 各自的解法

---

上一章我们从"为什么"出发，理解了微前端架构诞生的必然性。但"为什么需要微前端"只是故事的序章。真正的挑战从你决定采用微前端的那一刻开始——**你将立刻面对六个绕不过去的核心问题。**

这六个问题，就像建造一座城市必须解决的基础设施问题：供电（应用加载）、安全围墙（JS 隔离）、建筑外观协调（CSS 隔离）、通信网络（应用通信）、交通规划（路由管理）、公共资源调配（依赖共享）。任何一个微前端方案——无论是 qiankun、single-spa、Module Federation 还是 Wujie——本质上都是在用不同的策略回答这六个问题。

本章的目标不是深入任何一个框架的实现细节（那是后续章节的任务），而是**建立一张完整的问题地图**。当你对问题本身有了深刻理解，再去读源码时，你看到的就不是零散的代码，而是一个个精心设计的解决方案。

## 2.1 应用加载：如何在运行时动态加载远程代码

### 2.1.1 问题的本质

微前端的第一个核心问题，也是最基础的问题：**如何把一个远程服务器上的子应用代码，加载到当前页面并执行？**

这个问题看似简单——不就是动态插入一个 `<script>` 标签吗？但当你深入思考，会发现远比想象的复杂：

```typescript
// 最朴素的远程代码加载
function naiveLoadApp(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// 问题 1：子应用不只有 JS，还有 CSS、HTML 模板、静态资源
// 问题 2：子应用的 JS 可能有多个文件（vendor.js、app.js、chunk.js...）
// 问题 3：这些文件的加载顺序有依赖关系
// 问题 4：子应用的 CSS 可能和主应用冲突
// 问题 5：子应用卸载时，如何清理已加载的资源
// 问题 6：子应用的 publicPath 在远程服务器，相对路径会失效
```

这就是为什么每个微前端框架都需要一个**应用加载器**——它远不是一个简单的 script loader。

### 2.1.2 三种加载模式

业界主流的微前端方案，在应用加载上形成了三种截然不同的模式。

**模式一：JS Entry（single-spa 模式）**

JS Entry 是最直接的方式：子应用暴露一个 JavaScript 入口文件，主应用加载并调用其中的生命周期函数。

```typescript
// 子应用入口文件 app-entry.js：必须导出三个生命周期函数
export async function bootstrap(props: AppProps): Promise<void> {
  // 初始化：只在第一次加载时调用
  console.log('子应用 bootstrap');
}

export async function mount(props: AppProps): Promise<void> {
  // 挂载：每次进入子应用路由时调用
  const { container } = props;
  ReactDOM.render(<App />, container.querySelector('#root'));
}

export async function unmount(props: AppProps): Promise<void> {
  // 卸载：每次离开子应用路由时调用
  const { container } = props;
  ReactDOM.unmountComponentAtNode(container.querySelector('#root'));
}

// 主应用注册子应用
import { registerApplication, start } from 'single-spa';

registerApplication({
  name: 'order-app',
  app: () => System.import('https://order.example.com/app-entry.js'),
  activeWhen: '/order',
});
start();
```

JS Entry 简单直接，一个 URL 对应一个入口文件，加载逻辑完全可控。但代价也很明显——子应用的所有资源（CSS、图片、HTML 模板）都需要通过 JS 来管理，打包配置必须做特殊处理（输出为 UMD/SystemJS 格式），对子应用的侵入性较高。

**模式二：HTML Entry（qiankun 模式）**

qiankun 的 HTML Entry 是一种更"友好"的加载方式：直接请求子应用的 HTML 页面，然后从中解析出所有的 JS、CSS 资源。

```typescript
// qiankun 的 HTML Entry 加载流程（简化版）
async function loadAppByHtmlEntry(entry: string) {
  // 第一步：获取子应用的 HTML
  const html = await fetch(entry).then(res => res.text());

  // 第二步：解析 HTML，提取 JS 和 CSS
  const { template, scripts, styles } = parseHTML(html);

  // 第三步：将 HTML 模板和样式插入容器
  const container = document.querySelector('#sub-app-container');
  container.innerHTML = template;
  const styleNodes = await loadStyles(styles);
  styleNodes.forEach(node => container.appendChild(node));

  // 第四步：在沙箱环境中执行 JS
  const appExports = await execScripts(scripts, sandbox);

  return appExports; // { bootstrap, mount, unmount }
}

// parseHTML 的核心逻辑
function parseHTML(html: string) {
  const scripts: ScriptEntry[] = [];
  const styles: StyleEntry[] = [];
  // 用正则或 DOMParser 提取所有 <script> 和 <link> 标签
  // 区分外链脚本和内联脚本，保留执行顺序
  // 返回去掉脚本和样式后的"干净" HTML 模板
  const template = html
    .replace(/<script[\s\S]*?<\/script>/gi, '<!-- script removed -->')
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '<!-- style removed -->');
  return { template, scripts, styles };
}
```

HTML Entry 的精妙之处在于：**子应用不需要做任何打包配置的改动。** 它可以是一个标准的 React/Vue 应用，用 `npm run build` 构建出标准的 `index.html` + JS + CSS，qiankun 会自动处理一切。这极大降低了子应用的接入成本。

但 HTML Entry 也引入了额外的复杂度：解析 HTML 的可靠性（正则匹配还是 DOM 解析？）、相对路径的补全（子应用的资源路径需要转为绝对路径）、脚本执行顺序的保证。这些看似细节的问题，在 qiankun 的核心依赖 `import-html-entry` 中有大量的代码来处理。

**模式三：Module Federation（编译时声明 + 运行时加载）**

Module Federation 走了一条完全不同的路：不是在运行时去解析远程应用的 HTML/JS，而是在**编译时**声明模块的暴露和消费关系，在**运行时**按需加载远程模块。

```typescript
// 子应用（Remote）的 webpack/rspack 配置
new ModuleFederationPlugin({
  name: 'orderApp',
  filename: 'remoteEntry.js',
  exposes: {
    './OrderList': './src/components/OrderList',
    './OrderDetail': './src/pages/OrderDetail',
  },
  shared: {
    react: { singleton: true, requiredVersion: '^18.0.0' },
    'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
  },
});

// 主应用（Host）中使用远程模块——就像使用本地模块一样
const OrderList = React.lazy(() => import('orderApp/OrderList'));

function App() {
  return (
    <React.Suspense fallback={<Loading />}>
      <OrderList />
    </React.Suspense>
  );
}
```

Module Federation 的颠覆性在于：**它让远程模块的消费体验与本地模块几乎一致。** 你不需要关心"应用加载"这个概念——你只是 `import` 了一个模块，它碰巧在远程服务器上。

### 2.1.3 加载粒度的本质差异

三种模式最核心的差异在于**加载粒度**：

| 加载模式 | 粒度 | 侵入性 | 内置隔离 | 开发体验 |
|---------|------|--------|---------|---------|
| JS Entry | 应用级 | 高（需特殊打包格式） | 无 | 中等 |
| HTML Entry | 应用级 | 低（无需改造打包） | 内置沙箱 | 好 |
| Module Federation | 模块级 | 中（改构建配置） | 无 | 优秀 |

为什么加载粒度如此重要？考虑一个具体的场景：你的商品详情页需要嵌入一个来自"营销团队"的促销活动组件。在 JS Entry/HTML Entry 模式下，你必须加载整个营销子应用，然后在子应用内部导航到该组件——这是一种重量级的操作。而在 Module Federation 模式下，你可以直接 `import('marketingApp/PromotionBanner')`，只加载那一个组件的代码。

```typescript
// HTML Entry 模式：必须加载整个子应用
// 主应用需要为营销子应用分配一个容器和路由
registerMicroApps([{
  name: 'marketing-app',
  entry: '//marketing.example.com',
  container: '#marketing-container',
  activeRule: '/marketing',
}]);

// Module Federation 模式：只加载需要的组件
const PromotionBanner = React.lazy(
  () => import('marketingApp/PromotionBanner')
);
// 在商品详情页中直接使用，无需分配路由或容器
function ProductDetail() {
  return (
    <div>
      <ProductInfo />
      <React.Suspense fallback={<Skeleton />}>
        <PromotionBanner productId={productId} />
      </React.Suspense>
      <Reviews />
    </div>
  );
}
```

> 💡 **深度洞察：加载粒度决定了架构的灵活性**
>
> JS Entry 和 HTML Entry 的加载粒度是"应用级"——子应用是最小的部署和加载单位。而 Module Federation 的加载粒度是"模块级"——你可以只加载远程应用的一个组件、一个工具函数。这个看似微小的差异，决定了两种截然不同的架构思路：前者是"把大应用拆成小应用"，后者是"让模块跨越应用边界自由组合"。这就是为什么 Module Federation 的作者 Zack Jackson 说"Module Federation 不是微前端方案，是模块共享基础设施"。

## 2.2 JS 隔离：如何防止全局变量污染

### 2.2.1 问题的本质

假设你的主应用和子应用都使用了一个全局变量 `window.__APP_CONFIG__`：

```typescript
// 主应用设置的全局配置
window.__APP_CONFIG__ = {
  theme: 'light',
  apiBaseUrl: 'https://api.main.com',
};

// 子应用加载后，覆盖了同名全局变量
window.__APP_CONFIG__ = {
  theme: 'dark',
  apiBaseUrl: 'https://api.sub.com',
};

// 此时主应用读到的是子应用的配置——灾难开始
// 主应用的 API 请求全部打到了子应用的后端
```

这不是极端案例。在真实项目中，全局变量污染无处不在：第三方 SDK（`window.wx`、`window.AMap`、`window.Sentry`）、全局事件监听（resize、scroll）、定时器（setInterval、setTimeout）、全局样式副作用（`document.body.style.overflow = 'hidden'`）。

JS 隔离要解决的核心问题是：**让每个子应用运行在一个受控的 JavaScript 环境中，使其对全局对象的修改不会影响主应用和其他子应用。**

### 2.2.2 四种隔离策略

**策略一：快照沙箱（Snapshot Sandbox）**

最朴素但也最可靠的思路：在子应用激活时拍一张全局状态的"快照"，失活时恢复这个快照。

```typescript
class SnapshotSandbox {
  private windowSnapshot: Record<string, any> = {};
  private modifiedProps: Record<string, any> = {};

  activate(): void {
    // 拍快照：记录当前 window 上所有属性的值
    this.windowSnapshot = {};
    for (const key in window) {
      this.windowSnapshot[key] = (window as any)[key];
    }
    // 恢复上次的修改（如果有）
    Object.keys(this.modifiedProps).forEach(key => {
      (window as any)[key] = this.modifiedProps[key];
    });
  }

  deactivate(): void {
    // 找出子应用期间修改了哪些属性
    this.modifiedProps = {};
    for (const key in window) {
      if ((window as any)[key] !== this.windowSnapshot[key]) {
        this.modifiedProps[key] = (window as any)[key]; // 记录修改
        (window as any)[key] = this.windowSnapshot[key]; // 恢复原始值
      }
    }
  }
}
```

快照沙箱的类比是**酒店退房清洁**：客人入住前拍一张房间照片（activate），客人退房后按照片恢复原样（deactivate）。简单、可靠，但有一个致命限制——**同一时刻只能有一个"客人"入住**，因为它直接操作的是真正的 `window` 对象。

**策略二：Proxy 单实例沙箱（Legacy Sandbox）**

使用 ES6 Proxy 拦截对 `window` 的修改，只记录变化的属性，避免了快照沙箱遍历整个 `window` 的性能开销。

```typescript
class LegacySandbox {
  private addedPropsMap = new Map<PropertyKey, any>();
  private modifiedPropsMap = new Map<PropertyKey, any>();
  private currentUpdatedPropsMap = new Map<PropertyKey, any>();
  proxy: WindowProxy;

  constructor() {
    const rawWindow = window;
    const { addedPropsMap, modifiedPropsMap, currentUpdatedPropsMap } = this;

    this.proxy = new Proxy(rawWindow, {
      set(target, key, value) {
        const hasKey = target.hasOwnProperty(key);
        const originalValue = (target as any)[key];

        if (!hasKey) {
          addedPropsMap.set(key, value);
        } else if (!modifiedPropsMap.has(key)) {
          modifiedPropsMap.set(key, originalValue); // 首次修改，记录原始值
        }
        currentUpdatedPropsMap.set(key, value);
        (target as any)[key] = value; // 仍然写入真正的 window
        return true;
      },
    });
  }

  deactivate(): void {
    this.modifiedPropsMap.forEach((value, key) => (window as any)[key] = value);
    this.addedPropsMap.forEach((_, key) => delete (window as any)[key]);
  }

  activate(): void {
    this.currentUpdatedPropsMap.forEach((value, key) => (window as any)[key] = value);
  }
}
```

Legacy Sandbox 相比快照沙箱性能显著提升——不需要遍历整个 `window`，只处理实际变化的属性。但它仍然写入真正的 `window`，所以也是单实例的：**多个子应用不能同时激活。**

**策略三：Proxy 多实例沙箱（Proxy Sandbox）**

这是 qiankun 当前的默认沙箱方案，也是最精妙的设计。核心思路：**为每个子应用创建一个 fakeWindow，所有对 window 的读写都被代理到 fakeWindow 上。**

```typescript
class ProxySandbox {
  proxy: WindowProxy;
  private fakeWindow: Record<PropertyKey, any>;
  private running = false;

  constructor() {
    this.fakeWindow = this.createFakeWindow();
    const rawWindow = window;
    const fakeWindow = this.fakeWindow;
    const sandbox = this;

    this.proxy = new Proxy(fakeWindow, {
      set(target, key: PropertyKey, value: any): boolean {
        if (sandbox.running) {
          // 写入 fakeWindow，而不是真正的 window
          target[key] = value;
        }
        return true;
      },

      get(target, key: PropertyKey): any {
        // 优先从 fakeWindow 读取
        if (target.hasOwnProperty(key)) {
          return target[key];
        }
        // 回退到真正的 window
        const value = (rawWindow as any)[key];
        // 如果是函数，需要绑定到正确的 this
        if (typeof value === 'function') {
          return value.bind(rawWindow);
        }
        return value;
      },
    });
  }

  private createFakeWindow() {
    const fakeWindow: Record<PropertyKey, any> = {};
    // 拷贝 window 上不可配置的属性（如 window.top, window.self）
    Object.getOwnPropertyNames(window)
      .filter(key => !Object.getOwnPropertyDescriptor(window, key)?.configurable)
      .forEach(key => {
        Object.defineProperty(fakeWindow, key,
          Object.getOwnPropertyDescriptor(window, key)!);
      });
    return fakeWindow;
  }

  activate(): void { this.running = true; }
  deactivate(): void { this.running = false; }
}
```

多实例沙箱的革命性在于：**每个子应用拥有自己独立的 fakeWindow**。子应用 A 写入 `window.foo = 1`，实际写入的是 `fakeWindowA.foo`，完全不影响子应用 B 的 `fakeWindowB`。这使得多个子应用可以真正同时运行。

**策略四：iframe 天然隔离（Wujie 模式）**

iframe 是浏览器提供的最彻底的隔离机制——每个 iframe 拥有完全独立的 `window`、`document`、`location` 对象。Wujie 的创新在于**分离了 JS 执行环境和 DOM 渲染环境**：JS 在 iframe 中运行（天然完美隔离），DOM 渲染在主应用的 Shadow DOM 中（用户可见且交互正常）。

```typescript
class WujieIframeSandbox {
  iframe: HTMLIFrameElement;
  iframeWindow: Window;

  constructor() {
    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('style', 'display: none');
    this.iframe.src = 'about:blank';
    document.body.appendChild(this.iframe);
    this.iframeWindow = this.iframe.contentWindow!;

    // 关键：劫持 iframe 的 document 操作
    // 使 DOM 操作指向主应用中的 shadowRoot
    this.patchIframeDocument();
  }

  execScript(code: string): void {
    // 在 iframe 的上下文中执行子应用 JS，自动获得完整隔离
    (this.iframeWindow as any).eval(code);
  }
}
```

### 2.2.3 沙箱的边界：那些隔离不了的东西

无论哪种 Proxy 沙箱方案，都存在无法完美隔离的场景：

```typescript
const sandboxLimitations = {
  // 1. 原型链污染：子应用修改 Array.prototype 影响所有应用
  //    Proxy 拦截 window 属性，但不拦截原型链
  prototypePollution: 'Array.prototype.flatMap = customImpl',

  // 2. localStorage/sessionStorage：不在 Proxy 拦截范围内
  //    需要额外的 storage 隔离方案（如 namespace 前缀）
  storageConflict: 'localStorage.setItem("user_token", ...)',

  // 3. 全局事件监听器泄漏
  //    子应用卸载时忘记 removeEventListener
  eventLeaks: 'window.addEventListener("resize", handler)',

  // 4. 网络请求拦截
  //    子应用覆盖 window.fetch 影响主应用请求
  fetchOverride: 'window.fetch = customFetch',
};
```

> 🔥 **深度洞察：完美隔离的不可能定理**
>
> 在浏览器这个单进程、共享内存的环境中，实现真正完美的 JS 隔离在理论上是不可能的——除非使用 iframe（独立的 V8 上下文）。所有基于 Proxy 的沙箱方案，本质上都是在做"尽力而为的拦截"。拦截得越全面，性能开销越大，边界情况越多。这就是工程中的经典权衡：**你要在"隔离程度"和"性能开销/复杂度"之间找到适合业务场景的平衡点。** 对于大多数业务场景，qiankun 的 Proxy 沙箱已经够用——那些逃逸场景可以通过规范约束来规避。但如果你的场景对隔离有极致要求（比如运行不可信的第三方代码），iframe 是更安全的选择。

## 2.3 CSS 隔离：如何防止样式冲突

### 2.3.1 问题的本质

CSS 是全局的。这句话在单体应用时代已经是痛点，在微前端架构下更是噩梦。

```css
/* 主应用的样式 */
.header { background-color: #1890ff; height: 64px; }
.btn-primary { background-color: #1890ff; border-radius: 4px; }

/* 子应用的样式——使用了相同的类名 */
.header { background-color: #f5222d; height: 48px; }  /* 覆盖了主应用！ */
.btn-primary { background-color: #52c41a; }            /* 覆盖了主应用！ */
```

当子应用的 CSS 被插入到主应用的 `<head>` 中，由于 CSS 的层叠规则（后加载的覆盖先加载的），子应用的样式会"入侵"主应用的 UI。

### 2.3.2 四种隔离方案

**方案一：Shadow DOM 隔离**

浏览器原生提供的 CSS 隔离机制，影子树内的样式不会泄漏到外部，外部样式也不会渗透到内部。

```typescript
function createShadowContainer(hostElement: HTMLElement): ShadowRoot {
  const shadowRoot = hostElement.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = `
    <style>
      /* 这些样式被 Shadow DOM 封装，不会影响外部 */
      .header { background-color: #f5222d; height: 48px; }
    </style>
    <div id="sub-app-root"></div>
  `;
  return shadowRoot;
}
// qiankun 中启用：sandbox: { strictStyleIsolation: true }
```

Shadow DOM 隔离最彻底，但有显著的代价：弹窗组件（Modal/Popover/Tooltip）默认挂载到 `document.body`，会"逃逸"出 Shadow DOM 而失去样式；事件冒泡行为不同（`event.target` 会被重定向为 Shadow Host）；很多 UI 库假设自己运行在正常的 document 环境中。

**方案二：Scoped CSS（动态样式前缀）**

qiankun 的另一种方案：为子应用的所有样式规则添加特定的属性选择器前缀。

```typescript
function scopedCSS(styleText: string, appName: string): string {
  const prefix = `div[data-qiankun="${appName}"]`;
  return styleText.replace(
    /([^{}]+)\{/g,
    (match, selector: string) => {
      if (selector.trim().startsWith('@')) return match; // 跳过 @media 等
      const scopedSelector = selector
        .split(',')
        .map(s => `${prefix} ${s.trim()}`)
        .join(', ');
      return `${scopedSelector} {`;
    }
  );
}
// .header { color: red; }
// → div[data-qiankun="order-app"] .header { color: red; }
```

兼容性好、对子应用几乎透明。但如果子应用使用了 `:root` 选择器、`!important` 或动态创建 `<style>` 标签，可能绕过 scoped 机制。

**方案三：CSS Modules / CSS-in-JS**

不是微前端框架的功能，而是子应用自身的样式方案。通过构建工具将类名转为唯一 hash 值，从根本上避免命名冲突。

```typescript
// CSS Modules
import styles from './OrderList.module.css';
// styles.header === 'header_a1b2c3'（唯一类名）
<div className={styles.header}>订单列表</div>

// CSS-in-JS (styled-components)
const Header = styled.div`background: red; height: 48px;`;
// 生成唯一类名：.sc-aBcDe { background: red; }
```

优势是不依赖微前端框架，任何环境下都能工作。但要求所有子应用严格遵守规范——一旦有人写了全局 CSS，隔离就被打破。

**方案四：动态样式表（Dynamic Stylesheet）**

最简单的策略：子应用挂载时加载样式表，卸载时移除。不能防止同时运行的子应用之间的冲突，但可以防止已卸载子应用的样式残留，通常作为其他方案的补充。

> 💡 **最佳实践**：最稳妥的做法是**双保险**——微前端框架层面开启 Scoped CSS 或 Shadow DOM（防御底线），同时要求所有子应用使用 CSS Modules 或 CSS-in-JS（源头治理）。

## 2.4 应用通信：如何在微应用间传递数据

### 2.4.1 问题的本质

在单体应用中，模块间通信轻而易举——直接 import、函数调用、共享 Redux store。但在微前端架构下，子应用之间是"隔离"的，通信变得微妙了。

```typescript
// 微前端中常见的通信场景
const communicationScenarios = {
  userContext: '用户登录后，主应用把 token、角色传递给所有子应用',
  crossAppSync: '购物车子应用添加商品，商品详情子应用需要更新状态',
  childToParent: '子应用通知主应用切换路由、显示全局 loading',
  globalState: '主题色切换、语言切换，所有子应用需要同步更新',
};
```

通信方案的设计需要在两个维度上做平衡：**耦合度**和**复杂度**。耦合度太高，子应用失去独立性；复杂度太高，开发体验下降。

### 2.4.2 五种通信模式

**模式一：Props 传递（父子通信）**

```typescript
registerMicroApps([{
  name: 'order-app',
  entry: '//order.example.com',
  container: '#container',
  activeRule: '/order',
  props: {
    user: { name: 'Yang Yitao', role: 'admin' },
    token: 'eyJhbGciOiJIUzI1NiIs...',
    onNavigate: (path: string) => history.push(path),
    authService: {
      getToken: () => localStorage.getItem('token'),
      refreshToken: () => fetch('/api/refresh-token'),
      logout: () => { /* ... */ },
    },
  },
}]);

// 子应用接收 props
export async function mount(props: any) {
  const { user, token, onNavigate, authService } = props;
  console.log(`当前用户: ${user.name}`);
}
```

Props 传递的优势是**类型安全、显式依赖、易于调试**。劣势是只能实现主应用到子应用的单向传递。

**模式二：发布订阅（全局事件总线）**

经典的观察者模式，适合解耦的跨应用通信。

```typescript
interface MicroFrontendEvents {
  'user:login': { userId: string; token: string };
  'cart:itemAdded': { productId: string; quantity: number };
  'theme:changed': { theme: 'light' | 'dark' };
}

class EventBus<T extends Record<string, any>> {
  private listeners = new Map<keyof T, Set<Function>>();

  on<K extends keyof T>(event: K, cb: (data: T[K]) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => { this.listeners.get(event)?.delete(cb); }; // 返回取消函数
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }
}

// 子应用 A（购物车）：
eventBus.emit('cart:itemAdded', { productId: 'SKU001', quantity: 2 });
// 子应用 B（商品详情）：
const unsubscribe = eventBus.on('cart:itemAdded', ({ productId }) => {
  updateCartStatus(productId, true);
});
```

**模式三：全局状态（qiankun initGlobalState）**

qiankun 内置的通信方案：简化版的发布订阅 + 状态容器。比纯事件总线多了"状态"概念——新订阅者可获取当前状态快照。

```typescript
import { initGlobalState } from 'qiankun';

const actions = initGlobalState({ user: null, theme: 'light', locale: 'zh-CN' });
actions.onGlobalStateChange((newState, prevState) => {
  console.log('全局状态变化：', newState, prevState);
});
actions.setGlobalState({ theme: 'dark' });
```

**模式四：URL 参数通信**

利用 URL 作为通信媒介。天然可持久化、可分享，不需要框架支持。适合页面级导航数据。

**模式五：共享运行时状态（Module Federation）**

Module Federation 的独特优势：多个远程应用共享同一个 Zustand/Redux 实例。

```typescript
// shared-store 应用暴露全局 store
new ModuleFederationPlugin({
  name: 'sharedStore',
  exposes: { './store': './src/store' },
  shared: { zustand: { singleton: true } },
});

// 任何消费此远程模块的应用，都共享同一个 store 实例
import { useGlobalStore } from 'sharedStore/store';
function OrderPage() {
  const user = useGlobalStore((s) => s.user);
  return <div>欢迎, {user?.name}</div>;
}
```

### 2.4.3 通信模式的选型

| 通信模式 | 适用场景 | 耦合度 | 复杂度 | 实时性 |
|---------|---------|--------|--------|--------|
| Props 传递 | 主应用 → 子应用的配置数据 | 中 | 低 | 初始化时 |
| 事件总线 | 子应用之间的解耦通信 | 低 | 中 | 实时 |
| 全局状态 | 需要持久化 + 多方订阅的共享数据 | 中 | 中 | 实时 |
| URL 参数 | 页面级导航数据、可分享的状态 | 低 | 低 | 路由变化时 |
| 共享 Store | Module Federation 下的深度状态共享 | 高 | 高 | 实时 |

> 🔥 **深度洞察：通信的"最少知识原则"**
>
> 微前端通信方案的选择，应该遵循一个核心原则：**每个子应用应该只知道它需要知道的最少信息。** Props 传递最显式——子应用明确声明"我需要 user 和 token"；事件总线中等显式——子应用声明"我关心 cart:itemAdded 事件"；共享 Store 最隐式——子应用可以读取全局状态中的任何字段。当你发现多个子应用频繁共享大量状态时，也许应该反思：它们是否真的应该是独立的子应用？

## 2.5 路由管理：如何统一管理子应用的路由

### 2.5.1 问题的本质

浏览器只有一个地址栏，只有一个 `history` 对象。但在微前端架构中，主应用和每个子应用可能都有自己的路由系统。**谁来控制 URL？** 用户从 `/order/list` 导航到 `/product/123` 时，主应用需要卸载订单子应用、加载商品子应用——但子应用的 React Router 也在监听路由变化，谁先响应？

### 2.5.2 路由拦截机制

所有路由驱动的微前端方案都使用同一个核心技术：**路由劫持（Route Hijacking）**。

```typescript
// single-spa 路由拦截的核心原理
const originalPushState = window.history.pushState;
const originalReplaceState = window.history.replaceState;

window.history.pushState = function(state, title, url) {
  const result = originalPushState.apply(this, [state, title, url]);
  reroute(); // 触发微前端的路由变化处理
  return result;
};

window.history.replaceState = function(state, title, url) {
  const result = originalReplaceState.apply(this, [state, title, url]);
  reroute();
  return result;
};

window.addEventListener('popstate', () => reroute());

// reroute：微前端的路由调度中枢
function reroute(): void {
  const currentPath = window.location.pathname;
  const { appsToLoad, appsToMount, appsToUnmount } = getAppChanges(currentPath);

  const unmountPromises = appsToUnmount.map(app => app.unmount());
  const loadPromises = appsToLoad.map(app => app.load());

  Promise.all([...unmountPromises, ...loadPromises]).then(() => {
    appsToMount.forEach(app => app.mount());
  });
}
```

### 2.5.3 三层路由模型

理解微前端路由管理，关键是区分三个层次：

| 层次 | 职责 | 管理者 | 示例 |
|------|------|--------|------|
| 第一层：主应用路由 | 决定哪个子应用激活 | 微前端框架 | `/order/*` → order-app |
| 第二层：子应用路由 | 子应用内部页面切换 | React Router / Vue Router | `/order/list` → OrderList |
| 第三层：内部路由 | 局部状态（Tab 切换等） | 子应用自己 | 不反映在 URL 中 |

```typescript
// 正确设置子应用路由的 basename
function OrderApp(props: { basename: string }) {
  return (
    <BrowserRouter basename={props.basename || '/order'}>
      <Routes>
        <Route path="/list" element={<OrderList />} />
        <Route path="/detail/:id" element={<OrderDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
```

Module Federation 的路由管理截然不同——远程组件就是普通的 React 组件，路由完全由 Host 应用统一管理。

```typescript
// Module Federation 中，路由完全由 Host 管理
const OrderList = React.lazy(() => import('orderApp/OrderList'));
const ProductPage = React.lazy(() => import('productApp/ProductPage'));

function ShellApp() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          {/* 远程组件就像本地组件一样参与路由 */}
          <Route path="/order/list" element={<OrderList />} />
          <Route path="/product/:id" element={<ProductPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
// 只有一套路由系统，没有路由冲突问题
// 但远程应用失去了路由自治权，必须由 Host 统一管理
```

> 💡 **最佳实践**：在 qiankun/single-spa 架构下，主应用只管"哪个子应用"这一层（`/order/*`），子应用自己管内部页面。千万不要让主应用"深入"管理子应用的内部路由——那会重新引入耦合。

## 2.6 依赖共享：如何避免重复加载公共库

### 2.6.1 问题的本质

5 个子应用都使用 React 18（~40KB gzipped）和 Ant Design 5（~80KB gzipped）。如果每个子应用都打包一份完整依赖，意味着 480KB 的重复加载，以及 5 个 React 实例导致 Context 不共享、Hooks 无法跨应用调用。

但依赖共享远不是"把 React 抽出来"这么简单。核心挑战在于**版本冲突**：

```typescript
const versionConflict = {
  'order-app':     { react: '18.2.0', antd: '5.10.0' },
  'product-app':   { react: '18.3.0', antd: '5.12.0' },
  'user-app':      { react: '18.2.0', antd: '4.24.0' },  // 还在用 antd 4
  'marketing-app': { react: '17.0.2', antd: '5.8.0' },   // 还在用 React 17
};
// React 18.2 和 18.3 可以共享吗？（小版本差异，通常可以）
// antd 4 和 antd 5 能共享吗？（大版本不兼容，不能）
// React 17 和 React 18 能共享吗？（有 breaking changes，风险较高）
```

### 2.6.2 三种共享策略

**策略一：Externals（全局 CDN 加载）**

将公共依赖从打包产物中排除，通过 CDN 全局加载。所有子应用被迫使用同一个版本——简单但不灵活。

```typescript
// webpack.config.js
module.exports = {
  externals: { react: 'React', 'react-dom': 'ReactDOM' },
};
// 主应用 HTML 中加载 CDN 脚本，所有子应用通过 window.React 访问
```

**策略二：Module Federation Shared（运行时版本协商）**

Module Federation 的 `shared` 配置实现了**运行时版本协商**：

```typescript
new ModuleFederationPlugin({
  shared: {
    react: {
      singleton: true,            // 只允许一个实例
      requiredVersion: '^18.0.0', // 需要 18.x 版本
      eager: false,               // 异步加载
    },
    antd: {
      requiredVersion: '^5.0.0',  // 不设 singleton，允许多版本共存
    },
  },
});

// 运行时版本协商的工作原理：
// 1. 每个应用在 shared scope 中注册自己的依赖版本
// 2. 消费时，先检查 shared scope 中是否有满足要求的版本
// 3. singleton 模式：只用一个版本（即使版本不完全匹配也会复用）
// 4. 非 singleton：找到满足 requiredVersion 的最高版本
```

不是构建时决定用哪个版本，而是页面加载时根据所有已注册版本和消费者需求动态决定——这是它相比 Externals 的本质优势。

**策略三：Import Maps（浏览器原生模块解析）**

Import Maps 是一个正在走向标准化的浏览器 API，允许在运行时控制 ES Module 的解析路径。

```html
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.2.0",
    "react-dom": "https://esm.sh/react-dom@18.2.0",
    "react-dom/client": "https://esm.sh/react-dom@18.2.0/client"
  }
}
</script>
```

```typescript
// 子应用的 ES Module 代码
import React from 'react';           // → 解析为 https://esm.sh/react@18.2.0
import ReactDOM from 'react-dom';    // → 解析为 https://esm.sh/react-dom@18.2.0
```

浏览器原生支持、无需框架，但只支持 ES Module（不支持 UMD/CommonJS）、动态 Import Map 的浏览器支持尚不完善、缺乏版本协商机制（需要手动管理版本）。

### 2.6.3 依赖分类的最佳实践

```typescript
const dependencyCategories = {
  mustShare:    'React、ReactDOM —— 多实例导致 Hooks 崩溃，必须 singleton',
  shouldShare:  '大型 UI 库（antd、element-ui）—— 减少体积',
  avoidSharing: '业务工具库 —— 版本敏感，让子应用自己管理',
};
```

> 🔥 **深度洞察：依赖共享的"不可能三角"**
>
> 微前端的依赖共享面临一个类似 CAP 定理的"不可能三角"：**版本自由**（每个子应用用自己的版本）、**体积最优**（不重复加载）、**运行时兼容**（共享 Context/Hooks）——三者最多只能同时满足两个。Externals 牺牲版本自由来获得体积和兼容性；完全不共享牺牲体积和兼容性来获得版本自由；Module Federation 的 shared 配置是目前最接近"三者兼顾"的方案，但它通过复杂的运行时协商来实现，本身也引入了额外的复杂度。

## 2.7 六大问题的解决策略谱系

### 2.7.1 方案横向对比

| 问题域 | qiankun | single-spa | Module Federation | Wujie | Web Components |
|-------|---------|------------|-------------------|-------|---------------|
| **应用加载** | HTML Entry（解析 HTML） | JS Entry（加载 JS 入口） | 编译时声明+运行时加载 | iframe+WebComponent | Custom Element |
| **JS 隔离** | Proxy 沙箱（三代演进） | 无内置（需自行实现） | 无隔离（共享运行时） | iframe 天然隔离 | 无 JS 隔离 |
| **CSS 隔离** | Shadow DOM / Scoped CSS | 无内置 | 无内置（依赖子应用） | Shadow DOM + iframe | Shadow DOM 原生 |
| **应用通信** | initGlobalState + Props | 自定义事件/共享模块 | 共享模块/Store 实例 | Props+事件+window.parent | Custom Events |
| **路由管理** | 基于 single-spa 劫持 | pushState/popstate 劫持 | Host 统一管理 | iframe location 同步 | 无内置 |
| **依赖共享** | Externals（手动配置） | Externals / SystemJS | shared 运行时协商 | 不共享（天然隔离） | 无内置 |

### 2.7.2 方案的"性格画像"

```typescript
const solutionProfiles = {
  qiankun: {
    philosophy: '用运行时 hack 解决一切问题',
    bestFor: '存量项目改造，技术栈异构的团队',
    metaphor: '万能翻译官——让不同语言的人在同一房间交流，但翻译总有不精确的时候',
  },
  singleSpa: {
    philosophy: '只做路由调度，其余交给生态',
    bestFor: '技术能力强、需要深度定制的团队',
    metaphor: '交通信号灯系统——只管红绿灯，道路和车辆不归它管',
  },
  moduleFederation: {
    philosophy: '在编译层面解决模块共享问题',
    bestFor: '同一技术栈的团队，追求极致开发体验',
    metaphor: '自由贸易区——各国之间商品自由流通，没有海关检查（沙箱）',
  },
  wujie: {
    philosophy: '用 iframe 的隔离 + WebComponent 的渲染',
    bestFor: '隔离要求极高的场景，运行不可信代码',
    metaphor: '写字楼的独立办公室——每个公司有自己的空间，但共享大堂和电梯',
  },
  webComponents: {
    philosophy: '浏览器标准就是最好的方案',
    bestFor: '组件级共享（设计系统），长期维护的基础设施',
    metaphor: 'USB 接口标准——任何设备都能插，但功能取决于具体设备',
  },
};
```

### 2.7.3 隔离性与灵活性的光谱

六大问题的解决方案可以放在一个"隔离性—灵活性"的光谱上：

```
隔离性强 ←────────────────────────────────→ 灵活性强

  iframe     Proxy沙箱    Shadow DOM    Scoped CSS    CSS Modules    无隔离
  (Wujie)    (qiankun)    (qiankun)     (qiankun)    (各子应用)    (Module Fed)

  完全隔离     较强隔离      DOM/CSS隔离    CSS前缀隔离   构建时隔离   无隔离
  性能开销大   性能开销中     兼容性一般     兼容性好      需要约定     性能最优
  通信困难     通信可控      通信不影响     通信不影响    通信不影响   通信自由
```

这不是一个"哪个更好"的排序，而是**根据业务需求选择合适位置**的光谱。运行不可信的第三方代码？选左侧（强隔离）。同一团队的不同模块？选右侧（强灵活性）。

> 🔥 **深度洞察：六大问题的统一视角**
>
> 回顾本章讨论的六大问题——应用加载、JS 隔离、CSS 隔离、应用通信、路由管理、依赖共享——你会发现它们本质上都在回答同一个问题：**在"隔离"和"共享"之间如何找到平衡？** 加载是"如何获取别人的代码"（共享的起点）；JS 隔离和 CSS 隔离是"如何防止别人的代码影响我"（隔离的手段）；通信是"如何主动和别人交换信息"（受控的共享）；路由管理是"如何共享浏览器的唯一 URL"（不可避免的共享）；依赖共享是"如何共享公共代码以减少浪费"（效率驱动的共享）。**微前端架构的核心张力，就是这对永恒的矛盾——隔离与共享。** 理解这一点，你在面对任何新方案时，都能迅速抓住它的本质。

## 本章小结

- **应用加载**有三种模式：JS Entry（轻量直接）、HTML Entry（对子应用友好）、Module Federation（模块级粒度），加载粒度从粗到细
- **JS 隔离**从快照沙箱到 Proxy 沙箱再到 iframe 隔离，隔离程度递增但性能和通信代价也在增加；完美的 JS 隔离在浏览器单进程环境中是不可能的
- **CSS 隔离**的四种方案——Shadow DOM、Scoped CSS、CSS Modules、Dynamic Stylesheet——各有适用场景，最佳实践是"框架隔离 + 源头治理"双保险
- **应用通信**遵循"最少知识原则"：每个子应用应该只知道它需要知道的最少信息
- **路由管理**的核心是三层路由模型：框架层（哪个子应用）、子应用层（哪个页面）、内部层（局部状态）
- **依赖共享**面临"不可能三角"：版本自由、体积最优、运行时兼容不可兼得
- **六大问题的本质**是同一对矛盾——**隔离与共享的永恒张力**

## 思考题

1. **架构分析**：本章将微前端的六大问题归结为"隔离与共享的永恒张力"。请选择一个你熟悉的微前端方案（qiankun、Module Federation 或 Wujie），分析它在这六个问题上分别偏向"隔离"还是"共享"，并解释这种选择背后的设计哲学。

2. **方案设计**：假设你需要为一个金融行业的企业后台设计微前端架构——3 个团队，其中一个团队维护的是 5 年前用 jQuery 写的老系统。你会选择哪种应用加载模式？哪种 JS 隔离方案？请详细说明你的技术选型和理由。

3. **深度思考**：本章提到"完美的 JS 隔离在浏览器中是不可能的"。请列举至少 3 种 Proxy 沙箱无法拦截的场景，并为每种场景提出一个工程上的规避方案。

4. **前瞻性讨论**：随着浏览器标准的演进（Import Maps、Shadow DOM v2、Web Components），你认为未来 3-5 年内，本章讨论的六大问题中，哪些会被浏览器原生能力解决？哪些仍然需要框架层面的方案？请说明你的判断依据。


</div>
