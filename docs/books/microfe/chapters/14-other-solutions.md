<div v-pre>

# 第14章 其他前沿方案

> "当所有人都在争论哪个框架更好时，真正的变革往往来自一个没人注意到的浏览器标准提案。"

> **本章要点**
> - 深入理解 Garfish（字节跳动）的 Loader/Router/Sandbox 三层架构，以及它对乾坤设计哲学的继承与超越
> - 掌握 Micro App（京东）基于 WebComponent 自定义元素的微前端实现路线及其设计取舍
> - 理解 Import Maps 浏览器原生模块加载规范的工作机制，以及它如何改变微前端的依赖共享范式
> - 把握 Server-Driven UI、Server Islands、边缘计算组合等前沿趋势与微前端的融合方向

---

前面的章节中，我们花了大量篇幅剖析乾坤、single-spa、Module Federation 和 Wujie——这些是 2026 年微前端领域的"四大天王"，覆盖了绝大多数生产场景。但微前端的版图远不止这四个名字。

字节跳动内部孵化的 Garfish，在抖音电商、飞书等超大规模场景中经历了严苛的生产验证；京东的 Micro App 另辟蹊径，用 WebComponent 自定义元素重新定义了子应用的加载与隔离范式；而浏览器原生的 Import Maps 规范，正在悄悄削弱"我们为什么需要一个微前端框架"这个根基性假设。

更远处，Server-Driven UI 和 Server Islands 等服务端驱动的架构模式，正在模糊前端微服务与后端微服务之间的边界。当 CDN 边缘节点可以在 5ms 内完成 HTML 片段的组合，当服务端可以动态决定每个 UI 区域加载哪个版本的哪个组件——传统意义上的"前端微前端"是否还有存在的必要？

这一章，我们不追求面面俱到的 API 文档式罗列，而是抓住每个方案的**核心设计决策**和**本质差异点**，帮助你在已有的架构认知框架上，快速定位这些方案的坐标。

## 14.1 Garfish（字节跳动）：乾坤的继承者

### 14.1.1 从字节的痛点说起

2021 年，字节跳动的前端团队面临一个现实问题：乾坤在中小规模场景下表现优秀，但当子应用数量超过 20 个、页面级别的动态组合需求出现时，乾坤的一些设计假设开始被挑战。

最典型的三个痛点：

1. **预加载策略过于粗放**——乾坤的 `prefetch` 要么全量预加载，要么不加载，缺乏基于路由优先级的细粒度控制
2. **路由与应用的绑定过于刚性**——一个路由对应一个子应用的模型，在"同一个页面需要组合多个子应用的不同区域"时力不从心
3. **沙箱性能在高频切换场景下不够理想**——飞书等 SaaS 产品的用户可能在一分钟内切换十几次页面，沙箱的创建和销毁开销变得不可忽视

Garfish 就是在这样的背景下诞生的。它的设计目标很明确：**保留乾坤"运行时沙箱 + HTML Entry"的核心范式，在此基础上解决大规模、高频次、多区域的工程化问题。**

### 14.1.2 三层架构：Loader、Router、Sandbox

Garfish 的架构可以用三个核心模块来概括。与乾坤将加载、路由、沙箱逻辑耦合在主流程中不同，Garfish 做了更清晰的分层：

```
┌─────────────────────────────────────────────────┐
│                   Garfish 核心                    │
│                                                   │
│  ┌─────────┐   ┌─────────┐   ┌──────────────┐   │
│  │  Loader  │   │  Router  │   │   Sandbox    │   │
│  │  资源加载 │   │  路由管理 │   │   JS/CSS隔离 │   │
│  │          │   │          │   │              │   │
│  │ ·HTML解析│   │ ·路由劫持 │   │ ·Proxy沙箱  │   │
│  │ ·JS提取  │   │ ·激活规则 │   │ ·快照沙箱   │   │
│  │ ·CSS提取 │   │ ·多实例   │   │ ·样式隔离   │   │
│  │ ·预加载  │   │ ·嵌套路由 │   │ ·副作用收集 │   │
│  └─────────┘   └─────────┘   └──────────────┘   │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │              Plugin System (插件系统)         │ │
│  │   生命周期钩子 ─ 资源转换 ─ 沙箱扩展         │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Loader（资源加载器）** 负责获取和解析子应用资源。来看核心流程：

```typescript
// Garfish Loader 核心流程（简化自源码）
interface AppInfo {
  name: string;
  entry: string;           // 子应用入口 URL
  activeWhen?: string;     // 路由激活规则
  cache?: boolean;         // 是否启用缓存
}

class Loader {
  private appCache: Map<string, AppCacheItem> = new Map();
  private loadingMap: Map<string, Promise<AppResources>> = new Map();

  async loadApp(appInfo: AppInfo): Promise<AppResources> {
    const { name, entry, cache } = appInfo;

    // 1. 命中缓存：直接返回
    if (cache && this.appCache.has(name)) {
      return this.appCache.get(name)!.resources;
    }

    // 2. 正在加载：复用 Promise，避免重复请求
    if (this.loadingMap.has(name)) {
      return this.loadingMap.get(name)!;
    }

    // 3. 发起加载
    const loadPromise = this.fetchAndParse(entry);
    this.loadingMap.set(name, loadPromise);

    try {
      const resources = await loadPromise;
      if (cache) {
        this.appCache.set(name, {
          resources,
          timestamp: Date.now(),
        });
      }
      return resources;
    } finally {
      this.loadingMap.delete(name);
    }
  }

  private async fetchAndParse(entry: string): Promise<AppResources> {
    // 获取 HTML
    const html = await fetch(entry).then(res => res.text());

    // 解析 HTML，提取 JS 和 CSS 资源
    const { scripts, styles, template } = parseHTML(html, entry);

    // 并行加载所有 JS 和 CSS
    const [jsContents, cssContents] = await Promise.all([
      Promise.all(scripts.map(src => this.fetchScript(src))),
      Promise.all(styles.map(href => this.fetchStyle(href))),
    ]);

    return { template, jsContents, cssContents, scripts, styles };
  }
}
```

与乾坤的 `import-html-entry` 相比，Garfish 的 Loader 有两个关键改进：

1. **去重加载**——通过 `loadingMap` 避免对同一个子应用的并发重复请求。在预加载和用户导航同时触发时，这个细节可以避免双倍的网络开销。
2. **细粒度缓存控制**——支持按应用粒度开关缓存，而不是全局的开或关。对于频繁变更的子应用可以关闭缓存，对于稳定的公共模块则开启缓存。

**Router（路由管理器）** 是 Garfish 与乾坤差异最大的模块：

```typescript
// Garfish Router 的多实例路由匹配
interface RouterConfig {
  // 支持多个子应用同时激活
  apps: Array<{
    name: string;
    activeWhen: string | ((path: string) => boolean);
    // 关键：指定子应用挂载到哪个 DOM 容器
    domGetter: string | (() => HTMLElement);
  }>;
  // 路由拦截策略
  autoRefreshApp?: boolean;
  // 基础路径
  basename?: string;
}

class GarfishRouter {
  private apps: Map<string, RouterAppConfig> = new Map();
  private activeApps: Set<string> = new Set();

  /**
   * 核心方法：根据当前 URL 计算需要激活和销毁的子应用
   * 与乾坤的 "一个路由 = 一个子应用" 不同，
   * Garfish 允许同一路由下激活多个子应用
   */
  async reroute(currentPath: string): Promise<void> {
    const nextActiveApps = new Set<string>();

    // 遍历所有注册的子应用，判断哪些应该被激活
    for (const [name, config] of this.apps) {
      if (this.matchRoute(currentPath, config.activeWhen)) {
        nextActiveApps.add(name);
      }
    }

    // 计算需要卸载的子应用
    const appsToUnmount = [...this.activeApps]
      .filter(name => !nextActiveApps.has(name));

    // 计算需要挂载的子应用
    const appsToMount = [...nextActiveApps]
      .filter(name => !this.activeApps.has(name));

    // 先卸载，再挂载（保证 DOM 清理在前）
    await Promise.all(appsToUnmount.map(name => this.unmountApp(name)));
    await Promise.all(appsToMount.map(name => this.mountApp(name)));

    this.activeApps = nextActiveApps;
  }

  private matchRoute(
    path: string,
    rule: string | ((path: string) => boolean)
  ): boolean {
    if (typeof rule === 'function') return rule(path);
    // 支持通配符和前缀匹配
    return path.startsWith(rule);
  }
}
```

**多实例激活**是 Garfish 路由设计的核心竞争力。在飞书这样的产品中，一个页面的左侧导航、中间内容区、右侧面板可能分别由三个不同的子应用提供。乾坤的"一个路由绑定一个子应用"模型处理这种场景需要大量的 workaround，而 Garfish 从路由层面原生支持。

**Sandbox（沙箱系统）** 在原理上与乾坤的 Proxy 沙箱一脉相承，但做了重要的性能优化：

```typescript
// Garfish 沙箱的副作用收集机制
class GarfishSandbox {
  private fakeWindow: Record<string, any>;
  private proxyWindow: WindowProxy;
  // 关键优化：副作用收集器
  private sideEffects: Array<() => void> = [];

  constructor() {
    this.fakeWindow = Object.create(null);
    this.proxyWindow = new Proxy(this.fakeWindow, {
      get: (target, key: string) => {
        // 优先从沙箱自身读取
        if (key in target) return target[key];
        // 回退到真实 window
        const value = (window as any)[key];
        // 如果是函数，需要绑定到真实 window（避免 this 指向问题）
        if (typeof value === 'function' && !this.isConstructor(value)) {
          return value.bind(window);
        }
        return value;
      },
      set: (target, key: string, value) => {
        target[key] = value;
        // 记录副作用，以便沙箱销毁时回收
        this.sideEffects.push(() => {
          delete target[key];
        });
        return true;
      },
    });
  }

  /**
   * 关键优化：拦截 addEventListener，
   * 在沙箱销毁时自动移除所有事件监听
   */
  patchEventListener(): void {
    const rawAddEventListener = window.addEventListener;
    const rawRemoveEventListener = window.removeEventListener;
    const listenerMap = new Map<string, Set<EventListener>>();

    this.proxyWindow.addEventListener = (
      type: string,
      listener: EventListener,
      options?: boolean | AddEventListenerOptions
    ) => {
      if (!listenerMap.has(type)) {
        listenerMap.set(type, new Set());
      }
      listenerMap.get(type)!.add(listener);
      rawAddEventListener.call(window, type, listener, options);
    };

    // 沙箱销毁时，自动移除所有注册的事件监听
    this.sideEffects.push(() => {
      for (const [type, listeners] of listenerMap) {
        for (const listener of listeners) {
          rawRemoveEventListener.call(window, type, listener);
        }
      }
      listenerMap.clear();
    });
  }

  /**
   * 沙箱销毁：逆序执行所有副作用回收
   */
  destroy(): void {
    // 逆序执行，保证后添加的副作用先被清理
    for (let i = this.sideEffects.length - 1; i >= 0; i--) {
      this.sideEffects[i]();
    }
    this.sideEffects = [];
  }

  private isConstructor(fn: Function): boolean {
    try {
      new (fn as any)();
      return true;
    } catch {
      return false;
    }
  }
}
```

副作用收集的设计思路是：**与其在卸载时尝试"猜测"子应用做了哪些全局修改，不如在运行时就记录下每一个副作用，卸载时精确回收。** 这比乾坤的快照对比方案更高效——不需要遍历整个 `window` 对象来发现差异。

### 14.1.3 插件系统：Garfish 的扩展性设计

Garfish 的插件系统借鉴了 Webpack 的 Tapable 设计，提供了贯穿整个生命周期的钩子：

```typescript
// Garfish 插件接口
interface GarfishPlugin {
  name: string;
  version?: string;

  // 应用加载阶段
  beforeLoad?(appInfo: AppInfo): void | false;
  afterLoad?(appInfo: AppInfo, appInstance: App): void;

  // 应用挂载阶段
  beforeMount?(appInfo: AppInfo, appInstance: App): void;
  afterMount?(appInfo: AppInfo, appInstance: App): void;

  // 应用卸载阶段
  beforeUnmount?(appInfo: AppInfo, appInstance: App): void;
  afterUnmount?(appInfo: AppInfo, appInstance: App): void;

  // 资源处理钩子（这是乾坤没有的）
  beforeEval?(appInfo: AppInfo, code: string): string;
  afterEval?(appInfo: AppInfo): void;

  // 沙箱扩展钩子
  sandboxConfig?(appInfo: AppInfo): Partial<SandboxConfig>;
}

// 使用示例：自定义资源预处理插件
const cssModulesPlugin: GarfishPlugin = {
  name: 'garfish-plugin-css-modules',
  // 在执行 JS 之前，处理 CSS Modules 的命名空间
  beforeEval(appInfo, code) {
    // 为所有 CSS 类名添加子应用前缀
    return code.replace(
      /\bclassName\s*:\s*["']([^"']+)["']/g,
      (match, className) => {
        return match.replace(className, `${appInfo.name}__${className}`);
      }
    );
  },
};

// 注册插件
Garfish.use(cssModulesPlugin);
```

`beforeEval` 钩子尤其值得关注——它允许在子应用的 JS 代码被执行之前对代码进行转换。这为自定义的代码注入、安全审计、性能监控等场景提供了极大的灵活性。乾坤没有提供对等的钩子，如果你需要修改子应用的代码，只能通过修改 `import-html-entry` 的行为来间接实现。

> 🔥 **深度洞察：Garfish 的定位**
>
> Garfish 并不是要"颠覆"乾坤，而是在字节跳动的超大规模场景中对乾坤范式的**工程化升级**。如果用汽车来类比：乾坤是一辆可靠的家用轿车，Garfish 是在同一底盘上改装的赛道版——发动机原理相同，但悬挂、空气动力学、冷却系统都针对高负载场景做了专项优化。选 Garfish 而非乾坤的核心理由不是"更好"，而是"你的场景是否需要多实例同屏、插件化扩展和精细化缓存控制"。

### 14.1.4 Garfish 与乾坤的核心差异对照

| 维度 | 乾坤 (qiankun) | Garfish |
|------|----------------|---------|
| **路由模型** | 一个路由绑定一个子应用 | 支持同一路由激活多个子应用 |
| **沙箱策略** | Proxy / Snapshot / LegacySandbox | Proxy + 副作用收集器 |
| **插件系统** | 无官方插件机制 | 完整的插件生命周期钩子 |
| **缓存控制** | 全局 prefetch 开关 | 按应用粒度的缓存策略 |
| **代码转换** | 不支持 | beforeEval 钩子支持 |
| **TypeScript 支持** | 类型定义较弱 | 原生 TypeScript 编写 |
| **适用规模** | 中小型（< 10 个子应用） | 大型（10-50+ 个子应用） |
| **社区生态** | 成熟、文档丰富 | 字节内部验证充分，外部社区较小 |

## 14.2 Micro App（京东）：WebComponent 路线的实践

### 14.2.1 一个大胆的设问：如果微前端是一个 HTML 标签呢？

Micro App 的出发点是一个极其简洁的直觉：**子应用的加载和渲染，本质上和加载一张图片或一个 iframe 没有区别——都是在 DOM 中嵌入一个外部资源。** 那为什么不能像写 `<img src="...">` 一样写 `<micro-app src="...">`？

```html
<!-- 这是 Micro App 的理想使用形态 -->
<micro-app
  name="order"
  url="https://order.example.com"
  baseroute="/order"
></micro-app>
```

一行代码，一个自定义元素，完成子应用的加载、渲染和隔离。没有 `registerMicroApps`，没有 `loadMicroApp`，没有复杂的配置对象——一切都是声明式的。

这不是口号。Micro App 真的做到了。

### 14.2.2 自定义元素的生命周期映射

Micro App 的核心设计是将微前端的生命周期映射到 WebComponent 自定义元素的生命周期：

```typescript
// Micro App 自定义元素定义（简化自源码）
class MicroAppElement extends HTMLElement {
  // 子应用实例
  private appInstance: MicroAppInstance | null = null;

  // 声明需要监听的属性变化
  static get observedAttributes(): string[] {
    return ['name', 'url', 'baseroute', 'data'];
  }

  /**
   * 当元素被插入 DOM 时触发
   * 映射为：加载子应用 → 创建沙箱 → 挂载
   */
  connectedCallback(): void {
    const name = this.getAttribute('name')!;
    const url = this.getAttribute('url')!;
    const baseroute = this.getAttribute('baseroute') || '';

    this.appInstance = new MicroAppInstance({
      name,
      url,
      baseroute,
      container: this, // 自定义元素本身就是容器
    });

    // 开始加载和挂载
    this.appInstance.start();
  }

  /**
   * 当元素从 DOM 移除时触发
   * 映射为：卸载子应用 → 销毁沙箱 → 清理资源
   */
  disconnectedCallback(): void {
    if (this.appInstance) {
      this.appInstance.unmount();
      this.appInstance = null;
    }
  }

  /**
   * 当监听的属性发生变化时触发
   * 映射为：数据通信（主应用 → 子应用）
   */
  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    if (name === 'data' && this.appInstance) {
      // 属性变化触发数据更新
      this.appInstance.updateData(JSON.parse(newValue || '{}'));
    }
    if (name === 'url' && oldValue !== newValue && this.appInstance) {
      // URL 变化触发子应用切换
      this.appInstance.unmount();
      this.appInstance = new MicroAppInstance({
        name: this.getAttribute('name')!,
        url: newValue!,
        baseroute: this.getAttribute('baseroute') || '',
        container: this,
      });
      this.appInstance.start();
    }
  }
}

// 注册自定义元素
customElements.define('micro-app', MicroAppElement);
```

这个设计的精妙之处在于：**利用浏览器原生的自定义元素生命周期来驱动微前端的生命周期，无需手动管理。** 当 React/Vue 的条件渲染把 `<micro-app>` 元素从 DOM 中移除时，`disconnectedCallback` 自动触发子应用卸载——不需要任何额外的卸载代码。

### 14.2.3 资源隔离：Shadow DOM 与样式作用域

Micro App 的 CSS 隔离同样依托 WebComponent 的原生能力：

```typescript
class MicroAppInstance {
  private shadowRoot: ShadowRoot | null = null;
  private container: MicroAppElement;

  constructor(config: MicroAppConfig) {
    this.container = config.container;
  }

  async start(): Promise<void> {
    // 1. 创建 Shadow DOM（如果配置了严格隔离）
    if (this.config.shadowDom) {
      this.shadowRoot = this.container.attachShadow({ mode: 'open' });
    }

    // 2. 获取子应用资源
    const { template, scripts, styles } = await this.fetchResources();

    // 3. 将模板和样式注入到容器中
    const mountTarget = this.shadowRoot || this.container;

    // 关键：样式被限制在 Shadow DOM 内部
    styles.forEach(cssText => {
      const style = document.createElement('style');
      style.textContent = this.scopeCSS(cssText);
      mountTarget.appendChild(style);
    });

    // 注入 HTML 模板
    const templateEl = document.createElement('div');
    templateEl.innerHTML = template;
    mountTarget.appendChild(templateEl);

    // 4. 在沙箱环境中执行 JS
    this.execScripts(scripts);
  }

  /**
   * 非 Shadow DOM 模式下的 CSS 作用域化
   * 为所有选择器添加属性选择器前缀
   */
  private scopeCSS(cssText: string): string {
    const prefix = `micro-app[name="${this.config.name}"]`;

    return cssText.replace(
      // 匹配 CSS 选择器（简化版本）
      /([^{}]+)\{/g,
      (match, selector: string) => {
        // 跳过 @规则（@media, @keyframes 等）
        if (selector.trim().startsWith('@')) return match;

        // 为每个选择器添加前缀
        const scopedSelectors = selector
          .split(',')
          .map((s: string) => {
            s = s.trim();
            // 处理 :root, body, html 等全局选择器
            if (/^(html|body|:root)/.test(s)) {
              return `${prefix} ${s.replace(/^(html|body|:root)/, '')}`;
            }
            return `${prefix} ${s}`;
          })
          .join(', ');

        return `${scopedSelectors} {`;
      }
    );
  }
}
```

Micro App 提供了两种 CSS 隔离策略：

1. **Shadow DOM 模式**——利用浏览器原生的样式隔离，隔离效果最强，但存在弹窗挂载、样式穿透等已知问题
2. **CSS 作用域化模式**——通过为所有 CSS 选择器添加属性前缀实现隔离，兼容性更好，是默认推荐模式

### 14.2.4 数据通信：属性传递与自定义事件

Micro App 的通信机制同样借鉴了 WebComponent 的惯用模式——属性传递向下，事件冒泡向上：

```typescript
// 主应用 → 子应用：通过 data 属性传递
// React 主应用示例
function MainApp() {
  const [orderData, setOrderData] = useState({ userId: '123' });

  return (
    <div>
      <micro-app
        name="order"
        url="https://order.example.com"
        data={JSON.stringify(orderData)}
      />
    </div>
  );
}

// 子应用 → 主应用：通过自定义事件
// 子应用内部
window.microApp?.dispatch({
  type: 'order-created',
  payload: { orderId: 'ORD-456' },
});

// 主应用监听
const microAppEl = document.querySelector('micro-app[name="order"]');
microAppEl?.addEventListener('datachange', (event: CustomEvent) => {
  const { type, payload } = event.detail;
  if (type === 'order-created') {
    console.log('新订单:', payload.orderId);
  }
});
```

这种通信模型的优点是**符合 Web 开发者的直觉**：属性向下传、事件向上冒。不需要学习额外的 API，也不需要引入全局事件总线或状态管理库。

### 14.2.5 Micro App 的设计取舍

Micro App 的 WebComponent 路线并非没有代价。以下是它面临的核心挑战：

```typescript
// 问题一：Shadow DOM 中的弹窗挂载
// 很多 UI 库（Ant Design、Element Plus）的弹窗默认挂载到 document.body
// 在 Shadow DOM 模式下，弹窗会"逃出"子应用的隔离边界

// 子应用中使用 Ant Design Modal
Modal.confirm({
  title: '确认删除？',
  // 这个弹窗会渲染到 document.body
  // 而不是 Shadow DOM 内部
  // 导致样式丢失！
  getContainer: () => {
    // Micro App 的解决方案：提供容器指引
    return document.querySelector(
      'micro-app[name="order"]'
    )?.shadowRoot?.querySelector('.micro-app-body')
    || document.body;
  },
});

// 问题二：Custom Elements 的浏览器兼容性
// 虽然 2026 年主流浏览器都支持 Custom Elements v1
// 但企业内网应用可能还需要考虑旧版 IE/Edge
// Micro App 提供了 polyfill，但会增加约 15KB 的体积

// 问题三：与框架的集成
// React 对自定义元素的属性传递有特殊处理
// 需要区分 attribute（字符串）和 property（对象）
// React 19 已经改善了这一点，但旧版本需要特殊处理
```

> 🔥 **深度洞察：声明式 vs 命令式的微前端**
>
> Micro App 和乾坤代表了微前端的两种编程范式。乾坤是命令式的——你需要手动注册应用、手动启动、手动管理生命周期。Micro App 是声明式的——你只需要在 DOM 中声明一个元素，一切自动发生。声明式的优点是**心智模型简单**：开发者不需要理解微前端的生命周期管理，只需要把 `<micro-app>` 当成一个增强版的 `<iframe>` 来使用。但声明式的局限在于**灵活性**：当你需要在加载前做条件判断、在挂载后做异步初始化、在切换时做渐进式过渡动画时，命令式 API 提供的控制粒度更细。**没有绝对的优劣，只有场景的匹配。**

## 14.3 Import Maps：浏览器原生的模块加载

### 14.3.1 一个被低估的浏览器标准

当微前端框架们在运行时沙箱、HTML 解析、JS 隔离等领域激烈竞争时，浏览器标准委员会悄悄推出了一个看似不起眼的规范——Import Maps。

```html
<!-- 一个简单的 Import Maps 示例 -->
<script type="importmap">
{
  "imports": {
    "react": "https://cdn.example.com/react@18.3.1/esm/react.production.min.js",
    "react-dom": "https://cdn.example.com/react-dom@18.3.1/esm/react-dom.production.min.js",
    "lodash/": "https://cdn.example.com/lodash-es@4.17.21/",
    "@shared/utils": "https://shared.example.com/utils/v2.1.0/index.js"
  }
}
</script>

<!-- 之后的 ES Module 可以直接使用裸模块标识符 -->
<script type="module">
  import React from 'react';
  import { debounce } from 'lodash/debounce.js';
  import { formatDate } from '@shared/utils';

  // 就像在 Node.js 中一样自然
</script>
```

Import Maps 做的事情很简单：**建立模块标识符到 URL 的映射关系。** 这意味着浏览器原生的 `import` 语句可以使用像 `'react'` 这样的裸模块标识符（bare specifiers），不再需要写完整的 URL 路径。

你可能会问：这和微前端有什么关系？

关系大了。**微前端最核心的问题之一是依赖共享**——多个子应用如何共用同一份 React 而不是各自打包一份？Module Federation 通过构建工具在编译时解决这个问题；乾坤通过 `externals` + CDN 的约定来解决；而 Import Maps 提供了一个**浏览器原生的、零构建工具依赖的、声明式的**解决方案。

### 14.3.2 Import Maps 与微前端的依赖共享

来看一个完整的微前端依赖共享场景：

```html
<!-- 主应用的 index.html -->
<!DOCTYPE html>
<html>
<head>
  <!-- 全局 Import Map：定义所有共享依赖的版本和 URL -->
  <script type="importmap">
  {
    "imports": {
      "react": "https://cdn.example.com/react@18.3.1/esm/react.production.min.js",
      "react-dom": "https://cdn.example.com/react-dom@18.3.1/esm/react-dom.production.min.js",
      "react-router-dom": "https://cdn.example.com/react-router-dom@6.20.0/esm/index.js",
      "@design-system/": "https://cdn.example.com/design-system@3.0.0/"
    },
    "scopes": {
      "https://order-app.example.com/": {
        "react": "https://cdn.example.com/react@19.0.0/esm/react.production.min.js",
        "react-dom": "https://cdn.example.com/react-dom@19.0.0/esm/react-dom.production.min.js"
      }
    }
  }
  </script>
</head>
<body>
  <div id="main-app"></div>
  <div id="sub-app-order"></div>
  <div id="sub-app-product"></div>

  <!-- 主应用 -->
  <script type="module" src="/main-app/index.js"></script>

  <!-- 子应用们：各自独立构建、独立部署 -->
  <!-- 但共享同一份 React！ -->
  <script type="module" src="https://order-app.example.com/index.js"></script>
  <script type="module" src="https://product-app.example.com/index.js"></script>
</body>
</html>
```

注意 `scopes` 字段——这是 Import Maps 最强大的特性之一。它允许**不同路径下的模块使用不同版本的依赖**。上面的配置表示：来自 `https://order-app.example.com/` 的模块 `import 'react'` 时，会加载 React 19，而其他所有模块加载 React 18。

这正是微前端中"版本协商"问题的浏览器原生解法。

### 14.3.3 动态 Import Maps 与运行时控制

静态的 Import Maps 在页面加载时就确定了所有映射关系。但微前端场景往往需要动态加载子应用——在子应用被加载时才知道它需要什么依赖。

```typescript
// 动态生成 Import Maps 的方案
class DynamicImportMapManager {
  private registeredMaps: Map<string, Record<string, string>> = new Map();

  /**
   * 注册子应用的依赖映射
   */
  registerApp(appName: string, dependencies: Record<string, string>): void {
    this.registeredMaps.set(appName, dependencies);
  }

  /**
   * 生成合并后的 Import Map 并注入到 DOM
   *
   * 注意：Import Maps 规范要求 <script type="importmap">
   * 必须在所有 module script 之前插入
   * 这是一个重要的限制
   */
  generateAndInject(): void {
    const mergedImports: Record<string, string> = {};
    const scopes: Record<string, Record<string, string>> = {};

    for (const [appName, deps] of this.registeredMaps) {
      for (const [specifier, url] of Object.entries(deps)) {
        if (!mergedImports[specifier]) {
          // 首次注册的版本成为全局默认
          mergedImports[specifier] = url;
        } else if (mergedImports[specifier] !== url) {
          // 版本冲突：使用 scopes 进行隔离
          // 每个子应用有自己的 scope
          const appScope = `/${appName}/`;
          if (!scopes[appScope]) scopes[appScope] = {};
          scopes[appScope][specifier] = url;
        }
      }
    }

    const importMap = { imports: mergedImports, scopes };

    // 注入到 DOM
    const script = document.createElement('script');
    script.type = 'importmap';
    script.textContent = JSON.stringify(importMap, null, 2);

    // 必须在所有 module script 之前插入
    const firstModuleScript = document.querySelector('script[type="module"]');
    if (firstModuleScript) {
      firstModuleScript.before(script);
    } else {
      document.head.appendChild(script);
    }
  }
}

// 使用示例
const manager = new DynamicImportMapManager();

// 订单子应用需要 React 19
manager.registerApp('order', {
  'react': 'https://cdn.example.com/react@19.0.0/esm/react.production.min.js',
  'react-dom': 'https://cdn.example.com/react-dom@19.0.0/esm/react-dom.production.min.js',
});

// 商品子应用需要 React 18
manager.registerApp('product', {
  'react': 'https://cdn.example.com/react@18.3.1/esm/react.production.min.js',
  'react-dom': 'https://cdn.example.com/react-dom@18.3.1/esm/react-dom.production.min.js',
});

// 生成并注入合并后的 Import Map
manager.generateAndInject();
```

### 14.3.4 浏览器支持与 Polyfill 生态

截至 2026 年初，Import Maps 的浏览器支持情况：

```
浏览器支持状态（2026 年初）：
┌──────────────────────────────────────────────────────────┐
│ Chrome 89+      ✅ 完全支持                               │
│ Edge 89+        ✅ 完全支持                               │
│ Firefox 108+    ✅ 完全支持                               │
│ Safari 16.4+    ✅ 完全支持                               │
│ Opera 76+       ✅ 完全支持                               │
│ iOS Safari 16.4+✅ 完全支持                               │
│                                                          │
│ 全球覆盖率：约 95%                                        │
│ 不支持：IE 全系列、旧版移动端浏览器                         │
└──────────────────────────────────────────────────────────┘
```

对于需要兼容旧浏览器的场景，社区提供了成熟的 polyfill：

```typescript
// es-module-shims：最流行的 Import Maps polyfill
// 在不支持的浏览器中模拟 Import Maps 行为

// 1. 引入 polyfill（放在所有 script 之前）
// <script async src="https://ga.jspm.io/npm:es-module-shims/dist/es-module-shims.js"></script>

// 2. 使用 "importmap-shim" 类型
// <script type="importmap-shim">
// { "imports": { "react": "..." } }
// </script>

// 3. 使用 "module-shim" 类型
// <script type="module-shim">
// import React from 'react'; // 在旧浏览器中也能工作
// </script>

// polyfill 的性能影响
interface PolyfillPerformance {
  // 首次加载 polyfill 本身的开销
  polyfillSize: '~10KB gzipped';
  // 模块解析的额外开销
  moduleResolutionOverhead: '< 5ms per import';
  // 对于原生支持 Import Maps 的浏览器
  nativePerformanceImpact: '零开销（polyfill 自动降级）';
}
```

### 14.3.5 Import Maps 的局限性

Import Maps 并非万能。在微前端场景中，它有几个明确的局限：

```typescript
// 局限一：没有 JS 隔离能力
// Import Maps 只解决模块映射，不提供沙箱
// 多个子应用共享同一个全局作用域

// 子应用 A
window.myGlobalVar = 'from A'; // 污染全局

// 子应用 B
console.log(window.myGlobalVar); // 'from A' —— 被污染了

// 局限二：没有 CSS 隔离能力
// Import Maps 不处理样式，CSS 冲突需要额外方案解决

// 局限三：Import Map 只能存在一个
// 页面中只能有一个 <script type="importmap">
// 动态追加第二个会被浏览器忽略
// 这意味着所有子应用的依赖映射必须在页面加载前确定

// 局限四：不支持动态 import() 的映射修改
// 一旦 Import Map 确定，后续的 import() 调用
// 都基于同一份映射，无法在运行时修改

// 解决方案：结合 Service Worker
// Service Worker 可以拦截模块请求并重定向
// 相当于一个运行时可修改的 Import Map
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // 拦截模块请求，实现动态重映射
  if (url.pathname.startsWith('/shared-modules/')) {
    const moduleVersion = getVersionForCurrentApp(url.pathname);
    const redirectUrl = `https://cdn.example.com${url.pathname}@${moduleVersion}`;
    event.respondWith(fetch(redirectUrl));
  }
});
```

> 🔥 **深度洞察：Import Maps 不是微前端框架的替代品，而是基础设施层的补充**
>
> Import Maps 解决的是"多个独立构建的应用如何共享依赖"这一个问题，而微前端框架需要解决加载、隔离、通信、路由等一揽子问题。把 Import Maps 类比为微前端框架，就像把轮胎类比为汽车——轮胎是汽车不可或缺的组成部分，但单靠轮胎无法载人。**Import Maps 的真正价值在于：它可以替代 Module Federation 中"依赖共享"这一个模块的功能，而且是零构建工具依赖的。** 对于那些不需要 JS/CSS 隔离、只需要解决依赖共享问题的场景（比如同一团队维护的多个微应用），Import Maps 可能是比任何框架都更轻量的选择。

## 14.4 Server-Driven UI 与微前端的融合趋势

### 14.4.1 微前端的下一个战场在服务端

前面三节讨论的方案——Garfish、Micro App、Import Maps——都是纯客户端的解决方案。它们假设所有的微前端组合发生在浏览器中：主应用在浏览器中加载子应用的资源，在浏览器中创建沙箱，在浏览器中完成渲染。

但如果我们后退一步，重新审视微前端要解决的核心问题——**让不同团队独立开发、独立部署的 UI 片段在同一个页面中组合**——这个组合过程一定要发生在浏览器中吗？

答案是：不一定。而且在某些场景下，**服务端组合有压倒性的优势**。

### 14.4.2 Server Islands：Astro 引领的碎片化水合

Server Islands（服务端岛屿）是 Astro 框架提出的架构模式。它的核心思想是：**页面的大部分内容在服务端渲染为静态 HTML，只有需要交互的"岛屿"区域在客户端水合（hydration）。**

```typescript
// Astro 风格的 Server Islands 示意
// 每个 "岛屿" 可以是不同团队维护的组件
// 甚至可以用不同的前端框架实现

// --- 主页面（服务端渲染，纯静态 HTML）---
// page.astro
/*
---
// 服务端代码：获取页面骨架数据
const layout = await fetchPageLayout();
---

<html>
<body>
  <header>
    <!-- 导航栏：React 团队维护的岛屿 -->
    <NavBar client:load />
  </header>

  <main>
    <!-- 商品列表：Vue 团队维护的岛屿 -->
    <ProductList client:visible />

    <!-- 推荐模块：Svelte 团队维护的岛屿 -->
    <Recommendations client:idle />
  </main>

  <footer>
    <!-- 纯静态 HTML，无需水合 -->
    <p>© 2026 Example Corp</p>
  </footer>
</body>
</html>
*/

// 三种水合策略
interface HydrationStrategy {
  // client:load — 页面加载时立即水合（用于导航栏等关键交互区域）
  'client:load': '立即加载并水合';
  // client:visible — 元素进入视口时才水合（用于折叠屏以下的内容）
  'client:visible': '可见时水合，节省首屏开销';
  // client:idle — 浏览器空闲时水合（用于非关键交互区域）
  'client:idle': '空闲时水合，最低优先级';
}
```

Server Islands 与微前端的关联在于：**每个岛屿可以由不同的团队维护、使用不同的框架、拥有不同的部署节奏**——这不正是微前端要解决的核心问题吗？

区别在于组合方式：传统微前端在客户端组合，Server Islands 在服务端组合。

### 14.4.3 边缘计算组合：CDN 节点上的微前端

更前沿的方向是**在 CDN 边缘节点上进行 UI 片段的组合**。Cloudflare Workers、Vercel Edge Functions、Deno Deploy 等边缘计算平台让这成为可能。

```typescript
// 边缘计算组合示例（Cloudflare Workers 风格）
interface UIFragment {
  name: string;
  team: string;
  endpoint: string;    // 每个团队的服务端渲染端点
  cacheTTL: number;    // 缓存时间（秒）
  fallback: string;    // 降级 HTML
}

const fragments: UIFragment[] = [
  {
    name: 'header',
    team: 'platform',
    endpoint: 'https://header-service.internal/render',
    cacheTTL: 3600,         // 导航栏变化不频繁，缓存 1 小时
    fallback: '<nav>Loading...</nav>',
  },
  {
    name: 'product-list',
    team: 'product',
    endpoint: 'https://product-service.internal/render',
    cacheTTL: 60,           // 商品列表变化较频繁，缓存 1 分钟
    fallback: '<div>Loading products...</div>',
  },
  {
    name: 'recommendations',
    team: 'ai',
    endpoint: 'https://recommend-service.internal/render',
    cacheTTL: 300,          // 推荐结果缓存 5 分钟
    fallback: '<div>Loading recommendations...</div>',
  },
];

// 在边缘节点组合页面
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // 并行请求所有 UI 片段
  const fragmentResults = await Promise.allSettled(
    fragments.map(async (fragment) => {
      // 先检查边缘缓存
      const cached = await edgeCache.get(
        `${fragment.name}:${url.pathname}`
      );
      if (cached) return { name: fragment.name, html: cached };

      try {
        // 请求团队的渲染服务
        const response = await fetch(fragment.endpoint, {
          method: 'POST',
          body: JSON.stringify({
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            userAgent: request.headers.get('user-agent'),
          }),
          signal: AbortSignal.timeout(2000), // 2秒超时
        });

        const html = await response.text();

        // 写入边缘缓存
        await edgeCache.put(
          `${fragment.name}:${url.pathname}`,
          html,
          { ttl: fragment.cacheTTL }
        );

        return { name: fragment.name, html };
      } catch (error) {
        // 降级：返回 fallback HTML
        return { name: fragment.name, html: fragment.fallback };
      }
    })
  );

  // 组装最终页面
  const fragmentMap = new Map<string, string>();
  for (const result of fragmentResults) {
    if (result.status === 'fulfilled') {
      fragmentMap.set(result.value.name, result.value.html);
    }
  }

  const finalHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Example Store</title>
    </head>
    <body>
      ${fragmentMap.get('header') || ''}
      <main>
        ${fragmentMap.get('product-list') || ''}
        ${fragmentMap.get('recommendations') || ''}
      </main>
    </body>
    </html>
  `;

  return new Response(finalHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
```

这种模式的威力在于：

1. **性能极致化**——边缘节点距用户最近（通常 < 50ms 延迟），在边缘完成组合比在用户浏览器中组合快一个数量级
2. **天然的容错**——某个团队的渲染服务挂了？用 fallback HTML 兜底，其他片段不受影响
3. **独立部署的终极形态**——每个团队维护自己的渲染服务，连 JS bundle 都不需要共享
4. **SEO 友好**——返回的是完整的 HTML，搜索引擎直接可见

### 14.4.4 Server-Driven UI：从组件到协议

Server-Driven UI（SDUI）将这个思路推向更极端：**服务端不只是返回 HTML 片段，而是返回 UI 的结构化描述（通常是 JSON），由客户端的通用渲染器将其渲染为真实的 UI。**

```typescript
// Server-Driven UI 的数据协议示例
interface SDUIComponent {
  type: string;                          // 组件类型
  props: Record<string, any>;            // 组件属性
  children?: SDUIComponent[];            // 子组件
  actions?: SDUIAction[];                // 交互行为
  // 微前端扩展字段
  _source?: {
    team: string;                        // 提供此组件的团队
    service: string;                     // 提供此组件的服务
    version: string;                     // 组件版本
  };
}

interface SDUIAction {
  trigger: 'click' | 'submit' | 'visible';
  type: 'navigate' | 'api_call' | 'update_state';
  payload: Record<string, any>;
}

// 服务端返回的页面描述
const pageDescription: SDUIComponent = {
  type: 'page',
  props: { title: '商品详情' },
  children: [
    {
      type: 'product-header',
      props: { productId: 'SKU-123', showPrice: true },
      _source: { team: 'product', service: 'product-bff', version: '3.2.1' },
    },
    {
      type: 'review-list',
      props: { productId: 'SKU-123', limit: 10, sortBy: 'recent' },
      _source: { team: 'ugc', service: 'review-bff', version: '2.0.0' },
      actions: [
        {
          trigger: 'click',
          type: 'navigate',
          payload: { url: '/reviews/SKU-123' },
        },
      ],
    },
    {
      type: 'recommendation-carousel',
      props: { algorithm: 'collaborative-filtering', count: 8 },
      _source: { team: 'ai', service: 'recommend-bff', version: '5.1.0' },
    },
  ],
};

// 客户端通用渲染器
class SDUIRenderer {
  private componentRegistry: Map<string, React.ComponentType<any>> = new Map();

  /**
   * 注册组件——每个团队提供自己的组件实现
   */
  register(type: string, component: React.ComponentType<any>): void {
    this.componentRegistry.set(type, component);
  }

  /**
   * 递归渲染 SDUI 描述为 React 元素
   */
  render(node: SDUIComponent): React.ReactElement {
    const Component = this.componentRegistry.get(node.type);

    if (!Component) {
      // 未知组件类型：渲染占位符
      console.warn(`Unknown component type: ${node.type}`);
      return React.createElement('div', {
        className: 'sdui-placeholder',
        'data-type': node.type,
      });
    }

    const children = node.children?.map(
      (child, index) => React.createElement(
        React.Fragment,
        { key: index },
        this.render(child)
      )
    );

    return React.createElement(Component, {
      ...node.props,
      actions: node.actions,
    }, children);
  }
}
```

SDUI 模式在微前端语境下的意义在于：**UI 的"组合"从代码层面上移到了协议层面。** 不同团队不再需要共享 JS bundle 或在同一个 DOM 中运行各自的 SPA——他们只需要遵循同一套 JSON 协议，各自提供组件的实现和数据描述。

### 14.4.5 融合趋势：边界在消融

下面这张图勾勒了微前端的演进轨迹和未来方向：

```
传统微前端                    服务端驱动                    未来融合
(客户端组合)                  (服务端组合)                  (自适应组合)

┌──────────┐               ┌──────────┐               ┌──────────┐
│ 浏览器中  │               │ 服务端/   │               │ 根据场景  │
│ 加载子应用│     ──────►   │ 边缘节点  │     ──────►   │ 自动选择  │
│ 运行时组合│               │ 组合HTML  │               │ 组合策略  │
└──────────┘               └──────────┘               └──────────┘

 代表方案：                  代表方案：                  可能形态：
 · 乾坤                     · Server Islands           · 首屏在边缘组合
 · Garfish                  · Edge Composition         · 交互区域客户端水合
 · Micro App                · SDUI                     · 非关键内容懒加载
 · single-spa                                          · AI 驱动的动态优化
```

几个正在发生的融合趋势：

**趋势一：首屏服务端组合 + 交互客户端增强。** 页面的静态骨架在边缘节点组合（极快的 TTFB），然后需要交互的区域在客户端按需水合。这结合了两种范式的优势——服务端组合的速度和客户端组合的交互能力。

**趋势二：元数据驱动的组合编排。** 不再在代码中硬编码"哪个路由加载哪个子应用"，而是从一个配置中心或 BFF 层动态获取组合规则。这让 A/B 测试、灰度发布、个性化体验成为架构的内在能力。

```typescript
// 元数据驱动的组合编排示例
interface CompositionRule {
  path: string;
  fragments: Array<{
    slot: string;              // DOM 挂载位置
    source: string;            // 子应用/片段来源
    strategy: 'ssr' | 'csr' | 'edge';  // 渲染策略
    conditions?: {
      // A/B 测试条件
      abTest?: { experiment: string; variant: string };
      // 灰度条件
      canary?: { percentage: number };
      // 用户画像条件
      userSegment?: string[];
    };
  }>;
}

// 配置中心返回的组合规则
const rules: CompositionRule[] = [
  {
    path: '/product/:id',
    fragments: [
      {
        slot: 'header',
        source: 'https://header-service/render',
        strategy: 'edge',     // 在边缘节点渲染
      },
      {
        slot: 'product-detail',
        source: 'https://product-app.example.com',
        strategy: 'ssr',      // 服务端渲染
      },
      {
        slot: 'reviews',
        source: 'https://review-app.example.com',
        strategy: 'csr',      // 客户端渲染（传统微前端方式）
        conditions: {
          abTest: {
            experiment: 'new-review-ui',
            variant: 'treatment',
          },
        },
      },
    ],
  },
];
```

**趋势三：AI 辅助的动态优化。** 当用户的设备性能、网络状况、行为模式都可以被实时感知时，组合策略可以从静态配置变为动态决策：

```typescript
// AI 驱动的动态组合策略（前瞻性设计）
interface DynamicCompositionContext {
  // 用户设备信息
  device: {
    cpuCores: number;
    memoryGB: number;
    connectionType: 'slow-2g' | '2g' | '3g' | '4g' | '5g' | 'wifi';
  };
  // 用户行为信号
  behavior: {
    scrollSpeed: 'slow' | 'medium' | 'fast';
    engagementScore: number;   // 0-1
    previousPages: string[];
  };
}

function selectCompositionStrategy(
  context: DynamicCompositionContext
): 'full-ssr' | 'partial-hydration' | 'full-csr' {
  // 弱网 + 低端设备：全量 SSR，最小化客户端 JS
  if (
    context.device.connectionType === 'slow-2g' ||
    context.device.memoryGB < 2
  ) {
    return 'full-ssr';
  }

  // 高端设备 + 高参与度用户：部分水合，平衡体验与交互
  if (
    context.device.cpuCores >= 4 &&
    context.behavior.engagementScore > 0.7
  ) {
    return 'partial-hydration';
  }

  // 默认：全量客户端渲染（传统微前端模式）
  return 'full-csr';
}
```

> 🔥 **深度洞察：微前端的终极形态不是"框架"，而是"策略"**
>
> 回顾本章讨论的所有方案——Garfish 优化了客户端运行时组合，Micro App 用 WebComponent 简化了接入成本，Import Maps 提供了浏览器原生的依赖共享，Server Islands 和 Edge Composition 把组合搬到了服务端——你会发现一个清晰的趋势：**微前端正在从"一个框架的选择"演化为"一组策略的编排"。** 未来的微前端架构不会是"我们用乾坤"或"我们用 Module Federation"这样的单一选择，而是"首屏用 Edge Composition、交互区域用 Module Federation 共享组件、非关键模块用 Import Maps 懒加载"这样的混合策略。这意味着：理解每种方案的适用边界，比精通任何一种方案的 API 都更有价值。

### 14.4.6 方案定位全景图

让我们将本章讨论的方案，连同前面章节已经深入分析的方案，放在一张全景图中：

| 方案 | 组合位置 | 隔离能力 | 依赖共享 | 侵入性 | 最佳场景 |
|------|---------|---------|---------|--------|---------|
| **乾坤** | 客户端 | 强（Proxy 沙箱） | 弱（externals） | 中 | 中型团队，存量应用微前端化 |
| **Garfish** | 客户端 | 强（副作用收集） | 弱（externals） | 中 | 大型团队，多实例多区域场景 |
| **Micro App** | 客户端 | 中（WebComponent） | 弱 | 低 | 声明式偏好，WebComponent 生态 |
| **Module Federation** | 编译时 | 无（信任模型） | 强（运行时共享） | 高 | 同技术栈，编译时可控 |
| **Wujie** | 客户端 | 极强（iframe） | 弱 | 低 | 需要极致隔离的场景 |
| **Import Maps** | 浏览器原生 | 无 | 中（URL 映射） | 极低 | 轻量共享，同团队多应用 |
| **Server Islands** | 服务端 | 天然隔离 | N/A | 高 | 内容为主，首屏性能敏感 |
| **Edge Composition** | 边缘节点 | 天然隔离 | N/A | 高 | 全球部署，极致首屏性能 |
| **SDUI** | 服务端+客户端 | 协议隔离 | N/A | 极高 | 动态 UI，多端一致性 |

---

## 本章小结

- **Garfish** 是字节跳动对乾坤范式的工程化升级，核心优势在于多实例路由、副作用收集沙箱和插件化扩展，适合子应用数量多、页面组合复杂的大规模场景
- **Micro App** 用 WebComponent 自定义元素重新定义了微前端的接入方式，将微前端的生命周期映射为 DOM 元素的生命周期，实现了真正的声明式微前端
- **Import Maps** 是浏览器原生的模块映射规范，可以在零框架依赖的情况下解决微前端的依赖共享问题，但不提供 JS/CSS 隔离能力
- **Server Islands** 和**边缘计算组合**代表了微前端的服务端化趋势——当组合发生在服务端或边缘节点时，客户端的隔离问题自然消解
- **SDUI** 将 UI 的组合从代码层面上移到协议层面，为跨端一致性和动态化提供了新的可能
- 微前端的演进方向是从"单一框架选择"走向"多策略混合编排"，理解每种方案的适用边界比精通任何单一方案更重要

## 思考题

1. **方案对比**：Garfish 的副作用收集机制和乾坤的 Proxy 沙箱在实现原理上有何本质区别？在什么场景下副作用收集的方案会优于快照对比方案？请从时间复杂度和空间复杂度两个角度分析。

2. **架构设计**：Micro App 选择了 WebComponent 自定义元素作为微前端的承载方式。如果让你设计一个新的微前端框架，你会选择自定义元素还是普通的 `<div>` 容器？请列出至少三个决策因素。

3. **实践应用**：你的团队维护 5 个子应用，全部使用 React 18，部署在同一个域名下。请设计一个基于 Import Maps 的依赖共享方案，并分析它相比 Module Federation 的优势和劣势。

4. **前沿思考**：Server Islands 和传统微前端（如乾坤）可以共存于同一个项目中吗？请设计一个混合架构，让首屏内容通过 Server Islands 渲染，而需要复杂交互的区域通过客户端微前端加载。画出架构图并说明数据流。

5. **开放讨论**：本章最后提到"微前端的终极形态不是框架，而是策略"。你是否同意这个观点？如果微前端确实走向策略化，这对前端工程师的能力模型意味着什么？我们需要培养哪些新的技能？

</div>
