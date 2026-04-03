<div v-pre>

# 第16章 微前端的 DevOps 与工程化

> "微前端的真正挑战不在拆分代码——在于让十个团队同时向生产环境交付，且互不干扰。"

> **本章要点**
> - 设计独立构建、独立部署的 CI/CD 管线，实现子应用从提交到上线的全自动化流水线
> - 理解语义化版本在微前端中的特殊挑战，掌握兼容性矩阵与版本协商机制
> - 构建跨应用的监控与可观测性体系，快速定位"到底是谁的子应用出了问题"
> - 在微前端架构下实现灰度发布与 A/B 测试，做到子应用级别的精细化流量控制

---

凌晨两点四十五分，你被一条告警惊醒。

生产环境的错误率在过去十分钟内飙升了 300%。你打开 Grafana 面板，看到订单子应用的 JS 报错量从每分钟 3 次跳到了每分钟 120 次。你的第一反应是回滚——但回滚哪个？主应用半小时前刚部署了一个导航栏优化，商品子应用两小时前推了一版新的详情页，而订单子应用本身三天没有发布过。

错误堆栈指向一个 `TypeError: Cannot read properties of undefined (reading 'formatPrice')`，发生在订单子应用调用共享组件库的 `@shared/utils` 包中。你翻看提交记录，发现商品子应用两小时前的部署附带升级了共享组件库的版本，将 `formatPrice` 的函数签名从 `formatPrice(value: number)` 改成了 `formatPrice(value: number, options?: FormatOptions)`——本身是向后兼容的改动。但问题在于，Module Federation 的运行时版本协商将订单子应用拉到了新版本的共享库，而这个新版本内部重构了模块导出结构，`formatPrice` 从默认导出变成了具名导出。

**三个子应用、三次独立部署、一个共享依赖、一次无意的破坏性变更**——这就是微前端 DevOps 的真实战场。

这一章，我们不谈理论模型。我们谈的是：如何设计一套工程化体系，让上面这种事故**不可能发生**——或者至少，当它发生时，你能在 30 秒内定位原因、60 秒内完成回滚。

## 16.1 独立构建 + 独立部署的 CI/CD 管线设计

微前端的核心承诺之一是**独立部署**。但"独立部署"远不是"每个子应用一个 Git 仓库、各跑各的 CI"这么简单。独立部署的真正挑战在于：如何在保证独立性的同时，维护全局一致性。

### 16.1.1 仓库策略：Monorepo vs Polyrepo

在设计 CI/CD 之前，必须先回答一个前置问题：代码怎么组织？

```
方案一：Polyrepo（多仓库）
├── repo: main-app          # 主应用
├── repo: order-app          # 订单子应用
├── repo: product-app        # 商品子应用
├── repo: user-app           # 用户子应用
└── repo: shared-libs        # 共享库

方案二：Monorepo（单仓库）
repo: micro-frontend-platform
├── apps/
│   ├── main/                # 主应用
│   ├── order/               # 订单子应用
│   ├── product/             # 商品子应用
│   └── user/                # 用户子应用
├── packages/
│   ├── shared-utils/        # 共享工具库
│   ├── shared-components/   # 共享组件库
│   └── shared-types/        # 共享类型定义
└── turbo.json / nx.json     # 构建编排
```

两种策略各有利弊，但在实践中，**Monorepo + 独立部署管线**正在成为微前端团队的主流选择，原因有三：

1. **原子性变更**：修改共享库和使用方可以在同一个 PR 中完成，CI 自动验证兼容性
2. **统一工具链**：ESLint、TypeScript、构建配置在顶层统一管理，避免各子应用配置漂移
3. **依赖可见性**：在 Monorepo 中，谁依赖了什么、哪个版本、有没有冲突——一目了然

关键在于：Monorepo 不等于 Monobuild。**代码在一起管理，但构建和部署是独立的。**

### 16.1.2 基于变更检测的增量构建

Monorepo 下的核心问题是：订单子应用改了一行代码，不应该触发商品子应用的构建。这需要**变更检测**。

```yaml
# .github/workflows/ci.yml — GitHub Actions 实现
name: Micro Frontend CI/CD

on:
  push:
    branches: [main, 'release/**']
  pull_request:
    branches: [main]

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      main-app: ${{ steps.changes.outputs.main-app }}
      order-app: ${{ steps.changes.outputs.order-app }}
      product-app: ${{ steps.changes.outputs.product-app }}
      user-app: ${{ steps.changes.outputs.user-app }}
      shared-libs: ${{ steps.changes.outputs.shared-libs }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            main-app:
              - 'apps/main/**'
              - 'packages/shared-types/**'
            order-app:
              - 'apps/order/**'
              - 'packages/shared-utils/**'
              - 'packages/shared-components/**'
            product-app:
              - 'apps/product/**'
              - 'packages/shared-utils/**'
              - 'packages/shared-components/**'
            user-app:
              - 'apps/user/**'
              - 'packages/shared-utils/**'
            shared-libs:
              - 'packages/**'

  build-order-app:
    needs: detect-changes
    if: needs.detect-changes.outputs.order-app == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter order-app build
      - run: pnpm --filter order-app test
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: order-app-dist
          path: apps/order/dist/
          retention-days: 7

  # build-product-app, build-user-app 结构类似，此处省略

  deploy-order-app:
    needs: [build-order-app]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: order-app-dist
          path: dist/
      - name: Deploy to CDN
        run: |
          # 带版本号的部署路径，支持回滚
          VERSION=$(cat dist/version.json | jq -r '.version')
          DEPLOY_PATH="micro-apps/order/${VERSION}"

          aws s3 sync dist/ "s3://${CDN_BUCKET}/${DEPLOY_PATH}" \
            --cache-control "public, max-age=31536000, immutable"

          # 更新版本映射表（关键！）
          echo "{\"version\": \"${VERSION}\", \"path\": \"${DEPLOY_PATH}\", \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
            > /tmp/manifest.json
          aws s3 cp /tmp/manifest.json \
            "s3://${CDN_BUCKET}/micro-apps/order/latest.json" \
            --cache-control "no-cache, no-store, must-revalidate"
        env:
          CDN_BUCKET: ${{ secrets.CDN_BUCKET }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

注意上面的部署策略中一个关键细节：**静态资源使用不可变路径 + 永久缓存，版本映射文件使用 no-cache**。这是微前端 CDN 部署的黄金法则。

### 16.1.3 CDN 部署的双层架构

微前端的 CDN 部署与传统单体应用有本质区别。单体应用只有一个入口 HTML 和一组 bundle，而微前端需要管理多个子应用的资源，且这些资源可能随时独立更新。

```
CDN 目录结构：
├── micro-apps/
│   ├── order/
│   │   ├── v1.2.3/              # 不可变资源，Cache-Control: max-age=31536000, immutable
│   │   │   ├── remoteEntry.js
│   │   │   ├── index.js / index.css / assets/
│   │   ├── v1.2.4/              # 每个版本独立目录，永不覆盖
│   │   └── latest.json          # 可变指针，Cache-Control: no-cache
│   ├── product/                 # 同构结构
│   └── user/
└── manifest.json                # 全局版本清单（可变，no-cache）
                                 # { apps: { order: { version, entry, integrity }, ... } }
```

主应用在启动时拉取全局 `manifest.json`，获取每个子应用的最新版本和入口地址。这个 manifest 文件是整个系统的**真相源（Source of Truth）**。

```typescript
// 主应用启动时的版本加载逻辑
class MicroAppLoader {
  private manifest: AppManifest | null = null;
  private readonly manifestUrl = 'https://cdn.example.com/manifest.json';

  async initialize(): Promise<void> {
    this.manifest = await this.fetchManifest();
    // 启动后台轮询，检测子应用更新
    this.startPolling();
  }

  private async fetchManifest(): Promise<AppManifest> {
    const response = await fetch(this.manifestUrl, {
      cache: 'no-store',  // 强制不缓存
      headers: { 'X-Request-ID': crypto.randomUUID() },
    });
    if (!response.ok) {
      throw new ManifestLoadError(response.status);
    }
    return response.json();
  }

  getAppEntry(appName: string): string {
    const app = this.manifest?.apps[appName];
    if (!app) {
      throw new AppNotFoundError(appName);
    }
    return `https://cdn.example.com/${app.entry}`;
  }

  private startPolling(): void {
    setInterval(async () => {
      try {
        const newManifest = await this.fetchManifest();
        // 对比新旧 manifest，检测版本变更
        for (const [name, newApp] of Object.entries(newManifest.apps)) {
          const oldApp = this.manifest?.apps[name];
          if (!oldApp || oldApp.version !== newApp.version) {
            this.emit('app-updated', { app: name, from: oldApp?.version, to: newApp.version });
          }
        }
        this.manifest = newManifest;
        // 注意：不自动刷新！只是通知——由各子应用自己决定是否热更新
      } catch (e) {
        console.warn('[MicroAppLoader] Manifest polling failed:', e);
      }
    }, 30_000);  // 30 秒轮询
  }
}
```

> **深度洞察**：为什么不用 Service Worker 来管理子应用版本？因为 Service Worker 的更新策略本身就是一个复杂的生命周期问题。在微前端中引入 Service Worker，相当于在已经很复杂的版本管理上再叠加一层复杂度。除非你有明确的离线需求，否则用简单的 manifest 轮询 + CDN no-cache 策略就够了。Service Worker 的 `skipWaiting` 和 `clients.claim` 在多子应用场景下的行为很容易出人意料。

上面的 GitHub Actions 配置同样适用于 GitLab CI 的 `rules` + `changes` 语法，核心思路完全一致。需要特别注意：当共享库（`packages/`）发生变更时，**所有依赖它的子应用都需要重新构建**。这不是过度构建——这是必要的兼容性保障。共享库的变更本质上是一次隐式的全局变更。

## 16.2 版本管理：语义化版本 + 兼容性矩阵

在单体应用中，版本管理是线性的——每次发布一个版本号。但在微前端中，**系统的"版本"是一个矩阵**：主应用 v2.1.0 + 订单子应用 v3.4.2 + 商品子应用 v1.8.0 + 共享库 v2.0.1。这个矩阵中的任意组合都需要正常工作，否则就会出现开头那个凌晨两点的事故。

### 16.2.1 子应用版本契约

每个子应用需要显式声明自己的版本和依赖关系：

```json
{
  "name": "@micro/order-app",
  "version": "3.4.2",
  "microFrontend": {
    "type": "sub-app",
    "framework": "react",
    "frameworkVersion": "^18.2.0",
    "host": {
      "minVersion": "2.0.0",
      "maxVersion": "3.0.0"
    },
    "sharedDependencies": {
      "@shared/utils": "^2.0.0",
      "@shared/components": "^1.5.0",
      "@shared/auth": "^3.0.0"
    },
    "exposes": {
      "./OrderList": "./src/pages/OrderList.tsx",
      "./OrderDetail": "./src/pages/OrderDetail.tsx"
    },
    "publicPath": "auto"
  }
}
```

其中 `host.minVersion` 和 `host.maxVersion` 定义了这个子应用与主应用之间的兼容性范围。主应用在加载子应用时，必须校验这个范围：

```typescript
// 主应用加载子应用前的兼容性检查
function validateCompatibility(hostVersion: string, subApp: SubAppManifest): boolean {
  const { minVersion, maxVersion } = subApp.microFrontend.host;
  // 主应用版本必须在 [minVersion, maxVersion) 范围内
  if (!semver.gte(hostVersion, minVersion) || !semver.lt(hostVersion, maxVersion)) {
    console.error(`${subApp.name} 要求主应用 [${minVersion}, ${maxVersion})，当前 ${hostVersion}`);
    return false;
  }
  return true;
}

// 共享依赖的版本协商——检查主应用提供的版本是否满足子应用的要求
function negotiateSharedDeps(
  hostProvided: Record<string, string>,
  subAppRequired: Record<string, string>
): { dep: string; resolution: 'use-host' | 'fallback-to-bundled' }[] {
  return Object.entries(subAppRequired).map(([dep, range]) => {
    const provided = hostProvided[dep];
    const compatible = provided && semver.satisfies(provided, range);
    return { dep, resolution: compatible ? 'use-host' : 'fallback-to-bundled' };
  });
}
```

### 16.2.2 Module Federation 的版本协商机制

Module Federation 2.0 内置了版本协商能力，但它的行为并不总是直观的。理解其协商策略对于避免版本冲突至关重要。

```javascript
// rspack.config.js / webpack.config.js — 主应用
const { ModuleFederationPlugin } = require('@module-federation/enhanced');

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'host',
      remotes: {
        orderApp: 'orderApp@https://cdn.example.com/micro-apps/order/latest/remoteEntry.js',
        productApp: 'productApp@https://cdn.example.com/micro-apps/product/latest/remoteEntry.js',
      },
      shared: {
        react: {
          singleton: true,        // 全局只加载一份
          requiredVersion: '^18.2.0',
          eager: true,            // 主应用立即加载，不异步
          strictVersion: false,   // 不严格匹配——允许子应用用更高的 minor 版本
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.2.0',
          eager: true,
          strictVersion: false,
        },
        '@shared/utils': {
          singleton: true,
          requiredVersion: '^2.0.0',
          version: '2.1.0',      // 主应用提供的实际版本
        },
        '@shared/components': {
          singleton: false,       // 允许多版本共存！
          requiredVersion: '>=1.5.0',
        },
      },
    }),
  ],
};
```

```javascript
// rspack.config.js — 订单子应用
const { ModuleFederationPlugin } = require('@module-federation/enhanced');

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'orderApp',
      filename: 'remoteEntry.js',
      exposes: {
        './OrderList': './src/pages/OrderList.tsx',
        './OrderDetail': './src/pages/OrderDetail.tsx',
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^18.2.0',
          import: false,         // 不打包 React——完全使用主应用提供的
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.2.0',
          import: false,
        },
        '@shared/utils': {
          singleton: true,
          requiredVersion: '^2.0.0',
          import: false,         // 优先使用主应用提供的
        },
        '@shared/components': {
          singleton: false,
          requiredVersion: '^1.5.0',
          // 不设置 import: false——如果主应用版本不满足，用自己打包的
        },
      },
    }),
  ],
};
```

> **深度洞察**：`singleton: true` 和 `singleton: false` 的选择至关重要。对于 React 这类有全局状态的库（hooks 依赖单一的 ReactCurrentDispatcher），**必须 singleton**，否则会出现臭名昭著的 "Invalid hook call" 错误。但对于纯工具函数库，允许多版本共存反而更安全——子应用 A 用 v1.5 的按钮组件，子应用 B 用 v1.8 的，互不干扰。

### 16.2.3 兼容性矩阵的自动化验证

手动维护兼容性矩阵是不可持续的。我们需要在 CI 中自动化这个过程：

```typescript
// scripts/verify-compatibility-matrix.ts
import semver from 'semver';
import { glob } from 'glob';

async function verifyCompatibilityMatrix(): Promise<void> {
  const appPaths = await glob('apps/*/package.json');
  const apps = await Promise.all(
    appPaths.map(async (p) => JSON.parse(await Bun.file(p).text()))
  );

  const hostApp = apps.find((a: any) => a.name.includes('main'));
  const subApps = apps.filter((a: any) => a.microFrontend?.host);
  const errors: string[] = [];

  // 验证1：每个子应用与主应用的版本兼容性
  for (const sub of subApps) {
    const { minVersion, maxVersion } = sub.microFrontend.host;
    if (!semver.satisfies(hostApp.version, `>=${minVersion} <${maxVersion}`)) {
      errors.push(`${sub.name} 要求主应用 [${minVersion}, ${maxVersion})，实际 ${hostApp.version}`);
    }
  }

  // 验证2：共享依赖的版本范围是否存在交集
  const sharedDeps = new Map<string, { app: string; range: string }[]>();
  for (const sub of subApps) {
    for (const [dep, range] of Object.entries(sub.microFrontend?.sharedDependencies ?? {})) {
      if (!sharedDeps.has(dep)) sharedDeps.set(dep, []);
      sharedDeps.get(dep)!.push({ app: sub.name, range: range as string });
    }
  }
  for (const [dep, consumers] of sharedDeps) {
    const ranges = consumers.map((c) => c.range);
    // 检查是否存在某个版本同时满足所有范围
    const hasIntersection = ['1.0.0','1.5.0','2.0.0','2.5.0','3.0.0']
      .some((v) => ranges.every((r) => semver.satisfies(v, r)));
    if (!hasIntersection) {
      errors.push(`${dep} 版本冲突：${consumers.map((c) => `${c.app}(${c.range})`).join(' vs ')}`);
    }
  }

  if (errors.length > 0) {
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`兼容性矩阵验证通过：${subApps.length} 个子应用 × ${sharedDeps.size} 个共享依赖`);
}
verifyCompatibilityMatrix();
```

将此脚本集成到 CI 中：

```yaml
# 在 CI 管线中加入兼容性验证
verify-compatibility:
  stage: test
  script:
    - pnpm tsx scripts/verify-compatibility-matrix.ts
  rules:
    - if: $SHARED_CHANGED == "true"
    - changes:
        - "apps/*/package.json"
```

## 16.3 监控与可观测性：如何定位跨应用问题

微前端的监控难度远高于单体应用。一个用户的请求链路可能穿越主应用、两三个子应用、多个共享库、多个后端服务。当问题发生时，"是哪个子应用的问题"这个看似简单的问题，往往需要 20 分钟才能回答。

### 16.3.1 错误边界与错误归因

首要原则：**每个子应用必须有独立的错误边界，且错误必须被标记归属**。

```typescript
// 增强版 React Error Boundary——关键在于 componentDidCatch 中的错误归因
class MicroAppErrorBoundary extends React.Component<
  { appName: string; appVersion: string; fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() { return { hasError: true }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const { appName, appVersion } = this.props;

    // 核心：给错误打上子应用标签后上报
    errorTracker.capture(error, {
      tags: {
        'micro_app.name': appName,
        'micro_app.version': appVersion,
      },
      contexts: {
        microFrontend: { appName, appVersion, hostVersion: window.__MICRO_HOST_VERSION__ },
      },
    });

    // 通知主应用——子应用崩溃不应拖垮全局
    window.dispatchEvent(
      new CustomEvent('micro-app-error', { detail: { appName, appVersion, error } })
    );
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
```

### 16.3.2 全局未捕获错误的归因

并非所有错误都能被 React Error Boundary 捕获。异步错误、Promise rejection、网络请求失败——这些需要在全局层面拦截并归因。

```typescript
// 全局错误归因系统——三层策略
class MicroAppErrorAttributor {
  // 每个子应用注册时记录其脚本 URL 列表
  private appRegistry = new Map<string, { version: string; scriptUrls: Set<string> }>();

  registerApp(name: string, version: string, scriptUrls: string[]): void {
    this.appRegistry.set(name, { version, scriptUrls: new Set(scriptUrls) });
  }

  install(): void {
    // 捕获未处理的同步错误
    window.addEventListener('error', (event) => {
      const attr = this.attribute(event.filename, event.error?.stack);
      this.report(event.error, attr, 'uncaught-error');
    });
    // 捕获未处理的 Promise rejection
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      const attr = this.attribute(undefined, error.stack);
      this.report(error, attr, 'unhandled-rejection');
    });
  }

  private attribute(filename?: string, stack?: string): { app: string; confidence: string } {
    // 策略1：通过脚本文件名直接匹配子应用
    if (filename) {
      for (const [name, info] of this.appRegistry) {
        if (info.scriptUrls.has(filename) || filename.includes(`/micro-apps/${name}/`)) {
          return { app: name, confidence: 'high' };
        }
      }
    }
    // 策略2：解析堆栈中的 URL 逐帧匹配
    if (stack) {
      const urls = stack.match(/https?:\/\/[^\s)]+/g) ?? [];
      for (const url of urls) {
        for (const [name] of this.appRegistry) {
          if (url.includes(`/micro-apps/${name}/`)) return { app: name, confidence: 'medium' };
        }
      }
    }
    // 策略3：无法归因，默认归到主应用
    return { app: 'host', confidence: 'low' };
  }

  private report(error: Error, attr: { app: string; confidence: string }, type: string): void {
    errorTracker.capture(error, {
      tags: { 'micro_app.name': attr.app, 'attribution.confidence': attr.confidence, 'error.type': type },
    });
  }
}
```

### 16.3.3 分布式追踪：跨子应用的请求链路

当一个用户操作涉及多个子应用时（比如在商品详情页点击"加入购物车"，触发订单子应用的接口调用），我们需要一个贯穿全链路的追踪 ID。

```typescript
// 分布式追踪——核心思路：使用 W3C Trace Context 标准贯穿子应用边界
class MicroAppTracer {
  // 生成追踪上下文
  createTraceContext(): TraceContext {
    return {
      traceId: this.randomHex(16),    // 整条链路的唯一标识（32 字符）
      spanId: this.randomHex(8),       // 当前操作的标识（16 字符）
      parentSpanId: undefined,
      appName: window.__CURRENT_MICRO_APP__ ?? 'host',
    };
  }

  // 子应用间传递：保持 traceId 不变，生成新 spanId，旧 spanId 变为 parentSpanId
  propagate(context: TraceContext, targetApp: string): TraceContext {
    return {
      traceId: context.traceId,
      spanId: this.randomHex(8),
      parentSpanId: context.spanId,
      appName: targetApp,
    };
  }

  // Patch fetch，自动注入追踪头
  install(): void {
    const originalFetch = window.fetch;
    const self = this;
    window.fetch = function (input, init = {}) {
      const ctx = (window as any).__CURRENT_TRACE_CONTEXT__ ?? self.createTraceContext();
      const headers = new Headers(init.headers);
      // W3C Trace Context 标准格式
      headers.set('traceparent', `00-${ctx.traceId}-${ctx.spanId}-01`);
      headers.set('baggage', `micro_app.origin=${ctx.appName}`);
      return originalFetch.call(this, input, { ...init, headers });
    };
  }

  private randomHex(bytes: number): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  appName: string;
}
```

### 16.3.4 性能监控的子应用维度拆分

在微前端中，Web Vitals 等性能指标需要按子应用维度拆分，否则你只能看到一个全局的 LCP 数字，却不知道是哪个子应用拖慢了页面。

```typescript
// 子应用级性能监控（核心逻辑）
class MicroAppPerformanceMonitor {
  private appTimings = new Map<string, { mountStart: number }>();

  constructor() {
    // 监听资源加载、长任务等性能事件
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'resource') {
          // 根据 URL 中的 /micro-apps/{appName}/ 路径判断资源归属
          const match = (entry as PerformanceResourceTiming).name.match(/\/micro-apps\/([^/]+)\//);
          if (match) {
            metricsReporter.record('resource_load', {
              app: match[1],
              duration: entry.duration,
              size: (entry as PerformanceResourceTiming).transferSize,
            });
          }
        }
        if (entry.entryType === 'longtask') {
          // 长任务归因——通过当前活跃子应用判断
          metricsReporter.record('long_task', {
            duration: entry.duration,
            app: window.__CURRENT_MICRO_APP__ ?? 'host',
          });
        }
      }
    });
    observer.observe({ entryTypes: ['resource', 'longtask'] });
  }

  recordAppMount(appName: string): void {
    this.appTimings.set(appName, { mountStart: performance.now() });
  }

  recordAppMounted(appName: string): void {
    const timing = this.appTimings.get(appName);
    if (timing) {
      metricsReporter.record('micro_app_mount', {
        app: appName,
        mount_duration_ms: performance.now() - timing.mountStart,
      });
    }
  }
}
```

> **深度洞察**：性能监控中最容易被忽视的指标是**子应用切换时间**——从用户点击导航到新子应用渲染完成的耗时。这个时间包含了路由匹配、旧子应用卸载、新子应用资源加载、初始化、挂载的完整链路。在 qiankun 中，这个时间通常在 500ms-2s 之间；在 Module Federation 中，由于资源可以预加载，可以优化到 200ms 以内。监控这个指标，比监控单个子应用的 FCP 更能反映用户的真实体验。

## 16.4 灰度发布与 A/B 测试在微前端中的实现

微前端天然适合灰度发布——因为每个子应用都可以独立部署，也就可以独立灰度。但"独立灰度"带来的问题是：如何确保同一个用户在整个会话中看到一致的版本？

### 16.4.1 灰度发布的三种粒度

```
┌────────────────────────────────────────────────────────┐
│                   灰度发布粒度                          │
├────────────┬──────────────┬────────────────────────────┤
│  应用级灰度  │  页面级灰度   │      组件级灰度             │
│            │              │                            │
│ 整个子应用  │ 子应用内某些   │ 页面内特定组件              │
│ 使用新版本  │ 路由用新版本   │ 使用新版本                  │
│            │              │                            │
│ 适合：大版本 │ 适合：功能迭代 │ 适合：UI 实验               │
│ 升级、重构  │ 逐步放量      │ A/B 测试                   │
└────────────┴──────────────┴────────────────────────────┘
```

### 16.4.2 基于 Manifest 的灰度路由

灰度发布的核心在于：**不同用户拿到不同版本的 manifest**。这个决策应该在服务端完成，而不是在客户端。

```typescript
// 灰度发布服务（部署为边缘函数 / Cloudflare Worker / Nginx Lua）
interface GrayReleaseConfig {
  appName: string;
  stableVersion: string;
  canaryVersion: string;
  rules: GrayRule[];
}

interface GrayRule {
  type: 'percentage' | 'user_list' | 'header' | 'cookie' | 'region';
  condition: any;
  targetVersion: 'canary' | 'stable';
}

// Cloudflare Worker 实现
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 只处理 manifest 请求
    if (url.pathname !== '/manifest.json') {
      return fetch(request);  // 其他请求直接透传
    }

    // 1. 获取灰度配置
    const grayConfig = await env.KV.get<GrayReleaseConfig[]>(
      'gray-release-config',
      'json'
    );

    if (!grayConfig || grayConfig.length === 0) {
      // 无灰度配置，返回稳定版本 manifest
      return fetch(`${env.CDN_ORIGIN}/manifest.json`);
    }

    // 2. 获取或生成用户标识（用于保证一致性）
    const userId = this.getUserId(request);

    // 3. 为每个子应用决定版本
    const baseManifest = await (
      await fetch(`${env.CDN_ORIGIN}/manifest.json`)
    ).json();

    const resolvedManifest = this.resolveVersions(
      baseManifest,
      grayConfig,
      userId,
      request
    );

    return new Response(JSON.stringify(resolvedManifest), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Gray-Release': 'active',
        'X-User-Bucket': userId.slice(0, 8),  // 调试用
      },
    });
  },

  getUserId(request: Request): string {
    // 优先从 cookie 获取；无 cookie 时基于 IP + UA 生成稳定哈希
    const cookies = request.headers.get('Cookie') ?? '';
    const match = cookies.match(/gray_uid=([^;]+)/);
    if (match) return match[1];
    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const ua = request.headers.get('User-Agent') ?? '';
    return this.stableHash(`${ip}:${ua}`);
  },

  resolveVersions(baseManifest: any, grayConfig: GrayReleaseConfig[], userId: string, request: Request): any {
    const resolved = structuredClone(baseManifest);
    for (const config of grayConfig) {
      const app = resolved.apps[config.appName];
      if (!app) continue;

      // 依次评估灰度规则：百分比分桶、用户白名单、请求头匹配、地区匹配
      const shouldCanary = config.rules.some((rule) => {
        if (rule.type === 'percentage') {
          return this.hashToBucket(userId, 100) < rule.condition.value;
        }
        if (rule.type === 'user_list') {
          return rule.condition.users.includes(userId);
        }
        if (rule.type === 'header') {
          return request.headers.get(rule.condition.header) === rule.condition.value;
        }
        if (rule.type === 'region') {
          return rule.condition.countries.includes(request.headers.get('CF-IPCountry'));
        }
        return false;
      });

      if (shouldCanary) {
        app.version = config.canaryVersion;
        app.entry = app.entry.replace(config.stableVersion, config.canaryVersion);
        app._gray = true;
      }
    }
    return resolved;
  },

  hashToBucket(input: string, buckets: number): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % buckets;
  },

  stableHash(input: string): string {
    let hash = 0n;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5n) - hash) + BigInt(input.charCodeAt(i));
    }
    return hash.toString(36);
  },
};
```

### 16.4.3 金丝雀发布的自动化决策

灰度不是把流量切过去就完了。真正的金丝雀发布需要**自动监控灰度版本的健康度，并据此决定是扩大灰度还是回滚**。

```typescript
// 金丝雀发布自动化决策引擎
class CanaryReleaseController {
  private readonly checkInterval = 60_000;  // 每分钟检查一次
  private readonly stages = [1, 5, 10, 25, 50, 100];  // 灰度阶段（百分比）

  async executeCanaryRelease(
    appName: string,
    canaryVersion: string
  ): Promise<CanaryResult> {
    let currentStageIndex = 0;

    for (const percentage of this.stages) {
      console.log(
        `[Canary] ${appName}: 将灰度比例调整到 ${percentage}%`
      );

      // 1. 更新灰度配置
      await this.updateGrayConfig(appName, canaryVersion, percentage);

      // 2. 等待并收集指标
      const metrics = await this.collectMetrics(
        appName,
        canaryVersion,
        this.getObservationWindow(percentage)
      );

      // 3. 评估健康度
      const health = this.evaluateHealth(metrics);

      if (health.status === 'unhealthy') {
        // 自动回滚
        console.error(
          `[Canary] ${appName}: 灰度版本 ${canaryVersion} 健康检查失败，执行回滚`,
          health.reasons
        );
        await this.rollback(appName);
        return {
          success: false,
          rolledBackAt: percentage,
          reasons: health.reasons,
        };
      }

      if (health.status === 'degraded') {
        // 暂停扩量，延长观察
        console.warn(
          `[Canary] ${appName}: 指标有波动，暂停扩量，延长观察`
        );
        const extendedMetrics = await this.collectMetrics(
          appName,
          canaryVersion,
          this.getObservationWindow(percentage) * 2
        );
        const recheck = this.evaluateHealth(extendedMetrics);
        if (recheck.status !== 'healthy') {
          await this.rollback(appName);
          return { success: false, rolledBackAt: percentage, reasons: recheck.reasons };
        }
      }

      // 健康，继续下一阶段
      currentStageIndex++;
    }

    // 全量发布成功
    console.log(`[Canary] ${appName}: 灰度完成，全量发布 ${canaryVersion}`);
    await this.promoteToStable(appName, canaryVersion);
    return { success: true };
  }

  private evaluateHealth(metrics: CanaryMetrics): HealthEvaluation {
    const reasons: string[] = [];

    // 四个核心指标：错误率、P99 延迟、JS 异常数、挂载成功率
    const { canary: c, stable: s } = metrics;
    if (c.errorRate / Math.max(s.errorRate, 0.001) > 2.0) reasons.push('错误率翻倍');
    if (c.p99Latency / Math.max(s.p99Latency, 1) > 1.5) reasons.push('P99 延迟恶化 50%+');
    if (c.jsErrorCount > s.jsErrorCount * 3) reasons.push('JS 异常激增');
    if (c.mountSuccessRate < 0.99) reasons.push('挂载成功率 < 99%');

    if (reasons.length >= 2) return { status: 'unhealthy', reasons };
    if (reasons.length === 1) return { status: 'degraded', reasons };
    return { status: 'healthy', reasons: [] };
  }

  // 灰度比例越低，观察时间越长（样本量小需要更长验证）
  private getObservationWindow(pct: number): number {
    return pct <= 5 ? 600_000 : pct <= 25 ? 300_000 : 180_000;
  }

  private async rollback(appName: string): Promise<void> {
    await this.updateGrayConfig(appName, '', 0);
    await this.notify({ channel: 'oncall', severity: 'warning', message: `${appName} 灰度已自动回滚` });
  }

  // updateGrayConfig: 更新 KV 存储中的灰度百分比
  // promoteToStable: 更新全局 manifest，将 canary 设为正式版本
  // collectMetrics: 等待观察窗口后从监控 API 查询灰度 vs 稳定的对比指标
  // notify: 发送告警通知到 oncall 频道
  // 以上方法均为标准的 HTTP API 调用，此处省略实现
}

// 类型定义省略——核心结构：CanaryMetrics 包含 canary/stable 两组 VersionMetrics
// VersionMetrics: errorRate, p99Latency, jsErrorCount, mountSuccessRate
```

### 16.4.4 A/B 测试的子应用级实现

A/B 测试与灰度发布的区别在于：灰度是同一功能的新旧版本切换，A/B 测试是**不同功能变体的对比实验**。在微前端中，Module Federation 的动态远程加载能力让 A/B 测试可以做到组件粒度。

```typescript
// 基于 Module Federation 的 A/B 测试加载器
class ABTestLoader {
  private experiments = new Map<string, Experiment>();

  async loadComponent(experimentId: string, userId: string): Promise<React.ComponentType> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return () => null;

    // 1. 确定性分桶——同一用户始终看到同一变体
    const hash = this.deterministicHash(`${experiment.id}:${userId}`);
    const bucket = hash % 100;
    let cumulative = 0;
    const variant = experiment.variants.find((v) => {
      cumulative += v.weight;
      return bucket < cumulative;
    }) ?? experiment.variants[0];

    // 2. 上报曝光事件（A/B 测试结果分析的基础）
    navigator.sendBeacon('/api/experiments/exposure', JSON.stringify({
      experimentId, variantId: variant.id, userId,
      timestamp: Date.now(), page: location.pathname,
    }));

    // 3. 利用 Module Federation 动态加载对应变体的组件
    const script = document.createElement('script');
    script.src = variant.remoteEntry;
    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${variant.remoteEntry}`));
      document.head.appendChild(script);
    });

    // 初始化远程容器并获取组件
    const container = (window as any)[variant.containerName];
    await container.init(__webpack_share_scopes__.default);
    const factory = await container.get(variant.exposedModule);
    return factory().default;
  }

  private deterministicHash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

interface Experiment {
  id: string;
  variants: Variant[];
}

interface Variant {
  id: string;
  weight: number;            // 流量权重（百分比）
  remoteEntry: string;       // Module Federation 远程入口
  containerName: string;     // 全局容器名
  exposedModule: string;     // 暴露的模块路径
}
```

> **深度洞察**：A/B 测试在微前端中有一个独特的陷阱——**交互干扰**。如果实验 A 改变了商品详情页的"加入购物车"按钮样式，而实验 B 改变了购物车子应用的结算流程，两个实验之间可能存在交互效应。用户同时参与两个实验时，观测到的转化率变化无法明确归因。解决方案是建立**实验互斥层**：在同一互斥层内的实验，用户只会参与其中一个。不同互斥层的实验则可以正交叠加。

### 16.4.5 快速回滚机制

最后但最重要——回滚。在微前端中，回滚应该是**秒级**的，因为不需要重新构建，只需要切换版本指针。

```typescript
// scripts/rollback.ts — 一键回滚，可通过 CLI 或告警 webhook 自动触发
async function rollbackApp(appName: string): Promise<void> {
  // 1. 获取版本历史（CDN 上保留最近 N 个版本的记录）
  const history = await fetch(
    `https://cdn.example.com/micro-apps/${appName}/versions.json`,
    { cache: 'no-store' }
  ).then((r) => r.json());

  const current = history.find((v: any) => v.status === 'current');
  const previous = history.find((v: any) => v.status === 'previous');
  if (!previous) throw new Error(`No previous version for ${appName}`);

  console.log(`[Rollback] ${appName}: ${current.version} → ${previous.version}`);

  // 2. 核心操作：更新 latest.json 指针（< 1秒）
  await uploadToS3(
    `micro-apps/${appName}/latest.json`,
    JSON.stringify({ version: previous.version, path: `micro-apps/${appName}/${previous.version}` }),
    'no-cache, no-store, must-revalidate'
  );

  // 3. 更新全局 manifest + 刷新 CDN 缓存 + 清除灰度配置
  await Promise.all([
    updateGlobalManifest(appName, previous.version),
    purgeCDNCache([`https://cdn.example.com/micro-apps/${appName}/latest.json`]),
    clearGrayRelease(appName),
  ]);

  // 4. 发送告警通知
  await notify({ channel: 'oncall', severity: 'critical',
    message: `${appName} 已从 ${current.version} 回滚到 ${previous.version}` });
}

// 使用：npx tsx scripts/rollback.ts order-app
rollbackApp(process.argv[2]!).catch((e) => { console.error(e); process.exit(1); });
```

回滚之所以能做到秒级，关键在于**CDN 上的旧版本资源从未被删除**。每个版本的资源都以版本号为路径永久保留（或至少保留最近 N 个版本），切换版本只需要改一个 JSON 文件的指针。这就是 16.1.3 节提到的双层 CDN 架构的核心价值。

---

## 本章小结

- **独立构建 + 独立部署**是微前端工程化的基石：通过变更检测实现增量构建，通过版本化 CDN 路径 + 可变 manifest 实现独立部署与秒级回滚
- **版本管理**在微前端中是矩阵问题而非线性问题：每个子应用需要显式声明兼容性范围，CI 自动验证兼容性矩阵，Module Federation 的版本协商需要理解 singleton 的语义
- **监控与可观测性**的核心挑战是错误归因：通过脚本 URL 匹配、堆栈分析、调用链追踪三层策略，将错误准确归到具体子应用
- **灰度发布**通过服务端 manifest 路由实现，金丝雀发布需要自动化健康评估与分阶段扩量，A/B 测试利用 Module Federation 动态加载实现组件粒度的实验
- 整个 DevOps 体系的设计哲学是：**让独立团队以独立速度交付，同时保证全局一致性和可回滚性**

## 思考题

1. **工程设计**：本章介绍的 manifest 轮询机制存在最长 30 秒的版本更新延迟。在什么业务场景下这个延迟不可接受？你会如何优化——Server-Sent Events、WebSocket、还是 Service Worker？请分析各方案的利弊。

2. **版本策略**：假设你的微前端系统有 8 个子应用和 5 个共享库，某天你需要对核心共享库 `@shared/auth` 做一个破坏性变更（major 版本升级）。请设计一个渐进式迁移方案，确保在迁移过程中所有子应用都能正常运行。

3. **监控实践**：本章的错误归因系统基于 URL 路径匹配和堆栈分析。在使用 qiankun 的 HTML Entry 模式下（所有子应用的 JS 被 eval 执行，丢失了原始文件名），错误归因会遇到什么问题？你会如何解决？

4. **灰度策略**：金丝雀发布的自动化决策引擎使用了错误率、P99 延迟、JS 异常数、挂载成功率四个指标。你认为还应该加入哪些指标？在什么情况下，数据指标"看起来正常"但实际上用户体验已经恶化？

5. **架构权衡**：本章的灰度路由实现在边缘节点（Cloudflare Worker）完成。如果改为在客户端（主应用内）完成灰度决策，会有什么优势和风险？请结合安全性、一致性、性能三个维度分析。

</div>
