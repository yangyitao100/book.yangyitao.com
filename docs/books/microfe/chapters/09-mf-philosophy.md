<div v-pre>

# 第9章 Module Federation 设计哲学

> "微前端的终局不是更好的沙箱，而是让沙箱变得不再必要。"

> **本章要点**
> - 理解从"独立构建独立部署"到"运行时共享模块"的范式跃迁
> - 掌握 Module Federation 四大核心概念：Host、Remote、Shared、Exposes
> - 深入 remoteEntry.js 的加载机制与模块注册流程
> - 理解 Shared 依赖的版本协商算法：singleton、requiredVersion、eager 的设计权衡
> - 对比 Module Federation 1.0 与 2.0 的架构跃迁
> - 厘清 Module Federation 与运行时加载方案（乾坤/single-spa）的本质区别

---

2020 年 10 月，Webpack 5 正式发布。在长达两年的开发周期中，Webpack 团队悄然引入了一个不起眼的新特性——`ModuleFederationPlugin`。发布说明中只有寥寥数行描述。没有铺天盖地的营销，没有"改变前端未来"的宣言。

但那行不起眼的代码，掀起了一场静默的革命。

在 Module Federation 之前，前端模块的共享边界是**构建产物**。无论你的代码拆得多细，最终都要打包成一个或多个 bundle，以完整的构建产物为单位进行部署和加载。乾坤加载的是一个完整的子应用 HTML，single-spa 加载的是一个完整的子应用入口 JS——粒度再小也是"应用"级别。

Module Federation 打破了这个边界。它让不同的构建产物之间可以在运行时共享**任意粒度**的模块——一个组件、一个函数、一个配置对象。就像 Node.js 的 `require` 可以引用任何本地模块一样，Module Federation 让你的浏览器端代码可以"require"另一个独立构建、独立部署的应用中的任何导出模块。

这不是渐进式改良。这是范式转换。

要理解这场转换的深意，我们需要从头开始——从微前端最基本的架构假设说起。

## 9.1 从"独立构建独立部署"到"运行时共享模块"

### 9.1.1 传统微前端的架构假设

乾坤和 single-spa 共享一个基本假设：**每个子应用是一个独立的、完整的前端应用。** 它有自己的 `package.json`，自己的构建流程，自己的入口文件，自己的路由系统。主应用通过某种机制（HTML Entry 或 JS Entry）在运行时加载这个完整的应用，然后将其挂载到页面上的某个 DOM 容器中。

```typescript
// 乾坤的架构模型：以"应用"为加载单元
interface QiankunApp {
  name: string;
  entry: string;          // 子应用的完整入口 URL
  container: string;      // 挂载的 DOM 节点
  activeRule: string;     // 路由匹配规则
}

// 注册子应用
registerMicroApps([
  {
    name: 'order-app',
    entry: 'https://order.example.com',  // 加载一个完整的应用
    container: '#subapp-container',
    activeRule: '/order',
  },
  {
    name: 'product-app',
    entry: 'https://product.example.com', // 又一个完整的应用
    container: '#subapp-container',
    activeRule: '/product',
  },
]);
```

这个架构模型有三个隐含前提：

1. **加载粒度 = 应用**：你无法只加载订单应用中的 `OrderList` 组件，必须加载整个订单应用
2. **依赖各自独立**：每个子应用自带全部依赖，React 可能被加载多次
3. **隔离是必需的**：因为多个完整应用共享同一个页面，必须通过沙箱防止相互污染

```typescript
// 传统微前端的依赖加载示意
// 主应用
import React from 'react';        // React 实例 #1 (18.2.0)
import ReactDOM from 'react-dom';

// 订单子应用（独立构建）
import React from 'react';        // React 实例 #2 (18.2.0) —— 重复！
import ReactDOM from 'react-dom';

// 商品子应用（独立构建）
import React from 'react';        // React 实例 #3 (18.3.0) —— 又一份！
import ReactDOM from 'react-dom';

// 三份 React，三份 ReactDOM
// gzipped 后约 42KB × 3 = 126KB 的冗余
```

乾坤试图通过 `externals` 和全局变量约定来缓解这个问题——让所有子应用使用主应用加载的 React。但这种方案本质上是一种**运行时约定**：没有编译器参与、没有版本检查、没有类型安全。一旦某个子应用忘记配置 `externals`，或者需要一个不同版本的 React，整个约定就会崩溃。

### 9.1.2 Module Federation 的范式转换

Module Federation 的核心洞见可以用一句话概括：**模块共享不应该是运行时的约定，而应该是编译时的契约。**

```javascript
// webpack.config.js - 订单应用
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  output: {
    publicPath: 'https://order.example.com/',
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'orderApp',
      filename: 'remoteEntry.js',
      // 暴露模块：声明哪些模块可以被其他应用引用
      exposes: {
        './OrderList': './src/components/OrderList',
        './OrderDetail': './src/components/OrderDetail',
        './useOrder': './src/hooks/useOrder',
      },
      // 共享依赖：声明哪些依赖应该在运行时共享
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
        'react-router-dom': { requiredVersion: '^6.0.0' },
      },
    }),
  ],
};
```

```javascript
// webpack.config.js - 商品应用（消费方）
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  output: {
    publicPath: 'https://product.example.com/',
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'productApp',
      filename: 'remoteEntry.js',
      // 远程模块：声明要从哪里引用模块
      remotes: {
        orderApp: 'orderApp@https://order.example.com/remoteEntry.js',
      },
      exposes: {
        './ProductCard': './src/components/ProductCard',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
      },
    }),
  ],
};
```

现在，在商品应用的任何代码中，你可以这样写：

```typescript
// 商品应用的某个页面
import OrderList from 'orderApp/OrderList';
import { useOrder } from 'orderApp/useOrder';

const ProductPage: React.FC = () => {
  const { orders } = useOrder();

  return (
    <div>
      <h1>商品详情</h1>
      {/* 直接使用订单应用暴露的组件 */}
      <OrderList orders={orders} />
    </div>
  );
};
```

注意这段代码——`import OrderList from 'orderApp/OrderList'`。在编译时，Webpack 知道 `orderApp` 是一个远程模块，它不会试图从本地 `node_modules` 中解析这个路径，而是生成一段**运行时加载逻辑**，在浏览器中动态获取订单应用暴露的 `OrderList` 模块。

**这里发生了三个根本性的变化**：

1. **加载粒度从"应用"变为"模块"**：你只加载需要的 `OrderList` 组件，不需要加载整个订单应用
2. **依赖从"各自独立"变为"协商共享"**：React 只加载一份，版本由运行时协商决定
3. **隔离从"必需"变为"不需要"**：模块之间不存在全局变量污染的问题，因为它们通过正式的模块接口交互

### 9.1.3 一个类比：从集装箱运输到管道网络

传统微前端像**集装箱运输**——每个子应用是一个密封的集装箱，里面装满了它需要的所有东西（包括重复的公共依赖）。主应用是港口，负责接收和卸载集装箱。为了防止集装箱之间的货物相互污染，你需要一套复杂的仓储隔离系统（沙箱）。

Module Federation 像**管道网络**——每个应用是一个节点，它们通过管道（模块接口）连接。任何节点可以向网络中输出特定的产品（exposes），也可以从网络中获取需要的产品（remotes）。公共的基础设施（shared dependencies）只在网络中存在一份，所有节点共用。不需要隔离，因为管道本身就是清晰的边界。

```typescript
// 架构模型对比
interface TraditionalMicroFE {
  unit: 'application';         // 加载单位：应用
  sharing: 'convention';       // 共享方式：约定（externals）
  isolation: 'required';       // 隔离：必需（沙箱）
  communication: 'event-bus';  // 通信：事件总线
  overhead: 'high';            // 额外开销：高
}

interface ModuleFederation {
  unit: 'module';              // 加载单位：模块
  sharing: 'negotiated';       // 共享方式：协商（版本对齐）
  isolation: 'unnecessary';    // 隔离：不需要
  communication: 'import';     // 通信：标准 import/export
  overhead: 'minimal';         // 额外开销：极低
}
```

> **深度洞察：为什么"不需要沙箱"是一个巨大的进步**
>
> 沙箱不是免费的。乾坤的 `ProxySandbox` 在每次全局变量访问时都要经过 Proxy 拦截，这在高频调用场景下会产生可测量的性能开销。更重要的是，沙箱的存在本身就说明了一个问题：**你的模块边界不清晰。** 如果两个模块需要一堵墙来防止相互污染，说明它们的交互方式出了问题——依赖全局变量、修改全局 CSS、覆盖原型链方法。Module Federation 的模块通过标准的 `import/export` 交互，就像你在同一个项目中引用不同文件一样自然。这不是"隔离得更好"，而是"从根本上消除了需要隔离的场景"。

## 9.2 核心概念：Host、Remote、Shared、Exposes

### 9.2.1 四个核心角色

Module Federation 的架构围绕四个核心概念展开。要理解它们，最好的方式是跟踪一个模块从被暴露到被消费的完整生命周期。

- **Host（宿主）**：主动发起模块请求的一方，通过 `remotes` 字段声明依赖的远程应用，运行时加载 `remoteEntry.js` 并获取模块
- **Remote（远程）**：提供模块的一方，通过 `exposes` 字段声明可用的模块，构建时生成 `remoteEntry.js` 作为模块注册清单
- **Shared（共享依赖）**：避免依赖重复加载的协商机制，通过 `shared` 字段声明哪些依赖参与共享，运行时根据版本规则决定使用哪个版本
- **Exposes（暴露模块）**：定义 Remote 的公共 API，可以是组件、函数、常量、类型——任何 JS 模块

一个应用可以**同时**扮演 Host 和 Remote 两个角色——它既消费别人的模块，也暴露自己的模块。这种双向关系形成了一个去中心化的**模块联邦网络**。

```javascript
// 应用 A：既是 Host（消费 B 的模块），也是 Remote（暴露模块给 C）
// webpack.config.js
new ModuleFederationPlugin({
  name: 'appA',
  filename: 'remoteEntry.js',
  remotes: {
    appB: 'appB@https://b.example.com/remoteEntry.js',
  },
  exposes: {
    './SharedLayout': './src/components/SharedLayout',
    './AuthContext': './src/contexts/AuthContext',
  },
  shared: {
    react: { singleton: true },
    'react-dom': { singleton: true },
  },
});
```

```javascript
// 应用 B：Remote，暴露模块
new ModuleFederationPlugin({
  name: 'appB',
  filename: 'remoteEntry.js',
  exposes: {
    './DataGrid': './src/components/DataGrid',
    './useDataFetch': './src/hooks/useDataFetch',
  },
  shared: {
    react: { singleton: true },
    'react-dom': { singleton: true },
  },
});
```

```javascript
// 应用 C：Host，消费 A 暴露的模块
new ModuleFederationPlugin({
  name: 'appC',
  filename: 'remoteEntry.js',
  remotes: {
    appA: 'appA@https://a.example.com/remoteEntry.js',
  },
  shared: {
    react: { singleton: true },
    'react-dom': { singleton: true },
  },
});
```

### 9.2.2 remoteEntry.js：模块联邦的入口契约

`remoteEntry.js` 是 Module Federation 架构中最关键的产物。它不包含任何业务逻辑——它是一个**模块注册清单**，告诉消费方"我有哪些模块可用，以及如何加载它们"。

当 Webpack 构建一个配置了 `exposes` 的应用时，会生成这个文件。让我们深入分析它的结构：

```javascript
// remoteEntry.js 的简化结构（真实产物经过 Webpack 编译，这里展示核心逻辑）
var orderApp;

// 全局注册：将自己注册到全局作用域
(function () {
  // moduleMap：暴露模块的映射表
  var moduleMap = {
    './OrderList': function () {
      // 返回一个 Promise，懒加载对应的 chunk
      return import('./src_components_OrderList_tsx.js');
    },
    './OrderDetail': function () {
      return import('./src_components_OrderDetail_tsx.js');
    },
    './useOrder': function () {
      return import('./src_hooks_useOrder_ts.js');
    },
  };

  // get 方法：Host 通过这个方法获取指定模块
  var get = function (module) {
    return moduleMap[module]
      ? moduleMap[module]()
      : Promise.reject(new Error('Module "' + module + '" does not exist'));
  };

  // init 方法：初始化共享作用域
  var init = function (shareScope) {
    // 将 Host 的共享依赖注册到 Remote 的共享作用域
    // 这是版本协商的关键步骤
    initSharedScope(shareScope);
  };

  // 注册到全局
  orderApp = {
    get: get,
    init: init,
  };
})();
```

关键在于两个方法：

- **`init(shareScope)`**：接收 Host 传入的共享作用域（包含所有 shared 依赖的版本信息和工厂函数），完成依赖版本的协商
- **`get(moduleName)`**：根据模块名返回一个 Promise，resolve 为模块的实际内容

### 9.2.3 模块加载的完整流程

让我们追踪一个完整的模块加载过程——当商品应用（Host）引用订单应用（Remote）的 `OrderList` 组件时，发生了什么：

```typescript
// 第 1 步：Host 的 Webpack 运行时加载 remoteEntry.js
// 当代码中出现 import('orderApp/OrderList') 时
// Webpack 运行时首先检查：orderApp 的 remoteEntry.js 是否已加载？

async function loadRemoteEntry(remoteName: string, url: string): Promise<void> {
  // 创建 <script> 标签加载 remoteEntry.js
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url; // https://order.example.com/remoteEntry.js
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// 第 2 步：初始化共享作用域
async function initRemote(remoteName: string): Promise<void> {
  const container = window[remoteName]; // 获取全局注册的 Remote 容器

  // 确保共享作用域已初始化
  if (!__webpack_share_scopes__['default']) {
    __webpack_init_sharing__('default');
  }

  // 将 Host 的共享作用域传递给 Remote
  // 这一步完成版本协商
  await container.init(__webpack_share_scopes__['default']);
}

// 第 3 步：获取具体模块
async function loadRemoteModule(remoteName: string, moduleName: string): Promise<any> {
  const container = window[remoteName];

  // 调用 Remote 的 get 方法，获取模块工厂函数
  const factory = await container.get(moduleName);

  // 执行工厂函数，获取模块导出
  const module = factory();

  return module;
}

// 完整流程
async function resolveRemoteModule(): Promise<React.ComponentType> {
  // 1. 加载 remoteEntry.js（如果尚未加载）
  await loadRemoteEntry('orderApp', 'https://order.example.com/remoteEntry.js');

  // 2. 初始化共享作用域（版本协商）
  await initRemote('orderApp');

  // 3. 获取模块
  const module = await loadRemoteModule('orderApp', './OrderList');

  return module.default; // React 组件
}
```

整个过程可以归纳为六步：1）Host 通过 `<script>` 加载 `remoteEntry.js`；2）调用 `container.init()` 传递共享作用域；3）调用 `container.get('./OrderList')` 请求模块；4）Remote 返回模块工厂函数；5）工厂函数触发动态 `import()` 加载对应的 chunk 文件；6）返回模块导出（React 组件）。

### 9.2.4 Shared 依赖的版本协商机制

Shared 依赖的版本协商是 Module Federation 中最精妙的设计之一。它解决了一个看似简单但实际极其棘手的问题：**当 Host 和 Remote 依赖了同一个库的不同版本，应该使用哪一个？**

三个关键配置项控制着这个行为：

```javascript
// webpack.config.js
new ModuleFederationPlugin({
  shared: {
    react: {
      // singleton: 整个页面只允许存在一个实例
      // React 必须是 singleton，因为多个 React 实例会导致 Hooks 失效
      singleton: true,

      // requiredVersion: 声明这个应用需要的版本范围
      // 遵循 semver 规范
      requiredVersion: '^18.2.0',

      // eager: 是否在初始 bundle 中包含这个依赖
      // false（默认）：异步加载，减小初始 bundle 体积
      // true：同步包含，避免异步加载的时序问题
      eager: false,

      // strictVersion: 版本不兼容时是否抛出错误
      // false（默认）：打印警告
      // true：抛出运行时错误
      strictVersion: false,
    },

    // 简写形式：只指定包名，所有配置使用默认值
    lodash: {},

    // 带版本的简写
    axios: { requiredVersion: '^1.6.0' },
  },
});
```

版本协商的具体过程如下：

```typescript
// 版本协商算法的简化实现
interface SharedModuleInfo {
  version: string;                    // 实际版本
  factory: () => Promise<Module>;     // 模块工厂函数
  eager: boolean;                     // 是否同步加载
  singleton: boolean;                 // 是否单例
  requiredVersion: string;            // 要求的版本范围
  strictVersion: boolean;             // 是否严格版本检查
}

// 共享作用域：存储所有应用注册的共享依赖信息
type ShareScope = Record<string, Record<string, SharedModuleInfo>>;

function resolveSharedModule(
  shareScope: ShareScope,
  packageName: string,
  requiredVersion: string,
  singleton: boolean,
  strictVersion: boolean
): SharedModuleInfo {
  const versions = shareScope[packageName];
  // versions 是一个以版本号为 key 的映射
  // 例如：{ '18.2.0': {...}, '18.3.1': {...} }

  if (singleton) {
    // 单例模式：选择已注册的最高版本
    const highestVersion = findHighestVersion(versions);
    const selected = versions[highestVersion];

    // 检查版本兼容性
    if (!satisfies(highestVersion, requiredVersion)) {
      if (strictVersion) {
        throw new Error(
          `Unsatisfied version ${highestVersion} of shared ` +
          `singleton module ${packageName} ` +
          `(required ${requiredVersion})`
        );
      } else {
        console.warn(
          `Unsatisfied version ${highestVersion} from ${packageName}. ` +
          `Required: ${requiredVersion}`
        );
      }
    }

    return selected;
  }

  // 非单例模式：选择满足版本要求的最高版本
  const compatibleVersions = Object.keys(versions)
    .filter(v => satisfies(v, requiredVersion))
    .sort(compareVersions);

  if (compatibleVersions.length > 0) {
    return versions[compatibleVersions[compatibleVersions.length - 1]];
  }

  // 没有兼容版本，使用本地 fallback
  return localFallback(packageName);
}
```

用一个具体场景来说明：

```typescript
// 场景：三个应用共享 React
// App A: react@18.2.0, singleton: true, requiredVersion: '^18.0.0'
// App B: react@18.3.1, singleton: true, requiredVersion: '^18.2.0'
// App C: react@17.0.2, singleton: true, requiredVersion: '^17.0.0'

// 协商结果：
// 1. singleton = true → 只允许一个 React 实例
// 2. 可用版本：18.2.0, 18.3.1, 17.0.2
// 3. 选择最高版本：18.3.1
// 4. 兼容性检查：
//    - App A (^18.0.0) ← 18.3.1 ✓ 满足
//    - App B (^18.2.0) ← 18.3.1 ✓ 满足
//    - App C (^17.0.0) ← 18.3.1 ✗ 不满足！
//       → strictVersion = false → 打印警告
//       → strictVersion = true  → 抛出错误

// ⚠️ 这就是为什么在 Module Federation 中
// 所有应用的主要依赖版本必须大致对齐
```

### 9.2.5 eager 的设计权衡

`eager` 看似是一个简单的布尔配置，但它背后反映了 Module Federation 设计中一个深层的张力：**初始加载性能 vs 运行时确定性**。

```javascript
// eager: false（默认）
// 共享模块在运行时异步加载
shared: {
  react: {
    singleton: true,
    eager: false, // React 不包含在初始 bundle 中
  },
}
// 好处：初始 bundle 更小
// 风险：如果应用入口处同步使用了 React，会报错
//       因为 React 还没被加载

// eager: true
// 共享模块包含在初始 bundle 中
shared: {
  react: {
    singleton: true,
    eager: true, // React 包含在初始 bundle 中
  },
}
// 好处：无异步加载时序问题
// 代价：如果 Host 已经加载了 React，这份 eager 的 React 就浪费了
```

在实践中，通常只有**入口应用**（最先加载的 Host）需要设置 `eager: true`，其他 Remote 应用设置 `eager: false` 以复用 Host 提供的共享模块。

```javascript
// 推荐的配置模式
// Host 应用（最先加载）
new ModuleFederationPlugin({
  name: 'shell',
  shared: {
    react: { singleton: true, eager: true, requiredVersion: '^18.0.0' },
    'react-dom': { singleton: true, eager: true, requiredVersion: '^18.0.0' },
  },
});

// Remote 应用
new ModuleFederationPlugin({
  name: 'orderApp',
  shared: {
    react: { singleton: true, eager: false, requiredVersion: '^18.0.0' },
    'react-dom': { singleton: true, eager: false, requiredVersion: '^18.0.0' },
  },
});
```

但这里有一个常见的陷阱——入口应用必须使用**异步引导**模式：

```typescript
// ❌ 错误：同步入口，shared 模块还没初始化
// index.ts
import React from 'react';           // 此时 shared scope 未就绪
import ReactDOM from 'react-dom';
import App from './App';

ReactDOM.render(<App />, document.getElementById('root'));

// ✅ 正确：异步引导
// index.ts（bootstrap 入口）
import('./bootstrap');

// bootstrap.ts（真正的入口）
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);

// 为什么？因为那个 import('./bootstrap') 创建了一个异步边界
// Webpack 运行时利用这个边界来完成 shared scope 的初始化
// 所有 shared 模块的加载和版本协商都在这个异步间隙中完成
```

> **深度洞察：异步边界是 Module Federation 的"隐性契约"**
>
> 很多开发者在初次使用 Module Federation 时都会踩到同步入口的坑。这不是一个 bug，而是一个有意为之的设计决策。异步边界给了 Webpack 运行时一个"喘息"的机会——在业务代码执行之前，完成所有远程模块的发现、共享依赖的协商、模块工厂的注册。这和浏览器的 `DOMContentLoaded` 类似——你需要一个事件来标记"准备就绪"。Module Federation 用 `import()` 的 Promise 来实现了同样的效果。理解这一点，你就理解了 Module Federation 为什么要求入口是异步的——不是技术限制，是架构必然。

## 9.3 Module Federation 1.0 → 2.0 的架构跃迁

### 9.3.1 MF 1.0 的三个硬伤

Module Federation 1.0（Webpack 5 内置版本）虽然开创了模块共享的范式，但在生产环境中暴露出了三个显著的局限性：

**硬伤一：构建工具绑定**

MF 1.0 是 Webpack 5 的内置特性。这意味着如果你的项目使用 Vite、Rspack 或任何其他构建工具，你无法使用 Module Federation。在 2024-2025 年 Vite 快速崛起的背景下，这成了一个越来越大的限制。

```typescript
// MF 1.0 的架构约束
interface MF1Limitation {
  buildTool: 'Webpack 5 only';  // 构建工具绑定
  runtime: 'Webpack runtime';   // 运行时与 Webpack 耦合
  protocol: 'implicit';         // 没有显式的模块协议
}

// 如果团队 A 用 Webpack，团队 B 用 Vite
// 在 MF 1.0 下，它们无法建立联邦关系
// 这与 Module Federation "让不同团队独立选择技术栈"的愿景相矛盾
```

**硬伤二：类型安全缺失**

当你写 `import OrderList from 'orderApp/OrderList'` 时，TypeScript 完全不知道这个模块的类型。你需要手动编写类型声明文件，而且每次 Remote 的接口变更，Host 的类型声明都需要同步更新。

```typescript
// MF 1.0 下的类型声明：手动维护，容易过时
// types/orderApp.d.ts
declare module 'orderApp/OrderList' {
  import { FC } from 'react';

  interface OrderListProps {
    orders: Array<{ id: string; total: number }>;
    onSelect?: (orderId: string) => void;
  }

  const OrderList: FC<OrderListProps>;
  export default OrderList;
}

// 问题：如果订单团队给 OrderListProps 加了一个 filterBy 属性
// 商品团队的类型声明不会自动更新
// TypeScript 不会报错——但运行时可能出问题
```

**硬伤三：版本管理薄弱**

MF 1.0 没有内建的模块版本管理机制。当 Remote 应用更新了暴露的模块接口（比如修改了组件的 props），所有消费方的代码可能在运行时崩溃——没有任何编译时或部署时的检查。

```typescript
// MF 1.0 的版本问题
// v1: OrderList 接受 { orders: Order[] }
// v2: OrderList 接受 { orders: Order[], pageSize: number }（pageSize 必填）

// Host 仍然按 v1 的方式使用：
<OrderList orders={orders} />
// 运行时：TypeError: Cannot read property 'xxx' of undefined
// 没有任何提前预警
```

### 9.3.2 MF 2.0 的架构革新

Module Federation 2.0（由 Zack Jackson 主导的独立项目）针对上述硬伤进行了系统性的架构升级。核心理念从"Webpack 的内置特性"转变为"跨构建工具的模块共享基础设施"。

MF 2.0 的核心架构升级体现在三个方面：独立运行时（不绑定构建工具）、跨构建工具支持（Webpack/Rspack/Vite）、自动类型生成与基于 Manifest 的版本管理。

**革新一：独立运行时**

MF 2.0 将模块联邦的运行时从 Webpack 中抽离为一个独立的包 `@module-federation/runtime`。这个运行时可以在任何构建工具的产物中运行。

```typescript
// MF 2.0：使用独立运行时
import { init, loadRemote } from '@module-federation/runtime';

// 初始化联邦运行时
init({
  name: 'productApp',
  remotes: [
    {
      name: 'orderApp',
      entry: 'https://order.example.com/remoteEntry.js',
    },
  ],
  shared: {
    react: {
      version: '18.3.1',
      lib: () => require('react'),
      shareConfig: { singleton: true, requiredVersion: '^18.0.0' },
    },
  },
});

// 动态加载远程模块
const OrderList = await loadRemote('orderApp/OrderList');
```

```javascript
// MF 2.0 的 Rspack 配置
// rspack.config.js
const { ModuleFederationPlugin } = require('@module-federation/enhanced/rspack');

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'orderApp',
      filename: 'remoteEntry.js',
      exposes: {
        './OrderList': './src/components/OrderList',
      },
      shared: {
        react: { singleton: true },
      },
    }),
  ],
};

// 注意：API 与 Webpack 版本几乎完全一致
// 但底层运行时是独立的 @module-federation/runtime
```

**革新二：Manifest 与类型同步**

MF 2.0 引入了 `manifest.json`——一个描述 Remote 应用所有暴露模块及其元信息的清单文件。

```json
{
  "id": "orderApp",
  "name": "orderApp",
  "metaData": {
    "name": "orderApp",
    "buildInfo": {
      "buildVersion": "1.2.3",
      "buildTime": "2026-03-15T10:30:00Z"
    },
    "remoteEntry": {
      "name": "remoteEntry.js",
      "path": "https://order.example.com/remoteEntry.js"
    },
    "types": {
      "path": "https://order.example.com/@mf-types.zip",
      "name": "@mf-types.zip"
    }
  },
  "shared": [
    {
      "sharedName": "react",
      "version": "18.3.1",
      "singleton": true
    }
  ],
  "exposes": [
    {
      "path": "./OrderList",
      "name": "OrderList",
      "assets": {
        "js": ["static/js/OrderList.chunk.js"],
        "css": ["static/css/OrderList.chunk.css"]
      }
    }
  ]
}
```

这个 Manifest 有三重作用：

1. **资源发现**：Host 通过 Manifest 知道 Remote 有哪些模块可用，以及它们对应的 chunk 文件
2. **类型同步**：`types.path` 指向自动生成的类型定义文件，Host 的构建流程可以自动下载并应用
3. **版本追踪**：`buildInfo.buildVersion` 提供了显式的版本信息

```typescript
// MF 2.0 的类型同步流程
// 1. Remote 构建时，自动生成类型声明并打包为 @mf-types.zip
// 2. Host 构建时，自动下载并解压到 @mf-types/ 目录
// 3. TypeScript 通过 paths 配置自动解析

// tsconfig.json（Host 端，自动配置）
{
  "compilerOptions": {
    "paths": {
      "orderApp/*": ["./@mf-types/orderApp/*"]
    }
  }
}

// 现在 TypeScript 自动知道 OrderList 的类型
import OrderList from 'orderApp/OrderList';
// ✓ 自动补全
// ✓ 类型检查
// ✓ 接口变更时编译报错
```

**革新三：运行时插件系统**

MF 2.0 引入了一个强大的插件系统，允许在模块加载的各个阶段插入自定义逻辑。

```typescript
import { init, type FederationRuntimePlugin } from '@module-federation/runtime';

// 自定义插件：添加模块加载监控
const monitorPlugin: () => FederationRuntimePlugin = () => ({
  name: 'monitor-plugin',

  // 在 remoteEntry 加载前
  beforeRequest(args) {
    console.log(`[MF] Loading remote: ${args.id}`);
    performance.mark(`mf-load-start:${args.id}`);
    return args;
  },

  // 在模块加载完成后
  afterResolve(args) {
    performance.mark(`mf-load-end:${args.id}`);
    performance.measure(
      `mf-load:${args.id}`,
      `mf-load-start:${args.id}`,
      `mf-load-end:${args.id}`
    );
    return args;
  },

  // 加载错误时降级处理
  errorLoadRemote(args) {
    console.error(`[MF] Failed to load: ${args.id}`, args.error);
    // 返回一个降级组件
    return {
      default: () => <div>模块加载失败，请刷新重试</div>,
    };
  },
});

init({
  name: 'productApp',
  remotes: [
    { name: 'orderApp', entry: 'https://order.example.com/remoteEntry.js' },
  ],
  plugins: [monitorPlugin()],
});
```

### 9.3.3 MF 1.0 与 2.0 的对比总结

| 维度 | MF 1.0 | MF 2.0 |
|------|--------|--------|
| **运行时** | 嵌入 Webpack 运行时 | 独立运行时 `@module-federation/runtime` |
| **构建工具** | 仅 Webpack 5 | Webpack / Rspack / Vite |
| **类型安全** | 手动声明 `.d.ts` | 自动生成并同步类型 |
| **版本管理** | 仅 shared 版本协商 | Manifest + 构建版本号 |
| **错误处理** | 基础的 Promise reject | 插件式错误处理 + 降级策略 |
| **开发体验** | 无专用工具 | Chrome DevTools 扩展 + CLI 工具 |
| **动态加载** | remotes 编译时固定 | `loadRemote()` 支持完全动态化 |
| **部署** | URL 硬编码在构建产物中 | Manifest + 运行时配置 |

> **深度洞察：从"构建工具特性"到"模块共享协议"**
>
> MF 1.0 到 2.0 的跃迁，本质上是从"一个构建工具的特性"升级为"一个模块共享协议"。MF 1.0 的 `remoteEntry.js` 格式、`init/get` 接口、共享作用域结构都是 Webpack 的内部实现。MF 2.0 将这些内部实现标准化为一套跨构建工具的协议。这就像 HTTP 从一个 CERN 的内部协议演变为互联网的基础设施一样——**当一个机制从"某个工具的特性"升级为"多个工具共同遵守的协议"时，它的网络效应和生态价值会发生指数级跃迁。** 这就是为什么 MF 2.0 的意义远超过一次版本升级——它标志着模块联邦从 Webpack 生态的专属方案，升级为前端生态的基础设施。

## 9.4 与运行时加载方案（乾坤/single-spa）的本质区别

### 9.4.1 问题域的根本差异

乾坤/single-spa 和 Module Federation 经常被放在一起比较。但如果你深入理解了两者的设计哲学，你会发现它们**解决的不是同一个问题**。

- **乾坤/single-spa** 的核心问题：如何在一个页面中运行多个独立应用？解法：运行时加载 + 沙箱隔离 + 生命周期管理
- **Module Federation** 的核心问题：如何在不同构建产物之间共享模块？解法：编译时声明 + 运行时协商 + 模块级加载

乾坤的核心关注点是**应用的运行时隔离**：如何让子应用 A 的全局变量不会影响子应用 B？如何让子应用 A 的 CSS 不会泄漏到子应用 B？如何在子应用切换时清理副作用？

Module Federation 的核心关注点是**模块的跨构建共享**：如何让构建产物 A 在运行时引用构建产物 B 的某个模块？如何在不同版本的依赖之间进行协商？如何最小化重复加载？

这两个问题域有交集——两者都涉及"多个独立部署的前端代码在同一个页面中协作"。但出发点和解法路径完全不同。

### 9.4.2 五个维度的对比

**维度一：加载粒度**

```typescript
// 乾坤：加载粒度 = 应用
// 加载订单子应用 → 获取整个应用的 HTML → 解析 JS/CSS → 创建沙箱 → 挂载
registerMicroApps([{
  name: 'order-app',
  entry: 'https://order.example.com',  // 一个完整的应用
  container: '#container',
  activeRule: '/order',
}]);

// Module Federation：加载粒度 = 模块
// 只加载需要的 OrderList 组件
const OrderList = React.lazy(() => import('orderApp/OrderList'));
// 不需要加载订单应用的路由、布局、其他页面
```

**维度二：隔离策略**

```typescript
// 乾坤：运行时沙箱隔离
// 每个子应用运行在独立的 Proxy 沙箱中
// 全局变量、定时器、事件监听器都被拦截和隔离
const sandbox = new ProxySandbox('order-app');
// window.xxx → sandbox.proxy.xxx
// 性能开销：每次全局变量访问都经过 Proxy

// Module Federation：不需要隔离
// 模块通过标准 import/export 交互
// 没有全局变量污染的场景
import { OrderList } from 'orderApp/OrderList';
// 就是一个普通的模块导入
// 零沙箱开销
```

**维度三：依赖共享**

```typescript
// 乾坤：约定式共享
// 主应用通过 <script> 加载 React 到全局
// 子应用通过 externals 配置避免打包 React
// 约定子应用的 React 来自 window.React

// 问题1：如果子应用忘记配置 externals → 重复加载
// 问题2：如果需要不同版本的 React → 无法处理
// 问题3：无版本协商，完全依赖人工约定

// Module Federation：协商式共享
// 编译时声明版本需求，运行时自动协商
shared: {
  react: {
    singleton: true,
    requiredVersion: '^18.0.0',
  },
}
// 自动选择兼容的最高版本
// 不兼容时有明确的警告/错误
// 需要不同版本时可以配置为非 singleton
```

**维度四：通信模式**

```typescript
// 乾坤：事件总线 / 全局状态
// 子应用之间通过 props 传递、全局事件或共享状态通信
import { initGlobalState } from 'qiankun';

const actions = initGlobalState({ user: null });

// 主应用设置
actions.setGlobalState({ user: { name: 'Yang' } });

// 子应用监听
actions.onGlobalStateChange((state) => {
  console.log(state.user);
});

// 问题：无类型安全、无编译时检查、调试困难

// Module Federation：标准 import/export
// 共享一个状态管理模块
// appA/webpack.config.js
exposes: {
  './store': './src/store/globalStore',
}

// appB 中
import { useGlobalStore } from 'appA/store';
// 完整的类型安全
// 标准的模块接口
// 和本地模块无异的调试体验
```

**维度五：适用场景**

```typescript
// 乾坤的最佳场景
const qiankunBestFor = {
  legacy: '需要接入遗留应用（jQuery、Angular 1.x 等不同框架）',
  isolation: '子应用之间高度独立，需要严格的 JS/CSS 隔离',
  routing: '以路由为维度拆分子应用，每个路由对应一个独立应用',
  migration: '渐进式迁移旧单体应用，新旧应用框架不同',
};

// Module Federation 的最佳场景
const mfBestFor = {
  sharing: '多个应用之间需要共享组件、逻辑、状态',
  consistency: '统一技术栈（或相近版本），追求一致的开发体验',
  granularity: '需要模块级而非应用级的代码复用',
  performance: '对加载性能敏感，无法接受沙箱开销',
  newProject: '新建项目，没有遗留应用的历史包袱',
};
```

### 9.4.3 一个关键的误区

很多文章会这样描述："Module Federation 是一种新的微前端方案，可以替代乾坤。" 这个说法**严格意义上是不准确的**。

Module Federation 不是一个微前端框架。它没有以下能力：

- **没有应用生命周期管理**：不关心 bootstrap/mount/unmount
- **没有路由拦截**：不监听 URL 变化来切换子应用
- **没有 JS/CSS 沙箱**：不提供全局变量和样式的隔离
- **没有 HTML Entry**：不解析 HTML 来提取资源

Module Federation 是一个**模块共享基础设施**。它解决的是"如何在不同构建产物之间共享模块"这个底层问题。你可以用它来实现微前端——但你同样可以用它来实现跨团队的组件库共享、运行时插件系统、多应用的公共状态管理，甚至服务端模块的跨进程共享。

```typescript
// Module Federation 的应用场景远超微前端
const useCases = {
  // 微前端（最常见的场景）
  microFrontend: {
    description: '多个独立应用在同一页面协作',
    howMFHelps: '提供模块级共享，避免重复加载',
  },

  // 跨团队组件库
  sharedComponentLib: {
    description: '多个团队共享 UI 组件库',
    howMFHelps: '组件库更新后无需所有消费方重新构建',
    example: '设计系统团队发布 Button v2，所有应用自动使用新版本',
  },

  // 运行时插件系统
  pluginSystem: {
    description: '主应用支持动态加载第三方插件',
    howMFHelps: '插件作为 Remote 暴露，主应用作为 Host 消费',
    example: '类似 VS Code 的扩展机制，但在浏览器中运行',
  },

  // A/B 测试
  abTesting: {
    description: '同一个功能的不同实现，运行时决定使用哪个',
    howMFHelps: '不同版本作为不同的 Remote，运行时动态切换',
  },

  // 服务端联邦（Node.js）
  serverFederation: {
    description: '多个 Node.js 服务之间共享模块',
    howMFHelps: 'MF 2.0 支持 Node.js 运行时',
  },
};
```

### 9.4.4 两种方案的组合使用

在真实的大型项目中，乾坤和 Module Federation 不一定是互斥的选择。它们可以在不同层面协作：**乾坤负责应用级编排和隔离，Module Federation 负责模块级共享。**

举一个典型场景：订单子应用（React 18）和商品子应用（React 18）技术栈一致，通过 Module Federation 共享组件和 React 实例；营销子应用（Vue 3）框架不同，通过乾坤的沙箱实现隔离。三个子应用统一由乾坤管理生命周期和路由切换。

```typescript
// 主应用：用乾坤管理所有子应用的生命周期
registerMicroApps([
  { name: 'order-app', entry: 'https://order.example.com', container: '#container', activeRule: '/order' },
  { name: 'product-app', entry: 'https://product.example.com', container: '#container', activeRule: '/product' },
  { name: 'marketing-app', entry: 'https://marketing.example.com', container: '#container', activeRule: '/marketing' },
]);

// 订单和商品应用：webpack.config.js 中同时配置 MF
// 共享 OrderList、ProductCard、React/ReactDOM
// 营销应用：不参与 MF，通过乾坤沙箱隔离
```

> **深度洞察：Module Federation 不是微前端方案，是模块共享基础设施**
>
> 如果你只记住本章一个观点，应该是这个：**Module Federation 的设计哲学不是"更好的微前端"，而是"让独立构建的代码像同一个项目中的模块一样互相引用"。** 微前端只是这个能力的应用场景之一。这就像 TCP/IP 不是"更好的电话网络"，而是一个通用的数据传输协议——电话（VoIP）只是它的应用场景之一。当你理解了这一点，你就理解了为什么 Module Federation 2.0 要从 Webpack 中独立出来，为什么它要支持 Node.js 运行时，为什么它的 API 设计是"模块级"而非"应用级"——因为它的野心从来不是做一个微前端框架，而是成为**跨构建产物的模块共享协议**。这个定位决定了它的设计空间远比任何微前端框架都大。理解了工具的定位，才能正确使用工具。

### 9.4.5 选型决策矩阵

面对一个具体的项目，如何在乾坤和 Module Federation 之间做出选择？以下是一个基于实际约束条件的决策矩阵：

| 决策因素 | 倾向乾坤 | 倾向 MF |
|---------|---------|---------|
| **技术栈一致性** | 不一致（React + Vue + jQuery） | 基本一致（都用 React 18） |
| **遗留应用** | 有大量遗留应用需要接入 | 无遗留应用或可以重构 |
| **共享粒度** | 应用级即可（路由拆分） | 需要模块级（共享组件/逻辑） |
| **性能敏感度** | 可以接受沙箱开销 | 对加载性能极度敏感 |
| **构建工具** | 各团队构建工具不统一 | 统一使用 Webpack/Rspack |
| **隔离需求** | 需要严格 JS/CSS 隔离 | 团队有良好编码规范 |

没有"更好"的方案，只有"更适合"的方案。当你理解了两者的设计哲学和问题域，选型就不再是一道选择题，而是一道基于约束条件的推导题。

---

## 本章小结

- Module Federation 的核心范式转换：从"独立构建独立部署的应用"到"运行时共享任意粒度的模块"
- 四大核心概念：Host（消费方）、Remote（提供方）、Shared（协商共享的依赖）、Exposes（暴露的模块清单）
- `remoteEntry.js` 是 Remote 的入口契约，通过 `init()` 和 `get()` 两个方法完成共享作用域初始化和模块获取
- Shared 依赖的版本协商通过 `singleton`、`requiredVersion`、`eager` 三个配置项控制，本质是在"全局唯一"和"版本兼容"之间寻找平衡
- MF 2.0 的三大革新：独立运行时（跨构建工具）、Manifest + 类型同步（开发体验）、插件系统（可扩展性）
- Module Federation 和乾坤/single-spa 解决的不是同一个问题——前者是模块共享基础设施，后者是应用运行时管理框架
- Module Federation 不是微前端方案，微前端只是它的应用场景之一

## 思考题

1. **概念理解**：本章提出"Module Federation 不是微前端方案，是模块共享基础设施"。请从 Module Federation 的 API 设计（`exposes`、`remotes`、`shared`）出发，分析为什么说它的设计粒度是"模块级"而非"应用级"。如果将 Module Federation 的概念类比到后端微服务生态，它更接近 gRPC、Kubernetes 还是 Service Mesh？为什么？

2. **版本协商**：假设你的项目中有四个 Module Federation 应用，它们依赖的 React 版本分别是 `18.2.0`、`18.3.1`、`18.2.0`、`17.0.2`。所有应用都配置了 `singleton: true`。请推演运行时版本协商的结果，分析可能出现的问题，并提出你的解决方案。

3. **架构设计**：你的公司有三个前端团队，分别维护电商平台的订单系统（React 18）、商品系统（React 18）和客服系统（Vue 3）。现在需要在订单页面中嵌入商品推荐组件，在商品页面中嵌入最近订单列表。请设计一个架构方案，说明你会选择乾坤、Module Federation 还是两者的混合方案，并解释每个技术决策的理由。

4. **深度思考**：`eager: true` 和 `eager: false` 的选择本质上是"初始加载性能"和"运行时确定性"之间的权衡。请分析在以下三个场景中，你会如何配置 `eager`，并解释原因：a）面向消费者的电商首页；b）面向内部用户的后台管理系统；c）需要支持离线使用的 PWA 应用。

5. **前沿展望**：MF 2.0 将自己定位为"跨构建工具的模块共享协议"。如果未来浏览器原生支持了类似 Import Maps + Service Worker 的模块联邦能力，Module Federation 的运行时层是否会变得多余？它的哪些设计（如版本协商、类型同步、插件系统）是浏览器原生能力难以替代的？


</div>
