<div v-pre>

# 第18章 设计模式与架构决策

> "架构决策的本质不是选择最好的方案，而是在当前约束下选择最合理的取舍。微前端十年，教会我们的不是某个框架有多好，而是在隔离与共享之间，永远没有完美的平衡点——只有适合此时此刻的平衡点。"

> **本章要点**
> - 识别微前端生态中反复出现的 10 个核心设计模式，理解它们解决的本质问题
> - 深入剖析"隔离 vs 共享"这一微前端永恒张力的技术根源与工程权衡
> - 从失败案例和被放弃的方案中提炼出比成功经验更有价值的教训
> - 展望微前端下一个五年：Web Components 标准化、Server Islands、Edge Rendering
> - 理解微前端的终极形态不是"前端的微服务"，而是"模块的联邦"
> - 作为全书收官章，建立从细节到全景的架构思维——不仅知道"怎么做"，更知道"为什么这样做"

---

写完前面十七章，我们已经从 single-spa 的路由劫持、乾坤的 JS/CSS 沙箱、import-html-entry 的资源解析、Module Federation 的编译时共享、Wujie 的 iframe 增强、Web Components 的原生隔离等各个维度，完成了对微前端架构的全面解剖。如果把前面的章节比作"显微镜"——逐行逐函数地观察每个框架的每一处实现，那么本章我们需要换一种工具：**望远镜**。

站在足够远的距离回望整个微前端生态，你会发现一个令人惊叹的事实：在那些看似各自为营的框架实现之下，存在着一组反复出现的设计模式。single-spa 在用，乾坤在用，Module Federation 在用，Wujie 也在用——只是表现形式不同。这些模式不是教科书上的学术练习，而是无数工程师在真实生产环境中，面对真实的隔离需求、真实的性能约束、真实的团队协作压力做出的真实选择。

同时，微前端十年的发展史本身就是一部"架构决策史"。每一次技术迭代——从 iframe 到路由分发，从运行时沙箱到编译时联邦——都意味着一次架构哲学的重新审视。那些被放弃的方案和失败的尝试，往往比最终胜出的方案包含更多的智慧。

本章是全书的收官之章。我们将从设计模式、架构张力、失败教训、未来展望四个维度，为你构建一幅微前端架构决策的全景图。这不仅是对前面所有章节的一次高维度总结，更是帮助你建立**架构设计者的思维方式**——当你下次面对"该不该用微前端"或"该选哪种方案"时，你能从第一性原理给出答案。

## 18.1 微前端中的 10 个核心设计模式

微前端的代码从来不是为了展示设计模式而写的——它是为了解决问题。但当你用设计模式的"棱镜"去观察这些解决方案时，会发现经典模式几乎无处不在。以下是微前端生态中最核心的 10 个设计模式，按照它们在微前端生命周期中出现的顺序排列。

### 18.1.1 Facade 模式：主应用作为统一入口

Facade（门面）模式为复杂子系统提供一个简化的统一接口。在微前端中，主应用（基座）就是一个巨大的 Facade——它隐藏了路由分发、子应用加载、沙箱创建、通信协调等所有底层复杂性，对用户呈现一个完整统一的应用。

```typescript
// 乾坤的 registerMicroApps 就是典型的 Facade
// 用户只需声明"是什么"，不需要关心"怎么做"
import { registerMicroApps, start } from 'qiankun';

registerMicroApps([
  {
    name: 'order-app',
    entry: '//order.example.com',
    container: '#micro-app-container',
    activeRule: '/order',
  },
  {
    name: 'product-app',
    entry: '//product.example.com',
    container: '#micro-app-container',
    activeRule: '/product',
  },
]);

start();
// 这三行代码背后，乾坤需要：
// 1. 劫持路由事件（hashchange / popstate）
// 2. 根据 activeRule 匹配当前路由
// 3. 通过 import-html-entry 获取子应用 HTML
// 4. 解析 HTML 中的 script/link/style 标签
// 5. 创建 JS 沙箱（Proxy 或 Snapshot）
// 6. 创建 CSS 沙箱（Shadow DOM 或 Scoped CSS）
// 7. 执行子应用脚本，调用生命周期钩子
// 8. 管理子应用的挂载和卸载
// 这就是 Facade 的力量：将八步复杂流程封装为三行声明式 API
```

Facade 模式的关键价值不仅在于简化——更在于**解耦**。子应用的开发者不需要知道主应用用的是乾坤还是 single-spa，只需要暴露约定的生命周期函数。反过来，主应用也不需要知道子应用用的是 React 还是 Vue。Facade 在两者之间划出了一条清晰的契约边界。

> **深度洞察**：Facade 模式在微前端中的一个微妙风险是"过度封装"。乾坤的 `start()` 函数隐藏了大量底层决策（沙箱类型、CSS 隔离策略、预加载策略），当这些默认决策不适合你的场景时，你需要"穿透" Facade 去修改行为。这就是为什么乾坤后来添加了越来越多的配置项——Facade 的简洁性与灵活性之间，存在天然的张力。

### 18.1.2 Proxy 模式：JS 沙箱的核心机制

Proxy（代理）模式为另一个对象提供一个替身或占位符，以控制对这个对象的访问。乾坤的 `ProxySandbox` 是微前端领域最经典的 Proxy 模式应用——它用 `ES6 Proxy` 拦截子应用对 `window` 的所有操作，在不修改真实 `window` 的前提下为每个子应用提供独立的全局环境。

```typescript
// 乾坤 ProxySandbox 的核心实现（简化）
class ProxySandbox {
  private updatedValueSet = new Set<PropertyKey>();
  private fakeWindow: Record<PropertyKey, any>;

  proxy: WindowProxy;

  constructor(name: string) {
    const rawWindow = window;
    const fakeWindow = Object.create(null);
    this.fakeWindow = fakeWindow;

    this.proxy = new Proxy(fakeWindow, {
      get(target, prop) {
        // 某些属性必须从真实 window 读取
        if (prop === 'window' || prop === 'self' || prop === 'globalThis') {
          return proxy;  // 返回代理本身，形成闭环
        }

        // 优先从 fakeWindow 读取（子应用的修改）
        if (target.hasOwnProperty(prop)) {
          return target[prop];
        }

        // 兜底到真实 window（共享的全局 API）
        const value = rawWindow[prop as any];
        // 如果是函数，需要绑定正确的 this
        if (typeof value === 'function' && !isBoundFunction(value)) {
          return value.bind(rawWindow);
        }
        return value;
      },

      set(target, prop, value) {
        // 所有写操作都发生在 fakeWindow 上
        target[prop] = value;
        updatedValueSet.add(prop);
        return true;
      },

      has(target, prop) {
        return prop in target || prop in rawWindow;
      },
    });
  }
}
```

这段代码体现了 Proxy 模式的精髓：子应用以为自己在操作 `window`，实际上操作的是一个代理对象。所有读操作先查代理、再查真实对象；所有写操作只发生在代理上。这实现了"读时共享、写时隔离"的效果——本质上是 Copy-on-Write 策略在 JS 全局对象上的应用。

### 18.1.3 Strategy 模式：可切换的隔离策略

Strategy（策略）模式定义了一系列算法，把它们一个个封装起来，并且使它们可以互相替换。微前端中的隔离机制天然适合 Strategy 模式——CSS 隔离可以选择 Shadow DOM、Scoped CSS 或运行时前缀；JS 隔离可以选择 Proxy 沙箱、快照沙箱或 iframe 沙箱。

```typescript
// 微前端中的 Strategy 模式：CSS 隔离策略
interface CSSIsolationStrategy {
  name: string;
  apply(appHTML: string, appName: string): string;
  revert(appName: string): void;
}

// 策略一：Shadow DOM 隔离
class ShadowDOMStrategy implements CSSIsolationStrategy {
  name = 'shadow-dom';

  apply(appHTML: string, appName: string): string {
    // 将子应用的 DOM 树挂载到 Shadow DOM 中
    // 利用浏览器原生的样式隔离能力
    const container = document.getElementById(appName);
    const shadow = container!.attachShadow({ mode: 'open' });
    shadow.innerHTML = appHTML;
    return appHTML;
  }

  revert(appName: string): void {
    // Shadow DOM 会随宿主元素一起销毁
  }
}

// 策略二：Scoped CSS 前缀
class ScopedCSSStrategy implements CSSIsolationStrategy {
  name = 'scoped-css';

  apply(appHTML: string, appName: string): string {
    // 为所有 CSS 选择器添加子应用特定前缀
    // .container { } → div[data-qiankun="order-app"] .container { }
    return this.rewriteCSS(appHTML, appName);
  }

  private rewriteCSS(html: string, scope: string): string {
    // 通过正则或 CSS AST 改写选择器
    return html.replace(
      /([^{}]+)\{/g,
      (match, selector) => `div[data-qiankun="${scope}"] ${selector.trim()} {`
    );
  }

  revert(appName: string): void {
    // 移除注入的 scoped style 标签
  }
}

// 策略三：动态 Style 标签管理
class DynamicStyleStrategy implements CSSIsolationStrategy {
  name = 'dynamic-style';

  apply(appHTML: string, appName: string): string {
    // 子应用激活时添加样式，失活时移除
    return appHTML;
  }

  revert(appName: string): void {
    document.querySelectorAll(`style[data-app="${appName}"]`)
      .forEach(el => el.remove());
  }
}

// 使用：运行时选择策略
function createIsolation(config: AppConfig): CSSIsolationStrategy {
  if (config.strictStyleIsolation) return new ShadowDOMStrategy();
  if (config.experimentalStyleIsolation) return new ScopedCSSStrategy();
  return new DynamicStyleStrategy();
}
```

Strategy 模式在微前端中的价值尤为突出，因为不同的子应用可能需要不同的隔离策略。一个使用 Ant Design 的子应用可能在 Shadow DOM 下样式异常（因为 Ant Design 会动态向 `document.head` 注入样式），需要回退到 Scoped CSS；而一个完全自包含的子应用则可以享受 Shadow DOM 的完美隔离。Strategy 模式让这种"按需选择"成为可能。

### 18.1.4 Observer 模式：跨应用事件通信

Observer（观察者）模式定义了一种一对多的依赖关系，当一个对象的状态变化时，所有依赖它的对象都会收到通知。微前端中的跨应用通信几乎都建立在 Observer 模式之上——无论是全局事件总线、自定义事件还是共享状态管理。

```typescript
// 微前端事件总线的典型实现
class MicroFrontendEventBus {
  private events = new Map<string, Set<Function>>();

  // 发布事件
  emit(eventName: string, data?: any): void {
    const handlers = this.events.get(eventName);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(
            `[EventBus] Handler error for "${eventName}":`, error
          );
        }
      });
    }
  }

  // 订阅事件
  on(eventName: string, handler: Function): () => void {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }
    this.events.get(eventName)!.add(handler);

    // 返回取消订阅函数——关键的内存管理细节
    return () => {
      this.events.get(eventName)?.delete(handler);
    };
  }

  // 子应用卸载时的清理
  offAll(appName: string): void {
    // 移除该应用注册的所有事件处理器
    // 防止已卸载的子应用继续响应事件（内存泄漏）
  }
}

// 乾坤的 initGlobalState 本质上就是这个模式
import { initGlobalState } from 'qiankun';

const actions = initGlobalState({ user: null, theme: 'light' });

// 子应用 A：设置用户信息
actions.setGlobalState({ user: { name: '杨艺韬', role: 'admin' } });

// 子应用 B：响应用户信息变化
actions.onGlobalStateChange((state, prev) => {
  console.log('全局状态变更:', state, prev);
  // 更新本地 UI
});
```

> **深度洞察**：Observer 模式在微前端通信中的最大风险不是技术实现，而是**治理缺失**。当 10 个子应用通过全局事件总线通信时，"谁发了什么事件"、"谁在监听什么事件"、"事件的数据格式是什么"——如果这些没有统一的契约管理，事件总线会迅速退化为"全局变量 2.0"。成熟的微前端团队会为事件通信建立 TypeScript 类型定义和 Schema 校验，就像后端微服务需要 API 契约一样。

### 18.1.5 Mediator 模式：主应用作为协调者

Mediator（中介者）模式用一个中介对象来封装一系列对象的交互。在微前端中，主应用不仅是 Facade（对外的统一界面），还是 Mediator（对内的协调中心）——它管理子应用之间的生命周期协调、资源冲突解决和状态同步。

```typescript
// 主应用作为 Mediator 的协调逻辑
class AppMediator {
  private activeApp: MicroApp | null = null;
  private apps = new Map<string, MicroApp>();

  async switchApp(targetName: string): Promise<void> {
    const target = this.apps.get(targetName);
    if (!target) throw new Error(`App "${targetName}" not registered`);

    // 1. 协调当前应用的卸载
    if (this.activeApp) {
      // 通知其他子应用：某个应用即将卸载
      this.broadcast('app:before-unmount', {
        name: this.activeApp.name,
      });

      await this.activeApp.unmount();

      // 清理该应用的副作用
      this.activeApp.sandbox?.deactivate();

      this.broadcast('app:after-unmount', {
        name: this.activeApp.name,
      });
    }

    // 2. 协调目标应用的挂载
    this.broadcast('app:before-mount', { name: targetName });

    target.sandbox?.activate();
    await target.mount();

    this.activeApp = target;

    this.broadcast('app:after-mount', { name: targetName });
  }

  private broadcast(event: string, data: any): void {
    this.apps.forEach(app => {
      app.eventHandler?.(event, data);
    });
  }
}
```

Mediator 模式的价值在于**避免子应用之间的直接依赖**。如果子应用 A 需要在子应用 B 卸载后才能安全挂载（比如它们操作同一个 DOM 容器），这个协调逻辑应该在主应用中完成，而不是让 A 直接感知 B 的存在。

### 18.1.6 Factory 模式：沙箱实例的创建

Factory（工厂）模式将对象的创建逻辑封装起来，使调用者不需要知道具体的创建细节。微前端框架根据运行环境和配置动态创建不同类型的沙箱，这就是典型的工厂模式。

```typescript
// 乾坤中的沙箱工厂（简化）
type SandboxType = 'proxy' | 'snapshot' | 'legacy';

function createSandbox(
  appName: string,
  config: SandboxConfig
): JSSandbox {
  // 根据环境能力和配置选择沙箱类型
  if (window.Proxy && config.sandbox !== 'legacy') {
    // 现代浏览器：使用 Proxy 沙箱
    if (config.multiInstance) {
      return new ProxySandbox(appName);  // 支持多实例
    } else {
      return new LegacyProxySandbox(appName);  // 单实例模式
    }
  } else {
    // 不支持 Proxy：降级到快照沙箱
    return new SnapshotSandbox(appName);
  }
}

// 调用者不需要知道创建了哪种沙箱
const sandbox = createSandbox('order-app', {
  sandbox: true,
  multiInstance: true,
});
```

### 18.1.7 Adapter 模式：跨框架生命周期适配

Adapter（适配器）模式将一个类的接口转换成客户端所期望的另一种接口。在微前端中，不同框架（React、Vue、Angular）的组件生命周期各不相同，但主应用需要一个统一的生命周期协议（`bootstrap / mount / unmount`）。适配器模式解决了这个问题。

```typescript
// single-spa 的框架适配器：将 React/Vue 的生命周期
// 适配为统一的 bootstrap / mount / unmount 协议
function singleSpaReact(opts: ReactOptions) {
  return {
    async bootstrap() { /* React 无特殊初始化 */ },
    async mount(props: any) {
      const root = ReactDOM.createRoot(props.container);
      root.render(React.createElement(opts.rootComponent, props));
    },
    async unmount(props: any) {
      ReactDOM.createRoot(props.container).unmount();
    },
  };
}

function singleSpaVue(opts: VueOptions) {
  let app: any;
  return {
    async bootstrap() { /* Vue 无特殊初始化 */ },
    async mount(props: any) {
      app = createApp(opts.rootComponent);
      app.mount(props.container);
    },
    async unmount() { app?.unmount(); app = null; },
  };
}
// 主应用不需要知道子应用用的是什么框架——只调用统一协议
```

### 18.1.8 Composite 模式：嵌套微前端的递归组织

Composite（组合）模式将对象组合成树形结构以表示"部分-整体"层次关系。当微前端支持嵌套——一个子应用本身也可以作为基座加载更深层的子应用——这就是 Composite 模式的体现。

```
主应用（基座）
├── 子应用 A（订单中心）
│   ├── 孙应用 A1（订单列表）
│   └── 孙应用 A2（订单详情）
├── 子应用 B（商品中心）
│   ├── 孙应用 B1（商品管理）
│   └── 孙应用 B2（库存管理）
└── 子应用 C（用户中心）——叶子节点，不嵌套
```

Composite 模式使得微前端架构具备了递归扩展能力。但在实践中，嵌套层级超过两层会带来严重的性能和复杂度问题——沙箱嵌套、路由嵌套、通信链路延长。大多数生产级微前端架构将嵌套控制在一到两层。

### 18.1.9 Singleton 模式：全局共享资源的管理

Singleton（单例）模式确保一个类只有一个实例。微前端中的全局资源——路由实例、事件总线、国际化配置——都必须是单例。如果路由协调器被多次实例化，`popstate` 事件会被多次监听，`pushState` 被多次 patch，子应用被重复加载。single-spa 的 `reroute` 状态机、乾坤的全局沙箱注册表，都是 Singleton 模式的直接体现。

### 18.1.10 Chain of Responsibility 模式：资源加载的链式处理

Chain of Responsibility（责任链）模式使多个对象都有机会处理请求。微前端中的资源加载——HTML 获取 → 解析 → 脚本提取 → 样式处理 → 沙箱注入 → 执行——天然形成了一条责任链。import-html-entry 的 `importHTML` 函数就是这条链的入口，每个环节可以独立测试和替换。如果你需要自定义 CSS 处理逻辑（比如添加自动前缀），只需要替换样式处理这一环，不影响其他环节。

> **深度洞察**：回顾这 10 个设计模式，你会发现它们可以归为三组：**边界模式**（Facade、Proxy、Adapter——处理应用之间的边界）、**协调模式**（Mediator、Observer、Chain of Responsibility——协调应用之间的交互）、**构造模式**（Factory、Strategy、Singleton、Composite——构建和组织应用实例）。微前端的本质工作就是这三件事：划清边界、协调交互、组织结构。如果一个微前端方案在这三个维度上都有清晰的设计，它大概率是一个合理的方案。

## 18.2 隔离 vs 共享：微前端永恒的张力

如果要用一句话概括微前端架构中最根本的设计抉择，那就是：**隔离多少，共享多少**。

这不是一个可以一劳永逸回答的问题。它是一条光谱——一端是完全隔离（每个子应用都是独立的 iframe，零共享），另一端是完全共享（所有子应用运行在同一个 JS 上下文中，共享一切）。微前端方案的差异，本质上就是它们在这条光谱上选择了不同的位置。

### 18.2.1 隔离光谱：从 iframe 到 Module Federation

```
完全隔离 ◄──────────────────────────────────────► 完全共享
   │                                                  │
   ▼                                                  ▼
 iframe    Wujie    乾坤    single-spa    Module Federation
 (独立窗口)  (iframe  (Proxy   (路由分发     (编译时共享
             增强)    沙箱)    无沙箱)       运行时联邦)
```

每个方案在光谱上的位置决定了它的核心特征：

| 特征 | iframe | Wujie | 乾坤 | single-spa | Module Federation |
|------|--------|-------|------|------------|-------------------|
| **JS 隔离** | 浏览器原生 | iframe 原生 | Proxy 代理 | 无（自行处理） | 无（模块作用域） |
| **CSS 隔离** | 浏览器原生 | Shadow DOM | Scoped CSS | 无（自行处理） | 无（自行处理） |
| **性能开销** | 高 | 中 | 中 | 低 | 极低 |
| **共享能力** | 极弱 | 弱 | 中 | 中 | 强 |
| **框架兼容** | 任意 | 任意 | 任意 | 需适配器 | 需构建工具支持 |

### 18.2.2 隔离的代价

隔离不是免费的。每一层隔离都带来性能开销、复杂度增加和共享困难。让我们量化这些代价。

```typescript
// 不同隔离方案的性能开销对比（真实测量数据示意）
interface IsolationCost {
  strategy: string;
  memoryOverheadMB: number;     // 每个子应用额外内存开销
  mountTimeMs: number;          // 子应用首次挂载时间
  communicationLatencyMs: number; // 跨应用通信延迟
  bundleSizeKB: number;         // 框架本身的体积
}

const costs: IsolationCost[] = [
  {
    strategy: 'iframe',
    memoryOverheadMB: 15,        // 每个 iframe 独立的 JS 引擎实例
    mountTimeMs: 800,            // 需要完整的页面加载
    communicationLatencyMs: 5,   // postMessage 有序列化开销
    bundleSizeKB: 0,             // 无需框架
  },
  {
    strategy: 'qiankun (Proxy)',
    memoryOverheadMB: 3,         // Proxy 对象 + fakeWindow
    mountTimeMs: 200,            // HTML 解析 + 脚本执行
    communicationLatencyMs: 0.1, // 同一 JS 上下文，几乎无延迟
    bundleSizeKB: 45,            // 乾坤 + import-html-entry
  },
  {
    strategy: 'Module Federation',
    memoryOverheadMB: 0.5,       // 仅模块元数据
    mountTimeMs: 50,             // 模块已预加载
    communicationLatencyMs: 0,   // 直接函数调用
    bundleSizeKB: 15,            // 运行时插件
  },
];
```

iframe 提供了最强的隔离，但代价是每个子应用 15MB 的额外内存和 800ms 的挂载时间。Module Federation 几乎没有隔离开销，但也意味着子应用之间的边界主要靠**约定和规范**而非**技术强制**来维护。

### 18.2.3 共享的代价

共享同样不是免费的。当多个子应用共享依赖或状态时，会引入版本冲突、耦合传播和升级困难。

```typescript
// Module Federation 的版本协商——共享的核心挑战
// webpack.config.js
module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'order_app',
      shared: {
        react: {
          singleton: true,     // 全局只允许一个版本
          requiredVersion: '^18.2.0',  // 期望的版本范围
          strictVersion: false, // false：宽松匹配；true：严格匹配
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.2.0',
        },
        antd: {
          // 注意：不设 singleton
          // 允许不同子应用使用不同版本的 antd
          requiredVersion: '^5.0.0',
          // 但这意味着可能加载多份 antd——体积膨胀
        },
      },
    }),
  ],
};
```

版本协商是共享策略中最棘手的问题。考虑这个场景：

1. 子应用 A 依赖 `react@18.2.0`
2. 子应用 B 依赖 `react@18.3.0`
3. `singleton: true` 意味着只能加载一个版本

Module Federation 会选择满足所有 `requiredVersion` 的最高版本。但如果子应用 C 依赖 `react@19.0.0` 呢？`^18.2.0` 和 `^19.0.0` 无法被同一个版本满足。此时要么放弃 singleton（两份 React，Hooks 状态不互通），要么强制所有子应用同步升级（丧失独立部署的核心价值）。

> **深度洞察**：隔离和共享不是二选一的关系，而是**多维度独立决策**的关系。最成熟的微前端架构会在不同维度做出不同选择：JS 运行时隔离（Proxy 沙箱），CSS 隔离（Shadow DOM 或 Scoped CSS），依赖共享（Module Federation），状态通信（事件总线），路由管理（主应用统一协调）。也就是说，一个应用可以同时拥有强 JS 隔离和强依赖共享——两者并不矛盾。真正的架构智慧不在于"选择隔离还是共享"，而在于"在每个维度上选择恰当的位置"。

### 18.2.4 六种典型架构姿态

基于隔离与共享的组合，微前端架构在实践中形成了六种典型姿态：

```typescript
// 六种姿态的核心差异
const architecturePostures = {
  '全隔离型':     { 代表: 'iframe',     场景: '银行接入第三方',     代价: '性能差' },
  '沙箱隔离型':   { 代表: '乾坤',       场景: '企业中后台多团队',   代价: '沙箱逃逸风险' },
  '增强iframe型': { 代表: 'Wujie',      场景: '任意技术栈接入',     代价: '通信复杂' },
  '编译共享型':   { 代表: 'MF',         场景: '统一技术栈中大型应用', 代价: '无强制隔离' },
  '组件联邦型':   { 代表: 'MF 2.0',     场景: '多团队共建统一产品',  代价: '需统一工具链' },
  '混合型':       { 代表: '真实大型企业', 场景: '从来不会只有一种方案', 代价: '多方案并存成本' },
};
```

在真实的大规模前端团队中，姿态六——混合型——是最常见的。因为现实永远比理论复杂：你有刚用 Module Federation 重构的核心模块，也有五年前用 jQuery 写的遗留页面；你有高频交互的实时看板，也有一年更新一次的配置页面。架构师的工作不是选择"最好的方案"，而是为每个模块选择"最合适的姿态"。

## 18.3 被放弃的方案与失败案例的教训

成功的架构选择固然值得学习，但失败的尝试往往包含更深刻的洞见。本节我们考古那些被放弃的方案和真实的线上事故，从中提炼出比成功经验更有价值的教训。

### 18.3.1 教训一：快照沙箱的历史包袱

乾坤最初的 JS 沙箱实现是 `SnapshotSandbox`——在子应用挂载前保存 `window` 的快照，卸载时恢复。这个方案直觉上很优雅，但在生产中暴露了严重问题。

```typescript
// SnapshotSandbox 的核心逻辑
class SnapshotSandbox {
  private windowSnapshot: Record<string, any> = {};
  private modifyPropsMap: Record<string, any> = {};

  activate(): void {
    // 保存当前 window 的快照
    this.windowSnapshot = {};
    for (const prop in window) {
      this.windowSnapshot[prop] = (window as any)[prop];
    }

    // 恢复上次的修改
    Object.keys(this.modifyPropsMap).forEach(prop => {
      (window as any)[prop] = this.modifyPropsMap[prop];
    });
  }

  deactivate(): void {
    this.modifyPropsMap = {};

    // 记录变更，恢复原始值
    for (const prop in window) {
      if ((window as any)[prop] !== this.windowSnapshot[prop]) {
        this.modifyPropsMap[prop] = (window as any)[prop];
        (window as any)[prop] = this.windowSnapshot[prop];
      }
    }
  }
}
```

**问题一：遍历 `window` 的性能代价。** `window` 对象有数百个属性，`for...in` 遍历每次耗时 10-50ms。子应用频繁切换时，这个开销会累积成可感知的卡顿。

**问题二：不支持多实例。** 快照沙箱直接修改和恢复真实 `window`，在同一时刻只能有一个子应用处于激活状态。如果页面需要同时展示两个子应用——比如左侧是订单列表，右侧是商品详情——快照沙箱无能为力。

**问题三：无法拦截新增属性。** 如果子应用在运行时给 `window` 添加了一个新属性（`window.myGlobal = 123`），快照沙箱只会在卸载时将其删除。但在子应用运行期间，其他子应用（如果有的话）也能看到这个属性——隔离不完整。

这三个问题最终导致乾坤在支持 `Proxy` 的浏览器中完全切换到了 `ProxySandbox`，快照沙箱仅作为 IE 等老浏览器的降级方案保留。

**教训：直觉上的优雅不等于工程上的可行。** 快照-恢复是一个简洁的心理模型，但它的 O(n) 遍历成本和单实例限制在真实场景中不可接受。Proxy 拦截虽然实现复杂度更高，但它的 O(1) 属性访问和天然多实例支持是更好的工程选择。

### 18.3.2 教训二：CSS 隔离的"不可能三角"

微前端的 CSS 隔离存在一个类似于分布式系统 CAP 定理的"不可能三角"——你不能同时获得：

1. **完美隔离**：子应用的样式完全不影响外部
2. **完全兼容**：所有 CSS 特性和第三方组件库都正常工作
3. **零开销**：不增加运行时性能成本

```
        完美隔离
           ▲
          / \
         /   \
        /     \
       / Shadow \
      /   DOM    \
     /   (1+3,    \
    /    但不完全   \
   /     兼容)      \
  ────────────────────
  完全兼容          零开销
  (Scoped CSS:     (无隔离:
   1+2, 但有       2+3, 但
   改写开销)       无隔离)
```

**Shadow DOM 的兼容性问题：**

```typescript
// 问题场景：Ant Design 的 Modal 组件
// Ant Design 的 Modal 会将弹窗 DOM 插入到 document.body
// 而不是当前组件的 Shadow DOM 内
// 结果：弹窗样式丢失

// antd Modal 内部实现（简化）
function Modal({ children, open }: ModalProps) {
  // 使用 React Portal 将内容渲染到 body
  return ReactDOM.createPortal(
    <div className="ant-modal">{children}</div>,
    document.body  // 这个 body 在 Shadow DOM 外面！
  );
}

// 子应用在 Shadow DOM 内
// 但 Modal 的 DOM 在 Shadow DOM 外
// 子应用的样式被 Shadow DOM 封锁，无法影响外面的 Modal
// 结果：Modal 没有样式——白色背景上的白色文字
```

这个问题导致了大量生产事故。乾坤为此引入了 `experimentalStyleIsolation`（Scoped CSS 方案）作为 Shadow DOM 的替代方案，但 Scoped CSS 依赖正则表达式改写 CSS 选择器，无法完美处理所有边缘情况（如 `@keyframes`、`@font-face`、`:root` 选择器）。

**教训：当底层平台（浏览器）的能力不足以支撑需求时，任何上层方案都只能是"近似解"。** CSS 隔离的根本问题在于浏览器没有提供"CSS 作用域"的原生机制（`@scope` 规范仍在演进中）。框架层面的所有方案都是在"模拟"一种浏览器不原生支持的能力，因此必然存在边界情况。

### 18.3.3 教训三：全局状态共享的陷阱

一个电商团队分享过这样一个真实案例。他们的微前端架构中有五个子应用，通过乾坤的 `initGlobalState` 共享全局状态。随着时间推移，共享状态从最初的用户信息和主题配置，逐渐膨胀为包含购物车、搜索条件、页面缓存等各种数据的"巨型全局对象"。

```typescript
// 初始状态（合理）：{ user, theme }
// 六个月后（失控）：{ user, theme, locale, cart, search,
//   notifications, pageCache, featureFlags, abTest, ... }
// 从 2 个字段膨胀到 10+ 个字段，还在持续增长
```

这导致了三个严重问题：

**一、变更风暴。** 任何一个字段的修改都会触发所有订阅者的回调。用户在搜索框输入一个字符，五个子应用全部收到通知并重新渲染——尽管其中四个根本不关心搜索条件。

**二、隐式依赖。** 子应用 C 在某次迭代中开始依赖 `state.cart.items` 来展示"购物车角标"。但购物车数据是子应用 A 写入的。当子应用 A 重构了购物车数据结构（把 `items` 改为 `products`），子应用 C 的角标功能默默失效——没有任何编译时错误提示。

**三、内存泄漏。** `pageCache` 的数据从不清理，随着用户浏览页面越来越多，内存持续增长。

**教训：共享状态的膨胀和全局变量的滥用本质上是同一个反模式。** 微前端的全局状态应该严格限制在"真正全局"的数据上（用户身份、主题、语言），业务数据应该通过更具约束力的通信机制（事件 + Schema 校验）传递。

### 18.3.4 教训四：微前端"过早引入"的组织代价

一家中型创业公司（约 20 名工程师，3 个前端开发者）在团队只有一个 React 应用时就引入了乾坤微前端。他们的理由是"为未来扩展做准备"。

六个月后的结果：

```
实际收益：
  - 无（只有一个子应用，微前端的价值无法体现）

实际代价：
  - 主应用 + 乾坤框架维护成本：+30% 工作量
  - 每个新页面都需要决定"放主应用还是新建子应用"：决策成本
  - 本地开发需要同时启动主应用和子应用：开发体验下降
  - 新成员入职培训增加两天：学习成本
  - 遇到问题时社区资源比纯 React 少得多：排障成本

最终决策：移除乾坤，回归单体 React 应用
迁移成本：两周工程师时间
```

**教训：微前端是"规模化"的架构——它解决的是"多团队、多应用、独立部署"的问题。** 如果你的团队小于 5 个前端工程师、只有一个主要产品、发布节奏一致，那么微前端带来的复杂度远超收益。正如第 1 章所说：**不要因为"可能需要"而引入微前端，要因为"已经痛了"而引入。**

### 18.3.5 教训五：忽视子应用卸载的内存灾难

```typescript
// 一个导致内存泄漏的子应用（常见错误）
let globalInterval: number;
let globalEventHandler: (e: Event) => void;

export async function mount(props: any) {
  const { container } = props;

  // 错误 1：设置了全局定时器但卸载时不清理
  globalInterval = window.setInterval(() => {
    fetchNotifications();
  }, 5000);

  // 错误 2：绑定了全局事件但卸载时不移除
  globalEventHandler = (e: Event) => {
    handleResize(e);
  };
  window.addEventListener('resize', globalEventHandler);

  // 错误 3：创建了 Web Worker 但卸载时不终止
  const worker = new Worker('/worker.js');
  worker.postMessage('start');

  // 错误 4：建立了 WebSocket 连接但卸载时不关闭
  const ws = new WebSocket('wss://api.example.com');
  ws.onmessage = handleMessage;

  // 渲染应用
  ReactDOM.createRoot(container).render(<App />);
}

export async function unmount(props: any) {
  const { container } = props;
  ReactDOM.createRoot(container).unmount();
  // 只卸载了 React 组件，没有清理任何副作用
  // globalInterval 继续执行
  // resize 监听器继续响应
  // Worker 继续运行
  // WebSocket 继续连接
}
```

用户在五个子应用之间来回切换十次后，页面上同时运行着 50 个定时器、50 个 resize 监听器、50 个 Worker 和 50 个 WebSocket 连接。浏览器内存从 200MB 飙升到 2GB，页面卡死。

**教训：微前端的生命周期管理比单体应用严格十倍。** 在单体应用中，页面刷新会自动清理一切。但在微前端中，子应用的"卸载"不等于页面刷新——主应用和其他子应用仍在运行。每一个副作用都必须在 `unmount` 中显式清理。

```typescript
// 正确的做法
export async function unmount(props: any) {
  const { container } = props;

  // 清理所有副作用
  window.clearInterval(globalInterval);
  window.removeEventListener('resize', globalEventHandler);
  worker.terminate();
  ws.close();

  // 最后卸载 React
  ReactDOM.createRoot(container).unmount();
}
```

### 18.3.6 被放弃的方案：服务端组合的前端尝试

在微前端概念早期（2017-2018），有团队尝试过"服务端组合"方案——在 Nginx 或 Node.js 层将多个子应用的 HTML 片段拼接为一个完整页面：

这个方案通过 Nginx SSI（Server Side Includes）或 Node.js 中间层将多个子应用的 HTML 片段拼接为一个完整页面。优点是零 JS 框架依赖、首屏性能极佳。但它最终被大多数团队放弃，原因有三：

1. **无客户端交互能力**：服务端拼接的是静态 HTML，子应用之间的客户端交互（如点击导航切换内容区）需要页面刷新，用户体验退回到 MPA 时代
2. **CSS/JS 冲突无解**：多个子应用的 CSS 和 JS 被拼接到同一个页面，没有任何隔离机制——比 iframe 还不如
3. **开发体验极差**：本地开发需要启动 Nginx + 所有子应用服务，调试困难

**教训：微前端的核心价值在于"运行时"——在浏览器中动态地加载、隔离和协调多个应用。** 纯服务端方案虽然技术简单，但无法提供现代 Web 应用所需的交互体验。不过，"服务端组合"的思路并未完全消亡——它以 Server Islands 的形式在 2025 年重新出现，我们将在 18.4 节讨论。

## 18.4 微前端的下一个五年：标准化、岛屿与边缘

微前端十年，从 iframe 走到 Module Federation，核心范式经历了四代演进。接下来的五年，三个技术趋势将深刻重塑微前端的面貌。

### 18.4.1 Web Components 标准化：框架无关的终极承诺

Web Components（Custom Elements + Shadow DOM + HTML Templates）是浏览器原生提供的组件化标准。微前端社区对它寄予厚望——如果每个子应用都封装为 Web Component，那么框架无关、样式隔离、生命周期管理都可以由浏览器原生解决，不再需要框架层的沙箱。

```typescript
// 将微前端子应用封装为 Web Component
class MicroAppElement extends HTMLElement {
  private shadow: ShadowRoot;
  private app: any;

  constructor() {
    super();
    // Shadow DOM 提供原生的 CSS 隔离
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  // 浏览器原生的生命周期——无需框架管理
  async connectedCallback() {
    const appName = this.getAttribute('name');
    const entry = this.getAttribute('entry');

    // 加载子应用的资源
    const module = await import(/* webpackIgnore: true */ entry!);

    // 在 Shadow DOM 内挂载
    const container = document.createElement('div');
    this.shadow.appendChild(container);
    this.app = await module.mount({ container });
  }

  disconnectedCallback() {
    // 浏览器原生的卸载时机
    this.app?.unmount();
  }

  // 属性变化监听——原生的 props 传递机制
  static get observedAttributes() {
    return ['route', 'theme', 'user'];
  }

  attributeChangedCallback(name: string, oldVal: string, newVal: string) {
    this.app?.onPropsChange?.({ [name]: newVal });
  }
}

customElements.define('micro-app', MicroAppElement);
```

使用时：

```html
<!-- 声明式地使用微前端组件 -->
<micro-app
  name="order-app"
  entry="https://order.example.com/main.js"
  route="/order"
  theme="dark"
></micro-app>
```

这是 Wujie 已经走通的路线——它用 Web Components 作为子应用的挂载容器。但 Web Components 的标准化还面临几个关键缺口：

**一、`@scope` 规范。** CSS `@scope` 允许限定样式规则的作用范围，是 Shadow DOM 之外的另一种原生 CSS 隔离方案。它已在 Chrome 118+ 中可用，但 Firefox 和 Safari 的支持仍在进行中。

```css
/* @scope 规范：原生 CSS 作用域 */
@scope (.order-app) {
  /* 这些样式只对 .order-app 内的元素生效 */
  .container { margin: 0 auto; }
  .button { background: blue; }

  /* 甚至可以排除某些区域 */
  @scope (.order-app) to (.third-party-widget) {
    /* 不影响第三方组件内部 */
  }
}
```

**二、Declarative Shadow DOM。** 当前的 Shadow DOM 只能通过 JavaScript 创建（`attachShadow`）。Declarative Shadow DOM 允许在 HTML 中直接声明 Shadow DOM，这对 SSR（服务端渲染）至关重要。

```html
<!-- Declarative Shadow DOM：SSR 友好的 Shadow DOM -->
<micro-app name="order-app">
  <template shadowrootmode="open">
    <style>
      /* 这些样式在 Shadow DOM 内，天然隔离 */
      .container { margin: 0 auto; }
    </style>
    <div class="container">
      <!-- 服务端直出的子应用 HTML -->
    </div>
  </template>
</micro-app>
```

**三、跨 Shadow DOM 通信标准。** 目前 Shadow DOM 内外的通信主要依赖 Custom Events 和 attribute 传递，缺乏标准化的上下文传递机制（类似 React Context）。

> **深度洞察**：Web Components 的标准化进程比社区预期的要慢——这不是技术问题，而是**标准制定的政治博弈**。Google 推动 Web Components 最为积极（Chrome 团队主导了大量规范），但 Apple（Safari/WebKit）的优先级不同，导致部分关键 API（如 `ElementInternals` 的完整实现）在 Safari 上滞后。微前端不能完全押注于 Web Components 的全面成熟——至少在 2028 年之前，框架层的补充方案仍然必要。

### 18.4.2 Server Islands：服务端组合的文艺复兴

还记得 18.3.6 节被放弃的"服务端组合"方案吗？它正在以一种更优雅的形式回归——**Server Islands**（服务端岛屿）。

Server Islands 的核心思想：页面的大部分内容在服务端渲染为静态 HTML（甚至缓存在 CDN），只有"需要动态交互"的区域以"岛屿"（Island）的形式在客户端 hydrate。

```html
<!-- Server Islands：服务端渲染 + 按需 hydrate -->
<body>
  <!-- 静态区域：服务端直出，CDN 缓存 -->
  <header><!-- SSR --></header>
  <nav><!-- SSR --></nav>

  <!-- Island 1：商品列表（团队 A 负责，进入视口时 hydrate）-->
  <product-island server-rendered hydrate="visible"
    src="https://product-team.example.com/island.js">
    <!-- SSR 内容 -->
  </product-island>

  <!-- Island 2：购物车（团队 B 负责，空闲时 hydrate）-->
  <cart-island server-rendered hydrate="idle"
    src="https://cart-team.example.com/island.js">
    <!-- SSR 内容 -->
  </cart-island>

  <!-- Island 3：推荐引擎（团队 C 负责）-->
  <recommendation-island server-rendered hydrate="visible"
    src="https://rec-team.example.com/island.js">
    <!-- SSR 内容 -->
  </recommendation-island>

  <footer><!-- SSR --></footer>
</body>
```

Server Islands 与传统微前端的关键区别：

| 维度 | 传统微前端 | Server Islands |
|------|-----------|---------------|
| **首屏渲染** | 客户端渲染，白屏时间长 | 服务端直出，瞬间呈现 |
| **JS 加载** | 加载所有子应用的 JS | 只加载需要交互的岛屿 JS |
| **团队边界** | 子应用级（页面级） | 岛屿级（组件级） |
| **SEO** | 需要额外配置 SSR | 天然 SEO 友好 |
| **隔离机制** | 运行时沙箱 | 服务端隔离 + 客户端岛屿隔离 |

Astro 框架已经实现了 Islands 架构，而 Next.js 的 Partial Prerendering 和 Remix 的 `clientLoader` 也在向这个方向演进。当 Islands 架构与 Web Components 结合时，微前端的形态将从"多个 SPA 的运行时编排"演变为"多个岛屿的服务端组合 + 客户端按需 hydrate"。

### 18.4.3 Edge Rendering：微前端的地理分布

边缘计算（Edge Computing）正在改变微前端的部署模型。传统微前端的所有子应用都部署在中心化的 CDN 或源站，用户从同一个位置加载所有资源。Edge Rendering 将"渲染"这个动作推到了距离用户最近的边缘节点。

```typescript
// Cloudflare Workers 上的微前端边缘编排
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const appConfig = matchRoute(url.pathname);
    if (!appConfig) return new Response('Not Found', { status: 404 });

    // 在边缘节点：渲染主框架 + 并行获取子应用 SSR 内容
    const [shell, appContent] = await Promise.all([
      renderShell(url, env),
      env.SERVICE_BINDINGS[appConfig.name].fetch(request),
    ]);

    const html = shell.replace('<!-- APP -->', await appContent.text());
    return new Response(html, {
      headers: { 'Content-Type': 'text/html',
                 'Cache-Control': 's-maxage=60, stale-while-revalidate=3600' },
    });
  },
};
```

Edge Rendering 对微前端的意义在于三个方面：

**一、延迟优化。** 子应用的 HTML 在距离用户最近的边缘节点渲染，首字节时间（TTFB）从几百毫秒降低到几十毫秒。

**二、独立部署的天然支持。** 每个子应用可以是一个独立的边缘函数（Edge Function），部署互不影响。这是比 CDN 静态文件更彻底的独立部署——连渲染逻辑都是独立的。

**三、按区域定制。** 不同地区的用户可以看到不同的子应用组合。中国用户看到支付宝支付组件，美国用户看到 Stripe 支付组件——这种定制在边缘节点完成，无需客户端逻辑。

### 18.4.4 三条趋势的汇聚点

Web Components 标准化、Server Islands、Edge Rendering——这三条趋势并非独立发展，它们正在汇聚为一种新的微前端范式：

```
传统微前端（2019-2024）：
  客户端 SPA → 运行时加载子应用 SPA → 沙箱隔离 → 客户端路由协调

下一代微前端（2025-2030）：
  边缘节点 → 服务端组合 Islands → Web Components 封装 → 按需 hydrate

核心转变：
  从"运行时编排多个 SPA" → "编译时 + 边缘端编排多个组件"
  从"一个页面包含多个应用" → "一个页面包含多个独立部署的岛屿"
  从"框架级沙箱隔离" → "浏览器原生隔离（Shadow DOM + @scope）"
  从"客户端路由劫持" → "边缘路由 + 服务端组合"
```

这个转变的底层逻辑是：**将复杂度从客户端运行时转移到编译时和边缘端**。客户端的 JS 越少，性能越好，维护越简单。乾坤式的运行时沙箱是"在客户端解决所有问题"的极致——但问题是客户端的计算资源是最宝贵的（用户的设备千差万别）。把编排和隔离的工作交给编译器和边缘服务器，客户端只负责"显示和交互"——这是更合理的分工。

> **深度洞察**：Server Islands + Edge Rendering + Web Components 的组合可能让"微前端框架"这个品类本身变得不再必要。当浏览器原生提供了组件隔离（Web Components），服务端提供了组合能力（Server Islands），边缘网络提供了分布式部署（Edge Functions）——你还需要乾坤或 single-spa 吗？微前端框架的未来可能不是"更好的框架"，而是"融入基础设施直到不可见"。

## 18.5 回望全书：从碎片到全景

在结束本书之前，让我们做一次完整的回望。十八章的内容覆盖了微前端的六大核心问题域、四大主流方案、三层工程实践和一个架构哲学。让我们将这些碎片拼接成一幅全景图。

### 18.5.1 六大问题域的统一视角

微前端的所有技术问题都可以归入六大问题域。每个问题域中，不同方案做出了不同的取舍：

```
┌─────────────┬────────────┬────────────┬────────────┬───────────┐
│   问题域     │   乾坤      │  single-spa │  Module Fed │   Wujie    │
├─────────────┼────────────┼────────────┼────────────┼───────────┤
│ JS 隔离     │ Proxy 沙箱  │ 无(自行处理) │ 模块作用域   │ iframe    │
│ CSS 隔离    │ Scoped CSS  │ 无(自行处理) │ 约定(CSSMod)│ Shadow DOM│
│ 应用加载    │ HTML Entry  │ JS Entry    │ 模块联邦    │ iframe加载 │
│ 应用通信    │ 全局状态     │ Custom Event│ 直接导入    │ Props代理  │
│ 路由管理    │ 路由劫持     │ 路由劫持    │ 应用内路由   │ iframe路由 │
│ 依赖共享    │ externals   │ externals   │ 编译时共享   │ 有限共享   │
├─────────────┼────────────┼────────────┼────────────┼───────────┤
│ 核心哲学    │ 运行时拦截   │ 路由驱动    │ 编译时协商   │ 原生隔离   │
└─────────────┴────────────┴────────────┴────────────┴───────────┘
```

这张表揭示了一个关键洞见：**没有任何一个方案在所有问题域中都是最优解**。乾坤的 JS 隔离最成熟但有性能开销，Module Federation 的依赖共享最高效但无隔离保障，Wujie 的 CSS 隔离最完美但通信复杂度最高。架构决策的本质就是在这张表中，为你的具体场景找到最合理的组合。

### 18.5.2 微前端演进的底层逻辑

回顾微前端的四代演进，可以提炼出一条清晰的底层逻辑：

```
第一代 iframe（2015-）：
  思路：让浏览器帮我隔离
  代价：性能差、体验割裂
  反思：隔离太重了，需要更轻量的方案

第二代 路由分发 / single-spa（2018-）：
  思路：不隔离了，靠路由分发实现独立部署
  代价：无隔离、全局污染
  反思：不隔离不行，需要在运行时自建隔离

第三代 运行时沙箱 / 乾坤（2019-）：
  思路：用 JS 在运行时模拟隔离（Proxy 沙箱 + CSS 改写）
  代价：沙箱有逃逸风险、CSS 改写不完美、运行时开销
  反思：运行时方案终究是"模拟"，能否在编译时解决？

第四代 编译时共享 / Module Federation（2022-）：
  思路：在编译阶段处理模块边界和依赖共享
  代价：需要统一构建工具、无强制隔离
  反思：编译时和运行时各有优势，也许答案是组合
```

每一代都是对上一代"反思"的回应。第五代——如果存在的话——大概率是**编译时 + 边缘端 + 浏览器原生**的三方协作：编译时处理模块边界和依赖，边缘端处理组合和路由，浏览器原生处理隔离（Web Components + @scope）。客户端运行时的角色将大幅缩小。

### 18.5.3 一个核心观点

本书从第 1 章到第 18 章，反复出现一个核心观点，现在是正式表述它的时候：

**微前端的终极形态不是"前端的微服务"，而是"模块的联邦"。**

为什么这么说？

"前端的微服务"这个类比暗示了后端微服务的所有特征：独立进程、网络通信、服务发现、负载均衡。但前端的运行环境（浏览器）和后端的运行环境（服务器集群）有本质区别：

```
后端微服务                          前端"微服务"
─────────────                      ─────────────
独立进程 ✓                          同一浏览器标签页
网络通信（HTTP/gRPC）✓              同一 JS 运行时（可直接调用）
无限水平扩展 ✓                      受限于用户设备性能
服务发现机制 ✓                      无标准化的服务发现
独立数据库 ✓                        共享 DOM、共享 URL、共享浏览器 API
```

前端子应用不是独立的"服务"——它们运行在同一个浏览器标签页中，共享同一个 DOM 树、同一个 URL、同一个浏览器 API 集合。强行用"微服务"的思路去做微前端——追求完美隔离、通过序列化消息通信、每个子应用完全自包含——会导致过度工程化和性能灾难。

"模块的联邦"是一个更准确的比喻。Module Federation 的命名本身就蕴含了这个洞察：子应用不是"独立的服务"，而是"联邦中的模块"——它们有各自的自治权（独立构建、独立部署），但同时是一个联邦的成员（共享运行时、共享依赖、遵守公共协议）。联邦的成员之间不需要严格的隔离墙——它们需要的是**清晰的契约和适度的边界**。

```typescript
// "微服务思维"的微前端——过度隔离
const microServiceApproach = {
  isolation: 'iframe',              // 完全隔离
  communication: 'postMessage',     // 序列化通信
  deps: 'each-app-bundles-own',     // 每个应用独立打包所有依赖
  result: '用户加载 5MB 的 React × 5 = 25MB',
};

// "模块联邦思维"的微前端——适度共享
const moduleFederationApproach = {
  isolation: 'module-scope',        // 模块级边界
  communication: 'direct-import',   // 直接导入导出
  deps: 'shared-with-negotiation',  // 共享 + 版本协商
  result: '用户加载 5MB 的 React × 1 = 5MB + 各模块增量',
};
```

从"前端的微服务"到"模块的联邦"，核心转变是：

- 从**进程隔离**到**模块边界**
- 从**网络通信**到**接口契约**
- 从**独立运行时**到**共享运行时 + 版本协商**
- 从**追求完美隔离**到**追求合理共享**

这不是说隔离不重要——而是说隔离的粒度和方式应该匹配前端的运行环境特征，而非照搬后端的模型。

## 18.6 本章小结

本章从四个维度完成了对微前端架构的全景审视，也为全书画上了句号：

1. **设计模式**：微前端生态中的 10 个核心设计模式——Facade 统一入口、Proxy 沙箱隔离、Strategy 策略切换、Observer 事件通信、Mediator 协调中心、Factory 沙箱创建、Adapter 框架适配、Composite 嵌套组织、Singleton 全局资源、Chain of Responsibility 资源加载——它们可归为边界模式、协调模式和构造模式三组，对应微前端的三项核心工作：划清边界、协调交互、组织结构。

2. **架构张力**：隔离与共享是微前端永恒的张力。从 iframe 的完全隔离到 Module Federation 的深度共享，每种方案在光谱上的位置决定了它的适用场景和代价。成熟的架构在不同维度（JS、CSS、依赖、通信、路由）独立决策，而非一刀切。

3. **失败教训**：快照沙箱的性能瓶颈、CSS 隔离的不可能三角、全局状态的膨胀陷阱、过早引入的组织代价、子应用卸载的内存灾难、服务端组合的体验缺陷——这些失败和放弃的方案提供了比成功经验更深刻的洞见。

4. **未来展望**：Web Components 标准化提供浏览器原生隔离，Server Islands 实现服务端组合的文艺复兴，Edge Rendering 推动渲染的地理分布。三条趋势汇聚为一个方向：将复杂度从客户端运行时转移到编译时和边缘端。

作为全书的收官章节，我希望你带走的不仅是技术细节，更是一种**架构思维**。当你面对"该不该用微前端"时，不要只看技术潮流，要看你的团队规模、组织结构和痛点是否真正需要它。当你面对"该选哪种方案"时，不要只比较 Star 数和文档质量，要分析每种方案在隔离-共享光谱上的位置是否匹配你的约束。当你面对"微前端的未来是什么"时，不要只追逐新框架，要理解底层趋势——从运行时到编译时，从框架到基础设施，从隔离到联邦。

微前端十年，我们从 iframe 的粗暴隔离走到了 Module Federation 的精细共享。下一个十年，框架可能会消融于基础设施之中，"微前端"这个词本身也许会变得不再必要——就像今天没有人会特意说"我在用 AJAX"一样。但微前端背后的核心问题——**如何让不同的团队以不同的速度独立演进同一个产品**——永远存在。只要这个问题存在，本书所讨论的设计模式、架构权衡和工程智慧就不会过时。

> **深度洞察**：微前端的终极形态不是"前端的微服务"，而是"模块的联邦"。后端微服务追求进程级隔离和网络通信，因为服务器资源可以无限扩展。前端子应用运行在用户的浏览器中——一个资源受限、共享 DOM 和 URL 的环境——照搬微服务模型会导致过度工程化。Module Federation 的命名本身就是最好的宣言：子应用不是需要围墙隔开的独立王国，而是联邦中的自治成员——拥有独立构建和部署的自由，同时共享运行时和公共契约。从"隔离"到"联邦"，这不仅是技术路线的演进，更是架构哲学的成熟。

---

### 思考题

1. **设计模式应用**：本章列举了微前端中的 10 个核心设计模式。选择你最熟悉的一个微前端框架（乾坤、single-spa、Module Federation 或 Wujie），从源码中找到至少 3 个设计模式的具体实现位置，并分析为什么在那个位置使用那个模式是合理的。

2. **隔离 vs 共享**：假设你正在为一家拥有 50 名前端工程师、8 个业务团队、同时维护 React 和 Vue 技术栈的电商公司设计微前端架构。请在 JS 隔离、CSS 隔离、依赖共享、应用通信、路由管理五个维度上分别给出你的选择和理由。你会选择"一刀切"的统一方案，还是"混合型"的分维度方案？

3. **失败分析**：本章的"教训五"描述了子应用卸载时的内存泄漏问题。请设计一个"子应用副作用注册表"（Side Effect Registry）机制，使得子应用在 `mount` 阶段注册的所有副作用都能在 `unmount` 阶段被自动清理，无需开发者手动管理。给出 TypeScript 类型定义和核心实现。

4. **未来预测**：本章预测"Web Components + Server Islands + Edge Rendering"将重塑微前端。但如果未来五年 Web Components 的标准化进展不如预期（例如 Safari 持续拖延关键 API），微前端会走向什么方向？请给出你的"Plan B"架构方案。

5. **终极辩论**：本书的核心观点是"微前端的终极形态是模块的联邦，而非前端的微服务"。你同意这个观点吗？如果同意，请给出三个超越本书论述的补充论据。如果不同意，请构建一个反驳论证——在什么条件下，"前端的微服务"模型会比"模块的联邦"更合适？

</div>
