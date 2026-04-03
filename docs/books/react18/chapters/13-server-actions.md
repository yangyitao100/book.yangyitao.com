<div v-pre>

# 第13章 Server Actions 与数据流

> **本章要点**
>
> - 从 API Routes 到 Server Actions：服务端调用范式的三次跃迁
> - "use server" 指令的编译时处理：如何将函数调用转化为网络请求
> - Action ID 的生成算法：哈希、模块路径与函数位置的三元组
> - FormData 序列化与渐进增强：没有 JavaScript 的表单如何工作
> - 乐观更新与错误处理的统一模型：useOptimistic 与 useActionState 的协作
> - CSRF 防护与闭包变量泄露：Server Actions 的安全攻击面分析
> - Server Actions 与 React Server Components 的数据流闭环

---

在传统的 Web 开发中，前端与后端之间始终存在一道鸿沟——HTTP 协议。无论你使用 REST、GraphQL 还是 tRPC，开发者都必须手动定义请求格式、维护 API 端点、处理序列化与反序列化。这些"胶水代码"在一个全栈应用中往往占据了惊人的比例。React Server Actions 的出现，正是为了消除这道鸿沟。

Server Actions 让你可以在客户端组件中直接调用服务端函数，就像调用一个普通的异步函数一样。编译器负责将这个"函数调用"转化为一个 HTTP 请求，将参数序列化为请求体，将返回值反序列化为客户端可用的数据。这听起来像是 RPC（远程过程调用）的老概念，但 React 的实现远比传统 RPC 深刻——它将服务端调用与表单提交、乐观更新、错误边界、并发渲染等 React 核心机制深度融合，形成了一套完整的数据变更（mutation）基础设施。

本章将从编译时到运行时，完整剖析 Server Actions 的内部机制。我们会看到"use server"这两个字背后的编译器魔法，理解 Action ID 的生成策略，分析 FormData 序列化的工程细节，深入乐观更新的双层状态模型，最后严肃审视 Server Actions 引入的安全风险。

## 13.1 从 API Routes 到 Server Actions：服务端调用范式的进化

### 13.1.1 三代服务端调用范式

让我们用一个简单的"创建待办事项"场景，回顾服务端调用范式的三次进化：

**第一代：手动 fetch + API Routes**

```typescript
// pages/api/todos.ts（服务端）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { title } = req.body;
    const todo = await db.todo.create({ data: { title } });
    res.status(201).json(todo);
  }
}

// components/TodoForm.tsx（客户端）
function TodoForm() {
  const [title, setTitle] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to create todo');
      const todo = await res.json();
      // 还需要手动更新 UI...
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={title} onChange={e => setTitle(e.target.value)} />
      <button disabled={isPending}>
        {isPending ? 'Adding...' : 'Add'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
```

数一数这段代码中的"胶水"：API 路由定义、HTTP 方法判断、请求头设置、JSON 序列化/反序列化、手动 pending 状态管理、手动错误处理、手动 UI 刷新。真正的业务逻辑只有一行：`db.todo.create({ data: { title } })`。

**第二代：tRPC / React Query**

```typescript
// server/routers/todo.ts
export const todoRouter = router({
  create: publicProcedure
    .input(z.object({ title: z.string() }))
    .mutation(async ({ input }) => {
      return db.todo.create({ data: { title: input.title } });
    }),
});

// components/TodoForm.tsx
function TodoForm() {
  const utils = trpc.useUtils();
  const mutation = trpc.todo.create.useMutation({
    onSuccess: () => utils.todo.list.invalidate(),
  });

  return (
    <form onSubmit={e => {
      e.preventDefault();
      mutation.mutate({ title: e.currentTarget.title.value });
    }}>
      <input name="title" />
      <button disabled={mutation.isPending}>
        {mutation.isPending ? 'Adding...' : 'Add'}
      </button>
      {mutation.error && <p className="error">{mutation.error.message}</p>}
    </form>
  );
}
```

tRPC 消除了 HTTP 层的样板代码，提供了端到端的类型安全。但它仍然是一个独立于 React 的解决方案——pending 状态、错误处理、缓存失效都由第三方库管理，与 React 的并发渲染和 Suspense 是"贴合"而非"融合"。

**第三代：Server Actions**

```typescript
// app/actions.ts
'use server';

export async function createTodo(formData: FormData) {
  const title = formData.get('title') as string;
  const todo = await db.todo.create({ data: { title } });
  revalidatePath('/todos');
  return todo;
}

// components/TodoForm.tsx
import { createTodo } from '@/app/actions';

function TodoForm() {
  const [state, formAction, isPending] = useActionState(createTodo, null);

  return (
    <form action={formAction}>
      <input name="title" />
      <button disabled={isPending}>
        {isPending ? 'Adding...' : 'Add'}
      </button>
    </form>
  );
}
```

Server Actions 带来的简化是质的飞跃：没有 API 路由、没有 fetch、没有手动序列化、pending 状态由 React 内建追踪、表单即使在 JavaScript 未加载时也能通过原生 HTML 表单提交工作。更重要的是，这不是一个独立的数据层方案，而是 React 渲染引擎的一部分。

### 13.1.2 Server Actions 的本质：RPC 的 React 化

Server Actions 的设计灵感来自远程过程调用（RPC），但它超越了传统 RPC 的范畴。传统 RPC 框架关注的是"如何让远程调用看起来像本地调用"，而 Server Actions 关注的是"如何让服务端数据变更与 React 的渲染模型无缝集成"。

```
传统 RPC:    Client Function Call → Network → Server Function Execution → Return Value
Server Actions: Client Form/Action → Transition → Network → Server Function → RSC Re-render → Streaming UI Update
```

关键区别在于中间的"Transition"和末尾的"RSC Re-render"。Server Actions 的调用被包装在 React 的 Transition 中，这意味着：

1. **调用期间，旧 UI 保持交互性**——不会出现空白或 loading 闪烁
2. **返回的不仅是数据，而是重新渲染后的 RSC 流**——服务端组件树自动更新
3. **乐观更新、错误回退、并发调用都由 React 统一调度**——开发者无需自建状态机

> **深度洞察**：Server Actions 最深刻的创新不在于"消除 API 路由"，而在于将数据变更（mutation）纳入了 React 的声明式范式。在 Server Actions 之前，React 是一个优秀的"读取框架"——从 state 到 UI 的映射是声明式的。但数据的写入、提交、乐观更新却是命令式的。Server Actions 让数据写入也变成了声明式的：你声明一个 action，React 负责执行时机、状态追踪、错误恢复和 UI 更新。

## 13.2 "use server" 指令的编译时处理

### 13.2.1 指令的语义

`"use server"` 是 React 引入的第二个指令（第一个是 `"use client"`）。它有两种使用方式：

```typescript
// 方式 1：模块级指令——整个文件中导出的所有函数都是 Server Actions
'use server';

export async function createTodo(formData: FormData) {
  // 这是一个 Server Action
}

export async function deleteTodo(id: string) {
  // 这也是一个 Server Action
}

// 方式 2：函数级指令——单个函数声明为 Server Action
export function TodoList() {
  async function handleDelete(id: string) {
    'use server';
    // 这个内联函数是一个 Server Action
    await db.todo.delete({ where: { id } });
    revalidatePath('/todos');
  }

  return <DeleteButton onDelete={handleDelete} />;
}
```

从语法上看，`"use server"` 只是一个字符串字面量。但编译器对它的处理极为关键——它决定了一段代码是在服务端执行还是被替换为一个网络调用的 stub。

### 13.2.2 编译器的转换过程

当编译器遇到 `"use server"` 指令时，它执行以下转换。让我们以一个具体的例子来追踪整个过程：

**编译前（开发者编写的代码）：**

```typescript
// app/actions.ts
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function createTodo(title: string, priority: number) {
  const todo = await db.todo.create({
    data: { title, priority, completed: false },
  });
  revalidatePath('/todos');
  return { id: todo.id, title: todo.title };
}

export async function toggleTodo(id: string) {
  const todo = await db.todo.findUnique({ where: { id } });
  await db.todo.update({
    where: { id },
    data: { completed: !todo.completed },
  });
  revalidatePath('/todos');
}
```

**编译后（客户端收到的代码）：**

```typescript
// app/actions.ts（客户端版本）
import { createServerReference } from 'react-server-dom-webpack/client';
import { callServer } from '@/lib/server-runtime';

export const createTodo = createServerReference(
  'a1b2c3d4e5f6', // Action ID
  callServer
);

export const toggleTodo = createServerReference(
  'f6e5d4c3b2a1', // Action ID
  callServer
);
```

注意编译器做了什么：

1. **删除了所有的服务端代码**——`db` 导入、数据库操作、`revalidatePath` 调用全部消失
2. **为每个导出函数生成了唯一的 Action ID**
3. **用 `createServerReference` 创建了代理函数**——它们看起来是普通的异步函数，但实际上会发起网络请求

**编译后（服务端保留的代码）：**

```typescript
// app/actions.ts（服务端版本）
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { registerServerReference } from 'react-server-dom-webpack/server';

async function createTodo(title: string, priority: number) {
  const todo = await db.todo.create({
    data: { title, priority, completed: false },
  });
  revalidatePath('/todos');
  return { id: todo.id, title: todo.title };
}

async function toggleTodo(id: string) {
  const todo = await db.todo.findUnique({ where: { id } });
  await db.todo.update({
    where: { id },
    data: { completed: !todo.completed },
  });
  revalidatePath('/todos');
}

// 编译器注入的注册代码
registerServerReference(createTodo, 'app/actions.ts', 'createTodo');
registerServerReference(toggleTodo, 'app/actions.ts', 'toggleTodo');
```

服务端版本保留了原始逻辑，但额外调用了 `registerServerReference` 将函数注册到一个全局映射表中，以便运行时通过 Action ID 找到对应的函数。

### 13.2.3 Action ID 的生成算法

Action ID 是连接客户端代理和服务端实现的桥梁。它的生成需要满足两个看似矛盾的要求：

1. **确定性**——同一个函数在每次编译中必须生成相同的 ID，否则客户端缓存的引用会失效
2. **唯一性**——不同函数的 ID 必须不同，否则会调用错误的函数

React 的参考实现使用以下策略生成 Action ID：

```typescript
// react-server-dom-webpack 的 Action ID 生成逻辑
function generateActionId(
  moduleId: string,        // 模块的文件路径或构建 ID
  exportName: string       // 导出的函数名
): string {
  // 对于模块级 "use server"，使用模块 ID + 导出名
  // 例如：hash("app/actions.ts" + "#" + "createTodo")
  const raw = moduleId + '#' + exportName;

  // 使用 SHA-1 或类似的哈希算法生成固定长度的 ID
  const hash = createHash(raw);

  return hash;
}

// 对于函数级 "use server"（内联 Server Action），情况更复杂
function generateInlineActionId(
  moduleId: string,
  functionName: string,
  closureVariables: string[]  // 闭包捕获的变量列表
): string {
  // 内联 Action 可能捕获外部变量
  // 这些变量需要被序列化传输到服务端
  // Action ID 需要编码闭包信息
  const raw = moduleId + '#' + functionName + '(' + closureVariables.join(',') + ')';
  return createHash(raw);
}
```

> **深度洞察**：Action ID 的生成策略揭示了一个深层的架构决策——Server Actions 是编译时特性，不是运行时特性。你不能在运行时动态创建一个 Server Action，就像你不能在运行时创建一个新的 API 端点一样。编译器必须在构建时枚举所有可能的 Server Actions，为每个生成 ID，并建立客户端到服务端的映射。这个约束也是安全性的基础——只有编译时注册的函数才能被远程调用，运行时无法注入新的服务端函数。

### 13.2.4 闭包变量的序列化

内联 Server Actions 可以捕获外部作用域的变量，这带来了独特的编译挑战：

```typescript
function TodoItem({ todo }: { todo: Todo }) {
  async function handleToggle() {
    'use server';
    // 这里捕获了 todo.id——一个来自客户端的值
    await db.todo.update({
      where: { id: todo.id },
      data: { completed: !todo.completed },
    });
    revalidatePath('/todos');
  }

  return (
    <form action={handleToggle}>
      <button>{todo.title}</button>
    </form>
  );
}
```

编译器对这段代码的处理相当精妙：

```typescript
// 编译后的客户端代码
function TodoItem({ todo }: { todo: Todo }) {
  // 闭包变量被提取为 bound arguments
  const handleToggle = createServerReference('x7y8z9', callServer)
    .bind(null, todo.id); // todo.id 作为绑定参数

  return (
    <form action={handleToggle}>
      <button>{todo.title}</button>
    </form>
  );
}

// 编译后的服务端代码
async function handleToggle(
  todoId: string // 闭包变量变成了函数参数
) {
  await db.todo.update({
    where: { id: todoId },
    data: { completed: true }, // 注意：todo.completed 的值在编译时不可知
  });
  revalidatePath('/todos');
}
registerServerReference(handleToggle, 'components/TodoItem.tsx', 'handleToggle');
```

编译器将闭包变量"提升"为函数参数，并在客户端使用 `Function.prototype.bind` 预填充这些参数。当 action 被调用时，绑定的参数会随请求一起发送到服务端。

这个机制优雅但也引入了安全风险——我们将在 13.5 节详细讨论。

## 13.3 Actions 与表单：渐进增强的全栈表单

### 13.3.1 `<form action>` 的复兴

HTML 原生的 `<form>` 元素一直支持 `action` 属性——它指定表单提交的 URL。React 19 对这个属性进行了扩展：当 `action` 是一个函数时，React 会接管表单提交行为。

```tsx
// React 19 的 form action 支持三种类型
<form action="/api/submit">        {/* 传统 URL：原生表单提交 */}
<form action={serverAction}>       {/* Server Action 函数 */}
<form action={clientFunction}>     {/* 客户端函数 */}
```

当 `action` 是一个函数时，React 的处理流程如下：

```typescript
// ReactDOMComponent.js 中 form 提交的核心逻辑（简化）
function handleFormSubmit(
  event: SubmitEvent,
  form: HTMLFormElement,
  action: Function
) {
  // 1. 阻止原生表单提交
  event.preventDefault();

  // 2. 收集 FormData
  const formData = new FormData(form);

  // 3. 提取 submitter 信息（如果有）
  const submitter = event.submitter;
  if (submitter && submitter.name) {
    formData.append(submitter.name, submitter.value);
  }

  // 4. 在 Transition 中调用 action
  startTransition(async () => {
    try {
      // 如果是 Server Action，这里会触发网络请求
      // 如果是客户端函数，这里直接执行
      const result = await action(formData);

      // 5. 如果 action 返回了新的 RSC payload，应用更新
      if (result && typeof result === 'object') {
        applyServerActionResult(result);
      }
    } catch (error) {
      // 6. 错误会被最近的 Error Boundary 捕获
      throw error;
    }
  });
}
```

这段代码中有几个关键设计决策：

1. **使用 `startTransition` 包装**——这使得表单提交期间旧 UI 保持响应
2. **自动构造 `FormData`**——开发者不需要手动收集表单数据
3. **submitter 信息保留**——多个提交按钮场景下能区分是哪个按钮触发了提交
4. **错误委托给 Error Boundary**——与 React 的错误处理机制统一

### 13.3.2 渐进增强：没有 JavaScript 的表单

Server Actions 最具工程意义的设计之一是渐进增强（Progressive Enhancement）。当页面的 JavaScript 还未加载或执行失败时，表单仍然可以工作。

这是如何实现的？关键在于服务端渲染的 HTML 输出：

```typescript
// 使用 Server Action 的组件
function SearchForm() {
  async function search(formData: FormData) {
    'use server';
    const query = formData.get('q') as string;
    redirect(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <form action={search}>
      <input name="q" placeholder="Search..." />
      <button type="submit">Search</button>
    </form>
  );
}
```

服务端渲染输出的 HTML：

```html
<form method="POST" action="/search?_rsc=..." enctype="multipart/form-data">
  <input type="hidden" name="$ACTION_ID" value="a1b2c3d4e5f6" />
  <input name="q" placeholder="Search..." />
  <button type="submit">Search</button>
</form>
```

注意服务端渲染做了什么：

1. **添加了 `method="POST"`**——Server Actions 默认使用 POST 方法
2. **`action` 被替换为一个特殊的 URL**——指向框架的 Server Action 处理端点
3. **注入了隐藏的 `$ACTION_ID` 字段**——服务端通过这个 ID 找到对应的函数
4. **`enctype` 设为 `multipart/form-data`**——确保二进制数据（文件上传）也能正确传输

当 JavaScript 未加载时，浏览器的原生表单提交机制会将数据 POST 到 action URL。服务端收到请求后：

```typescript
// 框架的 Server Action 请求处理器（简化）
async function handleServerActionRequest(request: Request): Promise<Response> {
  const formData = await request.formData();

  // 1. 提取 Action ID
  const actionId = formData.get('$ACTION_ID') as string;
  formData.delete('$ACTION_ID');

  // 2. 从注册表中查找对应的函数
  const actionFn = serverActionRegistry.get(actionId);
  if (!actionFn) {
    return new Response('Action not found', { status: 404 });
  }

  // 3. 执行 action
  try {
    const result = await actionFn(formData);

    // 4. 判断请求类型
    const isRSCRequest = request.headers.get('Accept')?.includes('text/x-component');

    if (isRSCRequest) {
      // JavaScript 已加载：返回 RSC 流
      return new Response(renderToRSCStream(result), {
        headers: { 'Content-Type': 'text/x-component' },
      });
    } else {
      // JavaScript 未加载：执行传统的重定向或页面刷新
      return Response.redirect(request.url, 303);
    }
  } catch (error) {
    // 错误处理
    return new Response('Action failed', { status: 500 });
  }
}
```

这段代码的第 4 步揭示了渐进增强的核心：服务端通过检查请求头来判断客户端是否支持 RSC 流。如果支持（JavaScript 已加载），返回高效的 RSC 流式响应；如果不支持（JavaScript 未加载），执行传统的 HTTP 重定向，触发浏览器的全页面刷新。

> **深度洞察**：渐进增强不仅是一个"优雅降级"的策略，它实际上改变了 Web 应用的可靠性模型。在传统 SPA 中，如果 JavaScript 加载失败（CDN 故障、网络不稳定、浏览器扩展冲突），整个应用就变成了一个空白页面。而使用 Server Actions 的表单在 JavaScript 失效时仍然能够提交数据——用户体验会降级（没有乐观更新、没有即时反馈），但核心功能不会丧失。这是 Server Actions 相比 tRPC 或 React Query 等方案最本质的区别。

### 13.3.3 FormData 序列化的细节

当 JavaScript 已加载时，React 不使用原生表单提交，而是通过 `fetch` 发送 Server Action 请求。此时的序列化过程更为精细：

```typescript
// react-server-dom-webpack/client 中的请求构造逻辑（简化）
async function callServerAction(
  actionId: string,
  args: unknown[]
): Promise<unknown> {
  // 1. 序列化参数
  // Server Actions 使用 React 的 Flight 序列化格式
  // 它比 JSON 更强大，支持：
  // - FormData 原生传输
  // - Date 对象
  // - BigInt
  // - 嵌套的 Promise（在某些场景下）
  // - React 元素（作为 Server Reference）

  let body: BodyInit;
  let contentType: string;

  if (args.length === 1 && args[0] instanceof FormData) {
    // FormData 参数：直接作为 multipart/form-data 发送
    const formData = args[0] as FormData;
    formData.append('$ACTION_ID', actionId);

    // 绑定参数（闭包变量）需要额外编码
    if (boundArgs.length > 0) {
      formData.append(
        '$ACTION_BOUND',
        encodeFlightData(boundArgs)
      );
    }

    body = formData;
    // 不设置 Content-Type——让浏览器自动生成 boundary
  } else {
    // 非 FormData 参数：使用 Flight 编码
    body = encodeFlightData([actionId, ...args]);
    contentType = 'text/x-component';
  }

  // 2. 发送请求
  const response = await fetch(actionEndpoint, {
    method: 'POST',
    body,
    headers: contentType ? { 'Content-Type': contentType } : {},
  });

  // 3. 解析响应（RSC Flight 流）
  return decodeFlightResponse(response);
}
```

这里有一个微妙但重要的细节：当参数是 `FormData` 时，React 不设置 `Content-Type` 头。这是因为 `multipart/form-data` 格式需要一个随机生成的 boundary 字符串来分隔各个字段，而这个 boundary 必须出现在 `Content-Type` 头中。如果手动设置了 `Content-Type`，浏览器不会自动添加 boundary，导致服务端解析失败。

```
// 正确的请求头（浏览器自动生成）
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW

// 错误：手动设置但缺少 boundary
Content-Type: multipart/form-data
```

### 13.3.4 `useActionState` 的完整运作机制

`useActionState` 是 Server Actions 在客户端的核心 API，它将 action 函数、状态管理、pending 追踪三者合一：

```typescript
// useActionState 的类型签名
function useActionState<State>(
  action: (prevState: State, formData: FormData) => State | Promise<State>,
  initialState: State,
  permalink?: string
): [state: State, dispatch: (formData: FormData) => void, isPending: boolean];
```

让我们看看它的内部实现原理：

```typescript
// react-dom/src/shared/ReactDOMFormActions.js（简化重构）
function useActionState<State>(
  action: (prevState: State, formData: FormData) => State | Promise<State>,
  initialState: State,
  permalink?: string
): [State, (formData: FormData) => void, boolean] {
  // 内部使用 useReducer 管理状态
  const [state, dispatch] = useReducer(
    actionStateReducer,
    initialState
  );

  // pending 状态通过 Transition 自动追踪
  const [isPending, startTransition] = useTransition();

  // 构造 dispatch 函数
  const formAction = useCallback(
    (formData: FormData) => {
      startTransition(async () => {
        // 调用 action，传入当前 state 和 formData
        const newState = await action(state, formData);
        // 用新状态更新 reducer
        dispatch(newState);
      });
    },
    [action, state, startTransition]
  );

  // 如果提供了 permalink，在 SSR 时生成原生表单目标
  // 这是渐进增强的关键
  if (permalink) {
    attachPermalinkToForm(formAction, permalink);
  }

  return [state, formAction, isPending];
}

function actionStateReducer<State>(
  prevState: State,
  newState: State
): State {
  return newState;
}
```

`permalink` 参数值得特别关注。它用于渐进增强场景——当 JavaScript 未加载时，表单需要一个真实的 URL 来提交。`permalink` 就是这个 URL：

```tsx
function SearchForm() {
  const [results, formAction, isPending] = useActionState(
    searchAction,
    [],
    '/search' // permalink：JS 未加载时的回退 URL
  );

  return (
    <form action={formAction}>
      <input name="q" />
      <button>Search</button>
      {results.map(r => <SearchResult key={r.id} result={r} />)}
    </form>
  );
}
```

服务端渲染时，如果检测到 `permalink`，会在 HTML 中生成 `<form action="/search" method="POST">` 而不是默认的 RSC 端点，确保没有 JavaScript 时用户仍然会被导航到有意义的页面。

## 13.4 乐观更新与错误处理的统一模型

### 13.4.1 乐观更新的需求

在任何涉及网络请求的 UI 中，"等待响应"都是用户体验的杀手。如果点击"点赞"按钮后需要等待 200ms 的网络延迟才能看到数字变化，整个界面就会让人感到迟钝。乐观更新（Optimistic Update）的策略是：**先假设操作会成功，立即更新 UI，如果操作失败再回退**。

React 19 通过 `useOptimistic` 将这个模式标准化：

```typescript
function LikeButton({ postId, initialCount }: { postId: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const [optimisticCount, addOptimistic] = useOptimistic(
    count,
    (currentCount: number, increment: number) => currentCount + increment
  );

  async function handleLike() {
    addOptimistic(1); // 立即 +1（乐观）

    // 实际的 Server Action 调用
    const newCount = await likePost(postId);
    setCount(newCount); // 用真实值替换乐观值
  }

  return (
    <form action={handleLike}>
      <button>❤️ {optimisticCount}</button>
    </form>
  );
}
```

### 13.4.2 双层状态模型的实现

`useOptimistic` 的内核是一个双层状态模型：

```typescript
// ReactFiberHooks.js 中 useOptimistic 的核心实现（简化）
function mountOptimistic<S, A>(
  passthrough: S,
  reducer: ((state: S, action: A) => S) | null
): [S, (action: A) => void] {
  const hook = mountWorkInProgressHook();

  hook.memoizedState = hook.baseState = passthrough;
  const queue: UpdateQueue<S, A> = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: optimisticReducer,
    lastRenderedState: passthrough,
  };
  hook.queue = queue;

  const dispatch = dispatchOptimisticSetState.bind(
    null,
    currentlyRenderingFiber,
    true, // isOptimistic 标志
    queue
  );
  queue.dispatch = dispatch;

  return [passthrough, dispatch];
}

function updateOptimistic<S, A>(
  passthrough: S,
  reducer: ((state: S, action: A) => S) | null
): [S, (action: A) => void] {
  const hook = updateWorkInProgressHook();

  // 关键逻辑：如果没有 pending 的乐观更新，直接使用 passthrough
  // 如果有 pending 的乐观更新，将它们应用到 passthrough 上
  return updateOptimisticImpl(hook, passthrough, reducer);
}

function updateOptimisticImpl<S, A>(
  hook: Hook,
  passthrough: S,
  reducer: ((state: S, action: A) => S) | null
): [S, (action: A) => void] {
  const queue = hook.queue;

  // 基础值始终跟随 passthrough
  hook.baseState = passthrough;

  if (queue.pending !== null) {
    // 有乐观更新：在 passthrough 基础上应用
    let update = queue.pending.next;
    let newState = passthrough;

    do {
      const action = update.action;
      newState = reducer !== null
        ? reducer(newState, action)
        : (action as S);
      update = update.next;
    } while (update !== queue.pending.next);

    hook.memoizedState = newState;
    queue.pending = null;
  } else {
    // 没有乐观更新：直接使用 passthrough
    hook.memoizedState = passthrough;
  }

  return [hook.memoizedState, queue.dispatch!];
}
```

这个实现的关键在于 `passthrough` 参数。它是"真实状态"——当 Server Action 完成后，`passthrough` 会更新为服务端返回的真实值。此时，所有基于旧 `passthrough` 计算的乐观更新会被自动丢弃，因为新的 `passthrough` 已经包含了真实结果。

```
时间线：

t0: passthrough=10, 乐观更新 +1  → 显示 11
t1: passthrough=10, 又点了一次 +1 → 显示 12
t2: 第一个 action 完成，passthrough=11 → 显示 12（乐观 +1 仍在）
t3: 第二个 action 完成，passthrough=12 → 显示 12（所有乐观值清除）
```

### 13.4.3 错误处理：Error Boundary 与 Action 的协作

Server Actions 的错误处理遵循 React 的统一错误模型——通过 Error Boundary 捕获：

```tsx
function TodoApp() {
  return (
    <ErrorBoundary fallback={<p>Something went wrong</p>}>
      <TodoForm />
    </ErrorBoundary>
  );
}

function TodoForm() {
  const [state, formAction, isPending] = useActionState(createTodo, null);

  return (
    <form action={formAction}>
      <input name="title" required />
      <button disabled={isPending}>Add Todo</button>
    </form>
  );
}
```

当 Server Action 抛出错误时，React 的处理流程是：

```typescript
// Server Action 错误传播的简化流程
async function processServerActionResponse(response: Response) {
  const flightData = await decodeFlightResponse(response);

  if (flightData.error) {
    // 服务端错误被编码在 Flight 响应中
    // React 将其作为 Transition 中的错误抛出
    // 这会触发最近的 Error Boundary
    throw deserializeError(flightData.error);
  }

  // 成功：应用返回的 RSC 树更新
  applyFlightUpdate(flightData);
}
```

但有一个重要的细节：Server Action 的错误不会导致乐观更新"悬挂"。当错误发生时，Transition 被标记为失败，`useOptimistic` 的乐观状态会自动回退到 `passthrough` 值：

```typescript
// 乐观更新 + 错误回退的完整流程
function TodoList({ todos }: { todos: Todo[] }) {
  const [optimisticTodos, addOptimistic] = useOptimistic(
    todos,
    (state: Todo[], newTodo: Todo) => [...state, newTodo]
  );

  async function addTodo(formData: FormData) {
    const title = formData.get('title') as string;
    const tempTodo = { id: 'temp', title, completed: false };

    addOptimistic(tempTodo); // 乐观添加

    try {
      await createTodo(formData); // Server Action
      // 成功：revalidation 会更新 todos prop
      // useOptimistic 检测到 passthrough 变化，清除乐观值
    } catch (error) {
      // 失败：Transition 结束，乐观值自动回退
      // 用户看到的列表恢复到 addOptimistic 之前的状态
      throw error; // 重新抛出，让 Error Boundary 处理
    }
  }

  return (
    <div>
      <form action={addTodo}>
        <input name="title" />
        <button>Add</button>
      </form>
      <ul>
        {optimisticTodos.map(todo => (
          <li key={todo.id} style={{ opacity: todo.id === 'temp' ? 0.5 : 1 }}>
            {todo.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### 13.4.4 并发 Actions 的调度

当用户快速连续触发多个 Server Actions 时，React 的 Transition 调度器会确保它们的执行顺序和状态一致性：

```typescript
// React 内部的 Action 队列管理（概念模型）
type ActionQueueNode<State> = {
  action: (prevState: State, payload: FormData) => Promise<State>;
  payload: FormData;
  next: ActionQueueNode<State> | null;
  resolve: (state: State) => void;
  reject: (error: unknown) => void;
};

// 多个 action 按顺序执行，而不是并发
// 这确保每个 action 都能拿到前一个 action 的最新 state
async function processActionQueue<State>(
  queue: ActionQueueNode<State>,
  initialState: State
) {
  let currentState = initialState;
  let node: ActionQueueNode<State> | null = queue;

  while (node !== null) {
    try {
      currentState = await node.action(currentState, node.payload);
      node.resolve(currentState);
    } catch (error) {
      node.reject(error);
      // 注意：一个 action 的失败不会阻止后续 action 的执行
      // 但后续 action 的 prevState 可能不是最新的
    }
    node = node.next;
  }
}
```

这种串行执行策略是有意为之的。如果允许 Server Actions 并发执行，它们可能会看到过时的 `prevState`，导致状态冲突。例如，两个"添加待办事项"的 action 如果并发执行，都会基于相同的旧列表追加，可能导致数据丢失。

> **深度洞察**：React 的 Action 队列模型体现了一个深刻的设计哲学：在数据变更场景中，**可预测性比并发性更重要**。并发渲染（Concurrent Rendering）是 React 的读取优化——它让 UI 在数据获取时保持响应。而 Action 的串行执行是 React 的写入保障——它确保每次变更都基于最新状态。这种"读并发、写串行"的模式，与数据库事务的隔离级别有异曲同工之妙。

## 13.5 安全性考量：Server Actions 的攻击面分析

### 13.5.1 Server Actions 是公开的 HTTP 端点

这是使用 Server Actions 时最容易忽视的安全事实：**每一个 Server Action 都是一个可以被任意 HTTP 客户端调用的公开端点**。`"use server"` 标记的函数不是某种私有 API——它只是意味着"这个函数可以通过网络调用"。

```bash
# 任何人都可以用 curl 调用你的 Server Action
curl -X POST https://your-app.com/api/action \
  -H 'Content-Type: multipart/form-data' \
  -F '$ACTION_ID=a1b2c3d4e5f6' \
  -F 'title=Malicious Data'
```

这意味着 Server Action 中**必须**包含身份验证和授权检查：

```typescript
'use server';

import { auth } from '@/lib/auth';

export async function deletePost(postId: string) {
  // ❌ 危险：没有验证调用者身份
  // await db.post.delete({ where: { id: postId } });

  // ✅ 正确：始终验证身份和权限
  const session = await auth();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const post = await db.post.findUnique({ where: { id: postId } });
  if (post.authorId !== session.user.id) {
    throw new Error('Forbidden');
  }

  await db.post.delete({ where: { id: postId } });
  revalidatePath('/posts');
}
```

### 13.5.2 闭包变量泄露

内联 Server Actions 的闭包变量会被序列化到客户端 HTML 中。这可能导致敏感信息泄露：

```typescript
// ⚠️ 安全隐患：secretKey 会被序列化到客户端
function AdminPanel({ secretKey }: { secretKey: string }) {
  async function performAction() {
    'use server';
    // secretKey 被闭包捕获
    // 编译器会将它作为 bound argument 嵌入客户端代码
    await callExternalAPI(secretKey);
  }

  return <form action={performAction}><button>Execute</button></form>;
}
```

编译后的客户端 HTML 可能包含：

```html
<input type="hidden" name="$ACTION_BOUND" value="encrypted:sk_live_abc123..." />
```

虽然框架通常会对绑定参数进行加密，但这增加了攻击面。正确的做法是在服务端获取敏感数据，而不是通过闭包传递：

```typescript
// ✅ 正确：敏感数据在服务端获取
function AdminPanel({ userId }: { userId: string }) {
  async function performAction() {
    'use server';
    // 只捕获 userId（非敏感信息）
    // secretKey 在服务端从安全存储获取
    const secretKey = await getSecretFromVault(userId);
    await callExternalAPI(secretKey);
  }

  return <form action={performAction}><button>Execute</button></form>;
}
```

### 13.5.3 CSRF 防护

跨站请求伪造（CSRF）是 Server Actions 面临的经典 Web 安全威胁。由于 Server Actions 通过 POST 请求执行副作用操作，攻击者可能构造恶意页面诱导用户提交表单到你的应用。

React 和主流框架（如 Next.js）采用多层防御策略：

```typescript
// 层 1：Origin 检查
// 服务端验证请求的 Origin 头与应用域名匹配
function validateOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  const host = request.headers.get('Host');

  if (!origin) {
    // 没有 Origin 头的 POST 请求（例如来自同站点的原生表单提交）
    // 需要额外的验证机制
    return checkReferer(request);
  }

  return new URL(origin).host === host;
}

// 层 2：自定义请求头
// React 的 fetch 调用会添加特定的请求头
// 由于 CORS 的限制，跨域请求无法添加自定义头
// 这提供了额外的 CSRF 防护
const response = await fetch(actionEndpoint, {
  method: 'POST',
  body: formData,
  headers: {
    'Next-Action': actionId,  // 自定义头，跨域 form 提交无法携带
  },
});

// 层 3：加密绑定参数
// 闭包变量和 Action ID 使用服务端密钥加密
// 攻击者无法伪造有效的 Action 请求
function encryptBoundArgs(args: unknown[], secretKey: string): string {
  const payload = JSON.stringify(args);
  return encrypt(payload, secretKey);
}
```

**Origin 检查**是第一道防线——如果请求不是来自同源页面，直接拒绝。**自定义请求头**是第二道防线——浏览器不允许跨域表单提交携带自定义头（除非通过 CORS preflight 授权）。**加密绑定参数**是第三道防线——即使攻击者知道 Action ID，也无法伪造合法的加密参数。

### 13.5.4 输入验证：永远不要信任客户端

Server Actions 的参数来自网络，本质上与传统 API 的请求参数没有区别——它们可以被任意篡改。类型签名只是编译时的保证，运行时必须进行严格验证：

```typescript
'use server';

import { z } from 'zod';

// 定义验证 schema
const CreateTodoSchema = z.object({
  title: z.string().min(1).max(200),
  priority: z.enum(['low', 'medium', 'high']),
});

export async function createTodo(formData: FormData) {
  // 始终验证输入
  const parsed = CreateTodoSchema.safeParse({
    title: formData.get('title'),
    priority: formData.get('priority'),
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  // 验证通过后才执行业务逻辑
  const { title, priority } = parsed.data;
  const session = await auth();
  if (!session) {
    return { error: { message: 'Unauthorized' } };
  }

  const todo = await db.todo.create({
    data: {
      title,
      priority,
      userId: session.user.id,
    },
  });

  revalidatePath('/todos');
  return { data: todo };
}
```

### 13.5.5 速率限制与滥用防护

由于 Server Actions 可以执行数据库操作、发送邮件、调用外部 API 等有成本的操作，缺乏速率限制会导致资源耗尽或财务损失：

```typescript
'use server';

import { rateLimit } from '@/lib/rate-limit';

const limiter = rateLimit({
  interval: 60 * 1000, // 1 分钟
  uniqueTokenPerInterval: 500,
});

export async function sendMessage(formData: FormData) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');

  // 基于用户 ID 的速率限制
  try {
    await limiter.check(10, session.user.id); // 每分钟最多 10 次
  } catch {
    return { error: 'Too many requests. Please try again later.' };
  }

  // 业务逻辑...
}
```

> **深度洞察**：Server Actions 的安全模型暴露了一个深层的架构张力——**开发体验**与**安全意识**之间的矛盾。Server Actions 的魔力在于让远程调用"看起来像本地调用"，但正是这种无缝体验容易让开发者忘记一个关键事实：这些函数的参数来自不可信的网络。传统 API Routes 的"冗余"——手动解析请求、验证参数、检查权限——实际上是安全检查点的物理体现。Server Actions 消除了这些物理边界，开发者必须用纪律和工具来弥补。在团队中推行 Server Actions 时，建立代码审查清单和 lint 规则（例如要求每个 Server Action 必须调用 `auth()`）是至关重要的。

## 13.6 Server Actions 与 RSC 的数据流闭环

### 13.6.1 完整的读写循环

React Server Components（RSC）解决了数据的"读取"问题——服务端组件可以直接查询数据库并渲染 UI。Server Actions 解决了数据的"写入"问题——客户端组件可以调用服务端函数来修改数据。两者结合，形成了完整的数据流闭环：

```
┌─────────────────────────────────────────────────────┐
│                    Server                            │
│                                                      │
│  ┌──────────────┐         ┌──────────────────┐      │
│  │ Server       │  读取   │   Database /     │      │
│  │ Components   │◄───────│   External API    │      │
│  │ (RSC)        │         │                  │      │
│  └──────┬───────┘         └───────▲──────────┘      │
│         │                         │                  │
│         │ RSC Stream              │ 写入             │
│         │                         │                  │
│         ▼                   ┌─────┴──────────┐      │
│  ┌──────────────┐          │ Server          │      │
│  │ Flight       │          │ Actions         │      │
│  │ Response     │          │                 │      │
│  └──────┬───────┘          └───────▲─────────┘      │
│         │                          │                 │
└─────────┼──────────────────────────┼─────────────────┘
          │                          │
          │  Streaming               │  POST + FormData
          │  HTML/Flight             │  或 Flight-encoded
          ▼                          │
┌─────────────────────────────────────────────────────┐
│                    Client                            │
│                                                      │
│  ┌──────────────┐         ┌──────────────────┐      │
│  │ Client       │ action  │   <form>         │      │
│  │ Components   │◄───────│   useActionState  │      │
│  │              │         │   useOptimistic   │      │
│  └──────────────┘         └──────────────────┘      │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 13.6.2 revalidation：写入后的自动刷新

Server Action 完成后，通常需要刷新页面上的数据。React 和 Next.js 提供了两种 revalidation 机制：

```typescript
'use server';

import { revalidatePath, revalidateTag } from 'next/cache';

export async function updatePost(postId: string, formData: FormData) {
  const title = formData.get('title') as string;
  await db.post.update({ where: { id: postId }, data: { title } });

  // 方式 1：基于路径的 revalidation
  // 使指定路径的缓存失效，触发该路径下所有 Server Components 重新渲染
  revalidatePath(`/posts/${postId}`);

  // 方式 2：基于标签的 revalidation
  // 使指定缓存标签失效（更精细的控制）
  revalidateTag(`post-${postId}`);
}
```

当 Server Action 调用 `revalidatePath` 或 `revalidateTag` 后，框架会在响应中包含重新渲染后的 RSC 树。客户端收到这个响应后，会将新的 RSC 树与当前 UI 树进行协调（reconciliation），只更新变化的部分。

这个过程的技术实现链路如下：

```typescript
// 简化的 revalidation 响应处理流程
async function handleServerActionResponse(response: Response) {
  // 1. 解码 Flight 响应
  const flightData = await decodeFlightResponse(response);

  // 2. 响应可能包含两部分：
  //    - actionResult：Server Action 的返回值
  //    - tree：重新渲染后的 RSC 树（如果有 revalidation）

  if (flightData.actionResult !== undefined) {
    // 更新 useActionState 的状态
    resolveActionState(flightData.actionResult);
  }

  if (flightData.tree !== undefined) {
    // 用新的 RSC 树触发客户端协调
    // 这类似于一次"无感刷新"——用户看到的是 UI 平滑更新
    // 而不是整个页面重新加载
    startTransition(() => {
      applyRSCTreeUpdate(flightData.tree);
    });
  }
}
```

### 13.6.3 一个完整的全栈数据流示例

让我们用一个完整的示例来展示 Server Actions 与 RSC 的协作：

```typescript
// app/todos/page.tsx（Server Component）
import { db } from '@/lib/db';
import { TodoForm } from './TodoForm';
import { TodoList } from './TodoList';

export default async function TodosPage() {
  // 服务端直接查询数据库
  const todos = await db.todo.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main>
      <h1>My Todos</h1>
      <TodoForm />
      <TodoList todos={todos} />
    </main>
  );
}

// app/todos/actions.ts（Server Actions）
'use server';

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const TodoSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function createTodo(
  prevState: { error?: string } | null,
  formData: FormData
) {
  const session = await auth();
  if (!session) return { error: 'Please sign in' };

  const parsed = TodoSchema.safeParse({
    title: formData.get('title'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  await db.todo.create({
    data: {
      title: parsed.data.title,
      userId: session.user.id,
    },
  });

  revalidatePath('/todos');
  return null; // 成功：无错误
}

export async function toggleTodo(id: string, completed: boolean) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');

  // 验证所有权
  const todo = await db.todo.findUnique({ where: { id } });
  if (todo?.userId !== session.user.id) throw new Error('Forbidden');

  await db.todo.update({
    where: { id },
    data: { completed },
  });

  revalidatePath('/todos');
}

// app/todos/TodoForm.tsx（Client Component）
'use client';

import { useActionState } from 'react';
import { createTodo } from './actions';

export function TodoForm() {
  const [state, formAction, isPending] = useActionState(createTodo, null);

  return (
    <form action={formAction}>
      <input
        name="title"
        placeholder="What needs to be done?"
        required
        disabled={isPending}
      />
      <button disabled={isPending}>
        {isPending ? 'Adding...' : 'Add Todo'}
      </button>
      {state?.error && (
        <p role="alert" style={{ color: 'red' }}>{state.error}</p>
      )}
    </form>
  );
}

// app/todos/TodoList.tsx（Client Component）
'use client';

import { useOptimistic, useTransition } from 'react';
import { toggleTodo } from './actions';

type Todo = { id: string; title: string; completed: boolean };

export function TodoList({ todos }: { todos: Todo[] }) {
  const [optimisticTodos, updateOptimistic] = useOptimistic(
    todos,
    (state: Todo[], updatedTodo: { id: string; completed: boolean }) =>
      state.map(todo =>
        todo.id === updatedTodo.id
          ? { ...todo, completed: updatedTodo.completed }
          : todo
      )
  );
  const [, startTransition] = useTransition();

  function handleToggle(id: string, currentCompleted: boolean) {
    const newCompleted = !currentCompleted;
    startTransition(async () => {
      updateOptimistic({ id, completed: newCompleted });
      await toggleTodo(id, newCompleted);
    });
  }

  return (
    <ul>
      {optimisticTodos.map(todo => (
        <li key={todo.id}>
          <label style={{ opacity: todo.completed ? 0.5 : 1 }}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => handleToggle(todo.id, todo.completed)}
            />
            {todo.title}
          </label>
        </li>
      ))}
    </ul>
  );
}
```

这个示例展示了一个完整的数据流：

1. **读取**：Server Component 直接查询数据库，将数据作为 props 传递给 Client Component
2. **写入**：Client Component 调用 Server Actions 修改数据
3. **乐观更新**：`useOptimistic` 在 Server Action 完成前就更新 UI
4. **自动刷新**：`revalidatePath` 触发 Server Component 重新渲染，新数据自动流向客户端
5. **错误处理**：`useActionState` 管理错误状态，表单显示验证错误
6. **渐进增强**：即使 JavaScript 未加载，表单通过原生 HTML 提交仍然可以创建待办事项

## 13.7 本章小结

Server Actions 是 React 从"UI 渲染库"向"全栈应用基础设施"演进的关键一步。通过 `"use server"` 指令、编译时代码转换、FormData 序列化协议和与 React 渲染引擎的深度集成，它实现了以下目标：

关键要点：

1. **消除了前后端的 API 胶水层**：开发者直接在组件中调用服务端函数，编译器负责将函数调用转化为网络请求
2. **"use server" 是编译时指令，不是运行时标记**：它触发代码分割——客户端获得代理 stub，服务端保留真实实现，两者通过 Action ID 关联
3. **渐进增强是一等公民**：Server Actions 的表单在 JavaScript 未加载时通过原生 HTML 表单提交工作，确保核心功能的可靠性
4. **乐观更新与错误回退被纳入 React 的声明式模型**：`useOptimistic` 的双层状态和 Error Boundary 的自动集成，让数据变更场景的状态管理变得可预测
5. **安全性需要开发者主动保障**：Server Actions 是公开的 HTTP 端点，身份验证、输入验证、速率限制缺一不可
6. **与 RSC 形成数据流闭环**：Server Components 负责读取，Server Actions 负责写入，`revalidation` 机制确保写入后的 UI 自动更新

在下一章中，我们将深入 React 的合成事件系统——这是 React 与浏览器 DOM 交互的核心抽象层。理解事件系统的委托模型、优先级协作和 React 19 中的简化变化，是掌握 React 渲染管线"最后一公里"的关键。

> **课程关联**：本章内容对应慕课网课程《React 源码深度解析》的扩展部分。课程中详细讲解了 React 的渲染流程和状态管理机制，而 Server Actions 作为全栈数据流的新范式，是在该基础之上的架构级扩展，建议先完成课程基础部分的学习：[https://coding.imooc.com/class/650.html](https://coding.imooc.com/class/650.html)

---

### 思考题

1. **Server Actions 的闭包变量序列化存在安全风险。** 假设一个内联 Server Action 闭包捕获了一个包含 `userId` 和 `role` 的对象，攻击者篡改了序列化后的 `role` 字段为 `"admin"`。框架的加密绑定参数机制能否完全防御这种攻击？如果不能，还需要什么额外的防护措施？

2. **在高并发场景下，多个 Server Actions 被串行执行可能导致用户感知到显著的延迟。** 假设用户在一个 TODO 列表中快速连续勾选了 5 个复选框，每个触发一个 `toggleTodo` Server Action（每次耗时 200ms）。在当前的串行队列模型下，最后一个操作需要等待 1000ms 才能完成。请设计一种方案，在保证最终一致性的前提下，将用户感知延迟降低到接近 200ms。提示：考虑批处理（batching）和合并（coalescing）策略。

3. **`useActionState` 的 `permalink` 参数实现了渐进增强，但它引入了一个微妙的状态同步问题。** 当 JavaScript 未加载时，表单提交会导致全页面导航到 `permalink` 指定的 URL。此时，Server Action 的返回值（新的 state）如何传递给重新渲染的页面？如果 Server Action 返回了一个错误状态，`permalink` 对应的页面是否能正确显示这个错误？分析当前框架实现的解决方案及其局限性。

4. **Server Actions 的编译时代码转换依赖于静态分析。** 构造一个合法的 TypeScript 代码示例，其中 `"use server"` 指令的行为可能不符合开发者的直觉——例如，某些变量看起来应该在服务端执行，但实际上被泄露到了客户端。解释编译器在这种边界情况下的具体行为。

</div>
