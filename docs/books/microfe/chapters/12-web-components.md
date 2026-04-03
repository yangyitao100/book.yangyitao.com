<div v-pre>

# 第12章 Web Components 与微前端

> "最好的隔离不是框架给你的——是浏览器本来就有的。"

> **本章要点**
> - 深入理解 Shadow DOM 的两种模式（open/closed）及其在微前端场景中的隔离能力与边界
> - 掌握 Custom Elements 的完整生命周期，将其作为微应用容器实现加载、通信与销毁
> - 通过 Lit 框架的实战案例，体验 Web Components 驱动的微前端开发范式
> - 正视 Web Components 的真实局限：SSR 兼容性、表单集成、无障碍访问的挑战与应对策略
> - 理解 Web Components 在微前端技术版图中的独特定位：不是替代方案，而是基础设施

---

你可能已经注意到一个有趣的现象：前面章节中，无论是乾坤的 `strictStyleIsolation`，还是无界的组件级嵌入方案，底层都绕不开同一个东西——**Web Components**。

这不是巧合。

当我们费尽心思用 JavaScript 去模拟 CSS 隔离、用 Proxy 去拦截全局变量、用各种 hack 去阻止子应用之间的相互污染时，浏览器其实早就准备好了一套原生的隔离方案。Shadow DOM 提供 DOM 和样式的天然边界，Custom Elements 提供标准化的生命周期钩子，HTML Templates 和 Slots 提供灵活的内容分发机制。这三驾马车组成的 Web Components 标准，本身就是浏览器对"组件隔离"问题的官方回答。

那么问题来了：既然浏览器原生就支持隔离，为什么微前端框架们还要自己造轮子？

答案并不简单。这一章，我们将从 Shadow DOM 的隔离机制出发，一路走到 Custom Elements 容器化实践，再用 Lit 框架搭建一个完整的微前端方案，最后直面 Web Components 的真实局限。读完之后，你会理解：Web Components 不是微前端的银弹，但它是微前端架构师工具箱里最不该被忽视的那把瑞士军刀。

## 12.1 Shadow DOM：浏览器原生的隔离机制

### 12.1.1 Shadow DOM 的本质：一面单向镜

要理解 Shadow DOM，最好忘掉所有技术文档里的抽象定义，想象一面**单向镜**。

从外面（Light DOM）看进去，你看不到里面的细节——内部的样式、结构、事件都被隔离在镜子后面。但从里面（Shadow DOM）看出去，你依然能感知到外部世界的存在——继承的 CSS 属性（如 `font-family`、`color`）会穿透进来。

```typescript
// 创建一面"单向镜"
class IsolatedContainer extends HTMLElement {
  constructor() {
    super();
    // attachShadow 就是安装这面镜子
    const shadow = this.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        /* 这些样式只在镜子内部生效 */
        .title { color: red; font-size: 24px; }
        .content { padding: 16px; background: #f5f5f5; }
      </style>
      <div class="title">我是隔离的标题</div>
      <div class="content">
        <slot></slot>
      </div>
    `;
  }
}

customElements.define('isolated-container', IsolatedContainer);
```

```html
<style>
  /* 外部样式：试图影响 Shadow DOM 内部 */
  .title { color: blue; font-size: 48px; }
  .content { background: yellow; }
</style>

<isolated-container>
  <p>我是 Light DOM 中的内容，会被投影到 slot 中</p>
</isolated-container>

<!-- 结果：Shadow DOM 内部的 .title 是红色 24px，不受外部 .title 影响 -->
<!-- 外部的 .title 规则对 Shadow DOM 内部完全无效 -->
```

这个例子揭示了 Shadow DOM 隔离的核心特征：**CSS 选择器无法穿透 Shadow Boundary**。无论外部写了多么激进的 `* { color: blue !important; }`，Shadow DOM 内部的元素都不会被匹配到。这正是微前端梦寐以求的样式隔离能力。

### 12.1.2 open 与 closed：两种隔离哲学

`attachShadow` 接受一个 `mode` 参数，它决定了外部代码能否通过 JavaScript 访问 Shadow DOM 内部：

```typescript
// mode: 'open' —— 协作式隔离
const openShadow = element.attachShadow({ mode: 'open' });
// 外部可以通过 element.shadowRoot 访问内部 DOM
console.log(element.shadowRoot); // ShadowRoot {...}
console.log(element.shadowRoot.querySelector('.title')); // <div class="title">

// mode: 'closed' —— 强制式隔离
const closedShadow = element.attachShadow({ mode: 'closed' });
// 外部无法通过标准 API 访问内部 DOM
console.log(element.shadowRoot); // null
```

这两种模式背后是截然不同的设计哲学：

| 特性 | `open` 模式 | `closed` 模式 |
|------|-------------|---------------|
| `element.shadowRoot` | 返回 ShadowRoot | 返回 `null` |
| 外部 JS 可否操作内部 DOM | 可以 | 不可以（标准途径） |
| CSS 隔离 | 完全隔离 | 完全隔离 |
| 事件 retarget | 是 | 是 |
| 适用场景 | 组件库、微前端容器 | 安全敏感的第三方组件 |
| 浏览器原生使用 | `<video>`、`<input>` 等 | `<video>` 的内部控件 |

在微前端场景中，**绝大多数时候应该选择 `open` 模式**。原因很实际：

```typescript
// 微前端主应用可能需要与子应用的 Shadow DOM 交互
class MicroAppContainer extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    // 使用 open 模式，允许主应用在必要时操作内部 DOM
    // 比如：注入全局样式变量、监控子应用状态、错误捕获
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  // 主应用可能需要向子应用注入主题变量
  injectThemeVariables(variables: Record<string, string>): void {
    const styleEl = document.createElement('style');
    const cssVars = Object.entries(variables)
      .map(([key, value]) => `--${key}: ${value};`)
      .join('\n');
    styleEl.textContent = `:host { ${cssVars} }`;
    this.shadow.appendChild(styleEl);
  }
}
```

而 `closed` 模式虽然看似更安全，但实际上存在一个尴尬的事实——**它并不能真正阻止恶意访问**。通过拦截 `Element.prototype.attachShadow`，攻击者完全可以在组件创建之前截获 ShadowRoot 引用：

```typescript
// 绕过 closed 模式的"攻击"手段
const originalAttachShadow = Element.prototype.attachShadow;
const shadowRootMap = new WeakMap<Element, ShadowRoot>();

Element.prototype.attachShadow = function(init: ShadowRootInit): ShadowRoot {
  const shadowRoot = originalAttachShadow.call(this, init);
  // 即使是 closed 模式，这里也能拿到 shadowRoot 引用
  shadowRootMap.set(this, shadowRoot);
  return shadowRoot;
};

// 后续代码可以通过 shadowRootMap.get(element) 获取任何元素的 ShadowRoot
```

> 💡 **深度洞察**：`closed` 模式的设计初衷不是防御恶意代码——那是安全沙箱（如 iframe）的工作。它的真正价值在于**声明意图**：告诉组件的使用者"请不要依赖我的内部结构，因为它随时可能变化"。这和面向对象编程中 `private` 的理念一致——防君子不防小人，但对代码维护极有价值。

### 12.1.3 样式隔离的细节：什么能穿透，什么不能

Shadow DOM 的样式隔离不是"绝对的墙"，更像是"有窗户的墙"。理解哪些东西能穿透、哪些不能，对于微前端的样式管理至关重要。

```typescript
// 演示样式穿透行为
class StylePenetrationDemo extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .box {
          padding: 20px;
          border: 1px solid #ccc;
        }
      </style>
      <div class="box">
        <p>观察我的字体和颜色</p>
        <a href="#">观察我是否有下划线</a>
      </div>
    `;
  }
}
customElements.define('style-demo', StylePenetrationDemo);
```

```html
<style>
  body {
    font-family: 'Microsoft YaHei', sans-serif;
    color: #333;
    font-size: 14px;
    line-height: 1.6;
  }
  a { color: red; text-decoration: none; }
  p { margin-bottom: 20px; }
</style>

<style-demo></style-demo>
```

**能穿透 Shadow Boundary 的：**

| CSS 属性 | 穿透行为 | 原因 |
|---------|---------|------|
| `font-family` | 继承穿透 | 可继承属性 |
| `color` | 继承穿透 | 可继承属性 |
| `font-size` | 继承穿透 | 可继承属性 |
| `line-height` | 继承穿透 | 可继承属性 |
| CSS Custom Properties | 继承穿透 | 设计如此，这是特性 |

**不能穿透 Shadow Boundary 的：**

| CSS 属性/选择器 | 被阻挡 | 原因 |
|----------------|--------|------|
| 标签选择器 `p { }` | 阻挡 | 选择器无法穿透 |
| 类选择器 `.box { }` | 阻挡 | 选择器无法穿透 |
| `a { color: red }` | 阻挡 | 选择器无法穿透 |
| 全局重置 `* { }` | 阻挡 | 选择器无法穿透 |

这意味着在微前端场景中，**CSS 自定义属性（Custom Properties）是主应用向子应用传递设计令牌（Design Tokens）的最佳通道**：

```typescript
// 主应用：通过 CSS Custom Properties 传递设计体系
class ThemeAwareMicroApp extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: block;
        }
        .header {
          /* 使用主应用传递的设计令牌，提供合理的 fallback */
          background: var(--theme-primary, #1890ff);
          color: var(--theme-text-inverse, #fff);
          padding: var(--theme-spacing-md, 16px);
          border-radius: var(--theme-radius, 4px);
          font-size: var(--theme-font-size-lg, 18px);
        }
        .body {
          padding: var(--theme-spacing-md, 16px);
          color: var(--theme-text-primary, #333);
          background: var(--theme-bg-primary, #fff);
        }
      </style>
      <div class="header">
        <slot name="title">默认标题</slot>
      </div>
      <div class="body">
        <slot></slot>
      </div>
    `;
  }
}
customElements.define('theme-aware-app', ThemeAwareMicroApp);
```

```html
<!-- 主应用通过 CSS 变量控制所有子应用的主题 -->
<style>
  :root {
    --theme-primary: #722ed1;
    --theme-text-inverse: #fff;
    --theme-text-primary: #262626;
    --theme-bg-primary: #fafafa;
    --theme-spacing-md: 20px;
    --theme-radius: 8px;
    --theme-font-size-lg: 20px;
  }
</style>

<theme-aware-app>
  <span slot="title">订单管理子应用</span>
  <p>这里是子应用的内容区域</p>
</theme-aware-app>
```

### 12.1.4 Slot 分发：Light DOM 与 Shadow DOM 的桥梁

Slot 是 Web Components 中最容易被低估的特性。在微前端场景中，它解决了一个关键问题：**如何让主应用向子应用容器内注入内容，同时保持隔离**。

```typescript
class MicroAppShell extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .shell-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #fafafa;
          border-bottom: 1px solid #e8e8e8;
        }
        .shell-body {
          flex: 1;
          overflow: auto;
          position: relative;
        }
        .shell-footer {
          padding: 8px 16px;
          border-top: 1px solid #e8e8e8;
          background: #fafafa;
        }
      </style>

      <div class="shell-header">
        <slot name="header">
          <span>未命名应用</span>
        </slot>
      </div>

      <div class="shell-body">
        <!-- 默认 slot：子应用的主内容区域 -->
        <slot></slot>
      </div>

      <div class="shell-footer">
        <slot name="footer">
          <span>v1.0.0</span>
        </slot>
      </div>
    `;
  }
}
customElements.define('micro-app-shell', MicroAppShell);
```

```html
<!-- 主应用可以灵活控制每个子应用容器的 header 和 footer -->
<micro-app-shell>
  <div slot="header">
    <h3>📦 订单管理</h3>
    <button onclick="refreshApp()">刷新</button>
  </div>

  <!-- 没有 slot 属性的内容进入默认 slot -->
  <div id="order-app-root"></div>

  <div slot="footer">
    <span>最后更新：2 分钟前</span>
    <a href="/help">帮助</a>
  </div>
</micro-app-shell>
```

Slot 分发有一个关键特性：**被分发的内容（Light DOM）的样式由外部（主应用）控制，而容器的布局由 Shadow DOM 内部控制**。这种"内容与容器分离"的模型，天然适合微前端的"主应用管布局、子应用管内容"的职责划分。

## 12.2 Custom Elements 作为微应用容器

### 12.2.1 生命周期：Web 标准的 bootstrap-mount-unmount

Custom Elements 规范定义了一组生命周期回调，它们与微前端子应用的生命周期有着惊人的对应关系：

```typescript
// Custom Elements 生命周期与微前端生命周期的映射
class MicroAppElement extends HTMLElement {

  // ========== 生命周期回调 ==========

  /**
   * constructor: 元素被创建时调用
   * 对应微前端：初始化阶段（类似 single-spa 的 bootstrap 前置）
   * 注意：此时元素尚未插入 DOM，不要访问属性或子元素
   */
  constructor() {
    super();
    console.log('[lifecycle] constructor - 元素被创建');
    this.attachShadow({ mode: 'open' });
    // 只做最基本的初始化：创建 Shadow DOM、声明内部状态
    this._initialized = false;
    this._appInstance = null;
  }

  /**
   * connectedCallback: 元素被插入 DOM 时调用
   * 对应微前端：mount 阶段
   * 这是加载和挂载子应用的最佳时机
   */
  connectedCallback(): void {
    console.log('[lifecycle] connectedCallback - 元素插入 DOM');
    this._mountApp();
  }

  /**
   * disconnectedCallback: 元素从 DOM 移除时调用
   * 对应微前端：unmount 阶段
   * 必须在此处清理所有资源，防止内存泄漏
   */
  disconnectedCallback(): void {
    console.log('[lifecycle] disconnectedCallback - 元素从 DOM 移除');
    this._unmountApp();
  }

  /**
   * attributeChangedCallback: 被观察的属性变化时调用
   * 对应微前端：props 更新阶段
   * 主应用通过修改 attribute 向子应用传递数据
   */
  static get observedAttributes(): string[] {
    return ['src', 'app-name', 'active'];
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    console.log(`[lifecycle] attributeChanged: ${name} = ${oldValue} -> ${newValue}`);
    if (name === 'src' && oldValue !== newValue && this.isConnected) {
      // 资源地址变化，重新加载子应用
      this._unmountApp();
      this._mountApp();
    }
    if (name === 'active' && newValue === 'false') {
      this._deactivateApp();
    }
  }

  /**
   * adoptedCallback: 元素被移动到新的 document 时调用
   * 场景较少，但在 iframe 通信场景中可能触发
   */
  adoptedCallback(): void {
    console.log('[lifecycle] adoptedCallback - 元素被移至新文档');
  }

  // ========== 内部方法 ==========

  private _initialized: boolean;
  private _appInstance: any;

  private async _mountApp(): Promise<void> {
    const src = this.getAttribute('src');
    if (!src) return;

    // 在 Shadow DOM 中创建挂载点
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; position: relative; }
        .loading { text-align: center; padding: 40px; color: #999; }
        .error { color: #ff4d4f; padding: 16px; background: #fff2f0; border-radius: 4px; }
        .app-root { width: 100%; height: 100%; }
      </style>
      <div class="loading">加载中...</div>
      <div class="app-root"></div>
    `;

    try {
      // 加载子应用资源
      const module = await import(/* @vite-ignore */ src);
      const mountPoint = this.shadowRoot!.querySelector('.app-root')!;
      const loadingEl = this.shadowRoot!.querySelector('.loading')!;

      // 调用子应用的 mount 函数
      this._appInstance = await module.mount({
        container: mountPoint,
        props: this._getProps()
      });

      loadingEl.remove();
      this._initialized = true;

      // 派发自定义事件通知主应用
      this.dispatchEvent(new CustomEvent('app-mounted', {
        bubbles: true,
        composed: true, // composed: true 允许事件穿透 Shadow Boundary
        detail: { appName: this.getAttribute('app-name') }
      }));
    } catch (error) {
      this.shadowRoot!.querySelector('.loading')!.remove();
      this.shadowRoot!.querySelector('.app-root')!.innerHTML = `
        <div class="error">
          子应用加载失败: ${(error as Error).message}
        </div>
      `;
      this.dispatchEvent(new CustomEvent('app-error', {
        bubbles: true,
        composed: true,
        detail: { appName: this.getAttribute('app-name'), error }
      }));
    }
  }

  private _unmountApp(): void {
    if (this._appInstance && typeof this._appInstance.unmount === 'function') {
      this._appInstance.unmount();
    }
    this._appInstance = null;
    this._initialized = false;
  }

  private _deactivateApp(): void {
    if (this._appInstance && typeof this._appInstance.deactivate === 'function') {
      this._appInstance.deactivate();
    }
  }

  private _getProps(): Record<string, string> {
    const props: Record<string, string> = {};
    for (const attr of this.attributes) {
      if (attr.name !== 'src' && attr.name !== 'class' && attr.name !== 'style') {
        props[attr.name] = attr.value;
      }
    }
    return props;
  }
}

customElements.define('micro-app', MicroAppElement);
```

使用起来，就像使用一个普通的 HTML 标签一样自然：

```html
<!-- 声明式的子应用加载 -->
<micro-app
  src="https://cdn.example.com/order-app/main.js"
  app-name="order"
  active="true"
  api-base="https://api.example.com"
></micro-app>

<!-- 主应用监听子应用事件 -->
<script>
  document.querySelector('micro-app').addEventListener('app-mounted', (e) => {
    console.log(`${e.detail.appName} 子应用已挂载`);
  });

  // 通过修改 attribute 控制子应用
  document.querySelector('micro-app').setAttribute('active', 'false');
</script>
```

> 💡 **深度洞察**：注意 `connectedCallback` 可能被多次调用。当元素从 DOM 移除后再次插入（比如 DOM 重排或动画），`disconnectedCallback` 和 `connectedCallback` 会成对触发。这意味着你的 mount/unmount 逻辑必须是**幂等的**——反复调用不会产生副作用。这也是很多初学者踩坑的地方：在 `constructor` 里做了应该在 `connectedCallback` 里做的事，导致二次挂载失败。

### 12.2.2 完整的微前端容器实现

让我们把上面的简单示例扩展为一个生产级的微前端容器。这个容器需要处理真实场景中的各种边界情况：

```typescript
// 类型定义
interface MicroAppConfig {
  name: string;
  entry: string;
  activeRule?: string | ((location: Location) => boolean);
  props?: Record<string, unknown>;
  sandbox?: boolean;
  prefetch?: boolean;
}

interface MicroAppLifecycle {
  bootstrap: () => Promise<void>;
  mount: (props: MountProps) => Promise<void>;
  unmount: () => Promise<void>;
  update?: (props: MountProps) => Promise<void>;
}

interface MountProps {
  container: HTMLElement;
  props: Record<string, unknown>;
  onGlobalStateChange: (callback: (state: Record<string, unknown>) => void) => void;
  setGlobalState: (state: Record<string, unknown>) => void;
}

// 全局状态管理
class GlobalStateManager {
  private state: Record<string, unknown> = {};
  private listeners: Array<(state: Record<string, unknown>) => void> = [];

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  setState(partial: Record<string, unknown>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach(fn => fn(this.getState()));
  }

  onChange(callback: (state: Record<string, unknown>) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== callback);
    };
  }
}

const globalState = new GlobalStateManager();

// 资源加载器
class ResourceLoader {
  private static cache = new Map<string, MicroAppLifecycle>();

  static async load(entry: string): Promise<MicroAppLifecycle> {
    if (this.cache.has(entry)) {
      return this.cache.get(entry)!;
    }

    // 判断入口类型
    if (entry.endsWith('.js')) {
      return this.loadJSEntry(entry);
    } else {
      return this.loadHTMLEntry(entry);
    }
  }

  private static async loadJSEntry(url: string): Promise<MicroAppLifecycle> {
    const module = await import(/* @vite-ignore */ url);
    const lifecycle: MicroAppLifecycle = {
      bootstrap: module.bootstrap || (async () => {}),
      mount: module.mount,
      unmount: module.unmount,
      update: module.update,
    };
    this.cache.set(url, lifecycle);
    return lifecycle;
  }

  private static async loadHTMLEntry(url: string): Promise<MicroAppLifecycle> {
    const response = await fetch(url);
    const html = await response.text();

    // 解析 HTML，提取 JS 和 CSS 资源
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 收集样式
    const styles: string[] = [];
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = (link as HTMLLinkElement).href;
      if (href) styles.push(href);
    });
    doc.querySelectorAll('style').forEach(style => {
      styles.push(style.textContent || '');
    });

    // 收集脚本
    const scripts: string[] = [];
    doc.querySelectorAll('script[src]').forEach(script => {
      scripts.push((script as HTMLScriptElement).src);
    });

    // 返回从 HTML 中提取的生命周期
    // 实际实现会更复杂，这里简化处理
    const lifecycle: MicroAppLifecycle = {
      bootstrap: async () => {},
      mount: async (props: MountProps) => {
        // 注入样式
        for (const style of styles) {
          if (style.startsWith('http')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = style;
            props.container.appendChild(link);
          } else {
            const styleEl = document.createElement('style');
            styleEl.textContent = style;
            props.container.appendChild(styleEl);
          }
        }
        // 注入 HTML 模板
        const body = doc.querySelector('body');
        if (body) {
          const fragment = document.createDocumentFragment();
          Array.from(body.children).forEach(child => {
            if (child.tagName !== 'SCRIPT') {
              fragment.appendChild(child.cloneNode(true));
            }
          });
          props.container.appendChild(fragment);
        }
      },
      unmount: async () => {}
    };

    this.cache.set(url, lifecycle);
    return lifecycle;
  }

  static prefetch(entry: string): void {
    // 利用 requestIdleCallback 在空闲时预加载
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => this.load(entry));
    } else {
      setTimeout(() => this.load(entry), 1000);
    }
  }
}

// 生产级微前端容器
class MicroFrontendContainer extends HTMLElement {
  private shadow: ShadowRoot;
  private lifecycle: MicroAppLifecycle | null = null;
  private mounted = false;
  private unsubscribeState: (() => void) | null = null;

  static get observedAttributes(): string[] {
    return ['src', 'name', 'active', 'props'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.renderLoading();
  }

  connectedCallback(): void {
    const src = this.getAttribute('src');
    if (src) {
      this.loadAndMount(src);
    }
  }

  disconnectedCallback(): void {
    this.unmountApp();
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (!this.isConnected) return;

    switch (name) {
      case 'src':
        if (oldVal !== newVal && newVal) {
          this.unmountApp();
          this.renderLoading();
          this.loadAndMount(newVal);
        }
        break;
      case 'active':
        if (newVal === 'false' && this.mounted) {
          this.unmountApp();
        } else if (newVal !== 'false' && !this.mounted) {
          const src = this.getAttribute('src');
          if (src) this.loadAndMount(src);
        }
        break;
      case 'props':
        if (this.lifecycle?.update && this.mounted && newVal) {
          try {
            const props = JSON.parse(newVal);
            this.lifecycle.update(this.createMountProps(props));
          } catch (e) {
            console.warn('Invalid props JSON:', newVal);
          }
        }
        break;
    }
  }

  private renderLoading(): void {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          min-height: 100px;
        }
        .mf-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
          color: #8c8c8c;
          font-size: 14px;
        }
        .mf-loading::before {
          content: '';
          width: 20px;
          height: 20px;
          border: 2px solid #e8e8e8;
          border-top-color: #1890ff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-right: 8px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .mf-error {
          padding: 16px;
          background: #fff2f0;
          border: 1px solid #ffccc7;
          border-radius: 4px;
          color: #ff4d4f;
          font-size: 14px;
        }
        .mf-error-title {
          font-weight: 600;
          margin-bottom: 8px;
        }
        .mf-error-detail {
          color: #595959;
          font-size: 12px;
        }
        .mf-app-root {
          width: 100%;
        }
      </style>
      <div class="mf-loading">加载子应用中...</div>
      <div class="mf-app-root"></div>
    `;
  }

  private renderError(error: Error): void {
    const appRoot = this.shadow.querySelector('.mf-app-root');
    const loading = this.shadow.querySelector('.mf-loading');
    if (loading) loading.remove();
    if (appRoot) {
      appRoot.innerHTML = `
        <div class="mf-error">
          <div class="mf-error-title">子应用 ${this.getAttribute('name') || '未知'} 加载失败</div>
          <div class="mf-error-detail">${error.message}</div>
        </div>
      `;
    }
  }

  private createMountProps(extraProps?: Record<string, unknown>): MountProps {
    const container = this.shadow.querySelector('.mf-app-root') as HTMLElement;
    return {
      container,
      props: {
        ...this.getAttributeProps(),
        ...extraProps,
      },
      onGlobalStateChange: (callback) => {
        this.unsubscribeState = globalState.onChange(callback);
      },
      setGlobalState: (state) => {
        globalState.setState(state);
      },
    };
  }

  private getAttributeProps(): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    const skipAttrs = new Set(['src', 'name', 'active', 'props', 'class', 'style', 'id']);
    for (const attr of this.attributes) {
      if (!skipAttrs.has(attr.name)) {
        props[attr.name] = attr.value;
      }
    }
    // 合并 JSON props
    const jsonProps = this.getAttribute('props');
    if (jsonProps) {
      try {
        Object.assign(props, JSON.parse(jsonProps));
      } catch (e) { /* ignore */ }
    }
    return props;
  }

  private async loadAndMount(src: string): Promise<void> {
    try {
      this.lifecycle = await ResourceLoader.load(src);
      await this.lifecycle.bootstrap();
      await this.lifecycle.mount(this.createMountProps());

      // 移除 loading
      const loading = this.shadow.querySelector('.mf-loading');
      if (loading) loading.remove();

      this.mounted = true;

      this.dispatchEvent(new CustomEvent('micro-app:mounted', {
        bubbles: true,
        composed: true,
        detail: { name: this.getAttribute('name') }
      }));
    } catch (error) {
      this.renderError(error as Error);
      this.dispatchEvent(new CustomEvent('micro-app:error', {
        bubbles: true,
        composed: true,
        detail: { name: this.getAttribute('name'), error }
      }));
    }
  }

  private async unmountApp(): Promise<void> {
    if (this.lifecycle && this.mounted) {
      try {
        await this.lifecycle.unmount();
      } catch (error) {
        console.error(`[micro-frontend] unmount error:`, error);
      }
      this.mounted = false;
    }
  }
}

customElements.define('micro-frontend', MicroFrontendContainer);
```

这个容器在主应用中的使用方式极为简洁：

```html
<!DOCTYPE html>
<html>
<head>
  <title>微前端主应用</title>
  <style>
    :root {
      --theme-primary: #1890ff;
      --theme-success: #52c41a;
      --theme-spacing: 16px;
    }
    .app-layout {
      display: grid;
      grid-template-columns: 240px 1fr;
      grid-template-rows: 56px 1fr;
      height: 100vh;
    }
    .app-header { grid-column: 1 / -1; background: #001529; }
    .app-sidebar { background: #fff; border-right: 1px solid #e8e8e8; }
    .app-content { overflow: auto; padding: 24px; }
  </style>
</head>
<body>
  <div class="app-layout">
    <header class="app-header">
      <!-- 主应用自己的导航 -->
    </header>
    <aside class="app-sidebar">
      <nav>
        <a href="/order">订单管理</a>
        <a href="/product">商品管理</a>
        <a href="/user">用户中心</a>
      </nav>
    </aside>
    <main class="app-content">
      <!-- 微前端容器：声明式加载子应用 -->
      <micro-frontend
        id="main-app"
        name="order"
        src="https://cdn.example.com/apps/order/entry.js"
        api-base="https://api.example.com"
      ></micro-frontend>
    </main>
  </div>

  <script>
    // 路由变化时切换子应用
    const appRoutes = {
      '/order': 'https://cdn.example.com/apps/order/entry.js',
      '/product': 'https://cdn.example.com/apps/product/entry.js',
      '/user': 'https://cdn.example.com/apps/user/entry.js',
    };

    window.addEventListener('popstate', () => {
      const container = document.getElementById('main-app');
      const src = appRoutes[location.pathname];
      if (src) {
        container.setAttribute('src', src);
        container.setAttribute('name', location.pathname.slice(1));
      }
    });

    // 监听子应用事件
    document.addEventListener('micro-app:mounted', (e) => {
      console.log(`子应用 ${e.detail.name} 已就绪`);
    });

    document.addEventListener('micro-app:error', (e) => {
      console.error(`子应用 ${e.detail.name} 加载失败`, e.detail.error);
      // 可以上报错误监控
    });
  </script>
</body>
</html>
```

### 12.2.3 事件通信：composed 的秘密

在 Web Components 微前端架构中，事件通信有一个极其关键但容易被忽视的细节：**Shadow DOM 的事件 retarget 机制**。

```typescript
class EventDemo extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <button id="inner-btn">点击我</button>
    `;

    shadow.querySelector('#inner-btn')!.addEventListener('click', () => {
      // 事件 1：不设置 composed，事件在 Shadow Boundary 处停止
      this.dispatchEvent(new CustomEvent('internal-event', {
        bubbles: true,
        composed: false, // 默认值就是 false
        detail: { message: '我只能在 Shadow DOM 内部被捕获' }
      }));

      // 事件 2：设置 composed: true，事件穿透 Shadow Boundary
      this.dispatchEvent(new CustomEvent('public-event', {
        bubbles: true,
        composed: true,
        detail: { message: '我可以被外部的主应用捕获' }
      }));
    });
  }
}
customElements.define('event-demo', EventDemo);
```

事件穿透 Shadow Boundary 时，会发生 **event retarget**——事件的 `target` 属性会被重写为宿主元素（host element），而不是 Shadow DOM 内部的实际触发元素：

```typescript
// 主应用监听事件
document.querySelector('event-demo').addEventListener('public-event', (e) => {
  console.log(e.target);           // <event-demo> (宿主元素，而非内部按钮)
  console.log(e.composedPath());   // [button#inner-btn, ShadowRoot, event-demo, body, html, document, Window]
  console.log(e.detail.message);   // "我可以被外部的主应用捕获"
});

// 如果确实需要知道内部的触发元素，使用 composedPath()
document.querySelector('event-demo').addEventListener('public-event', (e) => {
  const path = e.composedPath();
  const realTarget = path[0]; // button#inner-btn
  console.log('实际触发元素:', realTarget);
});
```

> 💡 **深度洞察**：浏览器原生事件（如 `click`、`focus`、`input`）默认就是 `composed: true` 的——这是为了确保表单、键盘导航等基础功能不被 Shadow DOM 阻断。但自定义事件（CustomEvent）默认 `composed: false`。这个不对称的设计背后有深意：浏览器认为原生交互行为应该是全局可感知的，而业务逻辑事件是否穿透边界应该由开发者显式决定。在微前端中，这种显式控制正是我们需要的——**子应用的内部事件不应该泄漏到主应用，只有明确需要通信的事件才通过 `composed: true` 向上传递**。

## 12.3 Lit 框架的微前端实践

### 12.3.1 为什么是 Lit

当我们决定用 Web Components 构建微前端时，面临一个现实问题：原生 Web Components API 虽然功能完备，但写起来相当冗长。光是 `attachShadow`、`innerHTML`、`attributeChangedCallback` 这套仪式感满满的代码，就让很多习惯了 React/Vue 声明式编程的开发者望而却步。

Lit（由 Google 的 Polymer 团队打造）是目前最主流的 Web Components 增强框架，它在不偏离 Web 标准的前提下，提供了三个关键能力：

1. **响应式属性**：类似 Vue 的 reactive，属性变化自动触发重渲染
2. **声明式模板**：基于 Tagged Template Literals 的高效模板系统
3. **极小的体积**：核心库仅约 5KB（gzip），几乎不增加子应用负担

```typescript
// 原生 Web Components vs Lit 的对比

// ===== 原生写法（约 60 行）=====
class NativeCounter extends HTMLElement {
  private _count = 0;

  static get observedAttributes() { return ['count']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._render();
  }

  get count() { return this._count; }
  set count(val: number) {
    this._count = val;
    this._render();
  }

  attributeChangedCallback(name: string, _: string, newVal: string) {
    if (name === 'count') this.count = Number(newVal);
  }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        button { padding: 8px 16px; cursor: pointer; }
        span { margin: 0 12px; font-size: 18px; }
      </style>
      <button id="dec">-</button>
      <span>${this._count}</span>
      <button id="inc">+</button>
    `;
    this.shadowRoot!.getElementById('dec')!.onclick = () => { this.count--; };
    this.shadowRoot!.getElementById('inc')!.onclick = () => { this.count++; };
  }
}
customElements.define('native-counter', NativeCounter);

// ===== Lit 写法（约 25 行）=====
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('lit-counter')
class LitCounter extends LitElement {
  static styles = css`
    button { padding: 8px 16px; cursor: pointer; }
    span { margin: 0 12px; font-size: 18px; }
  `;

  @property({ type: Number }) count = 0;

  render() {
    return html`
      <button @click=${() => this.count--}>-</button>
      <span>${this.count}</span>
      <button @click=${() => this.count++}>+</button>
    `;
  }
}
```

代码量减半，可读性翻倍。而且 Lit 的模板系统不是简单的字符串拼接——它使用了 Tagged Template Literals，第一次渲染后会缓存模板结构，后续更新只对比变化的部分，性能接近手写 DOM 操作。

### 12.3.2 用 Lit 构建微前端子应用容器

```typescript
import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// 子应用注册表
interface AppRegistration {
  name: string;
  entry: string;
  activeRule: string;
  prefetch?: boolean;
  props?: Record<string, unknown>;
}

// 子应用状态
type AppStatus = 'idle' | 'loading' | 'bootstrapping' | 'mounted' | 'unmounting' | 'error';

@customElement('lit-micro-frontend')
class LitMicroFrontend extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      min-height: 100px;
    }

    .container {
      width: 100%;
      height: 100%;
    }

    .loading-overlay {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px;
      color: var(--mf-text-secondary, #8c8c8c);
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid var(--mf-border-color, #e8e8e8);
      border-top-color: var(--mf-primary-color, #1890ff);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-panel {
      padding: 24px;
      background: var(--mf-error-bg, #fff2f0);
      border: 1px solid var(--mf-error-border, #ffccc7);
      border-radius: 8px;
      margin: 16px;
    }

    .error-panel h3 {
      color: var(--mf-error-color, #ff4d4f);
      margin: 0 0 8px;
      font-size: 16px;
    }

    .error-panel p {
      color: var(--mf-text-secondary, #8c8c8c);
      margin: 0;
      font-size: 14px;
    }

    .error-panel button {
      margin-top: 16px;
      padding: 6px 16px;
      border: 1px solid var(--mf-border-color, #d9d9d9);
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 14px;
    }

    .error-panel button:hover {
      color: var(--mf-primary-color, #1890ff);
      border-color: var(--mf-primary-color, #1890ff);
    }
  `;

  @property({ type: String }) src = '';
  @property({ type: String }) name = '';
  @property({ type: Object }) appProps: Record<string, unknown> = {};

  @state() private status: AppStatus = 'idle';
  @state() private errorMessage = '';

  private lifecycle: any = null;
  private appContainer: HTMLDivElement | null = null;

  // Lit 的响应式更新机制：属性变化自动触发 updated
  updated(changedProperties: PropertyValues): void {
    if (changedProperties.has('src') && this.src) {
      // src 变化时重新加载
      this.reloadApp();
    }
    if (changedProperties.has('appProps') && this.lifecycle?.update) {
      // props 变化时通知子应用
      this.lifecycle.update({ props: this.appProps });
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unmountApp();
  }

  render() {
    return html`
      ${this.status === 'loading' || this.status === 'bootstrapping'
        ? html`
          <div class="loading-overlay">
            <div class="spinner"></div>
            <span>正在加载 ${this.name || '子应用'}...</span>
          </div>
        `
        : null
      }

      ${this.status === 'error'
        ? html`
          <div class="error-panel">
            <h3>${this.name || '子应用'} 加载失败</h3>
            <p>${this.errorMessage}</p>
            <button @click=${this.reloadApp}>重试</button>
          </div>
        `
        : null
      }

      <div class="container"></div>
    `;
  }

  firstUpdated(): void {
    this.appContainer = this.shadowRoot!.querySelector('.container');
    if (this.src) {
      this.reloadApp();
    }
  }

  private async reloadApp(): Promise<void> {
    await this.unmountApp();
    await this.loadAndMount();
  }

  private async loadAndMount(): Promise<void> {
    if (!this.src) return;

    this.status = 'loading';

    try {
      // 动态加载子应用模块
      const module = await import(/* @vite-ignore */ this.src);

      this.lifecycle = {
        bootstrap: module.bootstrap || (async () => {}),
        mount: module.mount,
        unmount: module.unmount,
        update: module.update,
      };

      // bootstrap 阶段
      this.status = 'bootstrapping';
      await this.lifecycle.bootstrap();

      // mount 阶段
      if (this.appContainer) {
        await this.lifecycle.mount({
          container: this.appContainer,
          props: { ...this.appProps, appName: this.name },
          onGlobalStateChange: (cb: Function) => {
            globalState.onChange(cb as any);
          },
          setGlobalState: (state: Record<string, unknown>) => {
            globalState.setState(state);
          },
        });
      }

      this.status = 'mounted';

      this.dispatchEvent(new CustomEvent('app-mounted', {
        bubbles: true,
        composed: true,
        detail: { name: this.name },
      }));
    } catch (error) {
      this.status = 'error';
      this.errorMessage = (error as Error).message;

      this.dispatchEvent(new CustomEvent('app-error', {
        bubbles: true,
        composed: true,
        detail: { name: this.name, error },
      }));
    }
  }

  private async unmountApp(): Promise<void> {
    if (this.lifecycle && this.status === 'mounted') {
      this.status = 'unmounting';
      try {
        await this.lifecycle.unmount();
      } catch (e) {
        console.error(`[lit-micro-frontend] ${this.name} unmount error:`, e);
      }
      if (this.appContainer) {
        this.appContainer.innerHTML = '';
      }
      this.lifecycle = null;
      this.status = 'idle';
    }
  }
}
```

### 12.3.3 基于 Lit 的主应用路由器

一个完整的微前端方案需要路由层来调度子应用。用 Lit 实现一个声明式的微前端路由器：

```typescript
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface RouteConfig {
  path: string;
  appName: string;
  entry: string;
  exact?: boolean;
  props?: Record<string, unknown>;
}

@customElement('micro-router')
class MicroRouter extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  @property({ type: Array }) routes: RouteConfig[] = [];
  @state() private currentRoute: RouteConfig | null = null;

  private handlePopState = () => this.matchRoute();

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('popstate', this.handlePopState);
    this.matchRoute();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this.handlePopState);
  }

  private matchRoute(): void {
    const pathname = window.location.pathname;
    const matched = this.routes.find(route => {
      if (route.exact) {
        return pathname === route.path;
      }
      return pathname.startsWith(route.path);
    });
    this.currentRoute = matched || null;
  }

  render() {
    if (!this.currentRoute) {
      return html`<slot name="not-found"><p>404 - 未找到对应的子应用</p></slot>`;
    }

    return html`
      <lit-micro-frontend
        .src=${this.currentRoute.entry}
        .name=${this.currentRoute.appName}
        .appProps=${{
          ...this.currentRoute.props,
          basePath: this.currentRoute.path
        }}
        @app-mounted=${this.onAppMounted}
        @app-error=${this.onAppError}
      ></lit-micro-frontend>
    `;
  }

  private onAppMounted(e: CustomEvent): void {
    console.log(`[router] ${e.detail.name} mounted at ${window.location.pathname}`);
  }

  private onAppError(e: CustomEvent): void {
    console.error(`[router] ${e.detail.name} failed:`, e.detail.error);
  }

  // 提供编程式导航方法
  navigate(path: string): void {
    window.history.pushState(null, '', path);
    this.matchRoute();
  }
}
```

在主应用 HTML 中：

```html
<script type="module">
  import './components/micro-router.js';
  import './components/lit-micro-frontend.js';

  const router = document.querySelector('micro-router');
  router.routes = [
    {
      path: '/dashboard',
      appName: 'dashboard',
      entry: 'https://cdn.example.com/apps/dashboard/main.js',
      exact: true,
    },
    {
      path: '/order',
      appName: 'order',
      entry: 'https://cdn.example.com/apps/order/main.js',
      props: { permissions: ['read', 'write'] },
    },
    {
      path: '/product',
      appName: 'product',
      entry: 'https://cdn.example.com/apps/product/main.js',
    },
    {
      path: '/analytics',
      appName: 'analytics',
      entry: 'https://cdn.example.com/apps/analytics/main.js',
      props: { dateRange: 'last30days' },
    },
  ];
</script>

<body>
  <app-header></app-header>
  <div class="layout">
    <app-sidebar></app-sidebar>
    <main>
      <micro-router>
        <div slot="not-found">
          <h2>页面未找到</h2>
          <p>请检查 URL 是否正确</p>
        </div>
      </micro-router>
    </main>
  </div>
</body>
```

### 12.3.4 子应用如何适配 Web Components 容器

不管子应用是 React、Vue 还是 Angular，只要导出标准的生命周期函数，就可以被 Web Components 容器加载：

```typescript
// React 子应用的适配层 —— order-app/main.ts
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './App';

let root: Root | null = null;

export async function bootstrap(): Promise<void> {
  console.log('[order-app] bootstrap');
}

export async function mount(props: {
  container: HTMLElement;
  props: Record<string, unknown>;
  onGlobalStateChange: (cb: (state: any) => void) => void;
  setGlobalState: (state: any) => void;
}): Promise<void> {
  const { container, props: appProps, onGlobalStateChange, setGlobalState } = props;

  // 在 Shadow DOM 内部创建挂载点
  const mountPoint = document.createElement('div');
  mountPoint.id = 'order-app-root';
  container.appendChild(mountPoint);

  root = createRoot(mountPoint);
  root.render(
    React.createElement(App, {
      ...appProps,
      onGlobalStateChange,
      setGlobalState,
    })
  );
}

export async function unmount(): Promise<void> {
  if (root) {
    root.unmount();
    root = null;
  }
}

export async function update(props: { props: Record<string, unknown> }): Promise<void> {
  // React 子应用可以通过 context 或 store 来响应 props 更新
  console.log('[order-app] props updated:', props);
}
```

```typescript
// Vue 子应用的适配层 —— product-app/main.ts
import { createApp, App as VueApp } from 'vue';
import AppComponent from './App.vue';
import router from './router';
import { createPinia } from 'pinia';

let app: VueApp | null = null;

export async function bootstrap(): Promise<void> {
  console.log('[product-app] bootstrap');
}

export async function mount(props: {
  container: HTMLElement;
  props: Record<string, unknown>;
}): Promise<void> {
  const { container, props: appProps } = props;

  const mountPoint = document.createElement('div');
  mountPoint.id = 'product-app-root';
  container.appendChild(mountPoint);

  app = createApp(AppComponent);
  app.use(router);
  app.use(createPinia());

  // 注入全局属性，子应用内部可通过 inject 获取
  app.provide('microAppProps', appProps);

  // 如果子应用有自己的路由，需要设置 base
  const basePath = (appProps as any).basePath || '/';
  router.replace(location.pathname.replace(basePath, '/') || '/');

  app.mount(mountPoint);
}

export async function unmount(): Promise<void> {
  if (app) {
    app.unmount();
    app = null;
  }
}
```

> 💡 **深度洞察**：注意 React 子应用在 Shadow DOM 内部运行时有一个隐藏的陷阱。React 17+ 将事件委托到 `rootNode` 而非 `document`——如果 `rootNode` 是 Shadow DOM 内部的元素，React 的事件系统可以正常工作。但 React 16 及更早版本将事件委托到 `document`，这会导致 Shadow DOM 内部的事件冒泡路径出现问题，`event.target` 指向宿主元素而非实际点击的元素。如果你的子应用不得不使用 React 16，需要在容器层做事件转发处理。

## 12.4 Web Components 的局限：SSR、表单、Accessibility

Web Components 不是银弹。当你决定在微前端架构中重度使用 Web Components 时，必须正视它的三大局限。这些局限不是"小问题"——在某些场景下，它们是架构级的阻碍。

### 12.4.1 SSR：最大的痛点

服务端渲染是 Web Components 最大的短板，没有之一。

问题的根源在于：**Shadow DOM 在 HTML 规范中没有声明式的序列化格式**。传统的 SSR 把组件渲染成 HTML 字符串发送给浏览器，但 Shadow DOM 无法用 HTML 字符串来表达。

```html
<!-- 这是 React SSR 的输出，浏览器可以直接渲染 -->
<div class="counter">
  <button>-</button>
  <span>0</span>
  <button>+</button>
</div>

<!-- 但 Shadow DOM 的"SSR 输出"应该长什么样？ -->
<!-- 答案：直到 Declarative Shadow DOM 出现之前，没有标准方式 -->
```

**Declarative Shadow DOM (DSD)** 是 Chrome 90+ 引入的新特性，它试图解决这个问题：

```html
<!-- Declarative Shadow DOM：在 HTML 中声明 Shadow DOM -->
<my-counter>
  <template shadowrootmode="open">
    <style>
      button { padding: 8px 16px; }
      span { margin: 0 12px; font-size: 18px; }
    </style>
    <button id="dec">-</button>
    <span>0</span>
    <button id="inc">+</button>
  </template>
</my-counter>
```

但现实并不乐观：

```typescript
// 使用 Lit 的 SSR 方案（@lit-labs/ssr）
// 这是目前最成熟的 Web Components SSR 方案

// server.ts
import { render } from '@lit-labs/ssr';
import { html } from 'lit';
import './components/my-counter.js'; // 服务端也需要加载组件定义

async function renderPage(): Promise<string> {
  const templateResult = html`
    <!DOCTYPE html>
    <html>
      <body>
        <my-counter count="5"></my-counter>
        <script type="module" src="/components/my-counter.js"></script>
      </body>
    </html>
  `;

  // Lit SSR 会生成包含 Declarative Shadow DOM 的 HTML
  const chunks: string[] = [];
  for await (const chunk of render(templateResult)) {
    chunks.push(chunk as string);
  }
  return chunks.join('');
}
```

DSD 的兼容性与现状：

| 浏览器 | Declarative Shadow DOM 支持 |
|--------|---------------------------|
| Chrome 90+ | 完全支持 |
| Edge 90+ | 完全支持 |
| Safari 16.4+ | 完全支持 |
| Firefox 123+ | 完全支持 |

到 2026 年，主流浏览器已经全部支持 DSD。但在微前端场景中，问题更加复杂：

```typescript
// 微前端 SSR 的挑战：主应用和子应用的渲染时序

// 场景：主应用在服务端渲染时，需要同时渲染子应用容器
// 但子应用可能部署在不同的服务上，有自己的 SSR 流程

// 主应用的 SSR
async function renderMainApp(url: string): Promise<string> {
  const matchedRoute = matchRoute(url);

  // 问题 1：需要跨服务调用子应用的 SSR
  const subAppHtml = await fetch(`${matchedRoute.ssrEndpoint}/render?path=${url}`);

  // 问题 2：子应用的 Shadow DOM HTML 需要嵌入主应用的 HTML 中
  // 但 Shadow DOM 的样式和 DOM 结构是隔离的，组合起来很复杂

  // 问题 3：Hydration 阶段，Custom Element 的 upgrade 时序
  // 浏览器解析 HTML 时会先看到 Declarative Shadow DOM
  // 然后 JS 加载后 Custom Element 定义被注册
  // 此时需要确保 hydration 不会丢失已有的 Shadow DOM 状态

  return `
    <!DOCTYPE html>
    <html>
      <body>
        <micro-frontend name="${matchedRoute.appName}">
          <template shadowrootmode="open">
            <style>/* 容器样式 */</style>
            <div class="container">
              ${subAppHtml}  <!-- 子应用 SSR 的 HTML 嵌入此处 -->
            </div>
          </template>
        </micro-frontend>
        <script type="module" src="/micro-frontend.js"></script>
        <script type="module" src="${matchedRoute.clientEntry}"></script>
      </body>
    </html>
  `;
}
```

> 💡 **深度洞察**：Web Components SSR 的根本困难不在技术实现，而在**架构理念的冲突**。SSR 的核心假设是"组件可以被序列化为字符串"，而 Shadow DOM 的核心设计是"创建一个独立的文档片段"。这两个目标天然矛盾。Declarative Shadow DOM 是一个妥协方案——它让 Shadow DOM 可以被声明式地表达在 HTML 中，但这个表达并不完美（比如无法表达事件监听器、无法表达组件内部状态）。在微前端场景中，如果你的应用对首屏渲染速度和 SEO 有强需求，**目前最务实的策略是：主应用的外壳（导航、侧边栏）做 SSR，子应用内容区域做 CSR**。不要试图在微前端场景下追求完美的全量 SSR。

### 12.4.2 表单集成：Shadow DOM 与原生表单的断裂

Shadow DOM 内部的表单元素与外部的 `<form>` 之间存在天然的隔离——这在微前端的跨应用表单场景中是一个真实的问题。

```html
<!-- 问题演示：Shadow DOM 内部的 input 不会参与外部 form 的提交 -->
<form id="outer-form" onsubmit="handleSubmit(event)">
  <label>用户名：<input name="username" value="test"></label>

  <!-- 这个自定义元素内部有一个 input -->
  <custom-input name="email"></custom-input>

  <button type="submit">提交</button>
</form>

<script>
  function handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    console.log('username:', formData.get('username')); // "test" ✅
    console.log('email:', formData.get('email'));        // null ❌ Shadow DOM 内部的 input 不参与
  }
</script>
```

**ElementInternals API** 是解决这个问题的标准方案：

```typescript
// 使用 ElementInternals 让 Custom Element 参与表单
class FormInput extends HTMLElement {
  private internals: ElementInternals;
  private input: HTMLInputElement;

  // 声明此元素可以参与表单
  static formAssociated = true;

  constructor() {
    super();
    // attachInternals 获取 ElementInternals 实例
    this.internals = this.attachInternals();

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }
        input {
          padding: 8px 12px;
          border: 1px solid #d9d9d9;
          border-radius: 4px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.3s;
        }
        input:focus {
          border-color: #1890ff;
          box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
        }
        :host(:invalid) input {
          border-color: #ff4d4f;
        }
        .error-message {
          color: #ff4d4f;
          font-size: 12px;
          margin-top: 4px;
          display: none;
        }
        :host(:invalid) .error-message {
          display: block;
        }
      </style>
      <input type="text" />
      <div class="error-message">
        <slot name="error">请填写此字段</slot>
      </div>
    `;

    this.input = shadow.querySelector('input')!;

    this.input.addEventListener('input', () => {
      // 通过 internals.setFormValue 设置表单值
      this.internals.setFormValue(this.input.value);
      this.validate();
    });
  }

  // 表单相关的回调
  formResetCallback(): void {
    this.input.value = '';
    this.internals.setFormValue('');
  }

  formStateRestoreCallback(state: string): void {
    this.input.value = state;
    this.internals.setFormValue(state);
  }

  formDisabledCallback(disabled: boolean): void {
    this.input.disabled = disabled;
  }

  // 自定义校验
  private validate(): void {
    if (this.hasAttribute('required') && !this.input.value) {
      this.internals.setValidity(
        { valueMissing: true },
        '此字段为必填项',
        this.input
      );
    } else if (this.hasAttribute('pattern')) {
      const pattern = new RegExp(this.getAttribute('pattern')!);
      if (!pattern.test(this.input.value)) {
        this.internals.setValidity(
          { patternMismatch: true },
          this.getAttribute('title') || '格式不正确',
          this.input
        );
      } else {
        this.internals.setValidity({});
      }
    } else {
      this.internals.setValidity({});
    }
  }

  connectedCallback(): void {
    if (this.hasAttribute('value')) {
      this.input.value = this.getAttribute('value')!;
      this.internals.setFormValue(this.input.value);
    }
    if (this.hasAttribute('placeholder')) {
      this.input.placeholder = this.getAttribute('placeholder')!;
    }
  }
}

customElements.define('form-input', FormInput);
```

```html
<!-- 现在 Custom Element 可以正常参与表单了 -->
<form id="registration" onsubmit="handleSubmit(event)">
  <form-input name="username" required placeholder="请输入用户名"></form-input>
  <form-input name="email" required pattern="[^@]+@[^@]+"
              title="请输入有效的邮箱地址" placeholder="请输入邮箱"></form-input>
  <button type="submit">注册</button>
</form>

<script>
  function handleSubmit(e) {
    e.preventDefault();
    const form = e.target;

    if (form.checkValidity()) {
      const formData = new FormData(form);
      console.log('username:', formData.get('username')); // 正常获取 ✅
      console.log('email:', formData.get('email'));        // 正常获取 ✅
    } else {
      form.reportValidity(); // 触发浏览器原生的校验 UI
    }
  }
</script>
```

在微前端场景中，表单集成的问题主要出现在：**主应用和子应用需要共享表单上下文时**。比如一个结算页面，地址部分由子应用 A 提供，支付部分由子应用 B 提供，但最终需要作为一个整体提交。`ElementInternals` 可以解决单个 Custom Element 参与表单的问题，但跨多个 Shadow DOM 的表单编排，仍然需要在应用层做状态协调。

### 12.4.3 Accessibility：被 Shadow DOM 打碎的无障碍树

无障碍访问（Accessibility，简称 A11y）是 Web Components 最容易被忽视、但后果最严重的问题。

浏览器会为页面构建一棵**无障碍树**（Accessibility Tree），屏幕阅读器通过这棵树来理解页面结构。Shadow DOM 会影响这棵树的构建方式：

```typescript
// 问题演示：焦点管理在 Shadow DOM 中的行为
class FocusTrapDemo extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open', delegatesFocus: true });
    shadow.innerHTML = `
      <style>
        :host { display: block; padding: 16px; border: 2px solid #e8e8e8; }
        :host(:focus-within) { border-color: #1890ff; }
        input { display: block; margin: 8px 0; padding: 8px; width: 200px; }
      </style>
      <label>
        <span>Shadow DOM 内的输入框 1</span>
        <input type="text" />
      </label>
      <label>
        <span>Shadow DOM 内的输入框 2</span>
        <input type="text" />
      </label>
    `;
  }
}

customElements.define('focus-trap-demo', FocusTrapDemo);
```

几个关键的 A11y 问题和解决方案：

**1. ARIA 引用穿不透 Shadow Boundary**

```html
<!-- 问题：aria-labelledby 无法引用 Shadow DOM 内部的元素 -->
<label id="outer-label">这是外部标签</label>
<my-input aria-labelledby="outer-label"></my-input>

<!-- 但如果 label 在另一个 Shadow DOM 内部，就引用不到了 -->
```

```typescript
// 解决方案：使用 ElementInternals 的 ARIA 代理
class AccessibleInput extends HTMLElement {
  static formAssociated = true;

  constructor() {
    super();
    const internals = this.attachInternals();
    const shadow = this.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <input type="text" />
    `;

    const input = shadow.querySelector('input')!;

    // 通过 internals 设置 ARIA 属性，这些属性会反映在宿主元素上
    // 让外部的无障碍树可以正确理解这个组件
    internals.ariaLabel = this.getAttribute('label') || '';
    internals.ariaRequired = this.hasAttribute('required') ? 'true' : 'false';
  }
}
customElements.define('accessible-input', AccessibleInput);
```

**2. 焦点顺序（Tab Order）的控制**

```typescript
// delegatesFocus: true 的作用
class DelegatedFocus extends HTMLElement {
  constructor() {
    super();
    // delegatesFocus: true 意味着：
    // 1. 当宿主元素被 focus 时，焦点会委托给 Shadow DOM 内部第一个可聚焦的元素
    // 2. 宿主元素的 :focus 伪类会在内部元素获得焦点时激活
    // 3. tabIndex 的计算会考虑 Shadow DOM 内部的元素
    const shadow = this.attachShadow({
      mode: 'open',
      delegatesFocus: true
    });

    shadow.innerHTML = `
      <style>
        :host(:focus-within) {
          outline: 2px solid #1890ff;
          outline-offset: 2px;
        }
        button {
          padding: 8px 16px;
          margin: 4px;
        }
      </style>
      <button>操作 A</button>
      <button>操作 B</button>
      <button>操作 C</button>
    `;
  }
}

customElements.define('delegated-focus', DelegatedFocus);
```

**3. 屏幕阅读器的 Shadow DOM 遍历**

```typescript
// 为微前端容器添加完整的 ARIA 语义
class AccessibleMicroApp extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });

    // 关键：为容器设置合适的 ARIA role 和属性
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .app-region {
          position: relative;
        }
        .loading-announcement {
          /* 视觉隐藏但屏幕阅读器可见 */
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
      </style>
      <div class="app-region"
           role="region"
           aria-label="${this.getAttribute('aria-app-name') || '子应用'}">
        <!-- 使用 aria-live 区域通知屏幕阅读器加载状态 -->
        <div class="loading-announcement"
             role="status"
             aria-live="polite"></div>
        <slot></slot>
      </div>
    `;
  }

  connectedCallback(): void {
    this.announceToScreenReader('子应用正在加载');
  }

  announceToScreenReader(message: string): void {
    const announcement = this.shadowRoot!.querySelector('.loading-announcement');
    if (announcement) {
      announcement.textContent = message;
    }
  }

  onAppMounted(): void {
    this.announceToScreenReader('子应用已加载完成');
  }

  onAppError(): void {
    this.announceToScreenReader('子应用加载失败，请稍后重试');
  }
}

customElements.define('accessible-micro-app', AccessibleMicroApp);
```

> 💡 **深度洞察**：无障碍访问不是"可选的附加功能"——在欧盟的《欧洲无障碍法案》（European Accessibility Act，2025 年 6 月生效）和美国的 ADA 合规要求下，Web 应用的无障碍能力已经是**法律义务**。如果你的微前端架构重度使用 Shadow DOM，必须在架构设计阶段就将 A11y 纳入考量，而不是事后补救。`ElementInternals` 和 `delegatesFocus` 是两个最关键的 API，确保你的团队从第一天就使用它们。

### 12.4.4 一张决策表：什么时候该用 Web Components

综合以上分析，我们可以得出一张实用的决策矩阵：

| 场景 | Web Components 适合度 | 说明 |
|------|---------------------|------|
| CSS 隔离需求强 | ★★★★★ | Shadow DOM 是最完美的 CSS 隔离方案 |
| 多框架共存（React + Vue） | ★★★★★ | Custom Elements 是唯一的框架无关标准 |
| 纯 CSR 应用 | ★★★★☆ | 完全没有 SSR 的困扰 |
| 子应用是独立团队维护的 | ★★★★☆ | 标准化的接口契约，降低协作成本 |
| 需要全量 SSR | ★★☆☆☆ | DSD 已可用但微前端 SSR 编排仍然复杂 |
| 复杂的跨应用表单 | ★★★☆☆ | ElementInternals 可解决单层，多层仍需协调 |
| 强 A11y 要求 | ★★★☆☆ | 可行但需要额外的 ARIA 处理工作 |
| 已有大量 jQuery/原生 JS 遗留代码 | ★★★★★ | Web Components 与任何技术栈兼容 |
| 对包体积极度敏感 | ★★★★★ | 零框架依赖，原生 API 无额外开销 |
| 需要 IE 11 支持 | ☆☆☆☆☆ | 不可能，即使 polyfill 也问题极多 |

最终，**Web Components 在微前端架构中的定位不是"取代乾坤/Module Federation"，而是作为它们的底层基础设施**。乾坤用 Shadow DOM 做样式隔离，无界用 Custom Elements 做容器，Module Federation 的远程组件也可以包装为 Web Components 来消费。理解 Web Components，不是为了只用 Web Components，而是为了理解所有微前端方案共同的浏览器原生根基。

---

## 本章小结

- **Shadow DOM** 提供浏览器原生的 DOM/CSS 隔离，`open` 模式适合微前端容器，CSS 自定义属性可以穿透 Shadow Boundary 传递设计令牌
- **Custom Elements** 的四个生命周期回调（`constructor`、`connectedCallback`、`disconnectedCallback`、`attributeChangedCallback`）与微前端的 bootstrap-mount-unmount 模型天然对应
- **Lit 框架** 在不偏离 Web 标准的前提下，将 Web Components 的开发体验提升到接近 React/Vue 的水平，适合构建微前端容器和路由系统
- **SSR 是 Web Components 最大的短板**，Declarative Shadow DOM 已在主流浏览器全面支持，但微前端场景下的 SSR 编排仍然复杂，务实策略是"外壳 SSR + 子应用 CSR"
- **表单集成** 依赖 `ElementInternals` API，单层 Custom Element 可以完美参与原生表单，但跨多个 Shadow DOM 的表单编排需要应用层协调
- **Accessibility** 需要从架构设计阶段纳入考量，`ElementInternals` 的 ARIA 代理和 `delegatesFocus` 是两个不可或缺的工具
- Web Components 在微前端中的定位是**底层基础设施**，不是替代方案——理解它，是为了理解所有微前端框架共同的浏览器原生根基

## 思考题

1. **概念辨析**：Shadow DOM 的 `open` 模式和 `closed` 模式在安全性上有何本质区别？为什么说 `closed` 模式不能用于安全隔离？如果一个微前端场景确实需要防止子应用读取容器内部的 DOM 结构，应该使用什么方案？

2. **实践设计**：假设你需要设计一个微前端容器，要求：(a) 子应用之间完全样式隔离；(b) 主应用可以通过设计令牌统一所有子应用的视觉风格；(c) 子应用可以向主应用派发事件。请画出这个容器的架构图，并说明 Shadow DOM、CSS Custom Properties 和 Custom Events 分别在其中扮演什么角色。

3. **框架对比**：对比原生 Web Components、Lit、Stencil 三种 Web Components 开发方式在微前端场景中的优劣。重点考虑：开发体验、运行时开销、SSR 支持、社区生态四个维度。

4. **难题攻坚**：你的团队正在将一个大型电商应用迁移到微前端架构。结算页面需要跨三个子应用收集表单数据（地址信息、商品确认、支付方式）。每个子应用都使用了 Shadow DOM 做样式隔离。请设计一个方案，让这三个子应用的表单数据可以作为一个整体提交，同时保持样式隔离不被破坏。

5. **前瞻思考**：随着 Declarative Shadow DOM 的全面普及和 `ElementInternals` API 的成熟，你认为 Web Components 在微前端领域会从"底层基础设施"演变为"主流方案"吗？需要什么条件才能促成这种转变？

</div>
