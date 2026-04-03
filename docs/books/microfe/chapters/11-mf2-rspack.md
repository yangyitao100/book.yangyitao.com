<div v-pre>

# 第11章 Module Federation 2.0 与 Rspack

> "模块联邦的第一个版本证明了跨构建产物共享代码是可行的——而第二个版本证明了这件事可以变得简单、安全、且极其快速。"

> **本章要点**
> - 理解 Module Federation 2.0 相比 1.0 的三大飞跃：类型安全、运行时插件系统、动态远程加载
> - 掌握 Rspack 中 Module Federation 的配置与 Rust 编译带来的性能优势
> - 深入 @module-federation/enhanced 运行时核心源码，理解模块加载与版本协商的底层机制
> - 实现跨框架（React + Vue）的 Module Federation 实践方案
> - 建立 MF 2.0 在生产环境的部署策略：版本管理、灰度发布、容灾降级

---

2022 年底的一个深夜，我正在调试一个 Webpack 5 Module Federation 的线上问题。远程模块加载失败了，但错误信息只有一行冷冰冰的 `ScriptExternalLoadError`。没有类型提示告诉我远程模块的接口长什么样，没有运行时钩子让我在加载失败时做降级处理，甚至无法在不重新部署宿主应用的情况下切换远程模块的地址。

我花了四个小时定位问题——最终发现是远程应用的一次接口变更导致类型不匹配，而宿主应用在编译期对此一无所知。

这就是 Module Federation 1.0 的困境：**它打开了一扇通往跨应用模块共享的大门，却没有在门口放一盏灯。**

2024 年，Zack Jackson 和团队发布了 Module Federation 2.0。这不是一次小版本迭代，而是一次架构级的重构。类型安全、运行时插件、动态远程、跨构建工具支持——这些能力让 Module Federation 从"能用"进化到"好用"。而 Rspack 的加入，则让"好用"变成了"飞快"。

本章将带你完整走过这条进化之路。

## 11.1 MF 2.0 的新能力

Module Federation 1.0 解决了一个根本问题：如何在运行时从另一个独立部署的应用中加载模块。但它留下了三个关键缺口——类型安全、运行时扩展性、动态远程管理。MF 2.0 逐一填补了这些缺口。

### 11.1.1 类型安全：@module-federation/typescript

在 MF 1.0 中，远程模块对宿主应用而言是一个黑盒。你通过字符串引用一个远程模块，TypeScript 编译器对它的类型一无所知。MF 2.0 通过 `@module-federation/typescript` 引入了完整的类型安全机制——远程应用在构建时生成类型声明，宿主应用在开发时自动拉取。

```typescript
// remote-app/rspack.config.ts（远程应用配置）
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';

export default {
  plugins: [
    new ModuleFederationPlugin({
      name: 'remoteApp',
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/components/Button.tsx',
        './UserCard': './src/components/UserCard.tsx',
        './useAuth': './src/hooks/useAuth.ts',
      },
      dts: {
        generateTypes: {
          extractRemoteTypes: true,
          compileInChildProcess: true,
        },
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
      },
    }),
  ],
};
```

宿主应用的配置负责消费这些类型：

```typescript
// host-app/rspack.config.ts（宿主应用配置）
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';

export default {
  plugins: [
    new ModuleFederationPlugin({
      name: 'hostApp',
      remotes: {
        remoteApp: 'remoteApp@http://localhost:3001/remoteEntry.js',
      },
      dts: {
        consumeTypes: {
          remoteTypesFolder: '@mf-types',
          abortOnError: false,
          consumeAPITypes: true,
        },
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
      },
    }),
  ],
};
```

配置完成后，宿主应用引用远程模块时便获得了完整的类型推导：

```typescript
// host-app/src/App.tsx —— 完整的类型推导
import RemoteButton from 'remoteApp/Button';
import { useAuth } from 'remoteApp/useAuth';

function App() {
  const { user, login, logout } = useAuth(); // ✅ 完整的类型推导
  return (
    <RemoteButton
      label="登录"        // ✅ string 类型
      onClick={login}     // ✅ () => void
      variant="primary"   // ✅ 联合类型自动补全
      // color={123}      // ❌ 编译期报错：不存在属性 'color'
    />
  );
}
```

类型同步的底层使用 TypeScript Compiler API 提取暴露模块的声明文件，打包为可下载归档，宿主应用开发时从远程拉取并解压到 `node_modules/@mf-types/` 目录，最后生成 TypeScript path mapping。

> 💡 **深度洞察**：MF 2.0 的类型安全不仅仅是"开发体验的提升"。在微前端架构中，远程模块的接口变更是最常见的故障来源之一。类型系统将这类问题从"运行时崩溃"前移到"编译期报错"。在传统微服务架构中，API 契约通过 OpenAPI/Protobuf 来保障；而在微前端架构中，模块联邦的类型系统扮演的正是同样的角色。

### 11.1.2 运行时插件系统

MF 1.0 的运行时行为几乎是固定的。MF 2.0 引入了强大的运行时插件系统，让你可以拦截模块联邦的每一个关键环节：

```typescript
import type { FederationRuntimePlugin } from '@module-federation/enhanced/runtime';

interface FederationRuntimePlugin {
  name: string;
  beforeInit?: (args: BeforeInitArgs) => BeforeInitArgs;
  init?: (args: InitArgs) => void;
  beforeRequest?: (args: BeforeRequestArgs) => BeforeRequestArgs | Promise<BeforeRequestArgs>;
  beforeLoadRemote?: (args: BeforeLoadRemoteArgs) => BeforeLoadRemoteArgs;
  afterLoadRemote?: (args: AfterLoadRemoteArgs) => AfterLoadRemoteArgs;
  onLoad?: (args: OnLoadArgs) => void;
  beforeLoadShare?: (args: BeforeLoadShareArgs) => BeforeLoadShareArgs;
  resolveShare?: (args: ResolveShareArgs) => ResolveShareArgs;
  errorLoadRemote?: (args: ErrorLoadRemoteArgs) => unknown;
}
```

以下是两个在生产环境中极具价值的插件示例：

```typescript
// 加载失败时的降级插件
const fallbackPlugin: () => FederationRuntimePlugin = () => ({
  name: 'fallback-plugin',
  errorLoadRemote({ id, error }) {
    console.error(`[MF Fallback] 远程模块 ${id} 加载失败:`, error);
    const fallbackMap: Record<string, () => unknown> = {
      'remoteApp/Button': () => import('./fallbacks/ButtonFallback'),
      'remoteApp/UserCard': () => import('./fallbacks/UserCardFallback'),
    };
    const loader = fallbackMap[id];
    if (loader) return loader();
    return { default: () => ({ __isFallback: true, moduleId: id }) };
  },
});

// 模块加载性能监控插件
const performancePlugin: () => FederationRuntimePlugin = () => {
  const timings = new Map<string, number>();
  return {
    name: 'performance-monitor-plugin',
    beforeLoadRemote(args) {
      timings.set(args.id, performance.now());
      return args;
    },
    afterLoadRemote(args) {
      const start = timings.get(args.id);
      if (start) {
        const duration = performance.now() - start;
        timings.delete(args.id);
        navigator.sendBeacon?.('/api/metrics', JSON.stringify({
          type: 'mf_module_load', moduleId: args.id, duration, timestamp: Date.now(),
        }));
        if (duration > 3000) {
          console.warn(`[MF Perf] ${args.id} 加载耗时 ${duration.toFixed(0)}ms，超过阈值`);
        }
      }
      return args;
    },
  };
};
```

插件通过 `init` 注册：

```typescript
import { init, loadRemote } from '@module-federation/enhanced/runtime';

init({
  name: 'hostApp',
  remotes: [{ name: 'remoteApp', entry: 'http://localhost:3001/remoteEntry.js' }],
  plugins: [fallbackPlugin(), performancePlugin()],
});

const Button = await loadRemote<{ default: React.FC }>('remoteApp/Button');
```

### 11.1.3 动态远程：告别硬编码

MF 1.0 中远程应用地址必须在构建时写死。MF 2.0 通过运行时 API 彻底解决了这个问题：

```typescript
import { init, loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';

init({ name: 'hostApp', remotes: [] });

// 从配置中心动态获取远程应用列表
async function bootstrapRemotes(): Promise<void> {
  const response = await fetch('https://config.example.com/api/micro-apps');
  const configs: Array<{ name: string; entry: string; enabled: boolean }> = await response.json();

  const enabledRemotes = configs
    .filter((c) => c.enabled)
    .map((c) => ({ name: c.name, entry: c.entry }));

  registerRemotes(enabledRemotes, { force: false });
}

// A/B 测试：基于用户分组加载不同版本
async function loadWithABTest(userId: string): Promise<void> {
  const abConfig = await fetchABTestConfig(userId);
  registerRemotes([{
    name: 'checkoutApp',
    entry: abConfig.group === 'experiment'
      ? 'https://cdn.example.com/checkout/v3-beta/remoteEntry.js'
      : 'https://cdn.example.com/checkout/v2.8.0/remoteEntry.js',
  }], { force: true });
}
```

> 💡 **深度洞察**：动态远程的本质是将"远程应用的版本绑定"从编译时推迟到运行时。这和微服务架构中的服务发现是同一个设计思想——我们不会将服务地址硬编码到代码中，而是通过注册中心动态发现。Module Federation 2.0 的动态远程 + 配置中心，就是微前端世界的"服务发现"。

## 11.2 Rspack 中的 Module Federation

### 11.2.1 为什么选择 Rspack

Rspack 是字节跳动开源的基于 Rust 的打包工具，提供了与 Webpack 高度兼容的 API，同时将构建性能提升了一个数量级。对 Module Federation 而言，Rspack 的价值在于：构建速度（Rust 编译带来 10-50 倍加速）和原生支持（从核心层面内置 MF）。

```typescript
// 构建性能对比（真实项目基准测试）
// Webpack 5: 冷构建 45s | 热构建 12s | HMR 2.1s | MF 开销 ~8s
// Rspack:    冷构建 3.2s | 热构建 0.8s | HMR 0.12s | MF 开销 ~0.5s
```

### 11.2.2 Rspack + MF 2.0 完整配置

远程应用的完整 Rspack 配置：

```typescript
// remote-app/rspack.config.ts
import { defineConfig } from '@rspack/cli';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';

export default defineConfig({
  entry: './src/index.ts',
  output: { publicPath: 'auto', uniqueName: 'remoteApp' },
  devServer: {
    port: 3001,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
  resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'] },
  module: {
    rules: [{
      test: /\.tsx?$/,
      use: {
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic' } },
          },
        },
      },
      type: 'javascript/auto',
    }],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'remoteApp',
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/components/Button.tsx',
        './UserCard': './src/components/UserCard.tsx',
        './useAuth': './src/hooks/useAuth.ts',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
      },
      runtimePlugins: ['./src/mf-plugins/lifecycle.ts'],
      dts: { generateTypes: { extractRemoteTypes: true, compileInChildProcess: true } },
    }),
  ],
});
```

宿主应用配置：

```typescript
// host-app/rspack.config.ts
import { defineConfig } from '@rspack/cli';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';

export default defineConfig({
  entry: './src/index.ts',
  output: { publicPath: 'auto', uniqueName: 'hostApp' },
  devServer: { port: 3000 },
  resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'] },
  module: {
    rules: [{
      test: /\.tsx?$/,
      use: {
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic' } },
          },
        },
      },
      type: 'javascript/auto',
    }],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'hostApp',
      remotes: { remoteApp: 'remoteApp@http://localhost:3001/remoteEntry.js' },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0', eager: true },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0', eager: true },
      },
      runtimePlugins: ['./src/mf-plugins/host-lifecycle.ts'],
      dts: { consumeTypes: { remoteTypesFolder: '@mf-types', abortOnError: false } },
    }),
  ],
});
```

### 11.2.3 Rspack 的 Rust 编译管线与 MF 的协同

Rspack 在 Module Federation 场景下有三个关键的架构优势。**第一，并行模块解析**——使用 Rust 的 rayon 库在多线程中并行解析模块依赖图，暴露模块和共享依赖的分析与主应用的模块解析同时进行。**第二，增量编译粒度**——以模块为粒度，当远程应用只修改了一个暴露模块时，只需重新编译该模块及其直接依赖。**第三，零拷贝的共享依赖分析**——直接在 Rust 内存中操作模块元数据，避免 JavaScript 对象的序列化/反序列化开销。

```
┌───────────────────────────────────────────────────┐
│               Rspack 编译管线                      │
│  ┌────────┐   ┌──────────┐   ┌──────────────┐    │
│  │解析阶段 │──▶│模块图构建 │──▶│ 代码生成阶段  │    │
│  │ (Rust)  │   │  (Rust)  │   │   (Rust)     │    │
│  └────────┘   └──────────┘   └──────────────┘    │
│      │              │               │             │
│      ▼              ▼               ▼             │
│  MF 远程       共享依赖         remoteEntry.js    │
│  引用解析       版本分析           生成            │
│  (Rust 侧)    (Rust 侧)        (Rust 侧)        │
│                                                   │
│  关键：MF 分析在 Rust 侧完成，无需 JS 互操作      │
└───────────────────────────────────────────────────┘
```

> 💡 **深度洞察**：类型提取（dts generation）仍然是 Rspack MF 构建中最慢的环节，因为它依赖 TypeScript Compiler API，运行在 JavaScript 侧。这也是为什么 `compileInChildProcess: true` 如此重要——它将类型编译放到子进程中，避免阻塞主构建流程。未来当 Rust 原生 TypeScript 编译器成熟后，这个瓶颈也将被消除。

## 11.3 @module-federation/enhanced 运行时源码分析

### 11.3.1 运行时初始化流程

`@module-federation/enhanced/runtime` 的入口是 `init` 函数，它创建一个 `FederationHost` 实例来管理所有远程应用的生命周期：

```typescript
// FederationHost 核心结构（简化源码分析）
class FederationHost {
  options: FederationRuntimeOptions;
  hooks: PluginSystem;
  moduleCache: Map<string, any>;
  sharedHandler: SharedHandler;
  remoteHandler: RemoteHandler;

  constructor(userOptions: UserOptions) {
    this.options = this.normalizeOptions(userOptions);

    // 初始化插件系统——所有内置行为都通过插件实现
    this.hooks = new PluginSystem({
      beforeInit: new SyncWaterfallHook<BeforeInitArgs>('beforeInit'),
      init: new SyncHook<InitArgs>('init'),
      beforeRequest: new AsyncWaterfallHook<BeforeRequestArgs>('beforeRequest'),
      beforeLoadRemote: new AsyncWaterfallHook<BeforeLoadRemoteArgs>('beforeLoadRemote'),
      afterLoadRemote: new AsyncWaterfallHook<AfterLoadRemoteArgs>('afterLoadRemote'),
      errorLoadRemote: new AsyncHook<ErrorLoadRemoteArgs>('errorLoadRemote'),
      beforeLoadShare: new AsyncWaterfallHook<BeforeLoadShareArgs>('beforeLoadShare'),
      resolveShare: new SyncWaterfallHook<ResolveShareArgs>('resolveShare'),
    });

    // 注册用户插件
    userOptions.plugins?.forEach((plugin) => this.hooks.registerPlugin(plugin));

    // 触发初始化钩子
    this.hooks.lifecycle.beforeInit.call({ userOptions, options: this.options, origin: this });
    this.hooks.lifecycle.init.call({ options: this.options, origin: this });
  }

  async loadRemote<T = any>(id: string): Promise<T> {
    return this.remoteHandler.loadRemote(id);
  }

  registerRemotes(remotes: Remote[], options?: { force?: boolean }): void {
    this.remoteHandler.registerRemotes(remotes, options);
  }
}

// 全局单例
let globalFederationHost: FederationHost | null = null;

export function init(options: UserOptions): FederationHost {
  if (globalFederationHost) {
    globalFederationHost.initOptions(options);
    return globalFederationHost;
  }
  globalFederationHost = new FederationHost(options);
  return globalFederationHost;
}
```

### 11.3.2 远程模块加载的完整链路

当调用 `loadRemote('remoteApp/Button')` 时，请求经过以下链路：

```typescript
// RemoteHandler.loadRemote 核心实现（简化）
class RemoteHandler {
  host: FederationHost;
  loadingMap: Map<string, Promise<any>>; // 防止重复加载

  async loadRemote(id: string): Promise<any> {
    // 1. 解析标识符：'remoteApp/Button' -> { remoteName, exposedModule }
    const { remoteName, exposedModule } = this.parseModuleId(id);

    // 2. 触发 beforeRequest 钩子（插件可修改请求）
    const args = await this.host.hooks.lifecycle.beforeRequest.call({
      id, remoteName, exposedModule, options: this.host.options,
    });

    // 3. 获取远程应用入口信息
    const remoteInfo = this.remoteMap.get(args.remoteName);
    if (!remoteInfo) throw new Error(`[MF] 未注册的远程应用: ${args.remoteName}`);

    // 4. 加载远程入口文件（remoteEntry.js）—— 带缓存
    const remoteContainer = await this.loadRemoteEntry(remoteInfo);

    // 5. 初始化远程容器（共享依赖协商在此发生）
    await this.initializeRemoteContainer(remoteContainer);

    // 6. 从远程容器获取具体模块的工厂函数
    const factory = await remoteContainer.get(args.exposedModule);
    if (!factory) {
      throw new Error(`[MF] ${args.remoteName} 未暴露模块 ${args.exposedModule}`);
    }

    // 7. 执行工厂函数获取模块
    const module = factory();

    // 8. 触发 afterLoadRemote 钩子
    const result = await this.host.hooks.lifecycle.afterLoadRemote.call({
      id, module, remoteName, exposedModule,
    });
    return result.module;
  }

  private async loadRemoteEntry(remoteInfo: RemoteInfo): Promise<RemoteContainer> {
    const { entry, name } = remoteInfo;
    if (this.loadingMap.has(name)) return this.loadingMap.get(name)!;

    const loadPromise = new Promise<RemoteContainer>(async (resolve, reject) => {
      try {
        await this.host.hooks.lifecycle.beforeLoadRemote.call({ id: name, entry });
        const container = await this.loadScript(entry, name);
        resolve(container);
      } catch (error) {
        // 触发错误处理钩子——插件可在此提供降级
        const fallback = await this.host.hooks.lifecycle.errorLoadRemote.call({
          id: name, error: error as Error, from: 'runtime', origin: this.host,
        });
        fallback !== undefined ? resolve(fallback as RemoteContainer) : reject(error);
      }
    });

    this.loadingMap.set(name, loadPromise);
    return loadPromise;
  }
}
```

### 11.3.3 共享依赖的版本协商算法

共享依赖协商是 Module Federation 最精妙的部分。当多个应用都声明了对 `react` 的依赖，运行时按以下规则决定使用哪个版本：

```typescript
// SharedHandler 版本协商逻辑（简化）
class SharedHandler {
  private resolveVersion(
    pkgName: string,
    candidates: SharedInfo[],
    extraOptions?: ShareExtraOptions
  ): SharedInfo {
    // 规则 1：singleton 模式——所有消费者必须使用同一个实例
    const singletonCandidates = candidates.filter((c) => c.singleton);
    if (singletonCandidates.length > 0) {
      const loaded = singletonCandidates.find((c) => c.loaded);
      if (loaded) {
        this.checkSingletonCompatibility(pkgName, loaded, candidates);
        return loaded; // 优先使用已加载的版本
      }
      return this.selectHighestVersion(singletonCandidates);
    }

    // 规则 2：非 singleton——按 semver 匹配
    const requiredVersion = extraOptions?.requiredVersion || '*';
    const compatible = candidates.filter((c) =>
      this.satisfiesVersion(c.version, requiredVersion)
    );

    if (compatible.length === 0) {
      console.warn(`[MF] ${pkgName} 没有满足 ${requiredVersion} 的版本`);
      return this.selectClosestVersion(candidates, requiredVersion);
    }

    return compatible.find((c) => c.loaded) || this.selectHighestVersion(compatible);
  }

  private checkSingletonCompatibility(
    pkgName: string, loaded: SharedInfo, all: SharedInfo[]
  ): void {
    for (const candidate of all) {
      if (candidate === loaded) continue;
      if (candidate.requiredVersion &&
          !this.satisfiesVersion(loaded.version, candidate.requiredVersion)) {
        const msg = `[MF] ${pkgName} 版本冲突！已加载 v${loaded.version}，` +
          `但 ${candidate.from} 要求 ${candidate.requiredVersion}。`;
        if (candidate.strictVersion) throw new Error(msg);
        else console.warn(msg);
      }
    }
  }
}
```

> 💡 **深度洞察**：React 要求整个应用中只能有一个实例（因为 hooks 依赖模块级的内部状态）。如果远程应用的 `react` 版本与宿主不兼容且未配置 `singleton: true`，运行时会加载两个 React 实例，导致 "Invalid hook call" 错误。`shared.react.singleton: true` 不是可选项，而是**必选项**。同理适用于 `react-dom`、`react-router` 以及任何依赖全局单例状态的库。

### 11.3.4 插件系统的实现机制

MF 2.0 的插件系统借鉴了 Webpack 的 Tapable 设计。核心是瀑布流（Waterfall）Hook——每个回调的返回值作为下一个回调的输入：

```typescript
class SyncWaterfallHook<T> {
  private callbacks: Array<(args: T) => T | undefined> = [];

  tap(callback: (args: T) => T | undefined): void {
    this.callbacks.push(callback);
  }

  call(args: T): T {
    let result = args;
    for (const cb of this.callbacks) {
      const newResult = cb(result);
      if (newResult !== undefined) result = newResult;
    }
    return result;
  }
}

class PluginSystem {
  lifecycle: Record<string, SyncWaterfallHook<any> | AsyncWaterfallHook<any>>;

  registerPlugin(plugin: FederationRuntimePlugin): void {
    for (const [hookName, hookInstance] of Object.entries(this.lifecycle)) {
      const handler = (plugin as any)[hookName];
      if (typeof handler === 'function') {
        hookInstance.tap(handler.bind(plugin));
      }
    }
  }
}
```

这种设计使得每个插件不仅可以读取数据，还可以修改数据并传递给下一个插件——这是 MF 2.0 运行时可扩展性的基石。

## 11.4 跨框架的 Module Federation 实践

### 11.4.1 跨框架的核心挑战

跨框架集成面临三个核心挑战：渲染机制不同（React Virtual DOM vs Vue 响应式代理）、生命周期不同（组件挂载/卸载时机需精确对齐）、状态管理不同（跨框架的状态共享需要框架无关的中间层）。解决方案的核心是**桥接模块**——将框架特定的组件封装为统一的 `mount/update/unmount` 接口。

### 11.4.2 React 宿主 + Vue 远程

Vue 远程应用暴露的不是 Vue 组件本身，而是经过适配器封装的桥接模块：

```typescript
// vue-remote-app/src/bridge/createReactiveBridge.ts
import { createApp, type App, type Component, h, reactive } from 'vue';

interface BridgeComponent {
  mount: (el: HTMLElement, props?: Record<string, unknown>) => void;
  update: (props: Record<string, unknown>) => void;
  unmount: () => void;
}

export function createReactiveBridge(component: Component): BridgeComponent {
  let app: App | null = null;
  const state = reactive<{ props: Record<string, unknown> }>({ props: {} });

  return {
    mount(el, props = {}) {
      Object.assign(state.props, props);
      app = createApp({
        setup() {
          return () => h(component, state.props);
        },
      });
      app.mount(el);
    },
    update(newProps) {
      // 直接修改响应式对象，Vue 自动触发更新——无需重新挂载
      Object.assign(state.props, newProps);
    },
    unmount() {
      app?.unmount();
      app = null;
    },
  };
}
```

在 React 宿主应用中，创建通用的包装组件：

```tsx
// host-app/src/components/VueRemoteWrapper.tsx
import React, { useRef, useEffect } from 'react';
import { loadRemote } from '@module-federation/enhanced/runtime';

interface BridgeModule {
  default: {
    mount: (el: HTMLElement, props?: Record<string, unknown>) => void;
    update: (props: Record<string, unknown>) => void;
    unmount: () => void;
  };
}

interface VueRemoteWrapperProps {
  remoteName: string;
  moduleName: string;
  componentProps?: Record<string, unknown>;
  fallback?: React.ReactNode;
}

export function VueRemoteWrapper({
  remoteName, moduleName, componentProps = {},
  fallback = <div>加载中...</div>,
}: VueRemoteWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<BridgeModule['default'] | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    async function loadAndMount() {
      try {
        const module = await loadRemote<BridgeModule>(`${remoteName}/${moduleName}`);
        if (cancelled || !containerRef.current || !module) return;
        module.default.mount(containerRef.current, componentProps);
        bridgeRef.current = module.default;
        setStatus('ready');
      } catch (error) {
        if (!cancelled) setStatus('error');
      }
    }
    loadAndMount();
    return () => { cancelled = true; bridgeRef.current?.unmount(); };
  }, [remoteName, moduleName]);

  // 当 React 侧 props 变化时，同步到 Vue 组件
  useEffect(() => {
    if (bridgeRef.current && status === 'ready') {
      bridgeRef.current.update(componentProps);
    }
  }, [componentProps, status]);

  return (
    <>
      {status === 'loading' && fallback}
      {status === 'error' && <div>加载失败</div>}
      <div ref={containerRef} style={{ display: status === 'ready' ? 'block' : 'none' }} />
    </>
  );
}
```

### 11.4.3 跨框架状态共享

跨框架最棘手的问题是状态共享。解决方案是引入一个框架无关的状态层——基于发布-订阅模式：

```typescript
// shared-state/src/createCrossFrameworkStore.ts
type Listener = () => void;

export function createCrossFrameworkStore<T extends Record<string, unknown>>(initialState: T) {
  let state: T = { ...initialState };
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState(updater: Partial<T> | ((prev: T) => Partial<T>)) {
      const partial = typeof updater === 'function' ? updater(state) : updater;
      state = { ...state, ...partial };
      listeners.forEach((fn) => fn());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

为 React 和 Vue 分别提供绑定：

```typescript
// React 绑定
import { useSyncExternalStore } from 'react';

export function useStore<T extends Record<string, unknown>, S>(
  store: ReturnType<typeof createCrossFrameworkStore<T>>,
  selector?: (state: T) => S
) {
  return useSyncExternalStore(
    store.subscribe,
    () => (selector ? selector(store.getState()) : store.getState())
  );
}
```

```typescript
// Vue 绑定
import { ref, onUnmounted, type Ref } from 'vue';

export function useStore<T extends Record<string, unknown>>(
  store: ReturnType<typeof createCrossFrameworkStore<T>>
): Ref<T> {
  const state = ref(store.getState()) as Ref<T>;
  const unsub = store.subscribe(() => { state.value = store.getState(); });
  onUnmounted(unsub);
  return state;
}
```

React 和 Vue 组件可以同时读写同一份状态，实现完美同步。

> 💡 **深度洞察**：跨框架状态共享的本质是"谁拥有状态"的问题。状态应该属于业务域而非框架。`createCrossFrameworkStore` 能同时为 React 和 Vue 所用，因为其核心是发布-订阅模式——所有响应式系统的最大公约数。即使未来引入 Svelte 或 Solid，只需写一个新的绑定函数，无需改动状态层。

## 11.5 MF 2.0 的生产部署策略

### 11.5.1 版本管理与发布策略

每个远程应用独立部署，版本管理通过配置中心（远程注册表）实现：

```typescript
interface RemoteAppVersion {
  name: string;
  version: string;
  entry: string;
  integrity?: string;              // SRI 哈希
  requiredHostVersion?: string;    // 宿主最低版本要求
  metadata: {
    deployedAt: string;
    commitHash: string;
    changelog: string;
  };
}

// 部署流程：上传 CDN -> 注册版本 -> 健康检查
async function registerNewVersion(app: RemoteAppVersion): Promise<void> {
  await uploadToCDN(app.name, app.version);
  await configCenter.register({
    ...app,
    entry: `https://cdn.example.com/${app.name}/${app.version}/remoteEntry.js`,
  });
  const health = await fetch(app.entry);
  if (!health.ok) throw new Error(`远程入口文件不可访问: ${app.entry}`);
}
```

### 11.5.2 灰度发布策略

借助动态远程和运行时插件，实现精细化灰度控制：

```typescript
function createGrayReleasePlugin(
  rules: Array<{
    remoteName: string;
    stableEntry: string;
    canaryEntry: string;
    condition: (ctx: { userId: string; userRole: string; abGroup: string }) => boolean;
  }>,
  getContext: () => { userId: string; userRole: string; abGroup: string }
): FederationRuntimePlugin {
  return {
    name: 'gray-release-plugin',
    beforeRequest(args) {
      const [remoteName] = args.id.split('/');
      const rule = rules.find((r) => r.remoteName === remoteName);
      if (!rule) return args;

      const ctx = getContext();
      const entry = rule.condition(ctx) ? rule.canaryEntry : rule.stableEntry;

      args.options.remotes = args.options.remotes?.map((remote) =>
        typeof remote === 'object' && remote.name === remoteName
          ? { ...remote, entry }
          : remote
      );
      return args;
    },
  };
}
```

### 11.5.3 容灾降级策略

远程模块加载失败是必须处理的场景。通过插件实现多层防线：

```typescript
function createResiliencePlugin(): FederationRuntimePlugin {
  const cdnFallbacks: Record<string, string[]> = {
    remoteApp: [
      'https://cdn-primary.example.com/remote/remoteEntry.js',
      'https://cdn-backup.example.com/remote/remoteEntry.js',
    ],
  };

  return {
    name: 'resilience-plugin',
    async errorLoadRemote({ id, error }) {
      const [remoteName] = id.split('/');

      // 策略 1：CDN 故障转移
      const urls = cdnFallbacks[remoteName];
      if (urls) {
        for (const url of urls) {
          try {
            const module = await loadFromUrl(url, id);
            if (module) return module;
          } catch { continue; }
        }
      }

      // 策略 2：Service Worker 缓存
      if ('caches' in window) {
        const cache = await caches.open('mf-remote-entries');
        const cached = await cache.match(id);
        if (cached) return processCachedEntry(cached);
      }

      // 策略 3：本地降级模块
      const fallbacks: Record<string, () => Promise<unknown>> = {
        'remoteApp/Button': () => import('./fallbacks/ButtonFallback'),
        'remoteApp/UserCard': () => import('./fallbacks/UserCardFallback'),
      };
      return fallbacks[id]?.() ?? { default: () => null, __IS_FALLBACK__: true };
    },
  };
}
```

### 11.5.4 性能优化：预加载与缓存

```typescript
import { preloadRemote, init } from '@module-federation/enhanced/runtime';

// 空闲时预加载
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => {
    preloadRemote([{ nameOrAlias: 'remoteApp', exposes: ['./Button', './UserCard'] }]);
  });
}

// 基于路由的预加载：hover 导航链接时提前加载
function prefetchOnHover(configs: Array<{
  selector: string; remoteName: string; exposes: string[];
}>): void {
  configs.forEach(({ selector, remoteName, exposes }) => {
    document.querySelector(selector)?.addEventListener('mouseenter', () => {
      preloadRemote([{ nameOrAlias: remoteName, exposes }]);
    }, { once: true });
  });
}
```

### 11.5.5 部署架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                    生产环境部署架构                            │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────────┐  │
│  │ 配置中心  │  │ 版本管理  │  │     监控告警系统           │  │
│  │(远程注册) │  │(版本+灰度)│  │  (性能 + 错误 + SLA)      │  │
│  └─────┬────┘  └─────┬────┘  └────────────┬──────────────┘  │
│        │             │                     │                 │
│  ┌─────▼─────────────▼─────────────────────▼──────────────┐  │
│  │                   CDN 层                                │  │
│  │  Host v3.2  RemoteA v2.8  RemoteB v1.5  (灰度版本...)  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                 用户浏览器                               │  │
│  │  ┌─────────────────────────────────────────────┐       │  │
│  │  │            MF 2.0 运行时                     │       │  │
│  │  │  插件系统: 灰度路由 / 容灾降级 / 性能监控    │       │  │
│  │  │  共享管理: 版本协商 / 单例保证 / 按需加载     │       │  │
│  │  └─────────────────────────────────────────────┘       │  │
│  │  ┌─────────────────────┐                               │  │
│  │  │   Service Worker    │ ← remoteEntry 缓存 + 离线降级 │  │
│  │  └─────────────────────┘                               │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

> 💡 **深度洞察**：很多团队在引入 Module Federation 时低估了运维复杂度。MF 1.0 只解决了"如何加载远程模块"，而生产环境还需要回答：远程应用挂了怎么办？如何灰度发布？如何回滚？如何监控？MF 2.0 的运行时插件系统正是对这些问题的系统性回应——它不试图内置所有策略，而是提供足够的扩展点让你按需实现。这种"平台化"的设计哲学，和 Webpack 本身通过插件系统实现一切的思路如出一辙。

## 本章小结

- Module Federation 2.0 在三个关键维度上超越了 1.0：**类型安全**消除了远程模块的接口黑盒，**运行时插件**开放了模块加载的全链路扩展，**动态远程**将版本绑定从编译时推迟到运行时
- Rspack 的 Rust 编译管线为 Module Federation 带来了一个数量级的性能提升，通过并行解析、增量编译、零拷贝分析三项关键技术使 MF 构建开销降至可忽略水平
- `@module-federation/enhanced` 运行时的核心是 `FederationHost` 单例，通过 `RemoteHandler`（远程加载）、`SharedHandler`（共享协商）、`PluginSystem`（插件管理）三大子系统协同工作
- 跨框架集成的关键在于"桥接模块"——将框架特定的组件封装为 `mount/update/unmount` 三方法接口，状态共享通过框架无关的发布-订阅机制实现
- 生产部署需要建立完整的版本管理、灰度发布、容灾降级、预加载缓存体系，MF 2.0 的插件系统为这些能力提供了标准化的扩展点

## 思考题

1. **类型安全的边界**：MF 2.0 的类型系统在开发时提供了类型检查，但远程模块在运行时加载——远程应用可能在宿主不知情的情况下变更接口。除了类型声明同步之外，你能设计一个运行时的契约验证机制来捕获接口不兼容问题吗？

2. **版本协商的极端场景**：假设宿主依赖 `react@18.2.0`，远程 A 依赖 `react@18.3.0`，远程 B 依赖 `react@17.0.2`（均配置 `singleton: true`）。请分析 MF 2.0 运行时的版本协商会如何处理这个三方冲突，以及可能产生的运行时问题。

3. **跨框架性能优化**：本章的 `VueRemoteWrapper` 在每次 `componentProps` 变化时都会调用 `bridge.update()`。请设计一个优化方案减少不必要的跨框架通信——提示：考虑浅比较、批量更新、以及 React 和 Vue 更新时机的差异。

4. **容灾策略评估**：假设你的应用有一个核心的结账远程模块，加载失败直接影响营收。请设计一套分级容灾方案，覆盖从"CDN 节点故障"到"远程应用全面不可用"的各级故障场景。

5. **架构演进方向**：Module Federation 本质上是"运行时模块链接"。随着 WebAssembly Component Model 和 Import Maps 标准的演进，你认为 MF 的哪些能力会被浏览器原生替代，哪些仍需要运行时解决方案？


</div>
