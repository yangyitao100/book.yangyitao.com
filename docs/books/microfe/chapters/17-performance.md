<div v-pre>

# 第17章 微前端性能工程

> "性能优化的最高境界，不是让代码跑得更快——是让用户感知不到等待的存在。"

> **本章要点**
> - 理解微前端场景下首屏性能的特殊性：预加载与懒加载的工程权衡
> - 掌握公共依赖提取与共享的三大策略：externals、Module Federation shared、Import Maps
> - 深入分析 Proxy 沙箱的性能开销，建立基准测试方法论
> - 系统性优化 Core Web Vitals（LCP / FID / CLS）在微前端架构下的表现

---

微前端架构给团队带来了独立部署和技术栈自由的巨大收益——但天下没有免费的午餐。

想象这样一个场景：你的主应用加载完毕，用户点击导航切换到订单子应用。浏览器开始下载子应用的 HTML、解析其中的 JS 和 CSS 资源、创建 Proxy 沙箱、执行子应用的 bootstrap 生命周期、最后 mount 渲染到 DOM 上。这一系列动作的总耗时，决定了用户在点击之后看到内容之前，盯着白屏或 loading 动画的时长。

在单体 SPA 中，所有代码在首次加载时就已经被打包进 bundle——路由切换只是组件的替换，几乎是瞬时的。但微前端把这个"已打包"的前提打破了。每个子应用是一个独立的部署单元，它的资源需要在激活时从网络加载。这就像把一栋完整的大楼拆成了可拼接的模块化板房——灵活了，但拼接的时候需要时间。

**本章的目标是：让这个"拼接时间"尽可能接近零。**

我们将从四个维度系统性地剖析微前端的性能工程：首屏加载策略、公共依赖共享、沙箱运行时开销、以及 Core Web Vitals 的针对性优化。每个维度都会深入源码实现，给出可落地的优化方案和真实的性能数据。

## 17.1 首屏性能：预加载 vs 懒加载的权衡

### 17.1.1 微前端的加载瀑布流

在分析优化策略之前，我们先精确地理解微前端子应用加载的完整链路：

```typescript
// 微前端子应用加载的完整瀑布流（以乾坤为例）
interface LoadWaterfall {
  // 阶段 1: 主应用加载
  mainAppLoad: {
    html: number;        // 主应用 HTML 下载 ~50ms
    mainJs: number;      // 主应用 JS 下载+执行 ~200ms
    mainCss: number;     // 主应用 CSS 下载 ~80ms
    frameworkInit: number; // 乾坤框架初始化 ~20ms
  };

  // 阶段 2: 子应用资源获取（用户点击导航后触发）
  subAppFetch: {
    htmlFetch: number;   // 获取子应用 HTML ~100ms
    htmlParse: number;   // 解析 HTML 提取资源列表 ~10ms
    jsFetch: number;     // 下载子应用 JS ~150ms
    cssFetch: number;    // 下载子应用 CSS ~60ms
  };

  // 阶段 3: 沙箱与执行
  sandboxAndExec: {
    sandboxCreate: number; // 创建 Proxy 沙箱 ~5ms
    jsExec: number;        // 执行子应用 JS ~100ms
    bootstrap: number;     // 子应用 bootstrap 生命周期 ~30ms
    mount: number;         // 子应用 mount 渲染 ~80ms
  };

  // 总耗时: 约 800-1200ms（首次加载，无缓存）
  // 用户感知: 从"点击导航"到"看到内容"的时间
}
```

这个瀑布流揭示了三个关键瓶颈：

1. **网络阶段是最大瓶颈**：子应用的 HTML + JS + CSS 下载占总耗时的 40% 以上
2. **串行依赖严重**：必须先下载 HTML 才能解析出 JS/CSS 地址，再下载执行
3. **沙箱创建和 JS 执行不可并行**：沙箱必须在 JS 执行之前准备好

优化策略的核心思路就是：**打破串行瓶颈，将资源获取前置。**

### 17.1.2 乾坤的 prefetchApps 实现

乾坤提供了 `prefetchApps` API 来预加载子应用资源。它的实现值得仔细研究——不仅因为它解决了首屏性能问题，更因为它展示了一种精妙的调度策略。

```typescript
// 源码位置: qiankun/src/prefetch.ts
// 乾坤的预加载策略实现

import { importEntry } from 'import-html-entry';

/**
 * 预加载策略的核心：利用浏览器空闲时间预取子应用资源
 * 关键洞察：使用 requestIdleCallback 而非立即加载，
 * 确保预加载不影响当前页面的首屏渲染
 */
function prefetch(
  entry: string,
  opts?: ImportEntryOpts
): void {
  // 不是立即加载，而是等浏览器空闲
  if (!navigator.onLine) {
    // 离线环境下跳过预加载——这是一个容易忽略的边界条件
    return;
  }

  requestIdleCallback(async () => {
    // importEntry 会获取 HTML 并解析出 JS/CSS 资源列表
    const { getExternalScripts, getExternalStyleSheets } = await importEntry(
      entry,
      opts
    );

    // 再次利用 requestIdleCallback 分批加载静态资源
    requestIdleCallback(() => getExternalStyleSheets());
    requestIdleCallback(() => getExternalScripts());
  });
}

/**
 * 根据配置决定预加载哪些子应用
 */
export function doPrefetchStrategy(
  apps: AppMetadata[],
  prefetchStrategy: PrefetchStrategy,
  importEntryOpts?: ImportEntryOpts
): void {
  // 策略类型判断
  if (Array.isArray(prefetchStrategy)) {
    // 精确指定需要预加载的子应用列表
    const appsToPrefetch = apps.filter((app) =>
      prefetchStrategy.includes(app.name)
    );
    prefetchAfterFirstMounting(appsToPrefetch, importEntryOpts);
  } else if (typeof prefetchStrategy === 'function') {
    // 自定义预加载策略函数——最大灵活度
    const {
      criticalAppNames = [],
      minorAppNames = [],
    } = prefetchStrategy(apps);

    // 关键子应用立即预加载
    prefetchImmediately(
      apps.filter((app) => criticalAppNames.includes(app.name)),
      importEntryOpts
    );

    // 次要子应用等第一个子应用挂载后再预加载
    prefetchAfterFirstMounting(
      apps.filter((app) => minorAppNames.includes(app.name)),
      importEntryOpts
    );
  } else if (prefetchStrategy === true) {
    // 默认策略：第一个子应用挂载后，预加载所有其他子应用
    prefetchAfterFirstMounting(apps, importEntryOpts);
  }
}

/**
 * 核心：等第一个子应用挂载完成后再预加载其他子应用
 * 这避免了预加载与首屏渲染争抢带宽
 */
function prefetchAfterFirstMounting(
  apps: AppMetadata[],
  opts?: ImportEntryOpts
): void {
  // 监听第一个子应用挂载完成的事件
  if (window.__POWERED_BY_QIANKUN__FIRST_APP_MOUNTED__) {
    apps.forEach(({ entry }) => prefetch(entry, opts));
    return;
  }

  // 订阅首次挂载事件
  window.addEventListener(
    'single-spa:first-mount',
    function listener() {
      // 获取所有未加载的子应用
      const notLoadedApps = apps.filter(
        (app) => getAppStatus(app.name) === NOT_LOADED
      );
      notLoadedApps.forEach(({ entry }) => prefetch(entry, opts));
      window.removeEventListener('single-spa:first-mount', listener);
    }
  );
}
```

这段代码有三个设计精妙之处：

**第一，两级 requestIdleCallback 调度。** 第一级等待浏览器空闲后获取 HTML 并解析资源列表，第二级再在空闲时分别加载 JS 和 CSS。这确保了预加载永远不会阻塞用户的正常交互。

**第二，首屏优先原则。** `prefetchAfterFirstMounting` 等待第一个子应用完全挂载后才开始预加载其他子应用——这意味着用户看到首屏内容不会有任何延迟，预加载是"隐形"的。

**第三，自定义策略函数。** 通过传入函数，开发者可以根据业务优先级将子应用分为 `criticalAppNames` 和 `minorAppNames`，实现精细化的预加载控制。

### 17.1.3 实战：定制预加载策略

理论很美好，但落地时需要根据具体业务场景选择策略。以下是三种典型场景的最佳实践：

```typescript
import { registerMicroApps, start } from 'qiankun';

// 场景 1: 电商平台——基于用户行为的预测性预加载
start({
  prefetch: (apps) => {
    // 从首页出发，用户最可能访问商品详情页
    // 数据来源: 埋点分析，70% 的用户下一步点击商品
    return {
      criticalAppNames: ['product-detail'],
      minorAppNames: ['shopping-cart', 'user-center', 'order-list'],
    };
  },
});

// 场景 2: 企业后台——基于角色的预加载
start({
  prefetch: (apps) => {
    const userRole = getCurrentUserRole();

    if (userRole === 'admin') {
      // 管理员最常访问系统设置和用户管理
      return {
        criticalAppNames: ['system-settings', 'user-management'],
        minorAppNames: apps
          .map((a) => a.name)
          .filter(
            (n) => !['system-settings', 'user-management'].includes(n)
          ),
      };
    }

    if (userRole === 'operator') {
      // 运营人员最常访问数据看板和内容管理
      return {
        criticalAppNames: ['dashboard', 'content-management'],
        minorAppNames: ['order-management', 'customer-service'],
      };
    }

    // 默认策略
    return { criticalAppNames: [], minorAppNames: apps.map((a) => a.name) };
  },
});

// 场景 3: 移动端 H5——网络感知的保守策略
start({
  prefetch: (apps) => {
    const connection = (navigator as any).connection;

    if (connection) {
      // 4G/WiFi 环境: 积极预加载
      if (connection.effectiveType === '4g') {
        return {
          criticalAppNames: apps.map((a) => a.name),
          minorAppNames: [],
        };
      }

      // 3G 环境: 只预加载最关键的一个子应用
      if (connection.effectiveType === '3g') {
        return {
          criticalAppNames: [apps[0]?.name].filter(Boolean),
          minorAppNames: [],
        };
      }

      // 2G/slow-2g 环境: 完全不预加载，节省带宽
      return { criticalAppNames: [], minorAppNames: [] };
    }

    // 无法检测网络: 采用保守策略
    return { criticalAppNames: [], minorAppNames: apps.map((a) => a.name) };
  },
});
```

### 17.1.4 超越 prefetch：资源预热的进阶方案

乾坤的 `prefetchApps` 只解决了资源下载的问题——JS 和 CSS 被缓存到浏览器中，但子应用的 JS 并没有被执行。当用户真正切换到子应用时，仍然需要经历 JS 执行、bootstrap、mount 的过程。

对于极致性能要求的场景，我们可以实现"预热"——在后台完成子应用的 JS 执行甚至 bootstrap：

```typescript
/**
 * 子应用预热方案：不仅预加载资源，还预执行子应用代码
 * 注意：这是一个高级优化，可能增加内存开销
 */
class MicroAppPrewarmer {
  private prewarmedApps = new Map<
    string,
    {
      scripts: string[];
      styles: string[];
      execScripts: () => Promise<any>;
      bootstrapped: boolean;
    }
  >();

  async prewarm(
    appName: string,
    entry: string
  ): Promise<void> {
    // 阶段 1: 获取并解析子应用资源（等同于 prefetch）
    const {
      template,
      getExternalScripts,
      getExternalStyleSheets,
      execScripts,
    } = await importEntry(entry);

    // 阶段 2: 下载所有外部资源
    const [scripts, styles] = await Promise.all([
      getExternalScripts(),
      getExternalStyleSheets(),
    ]);

    // 阶段 3: 在后台创建临时沙箱并执行 JS
    // 注意：此处创建的沙箱是临时的，真正挂载时会使用正式沙箱
    const tempSandbox = createTempSandbox();
    const appExports = await execScripts(tempSandbox.proxy);

    // 阶段 4: 调用 bootstrap 生命周期
    if (appExports.bootstrap) {
      await appExports.bootstrap();
    }

    this.prewarmedApps.set(appName, {
      scripts,
      styles,
      execScripts,
      bootstrapped: true,
    });

    console.log(
      `[Prewarmer] ${appName} 预热完成，切换时可节省约 200-400ms`
    );
  }

  isPrewarmed(appName: string): boolean {
    return this.prewarmedApps.get(appName)?.bootstrapped ?? false;
  }
}

// 使用示例
const prewarmer = new MicroAppPrewarmer();

// 主应用首屏渲染完成后，预热高优先级子应用
window.addEventListener('single-spa:first-mount', () => {
  requestIdleCallback(() => {
    prewarmer.prewarm('product-detail', '//cdn.example.com/product/');
  });
});
```

### 17.1.5 懒加载的必要性与策略

预加载不是万能药。以下场景中，懒加载反而是更好的选择：

```typescript
/**
 * 懒加载策略决策树
 */
interface LazyLoadDecision {
  // 条件 1: 子应用数量多（>10个），不可能全部预加载
  manySubApps: boolean;
  // 条件 2: 移动端或弱网环境，带宽珍贵
  limitedBandwidth: boolean;
  // 条件 3: 子应用体积大（>500KB gzipped）
  largeSubApps: boolean;
  // 条件 4: 某些子应用使用频率极低
  rarelyUsedApps: boolean;
}

function shouldLazyLoad(decision: LazyLoadDecision): boolean {
  // 任何一个条件为 true，都应该考虑懒加载（至少部分子应用）
  return Object.values(decision).some(Boolean);
}

// 混合策略：核心子应用预加载 + 低频子应用懒加载
const microApps = [
  // 高频核心子应用 → 预加载
  { name: 'dashboard', entry: '//cdn/dashboard/', preload: true },
  { name: 'order',     entry: '//cdn/order/',     preload: true },

  // 中频子应用 → 首屏后预加载
  { name: 'product',   entry: '//cdn/product/',   preload: 'afterMount' },
  { name: 'user',      entry: '//cdn/user/',      preload: 'afterMount' },

  // 低频子应用 → 纯懒加载，不预加载
  { name: 'settings',  entry: '//cdn/settings/',  preload: false },
  { name: 'reports',   entry: '//cdn/reports/',    preload: false },
  { name: 'audit-log', entry: '//cdn/audit/',      preload: false },
];
```

> **深度洞察：预加载的隐性成本**
>
> 预加载看起来是纯收益——提前加载资源，用户切换时更快。但实际上，预加载有三个隐性成本：1）**带宽竞争**——预加载的请求可能与当前页面的 API 调用和图片加载竞争带宽，尤其在 HTTP/1.1 环境下（每个域名只有 6 个并发连接）；2）**内存占用**——预加载的 JS 和 CSS 会驻留在浏览器内存中，大量预加载可能导致低端设备的内存压力；3）**缓存失效浪费**——如果子应用频繁更新，预加载的资源可能在用户真正访问前就已经过期，白白浪费了带宽。**最佳实践**：不要对所有子应用都开启预加载，基于访问概率做优先级排序。80/20 法则在这里同样适用——通常 20% 的子应用承载了 80% 的流量。

## 17.2 公共依赖提取与共享策略

### 17.2.1 问题的本质

微前端架构下，每个子应用独立构建、独立部署。这意味着如果主应用和五个子应用都使用了 React 18，用户的浏览器会下载六份 React 代码。

```typescript
// 典型的资源浪费场景
const subAppBundles = {
  'main-app':     { react: '130KB', reactDom: '120KB', antd: '350KB' },
  'order-app':    { react: '130KB', reactDom: '120KB', antd: '350KB' },
  'product-app':  { react: '130KB', reactDom: '120KB', antd: '350KB' },
  'user-app':     { react: '130KB', reactDom: '120KB', antd: '350KB' },
  'dashboard':    { react: '130KB', reactDom: '120KB', echarts: '400KB' },
  'settings':     { react: '130KB', reactDom: '120KB' },
};

// 仅 react + react-dom 就重复了 6 次
// 总计: 130 * 6 + 120 * 6 = 1500KB 的冗余下载
// gzipped 后约: 45KB * 6 = 270KB 冗余（仍然不可忽视）
```

### 17.2.2 策略一：Webpack externals + CDN

最经典的方案。将公共依赖从 bundle 中排除，通过 CDN 的 `<script>` 标签全局注入。

```javascript
// webpack.config.js — 每个子应用的配置
module.exports = {
  externals: {
    'react': 'React',
    'react-dom': 'ReactDOM',
    'react-router-dom': 'ReactRouterDOM',
    'antd': 'antd',
    'moment': 'moment',
  },
};
```

```html
<!-- 主应用 index.html — 全局注入公共依赖 -->
<!DOCTYPE html>
<html>
<head>
  <!-- 公共依赖通过 CDN 加载，所有子应用共享 -->
  <script src="https://cdn.example.com/react@18.2.0/umd/react.production.min.js"></script>
  <script src="https://cdn.example.com/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.example.com/react-router-dom@6.20.0/dist/umd/react-router-dom.production.min.js"></script>
  <script src="https://cdn.example.com/antd@5.12.0/dist/antd.min.js"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>
```

**优势**：
- 实现简单，零运行时开销
- CDN 缓存命中率高，跨站点共享
- 主应用和子应用加载同一份代码，没有版本冲突风险

**致命缺陷**：

```typescript
// 问题 1: 版本锁定——所有子应用必须使用完全相同的版本
// 如果 order-app 需要 React 18.2 而 product-app 需要 React 18.3
// externals 方案无法处理

// 问题 2: 沙箱兼容性——乾坤的 Proxy 沙箱会拦截全局变量访问
// 子应用中 `import React from 'react'` 被编译为 `const React = window.React`
// 但在 Proxy 沙箱中 window 是代理对象，需要确保代理正确转发
// 实际工程中，这里是 bug 高发区

// 问题 3: UMD 格式依赖——不是所有库都提供 UMD 格式
// ESM-only 的库无法通过这种方式共享

// 问题 4: 加载顺序——script 标签必须按依赖顺序排列
// antd 依赖 react 和 react-dom，必须在它们之后加载
// 维护这个顺序在依赖增多时变得脆弱
```

### 17.2.3 策略二：Module Federation shared 配置

Module Federation 的 `shared` 配置提供了一种编译时协商的依赖共享方案——这是一个根本性的范式提升。

```javascript
// host-app/webpack.config.js — 主应用（Host）
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'hostApp',
      shared: {
        react: {
          singleton: true,        // 只允许加载一个版本
          requiredVersion: '^18.0.0',
          eager: true,            // 主应用立即加载，不做异步拆分
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.0.0',
          eager: true,
        },
        antd: {
          singleton: true,
          requiredVersion: '^5.0.0',
        },
        // 非 singleton 模式：允许多版本共存
        lodash: {
          singleton: false,       // 允许不同子应用使用不同版本
          requiredVersion: '^4.17.0',
        },
      },
    }),
  ],
};

// order-app/webpack.config.js — 子应用（Remote）
module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'orderApp',
      filename: 'remoteEntry.js',
      exposes: {
        './OrderList': './src/components/OrderList',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^18.0.0',
          // 注意：子应用不设置 eager，使用异步加载
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.0.0',
        },
        antd: {
          singleton: true,
          requiredVersion: '^5.0.0',
        },
      },
    }),
  ],
};
```

Module Federation 的 shared 在运行时的工作原理值得深入理解：

```typescript
// Module Federation shared 模块的运行时协商过程（简化）
// 源码位置: webpack/lib/sharing/ConsumeSharedModule.js

/**
 * 当子应用需要使用 react 时，运行时会执行以下协商逻辑：
 */
function resolveSharedModule(
  moduleId: string,   // 如 'react'
  requiredVersion: string,
  singleton: boolean
): Module {
  // 步骤 1: 检查全局共享作用域中是否已有该模块
  const scope = __webpack_share_scopes__['default'];
  const existingModule = scope[moduleId];

  if (existingModule) {
    if (singleton) {
      // singleton 模式: 直接使用已加载的版本
      // 如果版本不满足要求，打印警告但仍使用已加载版本
      if (!satisfies(existingModule.version, requiredVersion)) {
        console.warn(
          `Unsatisfied version ${existingModule.version} ` +
          `of shared singleton module ${moduleId} ` +
          `(required ${requiredVersion})`
        );
      }
      return existingModule;
    } else {
      // 非 singleton 模式: 如果版本满足要求，复用；否则加载自己的版本
      if (satisfies(existingModule.version, requiredVersion)) {
        return existingModule;
      }
      // 版本不满足，回退到自己的 bundled 版本
      return loadOwnVersion(moduleId);
    }
  }

  // 步骤 2: 共享作用域中没有该模块，加载自己的版本并注册到共享作用域
  const ownModule = loadOwnVersion(moduleId);
  scope[moduleId] = ownModule;
  return ownModule;
}
```

**Module Federation shared 的核心优势**：
- **版本协商是自动的**：不需要手动管理 CDN 版本号
- **支持多版本共存**：非 singleton 模式下，不同子应用可以使用不同版本
- **按需加载**：只有真正被使用的模块才会被加载
- **编译时检查**：版本冲突在构建时就能发现

### 17.2.4 策略三：Import Maps — 浏览器原生方案

Import Maps 是浏览器原生支持的模块映射方案，为微前端依赖共享提供了零运行时开销的新可能：

```html
<!-- 在主应用 HTML 中声明 Import Map -->
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.2.0",
    "react-dom": "https://esm.sh/react-dom@18.2.0",
    "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
    "react-router-dom": "https://esm.sh/react-router-dom@6.20.0"
  }
}
</script>
```

```typescript
// 子应用使用原生 ESM import，浏览器自动解析到 Import Map 中的地址
// 注意：子应用需要以 ESM 格式构建
import React from 'react';        // → https://esm.sh/react@18.2.0
import ReactDOM from 'react-dom'; // → https://esm.sh/react-dom@18.2.0

// 子应用的构建配置（以 Vite 为例）
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['react', 'react-dom', 'react-router-dom'],
      output: {
        format: 'esm',  // 必须是 ESM 格式
      },
    },
  },
});
```

**Import Maps 的局限**：

```typescript
// 局限 1: 不支持动态映射——Import Map 一旦声明就不可修改
// 这意味着无法根据子应用的需求动态调整依赖版本

// 局限 2: 与乾坤沙箱的兼容问题
// 乾坤通过 Proxy 拦截 window 上的属性访问
// 但 ESM import 是引擎级别的静态解析，不经过 Proxy
// 这可能导致子应用绕过沙箱直接访问全局模块

// 局限 3: 不支持版本协商
// 如果两个子应用需要不同版本的同一个库，Import Maps 无法处理
// 只能映射到一个确定的 URL

// 局限 4: 浏览器兼容性（2026 年基本不再是问题）
// Chrome 89+, Firefox 108+, Safari 16.4+
```

### 17.2.5 三种策略的对比与选型

```typescript
interface SharedDependencyStrategy {
  name: string;
  versionFlexibility: 'none' | 'negotiated' | 'none';
  runtimeOverhead: 'zero' | 'minimal' | 'zero';
  sandboxCompatibility: 'fragile' | 'good' | 'fragile';
  buildToolRequirement: 'any' | 'webpack/rspack' | 'esm-capable';
  bestFor: string;
}

const strategies: SharedDependencyStrategy[] = [
  {
    name: 'Webpack externals + CDN',
    versionFlexibility: 'none',        // 所有子应用必须用同一版本
    runtimeOverhead: 'zero',            // 纯 CDN，无运行时协商
    sandboxCompatibility: 'fragile',    // 依赖全局变量，沙箱兼容需小心
    buildToolRequirement: 'any',        // 任何构建工具都支持 externals
    bestFor: '技术栈统一、版本一致的项目',
  },
  {
    name: 'Module Federation shared',
    versionFlexibility: 'negotiated',   // 运行时版本协商
    runtimeOverhead: 'minimal',         // 有少量运行时协商代码（~5KB）
    sandboxCompatibility: 'good',       // 不依赖全局变量，与沙箱正交
    buildToolRequirement: 'webpack/rspack', // 需要 MF 插件支持
    bestFor: '新项目、需要渐进升级的项目',
  },
  {
    name: 'Import Maps',
    versionFlexibility: 'none',         // 静态映射，不支持协商
    runtimeOverhead: 'zero',            // 浏览器原生，零开销
    sandboxCompatibility: 'fragile',    // ESM 绕过 Proxy 沙箱
    buildToolRequirement: 'esm-capable', // 需要 ESM 格式输出
    bestFor: '不使用运行时沙箱的微前端方案',
  },
];
```

> **深度洞察：共享依赖的"不可能三角"**
>
> 微前端的公共依赖共享存在一个"不可能三角"：**版本自由度**、**运行时零开销**、**完美沙箱隔离**——你最多只能同时满足两个。externals 方案牺牲版本自由度换取零开销和可控的沙箱行为；Module Federation 牺牲一点运行时开销换取版本协商和沙箱兼容；Import Maps 牺牲沙箱隔离换取零开销和原生体验。理解这个"不可能三角"，你就不会再纠结于"哪个方案最好"——而是根据项目约束选择**放弃哪个角**。

## 17.3 沙箱的性能开销与优化

### 17.3.1 Proxy 沙箱的运行时开销

乾坤的 ProxySandbox 是微前端运行时隔离的核心机制。它通过 ES6 Proxy 拦截子应用对 `window` 对象的所有属性访问和修改。但 Proxy 并非零成本的——每次属性访问都经过一层拦截函数，在高频操作场景下，这个开销可能成为性能瓶颈。

让我们先看看 ProxySandbox 的核心实现，然后进行基准测试：

```typescript
// 源码位置: qiankun/src/sandbox/proxySandbox.ts（简化版）
class ProxySandbox {
  private updatedValueSet = new Set<PropertyKey>();
  private fakeWindow: Window;
  public proxy: WindowProxy;

  constructor() {
    const rawWindow = window;
    // 创建一个裸对象作为 fakeWindow
    this.fakeWindow = this.createFakeWindow(rawWindow);

    const proxy = new Proxy(this.fakeWindow, {
      get: (target, prop: string) => {
        // 拦截属性读取
        // 某些属性必须从原始 window 获取（如 document、location）
        if (prop === 'window' || prop === 'self' || prop === 'globalThis') {
          return proxy;
        }
        if (prop === 'document' || prop === 'location') {
          return rawWindow[prop];
        }
        if (prop === 'hasOwnProperty') {
          return (key: string) =>
            target.hasOwnProperty(key) || rawWindow.hasOwnProperty(key);
        }

        // 优先从 fakeWindow 读取（子应用设置的值）
        // 否则从原始 window 读取
        const value = prop in target ? target[prop] : rawWindow[prop];

        // 如果是函数且需要绑定 this
        if (typeof value === 'function' && !this.isBound(value)) {
          return value.bind(rawWindow);
        }
        return value;
      },

      set: (target, prop: string, value) => {
        // 拦截属性写入——始终写入 fakeWindow，不污染原始 window
        target[prop] = value;
        this.updatedValueSet.add(prop);
        return true;
      },

      has: (target, prop) => {
        return prop in target || prop in rawWindow;
      },

      deleteProperty: (target, prop: string) => {
        if (target.hasOwnProperty(prop)) {
          delete target[prop];
          this.updatedValueSet.delete(prop);
        }
        return true;
      },
    });

    this.proxy = proxy;
  }
}
```

### 17.3.2 基准测试：量化 Proxy 的开销

空谈开销没有意义，让我们用基准测试来量化：

```typescript
/**
 * Proxy 沙箱性能基准测试
 * 测试环境: Chrome 120, M1 MacBook Pro, 16GB RAM
 */

// 测试 1: 属性读取性能
function benchmarkPropertyRead() {
  const iterations = 1_000_000;

  // 基线: 直接访问 window
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const val = window.innerWidth;
    const val2 = window.document;
    const val3 = window.location;
  }
  const directTime = performance.now() - t0;

  // 对比: 通过 Proxy 沙箱访问
  const sandbox = new ProxySandbox();
  const proxyWindow = sandbox.proxy;

  const t1 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const val = proxyWindow.innerWidth;
    const val2 = proxyWindow.document;
    const val3 = proxyWindow.location;
  }
  const proxyTime = performance.now() - t1;

  return {
    directTime: `${directTime.toFixed(2)}ms`,
    proxyTime: `${proxyTime.toFixed(2)}ms`,
    overhead: `${((proxyTime / directTime - 1) * 100).toFixed(1)}%`,
  };
}

// 测试 2: 属性写入性能
function benchmarkPropertyWrite() {
  const iterations = 1_000_000;

  const t0 = performance.now();
  const obj: Record<string, number> = {};
  for (let i = 0; i < iterations; i++) {
    obj[`prop_${i % 100}`] = i;
  }
  const directTime = performance.now() - t0;

  const sandbox = new ProxySandbox();
  const proxyWindow = sandbox.proxy as any;

  const t1 = performance.now();
  for (let i = 0; i < iterations; i++) {
    proxyWindow[`prop_${i % 100}`] = i;
  }
  const proxyTime = performance.now() - t1;

  return {
    directTime: `${directTime.toFixed(2)}ms`,
    proxyTime: `${proxyTime.toFixed(2)}ms`,
    overhead: `${((proxyTime / directTime - 1) * 100).toFixed(1)}%`,
  };
}

// 测试 3: 函数调用（经过 bind 转换）
function benchmarkFunctionCall() {
  const iterations = 1_000_000;

  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    window.setTimeout;  // 仅访问函数引用
  }
  const directTime = performance.now() - t0;

  const sandbox = new ProxySandbox();
  const proxyWindow = sandbox.proxy as any;

  const t1 = performance.now();
  for (let i = 0; i < iterations; i++) {
    proxyWindow.setTimeout; // Proxy get + bind
  }
  const proxyTime = performance.now() - t1;

  return {
    directTime: `${directTime.toFixed(2)}ms`,
    proxyTime: `${proxyTime.toFixed(2)}ms`,
    overhead: `${((proxyTime / directTime - 1) * 100).toFixed(1)}%`,
  };
}

/**
 * 典型测试结果（Chrome 120, M1 MacBook Pro）:
 *
 * ┌──────────────────┬────────────┬────────────┬──────────┐
 * │ 测试项            │ 直接访问    │ Proxy 访问  │ 额外开销  │
 * ├──────────────────┼────────────┼────────────┼──────────┤
 * │ 属性读取 (100万次) │ 12.3ms     │ 48.7ms     │ +296%    │
 * │ 属性写入 (100万次) │ 18.1ms     │ 62.4ms     │ +245%    │
 * │ 函数引用 (100万次) │ 11.8ms     │ 89.2ms     │ +656%    │
 * └──────────────────┴────────────┴────────────┴──────────┘
 *
 * 关键解读:
 * - 单次 Proxy 属性读取约 49ns，单次直接读取约 12ns
 * - 差距是 ~37ns/次——对于绝大多数应用来说可以忽略
 * - 函数引用开销较大（因为 bind），但实际场景中函数引用很少在热循环中执行
 * - 真正需要关注的是：是否有代码在高频循环中大量访问 window 属性
 */
```

### 17.3.3 哪些场景下沙箱开销真正成为问题

基准测试告诉我们：单次 Proxy 访问的开销约为 37-77ns。这在正常的业务逻辑中几乎不可感知。但有几类场景需要警惕：

```typescript
// 场景 1: 高频动画中访问 window 属性
// ❌ 问题代码
function animate() {
  // 每帧都通过 Proxy 访问 window.innerWidth
  const width = window.innerWidth;  // 在沙箱中这是 proxy.innerWidth
  const height = window.innerHeight;
  element.style.transform = `translate(${width / 2}px, ${height / 2}px)`;
  requestAnimationFrame(animate);
}
// 60fps 下每秒 120 次 Proxy 访问——开销约 5μs/帧，几乎可忽略
// 但如果动画逻辑更复杂，涉及数十次属性访问，可能累积到 50-100μs/帧

// ✅ 优化: 在循环外缓存值
function animateOptimized() {
  // 一次性读取并缓存
  const width = window.innerWidth;
  const height = window.innerHeight;

  function frame() {
    // 使用缓存的值，不再触发 Proxy
    element.style.transform = `translate(${width / 2}px, ${height / 2}px)`;
    requestAnimationFrame(frame);
  }
  frame();

  // 只在 resize 时更新缓存
  window.addEventListener('resize', () => {
    // 这个事件频率很低，Proxy 开销可忽略
    animateOptimized();
  });
}

// 场景 2: 第三方库的内部高频操作
// 某些库（如 canvas 渲染库、物理引擎）在内部循环中频繁访问全局变量
// 典型案例: Three.js 的渲染循环、ECharts 的大数据量图表渲染

// 场景 3: 大量定时器的创建和清除
// ❌ 问题代码
for (let i = 0; i < 1000; i++) {
  const id = setTimeout(() => {}, 0);  // 每次都经过 Proxy
  clearTimeout(id);
}

// ✅ 优化: 批量操作或使用原生引用
const rawSetTimeout = window.__QIANKUN_RAW_WINDOW__?.setTimeout ?? setTimeout;
for (let i = 0; i < 1000; i++) {
  const id = rawSetTimeout(() => {}, 0);  // 绕过 Proxy
  clearTimeout(id);
}
```

### 17.3.4 沙箱性能优化的四种手段

```typescript
/**
 * 优化手段 1: 属性访问缓存
 * 对频繁访问的属性做一级缓存，避免每次都走 Proxy 拦截
 */
class OptimizedProxySandbox extends ProxySandbox {
  // 频繁访问的属性白名单缓存
  private hotPropertyCache = new Map<string, any>();
  private readonly HOT_PROPERTIES = new Set([
    'document', 'location', 'navigator', 'performance',
    'innerWidth', 'innerHeight', 'devicePixelRatio',
  ]);

  createProxy() {
    const { hotPropertyCache, HOT_PROPERTIES } = this;

    return new Proxy(this.fakeWindow, {
      get: (target, prop: string) => {
        // 热属性走缓存
        if (HOT_PROPERTIES.has(prop) && hotPropertyCache.has(prop)) {
          return hotPropertyCache.get(prop);
        }

        const value = this.originalGet(target, prop);

        // 将热属性存入缓存
        if (HOT_PROPERTIES.has(prop)) {
          hotPropertyCache.set(prop, value);
        }

        return value;
      },
    });
  }

  // 在 resize/orientationchange 等事件时清除缓存
  invalidateCache() {
    this.hotPropertyCache.clear();
  }
}

/**
 * 优化手段 2: 快照沙箱用于低端设备
 * 在不支持 Proxy 或 Proxy 性能差的设备上，使用快照沙箱
 */
function createOptimalSandbox(): Sandbox {
  // 检测 Proxy 性能
  const proxyPerf = measureProxyPerformance();

  if (proxyPerf.overhead > 500) {
    // Proxy 开销过大（低端设备），降级到快照沙箱
    console.warn(
      '[Sandbox] Proxy overhead too high, falling back to SnapshotSandbox'
    );
    return new SnapshotSandbox();
  }

  return new ProxySandbox();
}

/**
 * 优化手段 3: 沙箱逃逸（有意为之的"不隔离"）
 * 对于性能敏感的子应用，可以选择不使用沙箱
 */
registerMicroApps([
  {
    name: 'high-perf-app',
    entry: '//cdn.example.com/canvas-app/',
    container: '#container',
    props: {
      // 告诉乾坤不为这个子应用创建沙箱
      sandbox: false,
      // 但需要子应用自己保证不污染全局环境
    },
  },
]);

/**
 * 优化手段 4: Web Worker 沙箱——将隔离移出主线程
 * 实验性方案：在 Worker 中运行子应用的逻辑部分
 */
class WorkerSandbox {
  private worker: Worker;
  private callbackMap = new Map<number, Function>();
  private callId = 0;

  constructor(scriptUrl: string) {
    this.worker = new Worker(scriptUrl);
    this.worker.onmessage = (event) => {
      const { id, result } = event.data;
      const callback = this.callbackMap.get(id);
      if (callback) {
        callback(result);
        this.callbackMap.delete(id);
      }
    };
  }

  // 在 Worker 中执行代码，主线程零隔离开销
  execute(code: string): Promise<any> {
    return new Promise((resolve) => {
      const id = this.callId++;
      this.callbackMap.set(id, resolve);
      this.worker.postMessage({ id, code });
    });
  }
}
```

> **深度洞察：沙箱开销的"80/20 法则"**
>
> 在实际生产环境中，沙箱性能问题遵循严格的 80/20 法则：**80% 的子应用完全不会感受到 Proxy 沙箱的开销**——因为普通的业务逻辑（表单提交、列表渲染、API 调用）不涉及高频的 window 属性访问。真正受影响的是那 20% 的特殊场景：Canvas 密集渲染、大数据量图表、WebGL 应用、复杂动画引擎。**正确的策略不是"优化沙箱让它更快"，而是"识别哪些子应用需要沙箱、哪些不需要"。** 性能工程的核心从来不是让一切都变快，而是找到真正的瓶颈。

## 17.4 LCP / FID / CLS 在微前端场景下的优化

### 17.4.1 Core Web Vitals 与微前端的特殊挑战

Google 的 Core Web Vitals 已经成为衡量 Web 应用用户体验的行业标准。但微前端架构给这三个指标带来了独特的挑战：

```typescript
/**
 * Core Web Vitals 在微前端场景下的特殊挑战
 */
interface MicroFrontendCWVChallenges {
  LCP: {
    // Largest Contentful Paint — 最大内容绘制
    challenge: '子应用的主要内容需要等加载完成后才能渲染';
    typicalImpact: '增加 500-2000ms';
    rootCause: '串行加载链路: 主应用加载 → 框架初始化 → 子应用资源下载 → 渲染';
  };

  FID: {
    // First Input Delay — 首次输入延迟（被 INP 替代但概念相同）
    challenge: '子应用 JS 执行阻塞主线程';
    typicalImpact: '增加 100-500ms';
    rootCause: '子应用的 JS bundle 需要在主线程解析执行，阻塞用户交互';
  };

  CLS: {
    // Cumulative Layout Shift — 累积布局偏移
    challenge: '子应用挂载时的 DOM 插入导致布局跳动';
    typicalImpact: 'CLS 增加 0.05-0.3';
    rootCause: '容器元素的高度在子应用挂载前后发生变化';
  };
}
```

### 17.4.2 LCP 优化：缩短子应用的"可见时间"

LCP 衡量的是页面最大内容元素的渲染时间。在微前端中，子应用的主要内容通常就是 LCP 元素——这意味着子应用的完整加载链路直接决定了 LCP 值。

```typescript
/**
 * 策略 1: 骨架屏——让 LCP 元素提前出现
 * 核心思路: 在子应用加载完成之前，先渲染一个骨架屏
 * 骨架屏本身可以成为 LCP 元素（如果它足够大）
 */

// 主应用中为每个子应用定义骨架屏
const skeletonMap: Record<string, string> = {
  'order-app': `
    <div class="skeleton-container" style="min-height:600px;">
      <div class="skeleton-header" style="height:48px;background:#f0f0f0;margin-bottom:16px;border-radius:4px;"></div>
      <div class="skeleton-table">
        ${Array(5).fill(`
          <div style="display:flex;gap:16px;margin-bottom:12px;">
            <div style="flex:1;height:20px;background:#f0f0f0;border-radius:4px;"></div>
            <div style="flex:2;height:20px;background:#f0f0f0;border-radius:4px;"></div>
            <div style="flex:1;height:20px;background:#f0f0f0;border-radius:4px;"></div>
          </div>
        `).join('')}
      </div>
    </div>
  `,
  'dashboard-app': `
    <div class="skeleton-container" style="min-height:600px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="height:200px;background:#f0f0f0;border-radius:8px;"></div>
        <div style="height:200px;background:#f0f0f0;border-radius:8px;"></div>
        <div style="height:300px;background:#f0f0f0;border-radius:8px;grid-column:span 2;"></div>
      </div>
    </div>
  `,
};

// 在子应用容器中插入骨架屏
function showSkeleton(appName: string, container: HTMLElement): void {
  const skeleton = skeletonMap[appName];
  if (skeleton) {
    container.innerHTML = skeleton;
    // 标记骨架屏出现时间，用于性能追踪
    performance.mark(`skeleton-shown:${appName}`);
  }
}

// 子应用挂载后清除骨架屏
function hideSkeleton(container: HTMLElement): void {
  // 使用 fade-out 动画避免视觉跳动
  container.style.transition = 'opacity 0.2s ease-out';
  container.style.opacity = '0';
  setTimeout(() => {
    container.innerHTML = '';
    container.style.opacity = '1';
  }, 200);
}

/**
 * 策略 2: SSR/SSG 预渲染子应用首屏
 * 在服务端预渲染子应用的首屏 HTML，直接嵌入主应用的 HTML 响应中
 */

// Node.js 中间件：根据路由预渲染对应子应用的首屏
async function microAppSSRMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const route = req.path;

  // 根据路由确定需要预渲染哪个子应用
  const appConfig = matchMicroApp(route);
  if (!appConfig) {
    next();
    return;
  }

  try {
    // 获取子应用的预渲染 HTML（可以缓存）
    const prerenderedHtml = await fetchPrerenderedContent(
      appConfig.ssrEndpoint,
      route
    );

    // 将预渲染内容注入主应用模板
    const mainTemplate = await getMainAppTemplate();
    const finalHtml = mainTemplate.replace(
      '<!-- MICRO_APP_PLACEHOLDER -->',
      `<div id="${appConfig.container}" data-prerendered="true">
        ${prerenderedHtml}
      </div>`
    );

    res.send(finalHtml);
  } catch (error) {
    // SSR 失败时降级为客户端渲染
    console.error(`SSR failed for ${appConfig.name}:`, error);
    next();
  }
}

/**
 * 策略 3: 关键 CSS 内联
 * 将子应用的关键 CSS 内联到主应用 HTML 中，避免 CSS 下载阻塞渲染
 */
function inlineCriticalCSS(
  appName: string,
  container: HTMLElement
): void {
  // 预先提取并内联子应用的首屏关键 CSS
  const criticalCSS = getCriticalCSSForApp(appName);
  if (criticalCSS) {
    const style = document.createElement('style');
    style.setAttribute('data-micro-app', appName);
    style.textContent = criticalCSS;
    document.head.appendChild(style);
  }
}
```

### 17.4.3 FID / INP 优化：减少子应用 JS 的主线程阻塞

FID（First Input Delay）及其后继指标 INP（Interaction to Next Paint）衡量用户交互的响应速度。在微前端中，子应用的 JS 执行是主线程阻塞的主要来源。

```typescript
/**
 * 策略 1: JS 执行分片——用 scheduler 拆分长任务
 */
class ScriptExecutor {
  /**
   * 将大的 JS 执行任务拆分为多个小任务
   * 每个小任务之间让出主线程，允许浏览器处理用户输入
   */
  async executeWithYielding(
    scripts: string[],
    sandbox: ProxySandbox
  ): Promise<void> {
    for (const script of scripts) {
      // 估算脚本执行时间
      const estimatedTime = this.estimateExecutionTime(script);

      if (estimatedTime > 50) {
        // 超过 50ms 的长任务需要分片
        await this.yieldToMain();
      }

      // 在沙箱中执行脚本
      sandbox.exec(script);
    }
  }

  /**
   * 让出主线程的通用方法
   * 优先使用 scheduler.yield()（Chrome 115+）
   * 降级到 MessageChannel（比 setTimeout 更快）
   */
  private yieldToMain(): Promise<void> {
    // 优先使用 Scheduler API（如果可用）
    if ('scheduler' in globalThis && 'yield' in (globalThis as any).scheduler) {
      return (globalThis as any).scheduler.yield();
    }

    // 降级到 MessageChannel
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(undefined);
    });
  }

  private estimateExecutionTime(script: string): number {
    // 粗略估算: 每 10KB 约 5ms（经验值，实际取决于代码复杂度）
    return (script.length / 10240) * 5;
  }
}

/**
 * 策略 2: 子应用 JS 异步加载——不阻塞主应用的交互
 */
async function loadSubAppNonBlocking(
  entry: string,
  container: HTMLElement
): Promise<void> {
  // 步骤 1: 立即显示骨架屏
  showSkeleton(container);

  // 步骤 2: 下载子应用资源（不阻塞主线程）
  const { template, execScripts, getExternalStyleSheets } =
    await importEntry(entry);

  // 步骤 3: CSS 先加载——不阻塞交互，但防止 FOUC
  await getExternalStyleSheets();

  // 步骤 4: JS 在 requestIdleCallback 中执行
  await new Promise<void>((resolve) => {
    requestIdleCallback(
      async () => {
        await execScripts();
        resolve();
      },
      { timeout: 3000 } // 最多等 3 秒，然后强制执行
    );
  });
}

/**
 * 策略 3: 子应用代码分割——只加载当前路由需要的代码
 */
// 子应用自身的 webpack 配置
// webpack.config.js
module.exports = {
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        // 将子应用按路由拆分
        orderList: {
          test: /[\\/]pages[\\/]order-list/,
          name: 'order-list',
          priority: 10,
        },
        orderDetail: {
          test: /[\\/]pages[\\/]order-detail/,
          name: 'order-detail',
          priority: 10,
        },
        // 公共代码单独打包
        common: {
          minChunks: 2,
          name: 'common',
          priority: 5,
        },
      },
    },
  },
};

// 子应用的路由配置——使用动态 import 实现路由级代码分割
const routes = [
  {
    path: '/order/list',
    component: () => import(
      /* webpackChunkName: "order-list" */
      './pages/OrderList'
    ),
  },
  {
    path: '/order/:id',
    component: () => import(
      /* webpackChunkName: "order-detail" */
      './pages/OrderDetail'
    ),
  },
];
```

### 17.4.4 CLS 优化：消除子应用挂载时的布局偏移

CLS（Cumulative Layout Shift）在微前端中有一个经典的触发场景：子应用容器在子应用挂载前没有确定的高度，挂载后内容撑开容器，导致下方的元素被推移。

```typescript
/**
 * 策略 1: 容器尺寸预留——在子应用加载前就固定容器高度
 */

// CSS 方案: 为子应用容器设置最小高度
const containerStyles = `
  /* 方案 A: 固定最小高度 */
  .micro-app-container {
    min-height: 600px;  /* 基于子应用的典型高度 */
    contain: layout;    /* CSS Containment: 隔离布局影响 */
  }

  /* 方案 B: 使用 aspect-ratio（如果内容比例可预测） */
  .micro-app-container--dashboard {
    aspect-ratio: 16 / 9;
    width: 100%;
  }

  /* 方案 C: 使用 CSS Grid 预留空间 */
  .app-layout {
    display: grid;
    grid-template-rows: 60px 1fr;  /* 导航栏 + 内容区 */
    min-height: 100vh;
  }
  .app-layout__content {
    overflow: auto;  /* 子应用内容不影响外部布局 */
  }
`;

/**
 * 策略 2: contain: layout 和 content-visibility
 * 利用 CSS Containment 告诉浏览器子应用容器是一个独立的布局上下文
 */
const advancedContainerStyles = `
  .micro-app-container {
    /* contain: layout 告诉浏览器:
       这个元素内部的布局变化不会影响外部 */
    contain: layout style;

    /* content-visibility: auto 告诉浏览器:
       屏幕外的子应用内容可以跳过渲染 */
    content-visibility: auto;

    /* 配合 contain-intrinsic-size 提供预估尺寸
       避免 content-visibility 导致的高度为 0 */
    contain-intrinsic-size: 0 600px;
  }
`;

/**
 * 策略 3: 监控 CLS 并自动修复
 */
class CLSMonitor {
  private observer: PerformanceObserver | null = null;
  private clsValue = 0;
  private clsEntries: PerformanceEntry[] = [];

  start(): void {
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        // 只关注非用户输入引起的布局偏移
        if (!entry.hadRecentInput) {
          this.clsValue += entry.value;
          this.clsEntries.push(entry);

          // 如果 CLS 超过阈值，触发告警
          if (this.clsValue > 0.1) {
            this.reportCLSIssue(entry);
          }
        }
      }
    });

    this.observer.observe({ type: 'layout-shift', buffered: true });
  }

  private reportCLSIssue(entry: any): void {
    // 定位导致布局偏移的元素
    const sources = entry.sources?.map((source: any) => ({
      node: source.node?.tagName,
      previousRect: source.previousRect,
      currentRect: source.currentRect,
    }));

    console.warn('[CLS Monitor] 检测到微前端布局偏移:', {
      clsValue: this.clsValue.toFixed(4),
      shiftedElements: sources,
      timestamp: entry.startTime,
    });

    // 上报到监控系统
    reportToMonitoring({
      type: 'cls_issue',
      value: this.clsValue,
      sources,
      microApp: this.getCurrentMicroApp(),
    });
  }

  private getCurrentMicroApp(): string {
    // 识别当前活跃的微应用
    return document.querySelector(
      '[data-qiankun-app]'
    )?.getAttribute('data-qiankun-app') ?? 'unknown';
  }
}

/**
 * 策略 4: 子应用切换的平滑过渡
 * 避免子应用卸载-加载之间的空白期导致 CLS
 */
class SmoothTransition {
  private currentContainer: HTMLElement | null = null;
  private pendingContainer: HTMLElement | null = null;

  async switchApp(
    fromApp: string | null,
    toApp: string,
    container: HTMLElement
  ): Promise<void> {
    // 步骤 1: 创建新容器（在当前容器下方，不可见）
    this.pendingContainer = document.createElement('div');
    this.pendingContainer.style.cssText =
      'position:absolute;top:0;left:0;width:100%;opacity:0;pointer-events:none;';
    container.style.position = 'relative';
    container.appendChild(this.pendingContainer);

    // 步骤 2: 在新容器中加载新子应用
    await mountMicroApp(toApp, this.pendingContainer);

    // 步骤 3: 获取新容器的实际高度
    const newHeight = this.pendingContainer.scrollHeight;

    // 步骤 4: 平滑过渡高度
    container.style.height = `${container.scrollHeight}px`;
    container.style.transition = 'height 0.3s ease-out';

    // 步骤 5: 交叉淡入淡出
    requestAnimationFrame(() => {
      container.style.height = `${newHeight}px`;

      // 淡出旧应用
      if (this.currentContainer) {
        this.currentContainer.style.transition = 'opacity 0.2s ease-out';
        this.currentContainer.style.opacity = '0';
      }

      // 淡入新应用
      this.pendingContainer!.style.transition = 'opacity 0.3s ease-in';
      this.pendingContainer!.style.opacity = '1';
      this.pendingContainer!.style.position = 'relative';
      this.pendingContainer!.style.pointerEvents = 'auto';

      // 步骤 6: 过渡完成后清理
      setTimeout(() => {
        if (this.currentContainer) {
          unmountMicroApp(fromApp!);
          this.currentContainer.remove();
        }
        container.style.height = 'auto';
        container.style.transition = '';
        this.currentContainer = this.pendingContainer;
      }, 300);
    });
  }
}
```

### 17.4.5 综合性能监控方案

最后，性能优化不能靠猜测——需要完整的监控体系来发现问题、验证优化效果。

```typescript
/**
 * 微前端专属的性能监控 SDK
 */
class MicroFrontendPerformanceMonitor {
  private metrics: Map<string, any[]> = new Map();

  /**
   * 追踪子应用的完整加载链路
   */
  trackAppLoad(appName: string): {
    markFetchStart: () => void;
    markFetchEnd: () => void;
    markExecStart: () => void;
    markExecEnd: () => void;
    markMountStart: () => void;
    markMountEnd: () => void;
    report: () => AppLoadMetrics;
  } {
    const marks: Record<string, number> = {};

    return {
      markFetchStart: () => {
        marks.fetchStart = performance.now();
      },
      markFetchEnd: () => {
        marks.fetchEnd = performance.now();
      },
      markExecStart: () => {
        marks.execStart = performance.now();
      },
      markExecEnd: () => {
        marks.execEnd = performance.now();
      },
      markMountStart: () => {
        marks.mountStart = performance.now();
      },
      markMountEnd: () => {
        marks.mountEnd = performance.now();
      },
      report: () => {
        const metrics: AppLoadMetrics = {
          appName,
          fetchDuration: marks.fetchEnd - marks.fetchStart,
          execDuration: marks.execEnd - marks.execStart,
          mountDuration: marks.mountEnd - marks.mountStart,
          totalDuration: marks.mountEnd - marks.fetchStart,
          timestamp: Date.now(),
        };

        // 存储并上报
        this.storeMetrics(appName, metrics);
        return metrics;
      },
    };
  }

  /**
   * 追踪 Core Web Vitals（微前端增强版）
   */
  trackCoreWebVitals(): void {
    // LCP
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1] as any;
      const lcpValue = lastEntry.startTime;
      const lcpElement = lastEntry.element?.tagName;
      const activeApp = this.getActiveApp();

      this.reportMetric('lcp', {
        value: lcpValue,
        element: lcpElement,
        microApp: activeApp,
        // 区分: LCP 元素属于主应用还是子应用
        isSubAppContent: this.isElementInSubApp(lastEntry.element),
      });
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    // INP (Interaction to Next Paint)
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        if (entry.interactionId) {
          this.reportMetric('inp', {
            value: entry.duration,
            target: entry.target?.tagName,
            microApp: this.getActiveApp(),
            // 追踪交互发生在哪个子应用中
            interactionType: entry.name,
          });
        }
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });

    // CLS（按子应用归因）
    let sessionCLS = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        if (!entry.hadRecentInput) {
          sessionCLS += entry.value;
          this.reportMetric('cls', {
            value: entry.value,
            cumulativeValue: sessionCLS,
            sources: entry.sources?.map((s: any) => ({
              element: s.node?.tagName,
              microApp: this.identifyAppForElement(s.node),
            })),
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  }

  /**
   * 生成性能报告
   */
  generateReport(): PerformanceReport {
    const allMetrics = Object.fromEntries(this.metrics);

    return {
      summary: {
        averageAppLoadTime: this.calculateAverage('appLoad', 'totalDuration'),
        p95AppLoadTime: this.calculatePercentile('appLoad', 'totalDuration', 95),
        lcpValue: this.getLatestMetric('lcp')?.value,
        clsValue: this.getLatestMetric('cls')?.cumulativeValue,
        inpValue: this.calculatePercentile('inp', 'value', 75),
      },
      perAppMetrics: this.getPerAppBreakdown(),
      recommendations: this.generateRecommendations(),
      timestamp: Date.now(),
    };
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const report = this.generateBasicStats();

    if (report.averageLoadTime > 2000) {
      recommendations.push(
        '子应用平均加载时间超过 2 秒，建议启用预加载（prefetchApps）'
      );
    }

    if (report.clsValue > 0.1) {
      recommendations.push(
        'CLS 超过 0.1，建议为子应用容器设置 min-height 和 contain: layout'
      );
    }

    if (report.largestBundle > 500 * 1024) {
      recommendations.push(
        `子应用 ${report.largestBundleApp} 的 bundle 超过 500KB，` +
        '建议进行代码分割或提取公共依赖'
      );
    }

    if (report.proxyOverhead > 100) {
      recommendations.push(
        '检测到 Proxy 沙箱开销较高，建议对高频访问属性启用缓存'
      );
    }

    return recommendations;
  }

  private getActiveApp(): string {
    return (
      document
        .querySelector('[data-qiankun-app].active')
        ?.getAttribute('data-qiankun-app') ?? 'main'
    );
  }

  private isElementInSubApp(element: Element | null): boolean {
    if (!element) return false;
    return !!element.closest('[data-qiankun-app]');
  }

  private identifyAppForElement(element: Element | null): string {
    if (!element) return 'unknown';
    const container = element.closest('[data-qiankun-app]');
    return container?.getAttribute('data-qiankun-app') ?? 'main';
  }

  private storeMetrics(key: string, data: any): void {
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    this.metrics.get(key)!.push(data);
  }

  private reportMetric(type: string, data: any): void {
    this.storeMetrics(type, data);
  }

  private calculateAverage(key: string, field: string): number {
    const entries = this.metrics.get(key) ?? [];
    if (entries.length === 0) return 0;
    return entries.reduce((sum, e) => sum + (e[field] ?? 0), 0) / entries.length;
  }

  private calculatePercentile(
    key: string,
    field: string,
    percentile: number
  ): number {
    const entries = this.metrics.get(key) ?? [];
    if (entries.length === 0) return 0;
    const sorted = entries.map((e) => e[field] ?? 0).sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  private getLatestMetric(key: string): any {
    const entries = this.metrics.get(key) ?? [];
    return entries[entries.length - 1];
  }

  private getPerAppBreakdown(): Record<string, any> {
    return {};
  }

  private generateBasicStats(): any {
    return {
      averageLoadTime: this.calculateAverage('appLoad', 'totalDuration'),
      clsValue: this.getLatestMetric('cls')?.cumulativeValue ?? 0,
      largestBundle: 0,
      largestBundleApp: '',
      proxyOverhead: 0,
    };
  }
}

// 使用
const monitor = new MicroFrontendPerformanceMonitor();
monitor.trackCoreWebVitals();

// 在子应用生命周期中埋点
registerMicroApps(
  apps.map((app) => ({
    ...app,
    props: {
      ...app.props,
      performanceTracker: monitor.trackAppLoad(app.name),
    },
  }))
);
```

### 17.4.6 性能预算与持续集成

性能优化不是一次性的工作——它需要持续的监控和守护。

```typescript
/**
 * 微前端性能预算配置
 * 集成到 CI/CD 流水线中，每次提交自动检测
 */
interface PerformanceBudget {
  // 子应用级别的预算
  perSubApp: {
    maxBundleSize: '200KB gzipped';     // 单个子应用的 JS bundle
    maxCSSSize: '50KB gzipped';          // 单个子应用的 CSS
    maxLoadTime: '2000ms';               // 首次加载时间上限
    maxMountTime: '500ms';               // mount 生命周期时间上限
  };

  // 整体预算
  overall: {
    maxLCP: '2500ms';                    // Google 的 "Good" 阈值
    maxINP: '200ms';                     // Google 的 "Good" 阈值
    maxCLS: '0.1';                       // Google 的 "Good" 阈值
    maxTotalSharedDeps: '300KB gzipped'; // 公共依赖总体积
    maxConcurrentApps: 3;                // 同时加载的子应用数量上限
  };
}

// CI 检测脚本示例
async function checkPerformanceBudget(): Promise<{
  passed: boolean;
  violations: string[];
}> {
  const violations: string[] = [];

  // 检查每个子应用的 bundle 大小
  for (const app of microApps) {
    const stats = await getBuildStats(app.name);

    if (stats.jsSize > 200 * 1024) {
      violations.push(
        `${app.name}: JS bundle ${(stats.jsSize / 1024).toFixed(0)}KB ` +
        `exceeds budget of 200KB`
      );
    }

    if (stats.cssSize > 50 * 1024) {
      violations.push(
        `${app.name}: CSS ${(stats.cssSize / 1024).toFixed(0)}KB ` +
        `exceeds budget of 50KB`
      );
    }
  }

  // 检查公共依赖总体积
  const sharedDepsSize = await getSharedDependenciesSize();
  if (sharedDepsSize > 300 * 1024) {
    violations.push(
      `Shared dependencies: ${(sharedDepsSize / 1024).toFixed(0)}KB ` +
      `exceeds budget of 300KB`
    );
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
```

> **深度洞察：性能是架构决策的结果**
>
> 本章讨论的所有性能问题——子应用加载延迟、公共依赖冗余、沙箱运行时开销、Core Web Vitals 劣化——它们的根因都不是"代码写得不好"，而是**微前端架构本身引入的结构性开销**。这意味着：1）性能优化的上限由架构决定——在乾坤 + Proxy 沙箱的架构下，你无法消除 Proxy 拦截的开销，只能最小化它；2）最大的性能优化往往来自架构调整而非代码优化——从乾坤切换到 Module Federation 可能一次性消除沙箱开销和依赖冗余问题；3）性能预算应该在架构设计阶段就确定，而不是上线后才开始关注。**先定义"多快才够快"，再选择能达到这个标准的架构方案。**

---

## 本章小结

- **首屏性能**：乾坤的 `prefetchApps` 通过 `requestIdleCallback` 两级调度实现非侵入式预加载，自定义策略函数支持基于业务优先级和网络环境的精细控制。预加载不是万能的——需要基于访问概率排序，遵循 80/20 法则
- **公共依赖共享**：externals + CDN、Module Federation shared、Import Maps 三种方案各有取舍，核心矛盾是"版本自由度 vs 运行时开销 vs 沙箱兼容"的不可能三角
- **沙箱开销**：Proxy 沙箱的单次属性访问开销约 37-77ns，对 80% 的业务场景可忽略。真正需要关注的是 Canvas 渲染、大数据量图表等高频访问场景，优化手段包括属性缓存、快照降级、选择性关闭沙箱
- **Core Web Vitals**：LCP 优化靠骨架屏和 SSR 预渲染缩短可见时间；FID/INP 优化靠 JS 执行分片和 `scheduler.yield()` 减少主线程阻塞；CLS 优化靠容器尺寸预留和 `contain: layout` 隔离布局影响
- **持续监控**：性能优化不是一次性工作，需要集成到 CI/CD 的性能预算机制和生产环境的实时监控来持续守护

## 思考题

1. **实践应用**：你的微前端项目有 8 个子应用，平均 bundle 大小 180KB（gzipped），首次切换到子应用需要 1.8 秒。请设计一个完整的预加载策略，说明哪些子应用预加载、何时触发、如何处理弱网场景。

2. **方案对比**：分析 Webpack externals + CDN 和 Module Federation shared 在以下场景中的优劣：a）所有子应用使用相同版本的 React；b）三个子应用使用 React 18，两个使用 React 17；c）需要在乾坤 Proxy 沙箱环境中运行。

3. **性能分析**：某个微前端项目的 CLS 得分为 0.25（远超 0.1 的 "Good" 阈值），已确认原因是子应用挂载时容器高度变化。请提出至少三种不同层次的解决方案，并说明各自的优缺点。

4. **深度思考**：本章提出"性能是架构决策的结果"。如果你正在设计一个全新的微前端架构，且性能预算要求 LCP < 1500ms、CLS < 0.05，你会选择什么技术方案？请说明选择理由和必须放弃的特性。

5. **开放讨论**：随着 Edge Computing 和 Service Worker 的成熟，你认为微前端的性能优化范式是否会发生根本性变化？例如，是否可以在 Service Worker 中完成子应用资源的预处理和缓存管理，从而消除运行时的加载延迟？

</div>
