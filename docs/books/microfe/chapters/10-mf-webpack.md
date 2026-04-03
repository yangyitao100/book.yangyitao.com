<div v-pre>

# 第10章 Webpack 5 Module Federation 源码

> "真正理解 Module Federation，不是学会写配置——是读懂那些配置背后，Webpack 在编译期和运行时各做了什么。"

> **本章要点**
> - 深入 ContainerPlugin 源码，理解远程模块如何被暴露为一个独立入口
> - 剖析 ContainerReferencePlugin 与 RemoteModule，理解消费端如何透明地加载远程模块
> - 解读 SharePlugin 与 ConsumeSharedPlugin 的版本协商机制，理解共享依赖如何在多个应用间去重
> - 完整追踪运行时加载流程：从 remoteEntry.js 的加载到模块工厂的实例化
> - 理解 Chunk 分割与依赖去重如何在 Module Federation 架构下协同工作

---

如果你曾经配置过 Module Federation，你一定写过这样的代码：

```javascript
// webpack.config.js - 远程应用
new ModuleFederationPlugin({
  name: 'remoteApp',
  filename: 'remoteEntry.js',
  exposes: {
    './Button': './src/components/Button',
  },
  shared: ['react', 'react-dom'],
});
```

然后在宿主应用里：

```javascript
// webpack.config.js - 宿主应用
new ModuleFederationPlugin({
  name: 'hostApp',
  remotes: {
    remoteApp: 'remoteApp@http://localhost:3001/remoteEntry.js',
  },
  shared: ['react', 'react-dom'],
});
```

配置不难。五分钟能跑通 Demo。但当你遇到以下问题时——

- 为什么 `remoteEntry.js` 里有一个 `init` 和一个 `get` 方法？它们分别做了什么？
- 共享依赖的版本协商到底是编译时决定的，还是运行时决定的？
- 当两个远程应用都暴露了 `react@18.2.0`，运行时如何决定用哪个？
- Chunk 分割和 Module Federation 如何协作？为什么有时候加载一个远程组件会触发多个网络请求？

——你会发现，仅靠配置层面的理解远远不够。

这一章，我们将打开 Webpack 5 的 `lib/container/` 目录，一行一行地追踪 Module Federation 从编译到运行的完整链路。你会看到四个核心插件如何分工协作，以及运行时那段精妙的异步加载逻辑是如何被编译器"种"进最终产物的。

## 10.1 ContainerPlugin：如何将模块暴露为远程入口

### 10.1.1 ModuleFederationPlugin 的分解

Module Federation 的用户入口是 `ModuleFederationPlugin`，但它本身几乎不做任何实质工作——它只是一个"编排者"，将配置分发给三个底层插件：

```typescript
// webpack/lib/container/ModuleFederationPlugin.js（简化）
class ModuleFederationPlugin {
  apply(compiler) {
    const { name, filename, exposes, remotes, shared } = this._options;

    // 1. 如果有 exposes —— 注册 ContainerPlugin
    if (exposes && Object.keys(exposes).length > 0) {
      new ContainerPlugin({
        name,
        filename,
        exposes,
        shareScope: this._options.shareScope || 'default',
      }).apply(compiler);
    }

    // 2. 如果有 remotes —— 注册 ContainerReferencePlugin
    if (remotes && Object.keys(remotes).length > 0) {
      new ContainerReferencePlugin({
        remoteType: this._options.remoteType || 'script',
        remotes,
        shareScope: this._options.shareScope || 'default',
      }).apply(compiler);
    }

    // 3. 如果有 shared —— 注册 SharePlugin
    if (shared) {
      new SharePlugin({
        shared,
        shareScope: this._options.shareScope || 'default',
      }).apply(compiler);
    }
  }
}
```

这个分解设计意味着：**一个应用可以同时是提供者和消费者**。你可以暴露模块给别人，同时消费别人暴露的模块。三个插件各自独立运作，通过 `shareScope` 这个命名空间在运行时汇合。

### 10.1.2 ContainerPlugin 的核心逻辑

`ContainerPlugin` 的职责很明确：为当前构建生成一个"容器入口"（即 `remoteEntry.js`），让外部消费者可以通过这个入口获取被暴露的模块。

```typescript
// webpack/lib/container/ContainerPlugin.js（核心流程）
class ContainerPlugin {
  apply(compiler) {
    const { name, exposes, shareScope, filename } = this._options;

    compiler.hooks.make.tapAsync(
      'ContainerPlugin',
      (compilation, callback) => {
        const dep = new ContainerEntryDependency(name, exposes, shareScope);

        // 设置入口的 loc 信息，用于调试和错误追踪
        dep.loc = { name };

        compilation.addEntry(
          compilation.options.context,
          dep,
          {
            name,
            filename,          // 通常是 'remoteEntry.js'
            library: {
              type: 'var',     // 挂载到全局变量
              name,
            },
          },
          (error) => {
            if (error) return callback(error);
            callback();
          }
        );
      }
    );

    // 注册 ContainerEntryDependency 的模块工厂
    compiler.hooks.thisCompilation.tap(
      'ContainerPlugin',
      (compilation, { normalModuleFactory }) => {
        compilation.dependencyFactories.set(
          ContainerEntryDependency,
          new ContainerEntryModuleFactory()
        );

        compilation.dependencyFactories.set(
          ContainerExposedDependency,
          normalModuleFactory
        );
      }
    );
  }
}
```

这段代码做了两件关键的事：

1. **在 `make` 钩子中添加一个新入口**。这意味着 `remoteEntry.js` 和你的主 `bundle.js` 是**平行的两个入口**——它们共享同一个编译过程，但生成独立的 Chunk。
2. **注册依赖工厂**。`ContainerEntryDependency` 用自定义的 `ContainerEntryModuleFactory` 来处理，而暴露出去的模块用标准的 `normalModuleFactory`（因为它们就是普通模块，只是被"标记"为可暴露的）。

> 💡 **深度洞察**：为什么 ContainerPlugin 选择在 `make` 钩子中添加入口，而不是直接修改 `entry` 配置？因为 `entry` 配置在 Webpack 启动时就已经被处理完毕，`make` 阶段是编译开始后的第一个可以动态添加入口的时机。这也是很多 Webpack 插件动态注入模块的标准模式。

### 10.1.3 ContainerEntryModule：容器的核心模块

`ContainerEntryModule` 是 Module Federation 架构中最精妙的部分之一。它负责生成 `remoteEntry.js` 的核心代码——包括 `init` 方法和 `get` 方法。

```typescript
// webpack/lib/container/ContainerEntryModule.js（简化）
class ContainerEntryModule extends Module {
  constructor(name, exposes, shareScope) {
    super('javascript/dynamic', null);
    this._name = name;
    this._exposes = exposes;
    this._shareScope = shareScope;
  }

  // 构建阶段：声明该模块依赖哪些暴露的模块
  build(options, compilation, resolver, fs, callback) {
    this.buildInfo = {};
    this.buildMeta = {};
    this.dependencies = [];

    // 为每个暴露的模块创建一个依赖
    for (const [name, options] of this._exposes) {
      const dep = new ContainerExposedDependency(name, options.import[0]);
      dep.name = name;
      this.dependencies.push(dep);
    }

    callback();
  }

  // 代码生成阶段：生成容器入口的运行时代码
  codeGeneration({ moduleGraph, chunkGraph, runtimeTemplate }) {
    const sources = new Map();
    const runtimeRequirements = new Set();

    // 收集所有暴露模块的映射关系
    const getters = [];
    for (const block of this.blocks) {
      const dep = block.dependencies[0];
      const module = moduleGraph.getModule(dep);
      const moduleId = chunkGraph.getModuleId(module);

      getters.push(
        `${JSON.stringify(dep.exposedName)}: () => {
          return __webpack_require__.e(${JSON.stringify(
            chunkGraph.getBlockChunkGroup(block).chunks[0].id
          )}).then(() => () => __webpack_require__(${JSON.stringify(moduleId)}));
        }`
      );
    }

    // 生成容器模块的源代码
    const source = new ConcatSource();
    source.add(`
      var moduleMap = {
        ${getters.join(',\n')}
      };
      var get = (module, getScope) => {
        __webpack_require__.R = getScope;
        getScope = (
          __webpack_require__.o(moduleMap, module)
            ? moduleMap[module]()
            : Promise.resolve().then(() => {
                throw new Error('Module "' + module + '" does not exist in container.');
              })
        );
        __webpack_require__.R = undefined;
        return getScope;
      };
      var init = (shareScope, initScope) => {
        if (!__webpack_require__.S) return;
        var name = ${JSON.stringify(this._shareScope)};
        var oldScope = __webpack_require__.S[name];
        if (oldScope && oldScope !== shareScope) {
          throw new Error(
            'Container initialization failed: share scope "' + name + '" already initialized'
          );
        }
        __webpack_require__.S[name] = shareScope;
        return __webpack_require__.I(name, initScope);
      };
    `);

    // 导出 get 和 init
    source.add(
      `\n__webpack_require__.d(exports, {
        get: () => get,
        init: () => init,
      });\n`
    );

    sources.set('javascript', source);
    return { sources, runtimeRequirements };
  }
}
```

这段代码生成器揭示了 `remoteEntry.js` 的核心结构：

1. **`moduleMap`**：一个从模块名到异步加载函数的映射表。每个暴露的模块并不内联在 `remoteEntry.js` 中，而是通过 `__webpack_require__.e`（加载 Chunk）延迟加载。
2. **`get(module)`**：消费者调用这个方法来获取指定的暴露模块。它返回一个 Promise，解析后得到模块工厂。
3. **`init(shareScope)`**：消费者在调用 `get` 之前必须先调用 `init`，传入共享作用域。这就是版本协商发生的时机。

```javascript
// remoteEntry.js 最终产出的代码结构（简化）
var remoteApp;
remoteApp = (() => {
  // ... webpack runtime ...
  var moduleMap = {
    './Button': () => {
      return __webpack_require__
        .e('src_components_Button_tsx')
        .then(() => () => __webpack_require__('./src/components/Button.tsx'));
    },
  };

  var get = (module, getScope) => { /* ... */ };
  var init = (shareScope, initScope) => { /* ... */ };

  return { get, init };
})();
```

> 💡 **深度洞察**：`remoteEntry.js` 故意设计得很小。它只包含模块映射表和两个方法，不包含任何实际的业务代码。真正的业务代码被分割到独立的 Chunk 中，按需加载。这意味着即使一个远程应用暴露了 50 个模块，宿主应用加载 `remoteEntry.js` 的成本也极低——只有当真正使用某个模块时，对应的 Chunk 才会被下载。

### 10.1.4 异步边界与 Chunk 的关系

一个容易被忽视的细节是：每个暴露的模块都会被放入一个**异步 Chunk**。在 `ContainerEntryModule` 的 `build` 阶段，Webpack 会为每个暴露模块创建一个 `AsyncDependenciesBlock`：

```typescript
// ContainerEntryModule.js 中的异步块创建
build(options, compilation, resolver, fs, callback) {
  // ...
  for (const [name, options] of this._exposes) {
    const block = new AsyncDependenciesBlock(undefined, name);
    const dep = new ContainerExposedDependency(name, options.import[0]);
    dep.name = name;
    block.addDependency(dep);
    this.addBlock(block);
  }
  callback();
}
```

`AsyncDependenciesBlock` 是 Webpack 代码分割的核心原语——每一个 `import()` 动态导入语句最终都会被转换为一个 `AsyncDependenciesBlock`。Module Federation 复用了这个机制，让暴露模块天然支持按需加载。

## 10.2 ContainerReferencePlugin：如何消费远程模块

### 10.2.1 远程引用的解析

当你在宿主应用的代码中写下：

```javascript
import Button from 'remoteApp/Button';
```

Webpack 需要把这个看似普通的 import 语句识别为"远程模块引用"，而不是尝试从 `node_modules` 中寻找。这正是 `ContainerReferencePlugin` 的职责。

```typescript
// webpack/lib/container/ContainerReferencePlugin.js（核心流程）
class ContainerReferencePlugin {
  apply(compiler) {
    const { remotes, remoteType } = this._options;

    // 将 remotes 配置转换为内部格式
    // 'remoteApp@http://localhost:3001/remoteEntry.js'
    // => { external: ['remoteApp@http://...'], shareScope: 'default' }
    const remoteMap = {};
    for (const [key, config] of Object.entries(remotes)) {
      remoteMap[key] = {
        external: Array.isArray(config) ? config : [config],
        shareScope: this._options.shareScope || 'default',
      };
    }

    compiler.hooks.compilation.tap(
      'ContainerReferencePlugin',
      (compilation, { normalModuleFactory }) => {
        // 拦截模块解析：当遇到匹配 remote 前缀的请求时，
        // 用 RemoteModule 替代正常的模块解析
        normalModuleFactory.hooks.factorize.tap(
          'ContainerReferencePlugin',
          (data) => {
            if (!data.request) return;

            // 检查请求是否匹配任何 remote 前缀
            for (const [key, config] of Object.entries(remoteMap)) {
              if (
                data.request.startsWith(key) &&
                (data.request.length === key.length ||
                  data.request.charCodeAt(key.length) === '/'.charCodeAt(0))
              ) {
                return new RemoteModule(
                  data.request,
                  config.external,
                  `.${data.request.slice(key.length)}` || '.',
                  config.shareScope
                );
              }
            }
          }
        );
      }
    );
  }
}
```

这里发生了一个巧妙的"劫持"：`normalModuleFactory` 的 `factorize` 钩子是 Webpack 解析模块路径的核心环节。当请求路径（例如 `remoteApp/Button`）的前缀匹配了 `remotes` 配置中的某个 key，`ContainerReferencePlugin` 会直接返回一个 `RemoteModule` 实例——**跳过整个正常的模块解析流程**。

这意味着 Webpack 不会尝试在文件系统中查找 `remoteApp/Button` 这个路径，而是创建一个特殊的"占位模块"，记录下远程加载所需的元信息。

### 10.2.2 RemoteModule：运行时加载的蓝图

`RemoteModule` 不包含任何实际代码。它是一个"蓝图"，在代码生成阶段会被翻译为运行时的远程加载逻辑：

```typescript
// webpack/lib/container/RemoteModule.js（简化）
class RemoteModule extends Module {
  constructor(request, externalRequests, internalRequest, shareScope) {
    super('remote-module');
    this.request = request;              // 'remoteApp/Button'
    this.externalRequests = externalRequests; // ['remoteApp@http://...']
    this.internalRequest = internalRequest;  // './Button'
    this.shareScope = shareScope;            // 'default'
  }

  // 标记该模块为外部依赖
  getSourceTypes() {
    return new Set(['remote']);
  }

  // 该模块的大小（用于优化决策）
  size() {
    return 6; // 很小，因为它只是一个引用
  }

  // 代码生成
  codeGeneration({ runtimeTemplate, moduleGraph, chunkGraph }) {
    const sources = new Map();
    const runtimeRequirements = new Set([
      RuntimeGlobals.module,
    ]);

    // 生成的代码本质上是：
    // module.exports = __webpack_require__.federation.get(remoteName, moduleName)
    sources.set(
      'remote',
      new RawSource(
        `module.exports = __webpack_require__.m[${JSON.stringify(
          this.request
        )}]`
      )
    );

    return { sources, runtimeRequirements };
  }

  // 序列化/反序列化支持（用于持久化缓存）
  serialize(context) {
    context.write(this.request);
    context.write(this.externalRequests);
    context.write(this.internalRequest);
    context.write(this.shareScope);
    super.serialize(context);
  }
}
```

`RemoteModule` 在模块图中的角色非常独特：它在编译期占据了一个位置，确保 Webpack 的依赖分析能正确处理远程引用；但它的实际内容在运行时才会被填充。

### 10.2.3 FallbackModule 与容错机制

在生产环境中，远程服务可能宕机。Module Federation 通过 `FallbackModule` 提供了多地址容错——在编译时生成一段带有 try-catch 的运行时代码，依次尝试主地址和备用地址：

```javascript
// FallbackModule 生成的运行时代码结构（简化）
var remotes = [
  () => loadScript('http://cdn.example.com/remoteEntry.js'),
  () => loadScript('http://backup.example.com/remoteEntry.js'),
];

var loadRemote = async () => {
  for (const remote of remotes) {
    try { return await remote(); }
    catch (e) { console.warn('Remote loading failed, trying fallback...', e); }
  }
  throw new Error('All remotes failed to load');
};
```

> 💡 **深度洞察**：fallback 机制是在编译期"编织"进运行时代码的，而不是一个运行时的配置选项。这体现了 Module Federation 的设计哲学——尽可能多的决策在编译期完成，运行时只负责执行。这与 qiankun 等运行时方案形成鲜明对比。

## 10.3 SharePlugin：共享依赖的版本协商机制

### 10.3.1 为什么需要共享依赖

没有共享机制的 Module Federation 是不可用的。想象这样的场景：

- 宿主应用使用 `react@18.2.0`
- 远程应用 A 使用 `react@18.2.0`
- 远程应用 B 使用 `react@18.3.1`

如果每个应用都打包自己的 React，用户将下载三份 React——总共约 400KB（压缩后）。更严重的是，React 的多实例会导致 Context、Hooks 等功能彻底失效。

`SharePlugin` 解决的就是这个问题：让多个独立构建的应用在运行时共享同一份依赖。

### 10.3.2 SharePlugin 的双面拆分

`SharePlugin` 本身也是一个编排者。它将配置拆分为两个子插件：

```typescript
// webpack/lib/sharing/SharePlugin.js（简化）
class SharePlugin {
  apply(compiler) {
    // 1. ProvideSharedPlugin —— 当前构建"提供"哪些共享模块
    new ProvideSharedPlugin({
      provides: this._resolvedProvides,
      shareScope: this._options.shareScope,
    }).apply(compiler);

    // 2. ConsumeSharedPlugin —— 当前构建"消费"哪些共享模块
    new ConsumeSharedPlugin({
      consumes: this._resolvedConsumes,
      shareScope: this._options.shareScope,
    }).apply(compiler);
  }
}
```

每个参与 Module Federation 的应用都**同时是提供者和消费者**。当你配置 `shared: ['react']` 时：

- `ProvideSharedPlugin` 确保当前构建的 React 被注册到共享作用域
- `ConsumeSharedPlugin` 确保当前构建在使用 React 时，优先从共享作用域获取

### 10.3.3 ConsumeSharedPlugin 的版本协商

版本协商是 Module Federation 最复杂的运行时逻辑之一。让我们看看 `ConsumeSharedPlugin` 是如何实现的：

```typescript
// webpack/lib/sharing/ConsumeSharedPlugin.js（核心逻辑简化）
class ConsumeSharedPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap(
      'ConsumeSharedPlugin',
      (compilation, { normalModuleFactory }) => {
        // 拦截模块解析：当遇到共享模块的请求时，
        // 用 ConsumeSharedModule 替代
        compilation.hooks.factorize.tap(
          'ConsumeSharedPlugin',
          (data) => {
            for (const [key, config] of this._consumes) {
              if (data.request === key || data.request.startsWith(key + '/')) {
                return new ConsumeSharedModule(
                  compilation.options.context,
                  {
                    shareKey: config.shareKey || key,
                    shareScope: config.shareScope || 'default',
                    requiredVersion: config.requiredVersion,
                    strictVersion: config.strictVersion || false,
                    singleton: config.singleton || false,
                    eager: config.eager || false,
                  }
                );
              }
            }
          }
        );
      }
    );
  }
}
```

`ConsumeSharedModule` 在代码生成阶段，会注入一段运行时版本选择逻辑。其核心伪代码如下：

```javascript
// ConsumeSharedModule 生成的运行时代码（简化）
var scope = __webpack_require__.S['default'];
var versions = scope['react'];

if (singleton) {
  // 单例模式：直接取第一个可用版本
  var entry = Object.values(versions)[0];
  if (strictVersion && !satisfies(entry.version, requiredVersion)) {
    throw new Error('Unsatisfied version ' + entry.version);
  }
  module.exports = entry.get();
} else {
  // 非单例模式：遍历所有版本，选择满足 semver 范围的最高版本
  var bestVersion = findSatisfyingVersion(versions, requiredVersion);
  if (bestVersion) {
    module.exports = versions[bestVersion].get();
  } else {
    // fallback：使用本地打包的版本
    module.exports = __webpack_require__(fallbackModuleId);
  }
}
```

版本协商的核心规则：

| 配置项 | 含义 | 运行时行为 |
|--------|------|-----------|
| `singleton: true` | 全局只允许一个版本 | 所有消费者使用同一个实例 |
| `strictVersion: true` | 严格版本匹配 | 版本不满足时抛出错误而非 warning |
| `requiredVersion: '^18.0.0'` | semver 范围约束 | 选择满足范围的最高版本 |
| `eager: true` | 不延迟加载 | 共享模块内联到入口 Chunk |

### 10.3.4 共享作用域的数据结构

运行时的共享作用域 `__webpack_require__.S` 的数据结构是理解版本协商的关键：

```javascript
// __webpack_require__.S 的运行时结构
__webpack_require__.S = {
  default: {                       // shareScope 名称
    react: {                       // shareKey
      '18.2.0': {                  // 版本号
        get: () => Promise.resolve().then(() => () => __webpack_require__('react')),
        loaded: false, from: 'hostApp', eager: false,
      },
      '18.3.1': {
        get: () => loadScript('remoteB/chunk-react.js').then(() => () => __webpack_require__('react')),
        loaded: false, from: 'remoteAppB', eager: false,
      },
    },
    'react-dom': {
      '18.2.0': { get: () => /* ... */, loaded: false, from: 'hostApp', eager: false },
    },
  },
};
```

当容器的 `init(shareScope)` 被调用时，它将自己提供的共享模块注册到这个结构中。多个容器调用 `init` 后，共享作用域中就积累了来自不同应用的、不同版本的模块。消费时，版本协商算法从中选择最合适的版本。

> 💡 **深度洞察**：`singleton: true` 是 React、ReactDOM 等库的必选配置。因为 React 使用内部的全局状态（如 `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`）来管理 Hooks 的调度器，如果存在两个 React 实例，Hooks 的调用顺序会混乱，导致 "Invalid hook call" 错误。Module Federation 的 `singleton` 选项本质上是对这类"有状态单例库"的架构级保护。

### 10.3.5 ProvideSharedPlugin 的注册机制

`ProvideSharedPlugin` 的工作相对简单——它在编译时将当前构建中的共享模块包装为 `ProvideSharedModule`，并在运行时的 `__webpack_require__.I`（initSharing）函数中完成注册：

`ProvideSharedPlugin` 在编译阶段通过 `afterResolve` 钩子拦截匹配的模块，将原始模块包装为 `ProvideSharedModule`。这个包装模块携带了 `shareScope`、`shareKey`、`version`、`eager` 等元信息。其中 `version` 是在编译时从 `package.json` 中读取的——这意味着**版本信息被"烘焙"到构建产物中**，而非运行时动态解析。

```javascript
// ProvideSharedModule 生成的运行时注册代码
__webpack_require__.I = (name, initScope) => {
  if (!initScope) initScope = [];
  // 防止循环初始化
  var initToken = '__webpack_require__.I(' + name + ')';
  if (initScope.indexOf(initToken) >= 0) return;
  initScope.push(initToken);

  var scope = __webpack_require__.S[name];
  if (!scope) scope = __webpack_require__.S[name] = {};

  // 注册当前构建提供的共享模块
  var register = (name, version, factory, eager) => {
    var versions = scope[name] = scope[name] || {};
    var activeVersion = versions[version];
    if (
      !activeVersion ||
      // 当版本相同时，后注册的覆盖先注册的
      // 但 eager 模块优先级更高
      (!activeVersion.loaded && (!eager !== !activeVersion.eager ? eager : false))
    ) {
      versions[version] = { get: factory, loaded: false, eager };
    }
  };

  // 注册 react@18.2.0
  register('react', '18.2.0', () =>
    __webpack_require__.e('vendors-react').then(
      () => () => __webpack_require__('../../node_modules/react/index.js')
    )
  );

  // 注册 react-dom@18.2.0
  register('react-dom', '18.2.0', () =>
    __webpack_require__.e('vendors-react-dom').then(
      () => () => __webpack_require__('../../node_modules/react-dom/index.js')
    )
  );
};
```

## 10.4 运行时加载流程：从 remoteEntry.js 到模块实例化

### 10.4.1 完整加载序列图

当宿主应用执行 `import Button from 'remoteApp/Button'` 时，运行时会经历以下完整流程：

```
宿主应用代码
    |
    v
__webpack_require__(RemoteModule_id)
    |
    v
__webpack_require__.e('remoteApp/Button')  // 加载远程 Chunk
    |
    +---> __webpack_require__.f.remotes('remoteApp/Button')
    |         |
    |         v
    |     __webpack_require__.l('http://.../remoteEntry.js')  // 加载远程入口
    |         |
    |         v
    |     window.remoteApp  // 全局变量挂载
    |         |
    |         v
    |     remoteApp.init(__webpack_require__.S['default'])  // 初始化共享作用域
    |         |
    |         v
    |     remoteApp.get('./Button')  // 获取模块工厂
    |         |
    |         v
    |     __webpack_require__.e('src_components_Button_tsx')  // 加载模块 Chunk
    |         |
    |         v
    |     moduleFactory()  // 执行模块工厂
    |
    v
Button 组件可用
```

### 10.4.2 __webpack_require__.f.remotes 运行时钩子

`__webpack_require__.f` 是 Webpack 5 的 Chunk 加载拦截器注册表。Module Federation 在其中注册了 `remotes` 处理器：

```javascript
// Webpack 生成的运行时代码（简化）

// Chunk 加载的核心入口
__webpack_require__.e = (chunkId) => {
  return Promise.all(
    Object.keys(__webpack_require__.f).reduce((promises, key) => {
      __webpack_require__.f[key](chunkId, promises);
      return promises;
    }, [])
  );
};

// remotes 处理器
__webpack_require__.f.remotes = (chunkId, promises) => {
  // chunkMapping 记录了哪些 Chunk 包含远程模块
  var chunkMapping = {
    'src_App_tsx': ['webpack/container/remote/remoteApp/Button'],
  };

  // idToExternalAndNameMapping 记录了远程模块的加载元信息
  var idToExternalAndNameMapping = {
    'webpack/container/remote/remoteApp/Button': [
      'default',                                          // shareScope
      'remoteApp',                                        // 远程容器名
      'remoteApp@http://localhost:3001/remoteEntry.js',   // 外部引用
      './Button',                                         // 内部模块名
    ],
  };

  var remoteModules = chunkMapping[chunkId];
  if (!remoteModules) return;

  remoteModules.forEach((id) => {
    var data = idToExternalAndNameMapping[id];
    var shareScope = data[0];
    var name = data[1];
    var externalUrl = data[2];
    var moduleName = data[3];

    var promise = (async () => {
      // 1. 加载远程入口脚本
      await __webpack_require__.l(externalUrl);

      // 2. 获取远程容器
      var container = window[name];
      if (!container) {
        throw new Error('Container ' + name + ' is not available');
      }

      // 3. 初始化共享作用域
      __webpack_require__.S[shareScope] = __webpack_require__.S[shareScope] || {};
      await container.init(__webpack_require__.S[shareScope]);

      // 4. 获取模块工厂
      var factory = await container.get(moduleName);

      // 5. 注册到模块注册表
      __webpack_require__.m[id] = (module, exports) => {
        module.exports = factory();
      };
    })();

    promises.push(promise);
  });
};
```

这段运行时代码是 Module Federation 的"心脏"。让我们逐步分析每个阶段：

**阶段一：`__webpack_require__.l` 加载远程入口**

```javascript
// __webpack_require__.l —— 脚本加载器（简化）
__webpack_require__.l = (url, done, key, chunkId) => {
  if (installedScripts[url]) { done(); return; }

  var script = document.createElement('script');
  script.src = url;
  script.timeout = 120;

  var onComplete = (event) => {
    script.onerror = script.onload = null;
    clearTimeout(timeout);
    event.type === 'load' ? (installedScripts[url] = true, done()) : done(new Error('Loading failed: ' + url));
  };

  var timeout = setTimeout(() => onComplete({ type: 'timeout' }), 120000);
  script.onerror = script.onload = onComplete;
  document.head.appendChild(script);
};
```

**阶段二：`container.init` 初始化共享**

`init` 调用是双向的——宿主应用将自己的共享作用域传递给远程容器，远程容器将自己提供的共享模块注册到同一个作用域中。这就像一次"握手"——双方交换可用的共享资源。

时序上：宿主应用启动时先通过 `__webpack_require__.I('default')` 注册自己的 `react@18.2.0`，远程入口加载后调用 `container.init(shareScope)` 注册远程版本。此时 `shareScope.react` 中有来自多个应用的版本条目，消费时由版本协商算法选择最优版本。

**阶段三：`container.get` 获取模块**

`get` 方法返回一个 Promise，解析后得到的是一个**模块工厂函数**（而非模块本身）。这个工厂函数被注册到 `__webpack_require__.m` 中，当其他代码通过 `__webpack_require__(id)` 请求该模块时，工厂函数被执行，返回模块的 exports。

```javascript
// 工厂注册的关键行
__webpack_require__.m[id] = (module, exports) => {
  module.exports = factory();
};

// 之后任何地方的 require 都能获得远程模块
var Button = __webpack_require__('webpack/container/remote/remoteApp/Button');
// => 实际执行 factory()，返回远程 Button 组件
```

### 10.4.3 异步启动与 eager 配置

Module Federation 有一个常见的"陷阱"：如果宿主应用的入口是同步的，共享模块的异步加载会导致运行时错误：

```javascript
// 错误示例：同步入口
// index.js
import React from 'react';        // 此时共享的 React 可能还没加载完
import App from './App';
ReactDOM.render(<App />, root);
```

解决方案是使用异步边界：

```javascript
// 正确示例：异步入口
// index.js
import('./bootstrap');

// bootstrap.js
import React from 'react';
import App from './App';
ReactDOM.render(<App />, root);
```

这个 `import('./bootstrap')` 创建了一个异步边界。Webpack 会在执行 `bootstrap.js` 之前，先加载所有必要的共享模块 Chunk。这背后的机制是 `__webpack_require__.e` 的 Promise 链——所有 `__webpack_require__.f` 中注册的处理器（包括 `remotes` 和 `consumes`）都会在 Chunk 加载时被触发。

如果确实需要同步加载共享模块，可以使用 `eager: true`：

```javascript
// webpack.config.js
new ModuleFederationPlugin({
  shared: {
    react: {
      singleton: true,
      eager: true,  // 将 react 内联到入口 Chunk
    },
  },
});
```

`eager: true` 的效果是：`ProvideSharedModule` 不再将共享模块放入独立的异步 Chunk，而是将其内联到入口 Chunk 中。代价是入口文件体积增大，但避免了异步加载的时序问题。

```javascript
// eager: false（默认）生成的代码
register('react', '18.2.0', () =>
  __webpack_require__.e('vendors-react').then(    // 异步加载
    () => () => __webpack_require__('react')
  )
);

// eager: true 生成的代码
register('react', '18.2.0', () =>
  () => __webpack_require__('react')               // 同步访问
);
```

> 💡 **深度洞察**：异步边界不仅仅是 Module Federation 的技术要求——它还是一个架构最佳实践。通过将应用的启动代码放在异步边界之后，你获得了一个天然的"预加载时机"：在执行任何业务代码之前，所有共享依赖、远程入口都已经就绪。这消除了一整类运行时的竞态条件。

### 10.4.4 __webpack_require__.f.consumes 与共享模块加载

除了 `remotes` 处理器，`__webpack_require__.f` 中还有一个 `consumes` 处理器，专门负责共享模块的运行时解析：

```javascript
// Webpack 生成的运行时代码（简化）
__webpack_require__.f.consumes = (chunkId, promises) => {
  var chunkMapping = {
    'bootstrap': ['webpack/sharing/consume/default/react'],
  };

  var moduleToHandlerMapping = {
    'webpack/sharing/consume/default/react': {
      getter: () => {
        // 从共享作用域获取 react
        var scope = __webpack_require__.S['default'];
        var entry = findSatisfyingVersion(scope['react'], '^18.0.0');
        if (entry) return entry.get();

        // fallback: 使用本地版本
        return __webpack_require__.e('vendors-react').then(
          () => () => __webpack_require__('react')
        );
      },
      shareInfo: {
        shareKey: 'react',
        shareScope: 'default',
        requiredVersion: '^18.0.0',
        singleton: true,
        strictVersion: false,
      },
    },
  };

  var moduleIds = chunkMapping[chunkId];
  if (!moduleIds) return;

  moduleIds.forEach((id) => {
    var handler = moduleToHandlerMapping[id];
    if (!handler) return;

    var promise = handler.getter().then((factory) => {
      __webpack_require__.m[id] = (module) => {
        module.exports = factory();
      };
    });

    promises.push(promise);
  });
};
```

这段代码的关键逻辑：

1. 根据 `chunkId` 查找该 Chunk 中需要哪些共享模块
2. 对每个共享模块，尝试从共享作用域中找到满足版本要求的模块
3. 如果找到了，使用共享版本；如果没找到，回退到本地打包的版本
4. 将获取到的模块工厂注册到 `__webpack_require__.m` 中

这意味着**共享模块的版本选择发生在 Chunk 加载时，而非模块执行时**。这是一个重要的时序细节——当你的业务代码执行 `require('react')` 时，该用哪个版本已经在 Chunk 加载阶段确定了。

## 10.5 Chunk 分割与依赖去重的协作

### 10.5.1 Module Federation 对 Chunk 图的影响

Module Federation 改变了 Webpack 的 Chunk 图结构。在没有 Module Federation 的标准构建中，所有 Chunk 来自同一个编译过程，它们之间的依赖关系是确定的。但在 Module Federation 下，Chunk 图跨越了多个独立构建：

```
宿主应用的 Chunk 图
├── main.js (entry)
├── src_App_tsx.js (async)
└── vendors-lodash.js (split)

远程应用的 Chunk 图
├── main.js (entry, 远程应用自己的页面)
├── remoteEntry.js (container entry)
├── src_components_Button_tsx.js (exposed, async)
├── src_components_Form_tsx.js (exposed, async)
└── vendors-antd.js (split, 被 Button 和 Form 共享)

运行时的跨构建 Chunk 加载
宿主 main.js
    → 加载 remoteEntry.js
    → 请求 './Button'
    → remoteEntry 内部加载 src_components_Button_tsx.js
    → 如果 Button 依赖 antd，还需加载 vendors-antd.js
```

### 10.5.2 共享模块与 splitChunks 的交互

当一个模块同时被标记为"共享"和被 `splitChunks` 规则命中时，会发生什么？

```javascript
// webpack.config.js
module.exports = {
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendors: {
          test: /node_modules/,
          name: 'vendors',
        },
      },
    },
  },
  plugins: [
    new ModuleFederationPlugin({
      shared: { react: { singleton: true } },
    }),
  ],
};
```

Webpack 的处理优先级是：**Module Federation 的共享声明优先于 splitChunks**。

具体来说，`ConsumeSharedPlugin` 在模块解析阶段就将 `react` 替换为 `ConsumeSharedModule`。这个 `ConsumeSharedModule` 不是一个真正的模块（它不对应文件系统上的文件），因此 `splitChunks` 的 `test: /node_modules/` 规则不会命中它。

但被 `ProvideSharedPlugin` 包装的模块仍然会被 `splitChunks` 影响：

Webpack 内部通过 `ChunkGroup` 的依赖关系来协调两者——`ProvideSharedModule` 创建的专用 async Chunk 不会被 `splitChunks` 再次合并，因为它们已经有明确的异步加载语义。

### 10.5.3 依赖去重的编译时与运行时

Module Federation 的依赖去重发生在**两个层面**：

**编译时去重**：`ConsumeSharedPlugin` 将对共享模块的直接引用替换为运行时查找。这意味着共享模块不会被重复打包到消费者的 bundle 中（除非作为 fallback）。

```javascript
// 编译前
import React from 'react';
// 编译后（概念性）
var React = __webpack_require__('webpack/sharing/consume/default/react');
// 实际获取的是共享作用域中的 React，而非本地打包的
```

**运行时去重**：当多个应用注册了同一个共享模块的同一个版本时，运行时只会加载其中一个。后注册的不会覆盖先注册的（除非 `eager` 配置不同）。

```javascript
// 运行时去重示意
// 宿主注册: scope.react['18.2.0'] = { get: hostFactory, from: 'host' }
// 远程A注册: scope.react['18.2.0'] 已存在，跳过
// 远程B注册: scope.react['18.3.1'] = { get: remoteBFactory, from: 'remoteB' }

// 最终 scope.react 只有两个版本条目，而非三个
// 消费者选择 18.3.1（满足 ^18.0.0 的最高版本）
```

### 10.5.4 动态远程加载的高级模式

在标准配置中，远程地址是硬编码在构建产物中的。但生产环境经常需要动态决定远程地址——例如根据环境变量、用户配置或 A/B 测试需求：

```javascript
// 动态远程加载
// webpack.config.js
new ModuleFederationPlugin({
  remotes: {
    remoteApp: `promise new Promise((resolve) => {
      const remoteUrl = window.__REMOTE_URL__ || 'http://localhost:3001/remoteEntry.js';
      const script = document.createElement('script');
      script.src = remoteUrl;
      script.onload = () => {
        resolve({
          get: (request) => window.remoteApp.get(request),
          init: (arg) => {
            try {
              return window.remoteApp.init(arg);
            } catch(e) {
              console.log('Remote already initialized');
            }
          }
        });
      };
      document.head.appendChild(script);
    })`,
  },
});
```

这种 `promise new Promise(...)` 语法利用了 Webpack 的外部模块类型系统——`promise` 类型告诉 Webpack 这个"外部模块"是一个 Promise，需要异步解析。编译后的代码会等待这个 Promise resolve，然后将结果作为容器使用。

从源码角度看，这个 Promise 字符串被 `ExternalModule` 处理——当 `externalType` 为 `'promise'` 时，代码生成器直接将 Promise 表达式作为模块导出：`module.exports = new Promise(...)`。Webpack 的模块系统会等待这个 Promise resolve，再将结果当作标准的容器对象使用。

### 10.5.5 性能优化：预加载与预取

Module Federation 与 Webpack 的 prefetch/preload 机制可以协同工作：

```javascript
// 在路由级别预加载远程模块
const routes = [
  {
    path: '/dashboard',
    component: React.lazy(() => import('remoteApp/Dashboard')),
  },
];

// Webpack magic comments 仍然有效
const Dashboard = React.lazy(() =>
  import(/* webpackPrefetch: true */ 'remoteApp/Dashboard')
);
```

但这里有一个微妙的问题：`webpackPrefetch` 只对 Chunk 级别的加载有效，而远程模块的加载涉及两层 Chunk——`remoteEntry.js` 和实际的模块 Chunk。Webpack 的 prefetch 只能处理第一层，第二层的 Chunk 需要等到 `remoteEntry.js` 加载并解析后才能知道。

更高级的优化策略是使用 Module Federation 2.0 引入的 `runtimePlugins`，它允许你在容器初始化后立即预触发高频模块的 Chunk 加载（如 `origin.get('./Dashboard')`），将串行的请求链变为并行。

> 💡 **深度洞察**：Module Federation 的性能瓶颈通常不在模块代码的大小（因为 Tree Shaking 和代码分割仍然有效），而在**网络请求的数量和瀑布流**。加载一个远程组件可能产生三次串行请求：`remoteEntry.js` → 共享依赖 Chunk → 模块 Chunk。优化的核心是减少请求链的深度——通过 `eager` 共享、预加载、以及合理的 Chunk 合并策略。

### 10.5.6 全链路总结

让我们用一张完整的表格总结 Module Federation 从编译到运行的全链路：

| 阶段 | 参与者 | 关键操作 |
|------|--------|---------|
| 编译：入口注册 | ContainerPlugin | 在 `make` 钩子添加 `remoteEntry.js` 入口 |
| 编译：模块替换 | ContainerReferencePlugin | 将 `remoteApp/X` 替换为 `RemoteModule` |
| 编译：共享标记 | ConsumeSharedPlugin | 将 `react` 等替换为 `ConsumeSharedModule` |
| 编译：共享注册 | ProvideSharedPlugin | 将本地 `react` 包装为 `ProvideSharedModule` |
| 编译：代码生成 | ContainerEntryModule | 生成 `moduleMap` + `get` + `init` |
| 编译：Chunk 分割 | SplitChunksPlugin | 与 ProvideSharedModule 协作分割 Chunk |
| 运行时：入口加载 | `__webpack_require__.l` | 通过 `<script>` 标签加载 `remoteEntry.js` |
| 运行时：共享初始化 | `container.init()` | 向共享作用域注册自身提供的共享模块 |
| 运行时：版本协商 | `__webpack_require__.f.consumes` | 从共享作用域选择最优版本 |
| 运行时：模块获取 | `container.get()` | 按需加载暴露模块的 Chunk 并返回工厂 |
| 运行时：模块实例化 | `__webpack_require__` | 执行工厂函数，得到最终的模块导出 |

最后，让我们总结 Module Federation 运行时各编译产物之间的关系：宿主应用的 `main.js` 通过 `__webpack_require__.f.remotes` 加载 `remoteEntry.js`，容器通过 `init(shareScope)` 完成共享依赖的双向注册，再通过 `get('./Button')` 触发模块 Chunk 的按需加载。所有共享依赖汇聚在全局单例 `__webpack_require__.S` 中，由 `__webpack_require__.f.consumes` 在 Chunk 加载时完成版本选择。整个流程是**编译时编排、运行时执行**的典范。

---

## 思考题

读完本章，试着回答以下问题来检验你的理解深度：

1. **`remoteEntry.js` 的体积与暴露模块的数量是什么关系？** 如果一个远程应用暴露了 100 个模块，`remoteEntry.js` 会变得很大吗？为什么？

2. **如果宿主应用配置了 `shared: { react: { singleton: true, requiredVersion: '^17.0.0' } }`，而远程应用提供了 `react@18.2.0`，运行时会发生什么？** `strictVersion` 的有无会改变结果吗？

3. **为什么 Module Federation 要求（或强烈建议）使用异步入口（`import('./bootstrap')`）？** 如果不用异步入口，共享模块的加载时序会出现什么问题？请从 `__webpack_require__.f.consumes` 的执行时机来分析。

4. **`eager: true` 和 `eager: false` 分别在什么场景下使用？** `eager: true` 虽然避免了异步加载问题，但它会带来什么副作用？

5. **假设你需要实现一个"运行时动态注册远程容器"的功能——在宿主应用运行时，根据后端配置动态加载一个编译时未知的远程应用。** 请基于本章的源码分析，描述你需要在运行时执行哪些步骤（提示：考虑 `__webpack_require__.l`、`container.init`、`container.get` 三个阶段）。

</div>
