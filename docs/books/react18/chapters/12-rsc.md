<div v-pre>

# 第12章 React Server Components 架构

> **本章要点**
>
> - RSC 的设计动机：零 bundle size 组件如何从根本上改变前端架构
> - Server Component 与 Client Component 的边界划分规则与 `"use client"` 指令的编译时处理
> - RSC Wire Protocol（Flight 协议）：服务端如何将组件树序列化为流式传输格式
> - `renderToPipeableStream` 与流式 SSR 的底层实现原理
> - RSC Payload 的数据结构：行格式、类型标记与引用模型
> - RSC 与 Next.js App Router 的深度集成机制
> - RSC 的性能模型：何时用、何时不用的工程决策框架

---

在 React 的演进历程中，有几个里程碑式的转折点：2015 年的 Virtual DOM 重新定义了 UI 编程模型，2017 年的 Fiber 架构重写了渲染引擎，2022 年的并发模式让渲染变得可中断。而 React Server Components（RSC）代表着第四次范式跃迁——它模糊了服务端与客户端的物理边界，让组件不再被困在浏览器这个"沙盒"里。

这次变革的激进程度超出了大多数人的预期。在传统的 React 应用中，所有组件都运行在浏览器端——即使一个组件只是从数据库读取数据然后渲染静态文本，它的代码也必须被打包、传输、解析、执行。RSC 的核心洞察是：**不是每个组件都需要交互能力，而没有交互能力的组件没有理由运行在客户端**。这不是一个渐进式的优化，而是对"组件在哪里运行"这个根本问题的重新回答。

本章将从源码层面解剖 RSC 的完整架构：从 `"use client"` 指令的编译时处理，到 Flight 协议的序列化机制，再到流式渲染的管道实现。我们不仅要理解它如何工作，更要理解它为什么必须这样设计。

## 12.1 RSC 的设计动机：零 bundle size 的组件

### 12.1.1 传统 SSR 的困境

在 RSC 出现之前，React 的服务端渲染（SSR）已经存在多年。但传统 SSR 有一个被广泛忽视的结构性问题：**它只是把首屏渲染搬到了服务端，组件代码本身仍然会全部发送到客户端**。

```typescript
// 传统 SSR 的流程
// 步骤 1: 服务端渲染 HTML
const html = renderToString(<App />);

// 步骤 2: 将 HTML 发送到客户端
res.send(`
  <html>
    <body>${html}</body>
    <script src="/bundle.js"></script>  <!-- 全部组件代码 -->
  </html>
`);

// 步骤 3: 客户端加载 bundle.js，执行 hydration
// 即使 <StaticHeader /> 永远不会更新，它的代码也在 bundle.js 中
hydrateRoot(document.getElementById('root'), <App />);
```

这里存在一个深层矛盾：SSR 的价值在于"用户更早看到内容"，但客户端仍然需要下载全部 JavaScript 才能完成 hydration。对于一个包含大量静态内容的页面（博客文章、产品详情、文档页面），bundle 中可能有超过 60% 的代码只是为了在客户端"重新生成"服务端已经渲染过的内容。

传统 SSR 的传输量 = HTML + **全部组件代码** + 全部依赖库。而 RSC 的传输量 = RSC Payload + **仅 Client Component 代码**。Server Component 的代码和依赖永远不离开服务端。

### 12.1.2 零 bundle size 的数学本质

RSC 的"零 bundle size"并不是一个营销口号，而是一个可以量化的工程指标。让我们用一个典型的电商产品页面来说明：

```tsx
// 产品详情页 — 未使用 RSC
// 客户端 bundle 包含：
// - react-markdown (92KB gzipped)
// - date-fns (16KB gzipped)
// - sanitize-html (48KB gzipped)
// - highlight.js (68KB gzipped)
// 总计：仅第三方依赖就约 224KB

import ReactMarkdown from 'react-markdown';
import { format } from 'date-fns';
import sanitizeHtml from 'sanitize-html';
import hljs from 'highlight.js';

function ProductDescription({ product }: { product: Product }) {
  const cleanHtml = sanitizeHtml(product.description);
  const formattedDate = format(product.createdAt, 'yyyy-MM-dd');

  return (
    <div>
      <h1>{product.name}</h1>
      <time>{formattedDate}</time>
      <ReactMarkdown>{cleanHtml}</ReactMarkdown>
      <pre>
        <code dangerouslySetInnerHTML={{
          __html: hljs.highlight(product.codeExample, { language: 'tsx' }).value
        }} />
      </pre>
    </div>
  );
}
```

在 RSC 架构下，`ProductDescription` 是一个 Server Component——它在服务端渲染成最终的 HTML/React 元素，`react-markdown`、`date-fns`、`sanitize-html`、`highlight.js` 这些依赖永远不会出现在客户端 bundle 中。这不是 tree-shaking，不是 code-splitting——这些库的代码从物理上就不存在于客户端的网络传输中。

### 12.1.3 不止是体积：直接访问后端资源

零 bundle size 只是 RSC 带来的第一层价值。更深层的价值在于：Server Component 可以直接访问服务端资源，而不需要通过 API 中间层。

```tsx
// Server Component — 直接访问数据库
// 这段代码只在服务端运行，永远不会出现在客户端 bundle 中
import { db } from '@/lib/database';
import { cache } from 'react';

// React 的 cache() 会对同一次渲染中的重复调用去重
const getProduct = cache(async (id: string) => {
  // 直接执行 SQL 查询，无需 REST/GraphQL 中间层
  const product = await db.query(
    'SELECT * FROM products WHERE id = $1',
    [id]
  );
  return product;
});

async function ProductPage({ params }: { params: { id: string } }) {
  const product = await getProduct(params.id);

  // 注意：这是一个 async 函数组件
  // 在传统 React 中，这是不可能的
  // 在 RSC 中，这是最自然的编程模型
  return (
    <div>
      <ProductHeader product={product} />
      <ProductReviews productId={product.id} />
      <AddToCartButton productId={product.id} /> {/* Client Component */}
    </div>
  );
}
```

> **深度洞察**：RSC 本质上是对"前后端分离"这个十年来被奉为金科玉律的架构范式的一次"逆反"。它的核心论点是：前后端分离在 API 层面是必要的（你需要独立部署和扩缩容），但在组件层面是多余的（一个只读数据展示的组件，没有理由在客户端重新运行）。RSC 把"分离的粒度"从"整个应用"细化到了"单个组件"。

## 12.2 Server Component vs Client Component：边界划分的艺术

### 12.2.1 `"use client"` 指令的编译时语义

`"use client"` 不是一个运行时的 API，而是一个编译器指令（compiler directive）。它的语义是："从这个文件开始，以及它导入的所有文件，都是客户端代码"。

```tsx
// components/AddToCartButton.tsx
"use client";  // 编译器边界标记

import { useState, useTransition } from 'react';
import { addToCart } from '@/actions/cart';

export function AddToCartButton({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(1);

  return (
    <div>
      <input
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(Number(e.target.value))}
      />
      <button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await addToCart(productId, quantity);
          });
        }}
      >
        {isPending ? '添加中...' : '加入购物车'}
      </button>
    </div>
  );
}
```

从编译器的视角看，`"use client"` 指令在模块依赖图中创建了一条分割线：

在模块依赖图中，`"use client"` 形成一条分割线：上方是 Server Component 区域（`ProductPage.tsx` -> `ProductHeader.tsx` / `ProductReviews.tsx`），下方是 Client Component 区域（`AddToCartButton.tsx` 及其依赖 `useState`、`useTransition` 等）。服务端 bundle 中只保留对 Client Component 的**引用**，而不包含其实际代码。

### 12.2.2 边界处理的编译过程

当 bundler（如 webpack 的 `react-server-dom-webpack` 插件）遇到 `"use client"` 指令时，它不会将该模块内联到服务端 bundle 中。相反，它会生成一个**模块引用（Module Reference）**：

```typescript
// 编译器处理 "use client" 的简化逻辑
function processClientBoundary(modulePath: string, exportName: string) {
  // 不将实际代码打包到服务端 bundle
  // 而是生成一个引用对象
  return {
    $$typeof: Symbol.for('react.client.reference'),
    $$id: `${modulePath}#${exportName}`,
    // 这个 ID 将用于客户端加载对应的 chunk
  };
}

// 在服务端 bundle 中，AddToCartButton 变成了：
// (不是组件函数，而是一个引用标记)
const AddToCartButton = {
  $$typeof: Symbol.for('react.client.reference'),
  $$id: '/components/AddToCartButton.tsx#AddToCartButton',
};
```

这个设计非常精妙。服务端渲染 `ProductPage` 时遇到 `<AddToCartButton />`，它不会尝试执行这个组件（因为它只是一个引用标记），而是将这个引用及其 props 序列化到 RSC Payload 中，交由客户端处理。

### 12.2.3 组合模式：Server Component 与 Client Component 的嵌套规则

理解嵌套规则是正确使用 RSC 的关键。核心规则只有两条：

**规则一：Server Component 可以导入和渲染 Client Component。**

```tsx
// ✅ Server Component 渲染 Client Component
// app/page.tsx (Server Component)
import { AddToCartButton } from '@/components/AddToCartButton'; // "use client"

async function ProductPage() {
  const product = await db.products.findOne({ id: '123' });
  return (
    <div>
      <h1>{product.name}</h1>
      <AddToCartButton productId={product.id} />
    </div>
  );
}
```

**规则二：Client Component 不能导入 Server Component，但可以通过 `children` 或其他 props 接收 Server Component 的渲染结果。**

```tsx
// ❌ 这是不允许的
"use client";
import { ServerOnlyComponent } from './ServerOnlyComponent'; // 错误！

function ClientWrapper() {
  return <ServerOnlyComponent />;  // Server Component 不能在客户端运行
}

// ✅ 正确的做法：通过 children 传递
"use client";
function ClientWrapper({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  return isOpen ? <div className="panel">{children}</div> : null;
}

// 在 Server Component 中组合
async function Page() {
  const data = await fetchData();
  return (
    <ClientWrapper>
      {/* ServerContent 的渲染结果作为 children 传入 */}
      <ServerContent data={data} />
    </ClientWrapper>
  );
}
```

这个模式之所以可行，是因为 React 的渲染是自顶向下的。当服务端渲染 `Page` 时，它会先渲染 `ServerContent` 得到 React 元素树，然后将这个已渲染的结果作为 `children` prop 传递给 `ClientWrapper` 的引用。客户端接收到的是已经序列化的元素树，不需要执行任何 Server Component 代码。

### 12.2.4 边界划分的工程决策框架

在实践中，决定一个组件应该是 Server 还是 Client，需要考虑以下决策矩阵：

- **Server Component**：可直接访问数据库/文件系统，支持 async/await，不加入客户端 bundle，但不能使用 useState/useEffect、事件处理、浏览器 API
- **Client Component**：支持全部 React Hooks 和浏览器 API、事件处理，但会加入客户端 bundle，不能直接访问服务端资源

> **深度洞察**：`"use client"` 指令的位置选择，本质上是在回答一个架构问题——"交互性从组件树的哪一层开始？" 最佳实践是将这条线推得尽可能靠近叶子节点。一个常见的反模式是在布局层级就标记 `"use client"`，导致整棵子树都被拉到客户端。正确的做法是：将交互逻辑封装在最小的 Client Component 中，而将数据获取和渲染逻辑留在 Server Component。

## 12.3 RSC Wire Protocol：服务端如何序列化组件树

### 12.3.1 Flight 协议概述

RSC 的网络传输不使用 HTML，也不使用 JSON——它使用一种专门设计的行文本协议，React 团队内部称之为 **Flight 协议**。这个协议的设计目标是支持流式传输（streaming），使得客户端可以在服务端还在渲染时就开始增量地处理数据。

Flight 协议的每一行代表一个"数据块"（chunk），格式为：

```
<行 ID>:<类型标记><数据>\n
```

让我们看一个具体的例子。假设服务端渲染以下组件树：

```tsx
// app/page.tsx (Server Component)
async function Page() {
  const posts = await db.posts.findMany();
  return (
    <Layout>
      <h1>博客</h1>
      <PostList posts={posts} />
      <SearchBar />  {/* Client Component */}
    </Layout>
  );
}
```

生成的 RSC Payload（简化后）大致如下：

```
0:["$","div",null,{"className":"layout","children":[["$","h1",null,{"children":"博客"}],["$","div",null,{"className":"post-list","children":[["$","article","post-1",{"children":[["$","h2",null,{"children":"第一篇文章"}],["$","p",null,{"children":"内容摘要..."}]]}],["$","article","post-2",{"children":[["$","h2",null,{"children":"第二篇文章"}],["$","p",null,{"children":"内容摘要..."}]]}]]}],["$","@1",null,{}]]}]
1:I["components/SearchBar.tsx","SearchBar"]
```

### 12.3.2 RSC Payload 的类型标记系统

Flight 协议使用一组类型标记来区分不同类型的数据块：

```typescript
// react-server-dom-webpack/src/ReactFlightServerConfig.js
// Flight 协议的核心类型标记

// 行类型前缀（简化表示）
const ROW_TYPE = {
  MODEL:    '',   // 默认：React 元素模型（JSON 编码的 React 树）
  MODULE:   'I',  // Client Component 模块引用 (Import)
  HINT:     'H',  // 预加载提示（CSS、字体等资源）
  ERROR:    'E',  // 错误信息
  TEXT:     'T',  // 纯文本块
  BLOCKED:  'B',  // 被阻塞的块（等待异步操作）
  POSTPONE: 'P',  // 延迟渲染标记
};

// 在 Payload 中，React 元素使用特殊的 $ 标记：
// "$"        → React 元素 (createElement)
// "$L<id>"   → 懒加载引用 (lazy reference)
// "$F"       → Server Component 的引用 (Flight)
// "@<id>"    → Client Component 引用（指向 I 行定义的模块）
// "$undefined" → undefined 值
// "$Infinity"  → Infinity
// "$-Infinity" → -Infinity
// "$NaN"       → NaN
// "$-0"        → -0
```

### 12.3.3 序列化引擎的实现

RSC 的序列化引擎位于 `react-server` 包中，其核心是 `renderToReadableStream`（Web Streams）或 `renderToPipeableStream`（Node.js Streams）。让我们深入其内部实现：

```typescript
// react-server/src/ReactFlightServer.js（简化）

// RSC 渲染请求的核心数据结构
type Request = {
  destination: Destination;       // 输出流
  bundlerConfig: BundlerConfig;   // 用于解析 Client Component 引用
  cache: Map<Function, mixed>;    // 服务端缓存
  nextChunkId: number;            // 递增的行 ID
  pendingChunks: number;          // 未完成的异步块计数
  completedModuleChunks: Array<Chunk>; // 已完成的模块引用块
  completedJSONChunks: Array<Chunk>;   // 已完成的 JSON 块
  completedErrorChunks: Array<Chunk>;  // 错误块
  abortableTasks: Set<Task>;           // 可中止的任务集
};

function renderToReadableStream(
  model: ReactClientValue,
  bundlerConfig: BundlerConfig,
  options?: Options
): ReadableStream {
  const request = createRequest(model, bundlerConfig, options);

  const stream = new ReadableStream({
    start(controller) {
      // 开始渲染流程
      startWork(request);
    },
    pull(controller) {
      // 消费端请求更多数据时，刷新待发送的块
      startFlowing(request, controller);
    },
    cancel(reason) {
      // 流被取消时，中止所有待处理任务
      abort(request, reason);
    },
  });

  return stream;
}
```

序列化的核心是 `resolveModelToJSON` 函数，它递归地处理 React 元素树：

```typescript
// 简化的序列化逻辑
function resolveModelToJSON(
  request: Request,
  parent: { [key: string]: ReactClientValue },
  key: string,
  value: ReactClientValue
): ReactJSONValue {

  // 处理 React 元素
  if (
    typeof value === 'object' &&
    value !== null &&
    value.$$typeof === REACT_ELEMENT_TYPE
  ) {
    const element = value;

    if (typeof element.type === 'function') {
      // Server Component：直接执行函数，获取渲染结果
      // 这是 RSC 的核心——服务端调用组件函数
      try {
        const result = element.type(element.props);

        // 如果返回 Promise（async 组件），创建一个挂起的任务
        if (typeof result === 'object' && result !== null &&
            typeof result.then === 'function') {
          // 创建新的行 ID，标记为 pending
          const newTask = createTask(request, result, element.type);
          request.pendingChunks++;
          request.abortableTasks.add(newTask);

          // 返回延迟引用
          return serializeLazyID(newTask.id);
        }

        // 同步组件：递归处理返回结果
        return resolveModelToJSON(request, parent, key, result);
      } catch (thrownValue) {
        // 处理 Suspense throw
        if (typeof thrownValue === 'object' &&
            typeof thrownValue.then === 'function') {
          const newTask = createTask(request, thrownValue, element.type);
          request.pendingChunks++;
          return serializeLazyID(newTask.id);
        }
        throw thrownValue;
      }
    }

    if (typeof element.type === 'string') {
      // 宿主元素（div, span 等）：序列化为 ["$", type, key, props]
      return ['$', element.type, element.key, element.props];
    }

    if (isClientReference(element.type)) {
      // Client Component 引用：序列化模块信息
      const moduleId = resolveClientReferenceMetadata(
        request.bundlerConfig,
        element.type
      );
      // 输出 I 行：模块引用
      emitModuleChunk(request, moduleId);
      // 在元素树中使用 @ 引用
      return ['$', `@${moduleId.id}`, element.key, element.props];
    }
  }

  // 处理 Promise
  if (typeof value === 'object' && value !== null &&
      typeof value.then === 'function') {
    const promiseId = request.nextChunkId++;
    request.pendingChunks++;

    value.then(
      (resolvedValue) => {
        const processedChunk = processModelChunk(
          request, promiseId, resolvedValue
        );
        request.completedJSONChunks.push(processedChunk);
        flushCompletedChunks(request);
      },
      (reason) => {
        emitErrorChunk(request, promiseId, reason);
      }
    );

    return serializeLazyID(promiseId);
  }

  // 基本类型直接返回
  return value;
}
```

### 12.3.4 不可序列化值的处理策略

Server Component 的 props 必须是可序列化的，因为它们要通过 Flight 协议传输。以下类型会触发序列化错误：

```typescript
// 可以通过 Flight 协议序列化的类型
type SerializableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | bigint
  | Array<SerializableValue>
  | { [key: string]: SerializableValue }
  | Date
  | Map<SerializableValue, SerializableValue>
  | Set<SerializableValue>
  | FormData
  | ReadableStream
  | URL
  | URLSearchParams
  | RegExp
  | Promise<SerializableValue>
  | ReactElement           // 包含 Server/Client Component
  | ClientReference;       // "use client" 标记的引用

// 不可序列化（将报错）的类型
// ❌ 函数（除了 Client Reference 和 Server Action）
// ❌ Class 实例
// ❌ Symbol（除了 React 内部使用的）
// ❌ 包含循环引用的对象

// 特殊情况：Server Action 可以序列化
// 它们与 Client Reference 类似，被转换为引用 ID
async function deletePost(formData: FormData) {
  "use server";  // 这个函数可以作为 prop 传递给 Client Component
  const id = formData.get('id');
  await db.posts.delete({ where: { id } });
}
```

> **深度洞察**：Flight 协议的设计体现了一个重要的工程取舍——它选择了"行文本"而不是二进制格式。这看似低效，实际上是为了流式解析的简单性：每当收到一个换行符，客户端就可以立即解析并处理该行数据，无需维护复杂的二进制分帧状态机。HTTP/2 和 HTTP/3 的帧层已经提供了高效的二进制传输，应用层协议的简单性比压缩效率更有价值。

## 12.4 流式渲染（Streaming SSR）的实现原理

### 12.4.1 从 `renderToString` 到 `renderToPipeableStream`

React 18 引入了 `renderToPipeableStream`，它与传统的 `renderToString` 有根本性的区别：

```typescript
// 传统方式：等待全部渲染完成后一次性输出
// 如果有一个慢查询（如3秒），整个页面都被阻塞
import { renderToString } from 'react-dom/server';

app.get('/', (req, res) => {
  // ⚠️ 阻塞直到所有数据就绪
  const html = renderToString(<App />);
  res.send(html);
});

// 流式方式：边渲染边输出
import { renderToPipeableStream } from 'react-dom/server';

app.get('/', (req, res) => {
  const { pipe, abort } = renderToPipeableStream(
    <App />,
    {
      bootstrapScripts: ['/client.js'],
      onShellReady() {
        // Shell（非 Suspense 部分）准备就绪，开始发送
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        pipe(res);  // 开始流式传输
      },
      onShellError(error) {
        // Shell 渲染失败，发送降级方案
        res.statusCode = 500;
        res.send('<h1>服务器错误</h1>');
      },
      onAllReady() {
        // 所有内容（包括 Suspense 内容）都渲染完成
        // 用于爬虫/SSG 场景
      },
      onError(error) {
        console.error(error);
      },
    }
  );

  // 超时处理
  setTimeout(() => abort(), 10000);
});
```

### 12.4.2 Shell 与 Suspense 边界的流式交互

流式渲染的核心机制是将页面分为"Shell"和若干个"Suspense 岛屿"。Shell 是立即可用的 UI 骨架，Suspense 边界包裹的内容在数据就绪后逐块注入。

```tsx
// 服务端组件树
async function Page() {
  return (
    <html>
      <body>
        {/* Shell 部分 — 立即发送 */}
        <Header />
        <nav><Sidebar /></nav>

        <main>
          {/* Suspense 岛屿 1 — 数据就绪后注入 */}
          <Suspense fallback={<PostsSkeleton />}>
            <PostList />  {/* async: 需要查数据库 */}
          </Suspense>

          {/* Suspense 岛屿 2 — 独立的数据流 */}
          <Suspense fallback={<CommentsSkeleton />}>
            <RecentComments />  {/* async: 调用外部 API */}
          </Suspense>
        </main>

        <Footer />
      </body>
    </html>
  );
}
```

浏览器收到的 HTML 流大致如下：

```html
<!-- 第一块：Shell（立即发送） -->
<!DOCTYPE html>
<html>
<body>
  <header><!-- Header 内容 --></header>
  <nav><!-- Sidebar 内容 --></nav>
  <main>
    <!-- Suspense fallback 作为占位符 -->
    <template id="B:0"></template>
    <div class="posts-skeleton">加载中...</div>
    <!--/$-->

    <template id="B:1"></template>
    <div class="comments-skeleton">加载中...</div>
    <!--/$-->
  </main>
  <footer><!-- Footer 内容 --></footer>

<!-- 注意：HTML 没有关闭，流仍然在传输 -->
```

```html
<!-- 第二块：PostList 数据就绪（200ms 后） -->
<div hidden id="S:0">
  <article><h2>第一篇文章</h2><p>...</p></article>
  <article><h2>第二篇文章</h2><p>...</p></article>
</div>
<script>
  // React 的内联脚本：替换 fallback
  $RC("B:0", "S:0");
</script>
```

```html
<!-- 第三块：RecentComments 数据就绪（800ms 后） -->
<div hidden id="S:1">
  <div class="comment">用户A：写得好</div>
  <div class="comment">用户B：学到了</div>
</div>
<script>
  $RC("B:1", "S:1");
</script>

  </body>
</html>
<!-- 流结束 -->
```

### 12.4.3 `$RC` 函数：流式替换的微型运行时

`$RC`（React Completed）是 React 注入到 HTML 流中的一个极小的内联脚本函数，它负责将 Suspense fallback 替换为实际内容：

```typescript
// React 注入的流式替换运行时（简化自 react-dom/src/server/fizz-instruction-set）
function $RC(boundaryId: string, contentId: string) {
  const boundary = document.getElementById(boundaryId);
  const content = document.getElementById(contentId);

  if (boundary && content) {
    const parent = boundary.parentNode;
    // 收集 boundary 到 <!--/$--> 之间的 fallback 节点并移除
    let node = boundary.nextSibling;
    while (node && !(node.nodeType === 8 && node.data === '/$')) {
      const next = node.nextSibling;
      parent.removeChild(node);
      node = next;
    }
    // 将隐藏容器中的实际内容移到正确位置
    while (content.firstChild) {
      parent.insertBefore(content.firstChild, node);
    }
    boundary.remove();
    content.remove();
  }
}
```

这种设计的精妙之处在于：**它不需要客户端 JavaScript bundle 已经加载**。`$RC` 是一个内联脚本，它直接操作 DOM，在 React 的 JavaScript 都还没有下载完成时就已经在工作了。这意味着用户可以在最短的时间内看到实际内容，而不是一直盯着 skeleton 等待 bundle 加载。

### 12.4.4 RSC 流与 SSR 流的协作

在完整的 RSC + SSR 场景中，实际上存在两层流：

数据流方向为：**Flight Server**（渲染 Server Components，生成 RSC Payload 流） -> **Fizz Server**（消费 RSC Payload，渲染 Client Components，生成 HTML 流） -> **浏览器**（流式渲染 + Hydration）。

```typescript
// 完整的 RSC + SSR 服务端流程（简化）
import { renderToPipeableStream as renderRSC } from 'react-server-dom-webpack/server';
import { renderToPipeableStream as renderHTML } from 'react-dom/server';
import { createFromReadableStream } from 'react-server-dom-webpack/client.edge';

async function handleRequest(req: Request): Promise<Response> {
  // 第一层：RSC 渲染，生成 Flight Payload 流
  const rscPayloadStream = renderRSC(
    <App url={req.url} />,
    bundlerConfig
  );

  // 将 RSC Payload 流转换为 React 元素树
  // 这一步会消费 Flight 流，解析其中的 Client Component 引用
  const [rscStream1, rscStream2] = rscPayloadStream.tee();

  // 第二层：将 RSC Payload 解析为可渲染的 React 树
  const ServerOutput = createFromReadableStream(rscStream1);

  // 第三层：SSR 渲染，将 React 树转为 HTML 流
  const { pipe } = renderHTML(
    <ServerOutput />,
    {
      bootstrapScripts: ['/client.js'],
      onShellReady() {
        // HTML Shell 就绪，开始响应
        // 同时将 RSC Payload 内联到 HTML 流中
        // （客户端 hydration 需要 RSC Payload）
      }
    }
  );

  return new Response(pipe(), {
    headers: { 'Content-Type': 'text/html' }
  });
}
```

> **深度洞察**：两层流的设计看似复杂，实则解决了一个根本性的问题——**RSC Payload 必须同时服务于两个消费者**：SSR 渲染器需要它来生成初始 HTML，客户端 React 需要它来完成 hydration 和后续的客户端导航。`tee()` 操作将一个流分裂为两个，正是为了满足这个双重消费需求。

## 12.5 RSC 与 Next.js App Router 的深度集成

### 12.5.1 App Router 的请求处理管线

Next.js 的 App Router 是目前 RSC 最成熟的生产级实现。理解它的请求处理管线，是理解 RSC 实际运作方式的关键。

```typescript
// Next.js App Router 的请求处理（简化示意）
// 基于 next/src/server/app-render/app-render.tsx

async function renderToHTMLOrFlight(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  renderOpts: RenderOpts
): Promise<RenderResult> {

  // 判断是浏览器导航还是初始加载
  const isRSCRequest = req.headers['rsc'] !== undefined;
  // RSC 请求头表示这是客户端导航，只需要 Flight Payload
  // 非 RSC 请求是初始页面加载，需要完整 HTML

  // 构建组件树
  // App Router 中，文件系统 → 组件树的映射：
  // app/
  //   layout.tsx    → 根布局
  //   page.tsx      → 当前页面
  //   loading.tsx   → Suspense fallback
  //   error.tsx     → ErrorBoundary
  //   not-found.tsx → NotFound 边界

  const componentTree = (
    <Layout>           {/* app/layout.tsx - Server Component */}
      <Template>       {/* app/template.tsx (如果存在) */}
        <ErrorBoundary fallback={<Error />}>
          <Suspense fallback={<Loading />}>
            <Page params={params} searchParams={searchParams} />
          </Suspense>
        </ErrorBoundary>
      </Template>
    </Layout>
  );

  if (isRSCRequest) {
    // 客户端导航：只返回 RSC Flight Payload
    const flightPayload = renderToReadableStream(
      componentTree,
      clientReferenceManifest
    );
    return new RenderResult(flightPayload);
  } else {
    // 初始加载：返回完整 HTML（包含内联的 RSC Payload）
    return renderToInitialHTML(componentTree, clientReferenceManifest);
  }
}
```

### 12.5.2 客户端导航与 RSC 数据获取

在 App Router 中，客户端导航（点击 `<Link>`）不会导致全页面刷新，而是触发一次 RSC 请求：

```typescript
// 客户端导航流程（简化示意）
// next/src/client/components/app-router.tsx

function navigate(href: string, options: NavigateOptions) {
  // 1. 向服务端发送 RSC 请求
  const flightResponse = fetch(href, {
    headers: {
      'RSC': '1',                    // 标记这是 RSC 请求
      'Next-Router-State-Tree': JSON.stringify(currentTree),
      'Next-Router-Prefetch': options.prefetch ? '1' : undefined,
    },
  });

  // 2. 流式解析 Flight Payload
  const serverResponse = createFromFetch(flightResponse, {
    callServer,  // Server Actions 的 RPC 通道
  });

  // 3. 使用 startTransition 应用新状态
  // 这确保了导航期间旧 UI 保持可交互
  startTransition(() => {
    // 将解析后的 React 树应用到 Router 状态
    dispatch({
      type: ACTION_NAVIGATE,
      payload: {
        url: new URL(href, location.origin),
        tree: serverResponse,
        isExternalUrl: false,
      },
    });
  });
}
```

### 12.5.3 缓存与重验证机制

Next.js 在 RSC 之上构建了多层缓存：

Next.js 在 RSC 之上构建了四层缓存：**层级 1 - 客户端路由缓存**（缓存已访问页面的 RSC Payload，动态页面 TTL 30s，静态页面 5min）；**层级 2 - 全路由缓存**（服务端缓存静态渲染的路由，构建时生成）；**层级 3 - 数据缓存**（缓存 `fetch()` 响应，支持 `revalidate` 和 `revalidateTag`）；**层级 4 - React 请求去重**（`React.cache()` 在同一次渲染中自动去重重复请求）。

```tsx
// 缓存与重验证的实际使用

// 1. 基于时间的重验证
async function ProductList() {
  // 每 60 秒重新获取数据
  const products = await fetch('https://api.example.com/products', {
    next: { revalidate: 60 }
  }).then(r => r.json());

  return products.map(p => <ProductCard key={p.id} product={p} />);
}

// 2. 按需重验证（通过 Server Action）
"use server";
import { revalidateTag } from 'next/cache';

async function updateProduct(formData: FormData) {
  const id = formData.get('id') as string;
  await db.products.update({
    where: { id },
    data: { name: formData.get('name') as string }
  });

  // 使所有带 'products' 标签的缓存失效
  revalidateTag('products');
}

// 3. 请求级去重
import { cache } from 'react';

const getUser = cache(async (userId: string) => {
  const user = await db.users.findUnique({ where: { id: userId } });
  return user;
});

// 在同一次请求中，无论调用多少次 getUser('123')，
// 只会执行一次数据库查询
async function UserProfile({ userId }: { userId: string }) {
  const user = await getUser(userId);  // 查询
  return <div>{user.name}</div>;
}

async function UserAvatar({ userId }: { userId: string }) {
  const user = await getUser(userId);  // 命中缓存，不再查询
  return <img src={user.avatar} />;
}
```

### 12.5.4 部分预渲染（Partial Prerendering）

Next.js 14 引入的部分预渲染（PPR）将 RSC 的流式能力推向了极致——它在构建时生成静态 Shell，在请求时填充动态内容：

```tsx
// 部分预渲染的工作原理
// app/product/[id]/page.tsx

export default async function ProductPage({ params }: { params: { id: string } }) {
  return (
    <div>
      {/* 静态部分：构建时预渲染 */}
      <Header />
      <ProductLayout>
        {/* 动态部分：请求时流式填充 */}
        <Suspense fallback={<PriceSkeleton />}>
          <DynamicPrice productId={params.id} />
        </Suspense>

        <Suspense fallback={<StockSkeleton />}>
          <InventoryStatus productId={params.id} />
        </Suspense>

        {/* 静态部分 */}
        <ProductDescription productId={params.id} />
      </ProductLayout>
      <Footer />
    </div>
  );
}

// PPR 的效果：
// 1. 构建时：生成包含 Suspense fallback 的静态 HTML
// 2. 请求时：立即返回静态 Shell（从 CDN 边缘缓存）
// 3. 同时：在边缘节点开始动态渲染
// 4. 动态内容就绪后：流式注入到已发送的 HTML 中
//
// 结果：TTFB 接近静态站点，同时保持完全动态的能力
```

## 12.6 RSC 的性能模型与适用场景分析

### 12.6.1 RSC 的性能收益模型

RSC 的性能优势并非在所有场景下均匀分布。理解其收益模型需要分析多个维度：

RSC 的性能优势主要体现在三个维度：

**首次加载性能（FCP/LCP）**：传统 CSR 需要等待 JS 下载、解析、执行后才能渲染；传统 SSR 虽然首屏快，但 Hydration 仍需要全量 JS。RSC + Streaming SSR 在发送 Shell 后即可让用户看到有意义的内容，Suspense 边界的内容逐步流式填充。

**JavaScript Bundle 大小**：传统应用打包全部组件和依赖，RSC 应用只打包 Client Component 及其依赖。在内容密集型应用中，bundle 体积可减少 40-70%。

**客户端导航性能**：传统 SPA 需要下载新路由的 JS chunk 并执行，RSC 只需获取 Flight Payload（数据+结构，而非代码+数据），通常体积远小于 JS chunk。

### 12.6.2 序列化开销与数据瀑布

RSC 也有其固有的性能陷阱，最常见的两个是序列化开销和数据瀑布：

```tsx
// 陷阱一：过大的 props 导致 RSC Payload 膨胀
// ❌ 反模式：将大量数据作为 props 传递给 Client Component
async function DataPage() {
  const allRecords = await db.records.findMany(); // 10000 条记录

  return (
    // 这 10000 条记录会全部序列化到 RSC Payload 中
    // Payload 可能达到数 MB
    <InteractiveTable data={allRecords} />
  );
}

// ✅ 改进：在 Server Component 中完成数据处理
async function DataPage() {
  const allRecords = await db.records.findMany();

  // 在服务端进行聚合和筛选
  const summary = {
    total: allRecords.length,
    categories: groupBy(allRecords, 'category'),
    topItems: allRecords.slice(0, 50),
  };

  return <InteractiveTable summary={summary} />;
}
```

```tsx
// 陷阱二：顺序数据获取（Request Waterfall）
// ❌ 串行获取：每个 await 都阻塞后续渲染
async function Dashboard() {
  const user = await getUser();           // 100ms
  const posts = await getPosts(user.id);  // 200ms（等 user 完成后才开始）
  const stats = await getStats(user.id);  // 150ms（等 posts 完成后才开始）
  // 总耗时：~450ms

  return <DashboardView user={user} posts={posts} stats={stats} />;
}

// ✅ 并行获取：利用 Promise.all 或组件级并行
async function Dashboard() {
  const user = await getUser();
  // 利用 Promise.all 并行获取独立数据
  const [posts, stats] = await Promise.all([
    getPosts(user.id),
    getStats(user.id),
  ]);
  // 总耗时：~300ms (100ms + max(200ms, 150ms))

  return <DashboardView user={user} posts={posts} stats={stats} />;
}

// ✅✅ 最优方案：利用 Suspense 实现组件级并行流式渲染
async function Dashboard() {
  const user = await getUser();

  return (
    <div>
      <UserInfo user={user} />
      {/* 这两个 Suspense 边界的数据获取完全并行 */}
      <Suspense fallback={<PostsSkeleton />}>
        <PostList userId={user.id} />  {/* 内部 await getPosts() */}
      </Suspense>
      <Suspense fallback={<StatsSkeleton />}>
        <StatsPanel userId={user.id} /> {/* 内部 await getStats() */}
      </Suspense>
    </div>
  );
  // 用户立即看到 Shell + UserInfo
  // PostList 和 StatsPanel 各自独立加载，谁先就绪谁先显示
}
```

### 12.6.3 适用场景决策树

```
你应该用 RSC 吗？决策树:

你的页面有大量静态/只读内容吗？
├── 是 → RSC 非常适合
│   ├── 博客/文档类页面 → RSC 是最佳选择
│   ├── 电商产品页 → RSC + 少量 Client Component
│   └── 数据仪表盘 → RSC Shell + Client 交互组件
│
├── 否 → 大部分是高交互内容
│   ├── 实时协作工具 (如 Figma 类) → RSC 价值有限
│   ├── 游戏/画布类应用 → 不适合 RSC
│   └── 富文本编辑器 → Client Component 为主
│
└── 混合场景
    ├── 社交媒体 Feed → RSC 渲染帖子 + Client 交互
    ├── SaaS 管理后台 → RSC 布局/列表 + Client 表单/图表
    └── 需要离线能力 → 需要仔细设计 Server/Client 边界
```

### 12.6.4 RSC 与其他方案的对比

RSC 并非唯一的服务端渲染方案，理解它与其他方案的差异有助于做出正确选择：

**RSC vs 传统 SSR + Hydration**：传统 SSR 将全部组件代码发送到客户端进行全量 Hydration，而 RSC 只对 Client Component 进行 Hydration。在典型电商页面中，RSC 可以将 Hydration 耗时从 200-500ms 降低到 50-150ms。

**RSC vs Islands Architecture (Astro)**：Islands 的理念是"静态优先，交互例外"——页面默认是静态 HTML，交互区域作为独立岛屿 hydrate。RSC 则是"服务端优先，交互下放"——所有组件默认在服务端运行，只有需要交互的才下放到客户端。RSC 的优势是支持 SPA 式的客户端导航和更细粒度的 Server/Client 组合。

**RSC vs 纯客户端 SPA**：SPA 不需要服务端、部署简单。但如果应用主要服务搜索引擎流量，或有大量静态内容，RSC 通过减少 bundle 体积和提供更快的首屏，可以带来显著的用户体验提升。

### 12.6.5 RSC 的底层约束与未来方向

RSC 当前仍然存在一些工程约束，了解这些约束对做出正确的架构决策至关重要：

```typescript
// 约束 1: Server Component 不能使用 React 状态和副作用
// 这是设计如此，不是缺陷——Server Component 是纯函数

// 约束 2: Server Component 与 Client Component 之间的数据流是单向的
// Server → Client: 通过 props（必须可序列化）
// Client → Server: 通过 Server Actions（"use server"）

// 约束 3: Server Component 不支持 Class Component
// 只有函数组件（包括 async 函数组件）可以是 Server Component

// 约束 4: 第三方库兼容性
// 任何使用了 useState/useEffect/浏览器 API 的库
// 都需要在 "use client" 边界内使用
// 这可能需要创建包装组件：
"use client";
import { Chart } from 'third-party-chart-lib'; // 使用了 useRef + canvas
export { Chart }; // 重导出为 Client Component

// 未来方向:
// 1. Server Component 的部分重渲染（避免全组件树重新序列化）
// 2. 更细粒度的缓存失效机制
// 3. 跨请求的 Server Component 状态持久化
// 4. 与 Edge Runtime 的深度集成（将 RSC 渲染推到 CDN 边缘）
```

> **深度洞察**：RSC 最深远的影响不在于技术层面，而在于它重新定义了"React 开发者"的职责边界。在 RSC 出现之前，React 开发者通常只关心浏览器端的渲染。RSC 之后，一个 React 组件可能直接执行数据库查询、读取文件系统、调用内部微服务——React 开发者需要同时具备前端和后端的思维模式。这不是一个工具链的变化，这是一个角色定义的变化。

## 12.7 本章小结

React Server Components 代表着 React 架构的一次根本性演进——从"客户端渲染框架"走向"全栈组件框架"。这次演进不是为了追赶时髦，而是对"组件应该在哪里运行"这个长期被忽视的问题给出了一个优雅的答案。

关键要点：

1. **RSC 的核心价值是"零 bundle size"组件**：Server Component 的代码和依赖永远不会传输到客户端，这在内容密集型应用中可以减少 40-70% 的 JavaScript 体积
2. **`"use client"` 是编译器边界，不是运行时 API**：它在模块依赖图中创建了 Server/Client 的分割线，最佳实践是将这条线推到尽可能靠近叶子节点的位置
3. **Flight 协议是 RSC 的传输层**：它使用行文本格式支持流式解析，每行数据都可以被独立处理，使得客户端可以在服务端还在渲染时就开始处理数据
4. **流式 SSR 通过 Suspense 边界实现增量交付**：Shell 立即发送，Suspense 包裹的内容在数据就绪后通过内联脚本注入
5. **RSC 不是银弹**：高交互应用、实时协作工具、离线优先应用中 RSC 的价值有限，正确的架构决策需要理解其性能模型的适用范围

在下一章中，我们将深入 Server Actions 与数据流——这是 RSC 的"写入端"。如果说 Server Component 解决了"如何优雅地读取数据"，那么 Server Actions 则瞄准了"如何优雅地变更数据"。二者共同构成了 React 全栈数据流的完整拼图。

> **课程关联**：本章内容对应慕课网课程《React 源码深度解析》的扩展部分。RSC 架构建立在前几章介绍的 Fiber、Reconciliation、并发模式等基础之上，建议先完成课程核心部分的学习：[https://coding.imooc.com/class/650.html](https://coding.imooc.com/class/650.html)

---

### 思考题

1. **为什么 Flight 协议选择行文本格式而不是更紧凑的二进制格式（如 Protocol Buffers 或 MessagePack）？** 从流式解析的复杂度、HTTP/2 帧层的压缩、调试可观测性三个角度分析这个设计决策的合理性。

2. **考虑以下场景**：一个 Server Component 需要根据用户的浏览器语言偏好（`Accept-Language` 请求头）渲染不同的内容。但 Server Component 没有对 `request` 对象的直接访问。请设计一种方案，使得 Server Component 能够获取请求头信息，同时不破坏组件的可缓存性。分析 Next.js 的 `headers()` API 是如何实现这一点的。

3. **RSC 的 Selective Hydration 机制允许 React 优先 hydrate 用户正在交互的 Suspense 边界。** 假设一个页面有 3 个 Suspense 边界 A、B、C 依次加载完成，但用户在 B 加载完成之前点击了 C 区域。请分析 React 的 hydration 优先级调度策略：C 是否会"插队"优先于 B 完成 hydration？如果 C 内部还有嵌套的 Suspense 边界会怎样？

4. **RSC 的数据获取模式（async Server Component）与 Relay 的 "render-as-you-fetch" 模式有什么异同？** 从数据瀑布问题的角度分析，RSC 是否完全解决了瀑布问题？如果没有，它提供了哪些工具来缓解这个问题？

</div>
