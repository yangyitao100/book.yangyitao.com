<div v-pre>

# 第10章 React Compiler 深度剖析

> **本章要点**
>
> - 手动优化的认知负担：useMemo/useCallback 泛滥背后的工程困境
> - React Compiler 的编译管线：从 Babel 插件到 HIR/MIR 的多层中间表示
> - Rules of React：编译器正确性的核心假设与语义契约
> - 自动记忆化的实现原理：静态分析、依赖追踪与缓存槽位分配
> - 编译前后代码对比：编译器如何消除手写 useMemo/useCallback
> - 编译器的局限性与逃生舱：`"use no memo"` 指令与 opt-out 策略
> - 与 Vue Compiler、Svelte Compiler、Solid Compiler 的架构对比

---

在 React 的历史上，有一个问题困扰了社区近十年：**性能优化到底应该是开发者的责任，还是框架的责任？**

从 `shouldComponentUpdate` 到 `React.memo`，从 `useMemo` 到 `useCallback`，React 一直将"避免不必要的重渲染"这个任务交给开发者。这种设计哲学的好处是明确——开发者完全掌控优化的时机和粒度。但代价同样惊人：在一个中等规模的 React 项目中，你会发现 `useMemo` 和 `useCallback` 像野草一样蔓延到每一个组件，不是因为它们真正需要，而是因为开发者不确定"不加会不会出问题"。这种防御性编程不仅增加了代码量，更严重的是，它把开发者的注意力从业务逻辑拽向了框架的性能细节。

React Compiler 的诞生，标志着 React 团队对这个问题给出了一个彻底不同的答案：**让编译器来做这件事**。编译器在构建阶段静态分析你的组件代码，自动插入细粒度的记忆化逻辑，使得开发者可以按照最自然的方式编写 React 代码，而不必操心缓存和引用稳定性。这不是一个简单的 Babel 插件，而是一套完整的编译管线，包含自己的中间表示、类型推导、副作用分析和代码生成。本章将深入这套编译管线的每一个环节，揭示 React Compiler 在技术层面究竟做了什么，以及它为什么能做到。

## 10.1 为什么需要编译器：手动优化的认知负担

### 10.1.1 useMemo/useCallback 的泛滥

考虑一个典型的 React 组件：

```tsx
function ProductList({ products, onAddToCart }: Props) {
  const sortedProducts = products
    .filter(p => p.inStock)
    .sort((a, b) => a.price - b.price);

  const handleClick = (id: string) => {
    analytics.track('product_click', { id });
    onAddToCart(id);
  };

  return (
    <div>
      {sortedProducts.map(product => (
        <ProductCard
          key={product.id}
          product={product}
          onClick={() => handleClick(product.id)}
        />
      ))}
    </div>
  );
}
```

这段代码逻辑清晰，可读性极佳。但一个有经验的 React 开发者会立即指出几个"性能问题"：

1. `sortedProducts` 每次渲染都会重新计算，即使 `products` 没有变化
2. `handleClick` 每次渲染都是新的函数引用
3. `onClick={() => handleClick(product.id)}` 每次渲染为每个 item 创建新的闭包
4. 如果 `ProductCard` 被 `React.memo` 包裹，上述所有新引用都会导致它无法跳过重渲染

于是"优化"后的版本变成了这样：

```tsx
function ProductList({ products, onAddToCart }: Props) {
  const sortedProducts = useMemo(
    () => products.filter(p => p.inStock).sort((a, b) => a.price - b.price),
    [products]
  );

  const handleClick = useCallback(
    (id: string) => {
      analytics.track('product_click', { id });
      onAddToCart(id);
    },
    [onAddToCart]
  );

  return (
    <div>
      {sortedProducts.map(product => (
        <MemoizedProductCard
          key={product.id}
          product={product}
          onClick={handleClick}
          productId={product.id}
        />
      ))}
    </div>
  );
}

const MemoizedProductCard = React.memo(ProductCard);
```

代码膨胀了近一倍，而且引入了新的复杂性：依赖数组是否正确？`onAddToCart` 的引用稳定吗？如果不稳定，是否需要在父组件也加 `useCallback`？这种"传染式优化"会一层一层向上蔓延，直到组件树的根部。

### 10.1.2 手动优化的三重困境

手动记忆化面临三个根本性的困境：

**第一，正确性难以保证。** 依赖数组遗漏是 React 应用中最常见的 bug 来源之一。ESLint 的 `exhaustive-deps` 规则能捕获一部分，但对于复杂的闭包引用和对象依赖，开发者常常不确定应该包含哪些依赖。

```tsx
// 一个微妙的依赖遗漏
const processData = useCallback(() => {
  // config 是外部变量，但开发者忘了加到依赖数组
  return data.map(item => transform(item, config));
}, [data]); // ❌ 遗漏了 config
```

**第二，粒度难以把控。** 什么该 memo，什么不该 memo？这个决策需要对 React 的渲染机制有深入理解，而且往往取决于组件在树中的位置和使用频率——这些信息在编写组件时并不总是可知的。

**第三，维护成本持续增长。** 每次修改组件逻辑，都需要同步审视 `useMemo`/`useCallback` 的依赖数组。添加一个新的状态变量，可能需要更新三四个依赖数组。重构一个函数的参数，可能引发一连串的 `useCallback` 更新。

> **深度洞察**：手动优化的本质问题不在于它"难"，而在于它是一种**与业务逻辑正交的关注点**。当一个开发者在编写购物车的增删改查时，他不应该同时操心"这个函数引用是否稳定"。React Compiler 的核心价值，就是将这种正交关注点从开发者的认知负担中彻底移除。

### 10.1.3 从人工到自动：编译器的必然性

React 团队对这个问题的认知经历了几个阶段：

1. **2018 年**：推出 `React.memo` 和 Hooks 的 `useMemo`/`useCallback`，将优化能力交给开发者
2. **2021 年**：React Conf 上首次提出 React Forget（React Compiler 的前身），明确承认手动优化是不可持续的
3. **2023 年**：React Compiler 进入公开开发阶段，架构从 Babel 插件演进为独立编译管线
4. **2024 年**：React Compiler 随 React 19 正式发布，标志着 React 进入编译时优化时代

这个演进路径揭示了一个深层道理：**当一个优化模式可以被形式化描述时，它就应该被自动化**。记忆化的逻辑——"如果输入没变，就返回上一次的输出"——是完全可以被机械化执行的。需要解决的核心问题只有一个：如何准确判断"输入是否变化"。

## 10.2 编译器架构：从 Babel 插件到独立编译管线

### 10.2.1 整体架构概览

React Compiler 不是一个简单的代码变换工具。它是一套完整的编译管线，包含以下阶段：

```
源代码 (JSX/TSX)
    │
    ▼
┌──────────────────────┐
│  1. Babel Parser      │  ── 解析为 Babel AST
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  2. HIR 构建          │  ── 从 AST 构建高层中间表示
│     (High-level IR)   │     控制流图 + 指令序列
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  3. 分析与验证 Pass   │  ── Rules of React 验证
│     - 类型推导         │     副作用分析
│     - 作用域分析       │     变量可变性分析
│     - 副作用推断       │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  4. 反应性分析        │  ── 识别响应式输入
│     (Reactivity)      │     构建依赖关系图
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  5. 作用域构建        │  ── 划定记忆化边界
│     (Scope Building)  │     分配缓存槽位
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  6. 代码生成          │  ── 输出带有缓存逻辑的代码
│     (Codegen)         │     使用 useMemoCache Hook
└──────────────────────┘
```

这套管线的设计哲学与传统编译器（如 LLVM）高度相似：通过多层中间表示逐步降低抽象层级，在每一层执行针对性的分析和变换。

### 10.2.2 HIR：高层中间表示

HIR（High-level Intermediate Representation）是 React Compiler 的核心数据结构。它将 JavaScript 代码转换为一种结构化的控制流图（CFG），其中每个基本块包含一系列指令：

```typescript
// React Compiler 内部的 HIR 核心类型
type HIR = {
  body: HIRBlock[];          // 函数体中的所有基本块
  params: Array<Place>;       // 函数参数
  context: Array<Place>;      // 闭包捕获的外部变量
  returnType: Type;
};

type HIRBlock = {
  id: BlockId;
  kind: 'block' | 'value' | 'sequence';
  instructions: Array<HIRInstruction>;
  terminal: Terminal;         // 分支、跳转或返回
};

type HIRInstruction = {
  id: InstructionId;
  lvalue: Place;              // 结果存储位置
  value: InstructionValue;    // 指令的具体操作
  loc: SourceLocation;        // 源码位置（用于 source map）
};

// Place 是 HIR 中的"变量"概念
type Place = {
  identifier: Identifier;
  effect: Effect;             // 该位置的副作用标注
  reactive: boolean;          // 是否是响应式值
};
```

为什么不直接在 Babel AST 上做分析？因为 JavaScript 的 AST 是面向语法结构的树状表示，而编译器需要的是面向数据流和控制流的图状表示。例如，一个 `if-else` 语句在 AST 中是嵌套的节点，但在 HIR 中被展开为多个基本块和条件跳转——后者更适合做数据流分析。

```typescript
// 原始代码
function Example({ items, filter }) {
  const filtered = items.filter(i => i.active);
  const label = filter ? `Active (${filtered.length})` : 'All';
  return <Header label={label} count={filtered.length} />;
}

// 对应的 HIR 伪代码（简化表示）
// Block 0:
//   $0 = LoadParam 'items'
//   $1 = LoadParam 'filter'
//   $2 = MethodCall $0.filter(arrow($3 => PropertyRead $3.active))
//   $3 = LoadParam 'filter'
//   Branch $3 → Block1, Block2
//
// Block 1 (truthy):
//   $4 = PropertyRead $2.length
//   $5 = TemplateLiteral `Active (${$4})`
//   Jump → Block3($5)
//
// Block 2 (falsy):
//   $6 = Literal 'All'
//   Jump → Block3($6)
//
// Block 3 (merge):
//   $7 = Phi($5, $6)            ← label 的值取决于执行路径
//   $8 = PropertyRead $2.length
//   $9 = JSXElement Header { label: $7, count: $8 }
//   Return $9
```

注意 `Phi` 节点——这是 SSA（Static Single Assignment）形式中的经典概念。当一个变量在不同的控制流路径中被赋予不同的值时，合并点需要一个 Phi 节点来统一。这使得数据流分析可以精确地追踪每个值的来源。

### 10.2.3 指令类型与语义

HIR 中的指令类型涵盖了 JavaScript 和 React 特有的操作：

```typescript
type InstructionValue =
  // 基础操作
  | { kind: 'Literal'; value: string | number | boolean | null }
  | { kind: 'LoadLocal'; place: Place }
  | { kind: 'StoreLocal'; lvalue: Place; value: Place }

  // 属性操作
  | { kind: 'PropertyRead'; object: Place; property: string }
  | { kind: 'PropertyStore'; object: Place; property: string; value: Place }
  | { kind: 'ComputedRead'; object: Place; key: Place }

  // 函数调用
  | { kind: 'CallExpression'; callee: Place; args: Array<Place> }
  | { kind: 'MethodCall'; receiver: Place; method: string; args: Array<Place> }

  // React 特有
  | { kind: 'JSXElement'; tag: Place; props: Array<JSXAttribute>; children: Array<Place> }
  | { kind: 'JSXFragment'; children: Array<Place> }

  // 控制流相关
  | { kind: 'Phi'; operands: Map<BlockId, Place> }
  | { kind: 'Destructure'; value: Place; pattern: DestructurePattern }

  // 数组与对象
  | { kind: 'ArrayExpression'; elements: Array<Place> }
  | { kind: 'ObjectExpression'; properties: Array<ObjectProperty> }

  // Hook 调用（被特殊识别）
  | { kind: 'HookCall'; hook: HookKind; args: Array<Place> };
```

编译器对 Hook 调用做了特殊处理。当它识别到 `useState`、`useEffect` 等 Hook 时，会赋予特殊的语义——例如 `useState` 的返回值被标记为响应式，而 `useEffect` 的回调被标记为副作用区域。

### 10.2.4 从 HIR 到反应性标注

HIR 构建完成后，编译器执行一系列分析 Pass，其中最关键的是**反应性分析**（Reactivity Analysis）。这个 Pass 的目标是回答一个核心问题：**函数中的哪些值依赖于可能变化的输入（即"响应式值"）？**

```typescript
// 反应性传播的核心逻辑（简化）
function inferReactivity(hir: HIR): void {
  // 第一步：标记初始响应式源
  // - 函数参数（props）是响应式的
  // - useState 的返回值是响应式的
  // - useContext 的返回值是响应式的
  // - useReducer 的返回值是响应式的
  for (const param of hir.params) {
    param.reactive = true;
  }

  for (const block of hir.body) {
    for (const instr of block.instructions) {
      if (instr.value.kind === 'HookCall') {
        switch (instr.value.hook) {
          case 'useState':
          case 'useReducer':
          case 'useContext':
            instr.lvalue.reactive = true;
            break;
        }
      }
    }
  }

  // 第二步：前向传播
  // 如果一个指令的输入包含响应式值，其输出也是响应式的
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of hir.body) {
      for (const instr of block.instructions) {
        if (!instr.lvalue.reactive && hasReactiveInput(instr)) {
          instr.lvalue.reactive = true;
          changed = true;
        }
      }
    }
  }
}
```

这个传播过程类似于类型系统中的类型推导——从已知的"响应式源"出发，沿着数据流边传播到所有依赖的值。最终，每个 `Place` 都会被标注为"响应式"或"非响应式"。

> **深度洞察**：反应性分析的本质是一种**抽象解释**（Abstract Interpretation）。编译器不运行代码，而是在一个简化的抽象域上"模拟"程序的执行，追踪"值是否可能因为 props/state 变化而变化"这一属性。这与 Vue 3 的响应式系统在运行时做的事情是等价的——只不过 React Compiler 在编译时完成，而 Vue 在运行时完成。

## 10.3 React 的规则（Rules of React）：编译器的核心假设

### 10.3.1 为什么编译器需要规则

React Compiler 不是万能的。它的正确性建立在一组关于 React 代码行为的假设之上，这些假设被称为 **Rules of React**。如果你的代码违反了这些规则，编译器可能会产生错误的优化。

这类似于 C 语言中的"未定义行为"（Undefined Behavior）——编译器基于"程序员不会触发未定义行为"的假设来做优化。React Compiler 也基于"开发者遵守 React 规则"的假设来插入记忆化。

### 10.3.2 核心规则清单

**规则一：组件和 Hook 必须是幂等的。**

给定相同的输入（props、state、context），组件必须返回相同的输出。这意味着在渲染过程中不能有可观察的副作用。

```tsx
// ✅ 幂等：相同输入产生相同输出
function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}</h1>;
}

// ❌ 非幂等：每次渲染产生不同结果
function Timestamp() {
  return <span>{Date.now()}</span>; // 每次调用 Date.now() 结果不同
}

// ❌ 非幂等：渲染时修改外部变量
let renderCount = 0;
function Counter() {
  renderCount++; // 副作用！
  return <span>Rendered {renderCount} times</span>;
}
```

编译器如何利用这条规则？如果组件是幂等的，那么当输入未变时，编译器可以安全地跳过重新执行，直接返回缓存的结果。

**规则二：Props 和 State 是不可变的。**

React 的心智模型要求 props 和 state 被视为不可变快照。修改它们必须通过创建新对象的方式。

```tsx
// ✅ 正确：创建新数组
function handleAdd(item: Item) {
  setItems(prev => [...prev, item]);
}

// ❌ 错误：直接修改 props
function BadComponent({ items }: { items: Item[] }) {
  items.push({ id: 'new' }); // 直接修改了 props！
  return <List items={items} />;
}

// ❌ 错误：直接修改 state
function BadMutation() {
  const [user, setUser] = useState({ name: 'Alice' });
  const handleClick = () => {
    user.name = 'Bob'; // 直接修改了 state 对象
    setUser(user);     // 同一个引用，React 会认为没有变化
  };
  return <button onClick={handleClick}>{user.name}</button>;
}
```

这条规则对编译器至关重要。编译器使用**浅比较**（`Object.is`）来判断值是否变化。如果代码直接修改对象而不创建新引用，编译器的缓存判断就会失效。

**规则三：传递给 Hook 的值是不可变的。**

一旦一个值被传递给 Hook（如 `useMemo` 的依赖数组），它就不应该被后续修改。

```tsx
// ❌ 危险：修改了传递给 Hook 的值
function Problematic({ config }: { config: Config }) {
  // config 被传给 useEffect 的依赖
  useEffect(() => {
    initializeSDK(config);
  }, [config]);

  // 然后修改了 config（如果 config 来自可变源）
  config.debug = true; // 这会影响已经捕获了 config 的 Effect
}
```

**规则四：JSX 的返回值是不可变的。**

创建的 JSX 元素不应该被后续修改。React 假设虚拟 DOM 树一旦构建就是固定的。

```tsx
// ❌ 不要修改已创建的 JSX 元素
function Bad() {
  const element = <div className="base" />;
  element.props.className = 'modified'; // 绝对不要这样做
  return element;
}
```

### 10.3.3 编译器如何验证规则

React Compiler 内置了一套静态分析 Pass 来检测违反规则的代码模式：

```typescript
// 编译器的验证 Pass（概念性实现）
function validateRulesOfReact(hir: HIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const block of hir.body) {
    for (const instr of block.instructions) {
      // 检测 1：渲染阶段是否修改了外部变量
      if (isMutatingExternalVariable(instr)) {
        diagnostics.push({
          severity: 'error',
          message: 'Cannot mutate external variable during render',
          loc: instr.loc,
        });
      }

      // 检测 2：是否修改了 props
      if (isMutatingProps(instr, hir.params)) {
        diagnostics.push({
          severity: 'error',
          message: 'Cannot mutate props',
          loc: instr.loc,
        });
      }

      // 检测 3：是否在渲染路径中调用了非确定性函数
      if (isNonDeterministicCall(instr)) {
        diagnostics.push({
          severity: 'warning',
          message: 'Non-deterministic function call in render path',
          loc: instr.loc,
        });
      }
    }
  }

  return diagnostics;
}
```

当编译器检测到无法安全优化的代码时，它有两种策略：

1. **局部降级**：对无法分析的部分跳过记忆化，其余部分继续优化
2. **完全跳过**：对整个函数放弃编译器优化，保持原始行为

这种"保守策略"确保了编译器不会引入行为变更——最坏的情况是某些优化没有被应用，而不是产生错误的代码。

## 10.4 自动记忆化的实现原理：静态分析 + 依赖追踪

### 10.4.1 作用域划分：确定记忆化边界

编译器的核心任务是**将代码划分为若干"记忆化作用域"**（memoization scopes），每个作用域对应一段可以被缓存的计算。

```tsx
function UserProfile({ user, theme }: Props) {
  // 作用域 A：依赖 user.name
  const displayName = user.name.toUpperCase();

  // 作用域 B：依赖 user.posts
  const recentPosts = user.posts.slice(0, 5);

  // 作用域 C：依赖 theme
  const style = { color: theme.primary, fontSize: theme.size };

  // 作用域 D：依赖 displayName, recentPosts, style（即依赖 A, B, C 的输出）
  return (
    <div style={style}>
      <h1>{displayName}</h1>
      <PostList posts={recentPosts} />
    </div>
  );
}
```

编译器如何确定作用域边界？通过分析 HIR 中的数据依赖关系：

```typescript
// 作用域构建的核心算法（简化）
function buildScopes(hir: HIR): Scope[] {
  const scopes: Scope[] = [];

  // 第一步：为每个具有响应式输入的指令序列创建候选作用域
  let currentScope: Scope | null = null;

  for (const block of hir.body) {
    for (const instr of block.instructions) {
      const reactiveInputs = getReactiveInputs(instr);

      if (reactiveInputs.length > 0) {
        // 这条指令依赖响应式值，需要被包含在某个作用域中
        if (currentScope === null || !isCompatible(currentScope, reactiveInputs)) {
          // 创建新作用域
          currentScope = createScope(reactiveInputs);
          scopes.push(currentScope);
        }
        currentScope.instructions.push(instr);
      }
    }
  }

  // 第二步：合并具有相同依赖的相邻作用域
  return mergeCompatibleScopes(scopes);
}

type Scope = {
  id: ScopeId;
  dependencies: Set<Place>;     // 该作用域依赖的响应式值
  outputs: Set<Place>;          // 该作用域产出的值（供后续作用域使用）
  instructions: HIRInstruction[];
  cacheSlot: number;            // 在 useMemoCache 中的槽位
};
```

### 10.4.2 依赖追踪：精确到属性级别

React Compiler 的一个重要特性是**属性级别的依赖追踪**。它不仅追踪"是否依赖 `user`"，还追踪"依赖 `user` 的哪个属性"：

```tsx
function UserCard({ user }: { user: User }) {
  // 只依赖 user.name —— user.age 变了不需要重新计算
  const greeting = `Hello, ${user.name}`;

  // 只依赖 user.avatar —— user.name 变了不需要重新计算
  const avatarUrl = getAvatarUrl(user.avatar);

  return (
    <div>
      <img src={avatarUrl} />
      <span>{greeting}</span>
    </div>
  );
}
```

在编译器的 HIR 中，这会被分析为：

```
$greeting 的依赖：{ user.name }
$avatarUrl 的依赖：{ user.avatar }
JSX 的依赖：{ $greeting, $avatarUrl } → 展开为 { user.name, user.avatar }
```

这种精细度意味着，如果只有 `user.email` 变化，而 `user.name` 和 `user.avatar` 不变，编译器插入的缓存可以让 `greeting` 和 `avatarUrl` 跳过重新计算。

### 10.4.3 缓存槽位分配与 useMemoCache

编译器使用一个特殊的内部 Hook——`useMemoCache`——来管理所有的缓存。这个 Hook 接受一个数字参数，表示需要的缓存槽位数量，返回一个持久化的数组：

```typescript
// React 内部的 useMemoCache 实现
function useMemoCache(size: number): Array<any> {
  const fiber = currentlyRenderingFiber;
  let memoCache = fiber.updateQueue?.memoCache;

  if (memoCache === null || memoCache === undefined) {
    // 首次渲染：创建缓存数组
    memoCache = { data: new Array(size).fill(MEMO_CACHE_SENTINEL) };
    if (fiber.updateQueue === null) {
      fiber.updateQueue = createUpdateQueue();
    }
    fiber.updateQueue.memoCache = memoCache;
  }

  return memoCache.data;
}

// 哨兵值：用于标识"尚未缓存"的槽位
const MEMO_CACHE_SENTINEL = Symbol.for('react.memo_cache_sentinel');
```

编译器生成的代码通过比较依赖值来决定是否使用缓存：

```tsx
// 编译前
function Greeting({ name, age }: Props) {
  const message = `Hello, ${name}! You are ${age}.`;
  return <p className="greeting">{message}</p>;
}

// 编译后（概念性表示）
function Greeting({ name, age }: Props) {
  const $ = useMemoCache(4);

  let message;
  // 缓存槽位 0, 1 对应 message 的计算
  if ($[0] !== name || $[1] !== age) {
    message = `Hello, ${name}! You are ${age}.`;
    $[0] = name;
    $[1] = age;
    $[2] = message;
  } else {
    message = $[2];
  }

  // 缓存槽位 3 对应 JSX 的创建
  let t0;
  if ($[3] !== message) {
    t0 = <p className="greeting">{message}</p>;
    $[3] = message;
    // 注意："greeting" 是字面量，不需要追踪
  } else {
    t0 = $[4]; // 假设槽位 4 存储 JSX 结果
  }

  return t0;
}
```

### 10.4.4 副作用的特殊处理

编译器对副作用代码非常谨慎。渲染阶段的纯计算可以被自由缓存，但副作用（如 `useEffect`）需要保留执行语义：

```tsx
// 编译前
function DataFetcher({ url }: { url: string }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(url).then(res => res.json()).then(setData);
  }, [url]);

  if (!data) return <Loading />;
  return <DataView data={data} />;
}

// 编译后（概念性表示）
function DataFetcher({ url }: Props) {
  const $ = useMemoCache(7);
  const [data, setData] = useState(null);

  // useEffect 的回调被缓存，但 useEffect 本身始终被调用
  // （React 内部通过比较依赖来决定是否执行 effect）
  let t0;
  if ($[0] !== url || $[1] !== setData) {
    t0 = () => {
      fetch(url).then(res => res.json()).then(setData);
    };
    $[0] = url;
    $[1] = setData;
    $[2] = t0;
  } else {
    t0 = $[2];
  }

  let t1;
  if ($[3] !== url) {
    t1 = [url];
    $[3] = url;
    $[4] = t1;
  } else {
    t1 = $[4];
  }

  useEffect(t0, t1);

  // 条件渲染的 JSX 也被缓存
  let t2;
  if ($[5] !== data) {
    t2 = !data ? <Loading /> : <DataView data={data} />;
    $[5] = data;
    $[6] = t2;
  } else {
    t2 = $[6];
  }

  return t2;
}
```

注意编译器做了什么：

1. `useEffect` 的**回调函数**被缓存（等价于手写 `useCallback`）
2. `useEffect` 的**依赖数组**被缓存（避免每次创建新数组引用）
3. `useEffect` 调用本身**不被跳过**——它必须在每次渲染中执行，由 React 运行时决定是否触发 effect

> **深度洞察**：React Compiler 的记忆化策略可以被概括为一条原则——**缓存值，而非跳过执行**。组件函数始终被完整调用，但通过缓存中间值和最终 JSX，避免不必要的对象创建和子组件的 props 变化。这与 `React.memo` 跳过整个组件渲染的策略形成了互补。

## 10.5 编译前后代码对比：useMemo/useCallback 如何被消除

### 10.5.1 基础场景：计算属性

```tsx
// 编译前：开发者手写 useMemo
function PriceDisplay({ price, taxRate }: Props) {
  const total = useMemo(
    () => price * (1 + taxRate),
    [price, taxRate]
  );

  const formatted = useMemo(
    () => `$${total.toFixed(2)}`,
    [total]
  );

  return <span className="price">{formatted}</span>;
}

// 有了 React Compiler 后，开发者只需写：
function PriceDisplay({ price, taxRate }: Props) {
  const total = price * (1 + taxRate);
  const formatted = `$${total.toFixed(2)}`;
  return <span className="price">{formatted}</span>;
}

// 编译器自动生成等价的缓存代码：
function PriceDisplay({ price, taxRate }: Props) {
  const $ = useMemoCache(5);

  let total;
  if ($[0] !== price || $[1] !== taxRate) {
    total = price * (1 + taxRate);
    $[0] = price;
    $[1] = taxRate;
    $[2] = total;
  } else {
    total = $[2];
  }

  let t0;
  if ($[3] !== total) {
    t0 = <span className="price">{`$${total.toFixed(2)}`}</span>;
    $[3] = total;
    $[4] = t0;
  } else {
    t0 = $[4];
  }

  return t0;
}
```

注意编译器甚至做了一个手写 `useMemo` 不会做的优化：它将 `formatted` 的计算和 JSX 的创建**合并到了一个缓存块**中，因为它们的依赖链是连续的。手写时我们会分别 memo 每个中间值，但编译器能够看到全局依赖图，做出更优的缓存粒度决策。

### 10.5.2 回调函数场景

```tsx
// 编译前：手动 useCallback + React.memo
function TodoItem({ todo, onToggle, onDelete }: Props) {
  const handleToggle = useCallback(() => {
    onToggle(todo.id);
  }, [onToggle, todo.id]);

  const handleDelete = useCallback(() => {
    onDelete(todo.id);
  }, [onDelete, todo.id]);

  return (
    <div className="todo-item">
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={handleToggle}
      />
      <span>{todo.text}</span>
      <button onClick={handleDelete}>Delete</button>
    </div>
  );
}

export default React.memo(TodoItem);

// 有了 React Compiler，开发者只需写：
function TodoItem({ todo, onToggle, onDelete }: Props) {
  return (
    <div className="todo-item">
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => onToggle(todo.id)}
      />
      <span>{todo.text}</span>
      <button onClick={() => onDelete(todo.id)}>Delete</button>
    </div>
  );
}

// 编译器生成的代码会自动缓存这些匿名函数和 JSX
```

关键区别：开发者不再需要把回调函数"拎"出来用 `useCallback` 包裹，不再需要手动维护依赖数组，不再需要用 `React.memo` 包裹子组件。编译器会自动确保当 `todo.id`、`onToggle`、`onDelete` 都没有变化时，生成的 JSX 是同一个引用。

### 10.5.3 复杂计算场景

```tsx
// 一个真实场景：数据仪表盘
function Dashboard({ metrics, timeRange, filters }: Props) {
  // 编译器会为以下每段计算识别精确的依赖并缓存

  const filteredMetrics = metrics.filter(m =>
    filters.categories.includes(m.category) &&
    m.timestamp >= timeRange.start &&
    m.timestamp <= timeRange.end
  );

  const aggregated = {
    total: filteredMetrics.reduce((sum, m) => sum + m.value, 0),
    average: filteredMetrics.length > 0
      ? filteredMetrics.reduce((sum, m) => sum + m.value, 0) / filteredMetrics.length
      : 0,
    max: Math.max(...filteredMetrics.map(m => m.value)),
    min: Math.min(...filteredMetrics.map(m => m.value)),
  };

  const chartData = filteredMetrics.map(m => ({
    x: m.timestamp,
    y: m.value,
    label: m.name,
  }));

  return (
    <div className="dashboard">
      <SummaryCards data={aggregated} />
      <Chart data={chartData} />
      <MetricsTable rows={filteredMetrics} />
    </div>
  );
}
```

在没有编译器的情况下，正确优化这个组件需要至少 4 个 `useMemo`，而且需要仔细分析依赖链——`aggregated` 和 `chartData` 都依赖 `filteredMetrics`，所以 `filteredMetrics` 必须先被 memo。这种级联依赖很容易出错。

React Compiler 会自动分析出：
- `filteredMetrics` 依赖 `metrics`、`filters.categories`、`timeRange.start`、`timeRange.end`
- `aggregated` 和 `chartData` 依赖 `filteredMetrics`
- JSX 元素分别依赖 `aggregated`、`chartData`、`filteredMetrics`

并为每个依赖边界插入精确的缓存逻辑。

### 10.5.4 编译器对已有 useMemo/useCallback 的处理

一个重要的问题：如果代码中已经有 `useMemo` 和 `useCallback`，编译器会怎么做？

答案是：**编译器会保留它们的语义，但可能优化它们的实现**。编译器不会删除手写的 `useMemo`，而是将其视为一个"开发者明确声明的缓存意图"，并将其纳入整体的缓存策略中。

```tsx
// 手写的 useMemo 被编译器保留
function Example({ data }: Props) {
  // 编译器识别这是一个显式的 useMemo，保留语义
  const processed = useMemo(() => expensiveComputation(data), [data]);

  // 编译器对其余部分自动插入缓存
  return <Result value={processed} />;
}
```

这意味着从手动优化迁移到编译器优化是**渐进式的**——你可以在启用编译器后逐步移除手写的 `useMemo`/`useCallback`，而不是一次性重写所有代码。

## 10.6 编译器的局限性与逃生舱

### 10.6.1 编译器无法处理的模式

**模式一：运行时动态行为。**

```tsx
// 编译器无法分析 eval 或动态属性访问的模式
function Dynamic({ obj, key }: { obj: any; key: string }) {
  const value = obj[key]; // key 是动态的，编译器无法追踪具体依赖
  return <span>{value}</span>;
}
```

对于动态属性访问，编译器会保守地将整个 `obj` 作为依赖，而不是精确到某个属性。

**模式二：外部可变状态。**

```tsx
// 全局可变状态是编译器的盲区
let globalCounter = 0;

function Counter() {
  // 编译器不知道 globalCounter 何时变化
  // 可能会错误地缓存包含它的计算结果
  return <span>{globalCounter}</span>;
}
```

编译器的静态分析无法追踪运行时的外部可变状态。如果你的代码依赖全局变量、模块级变量或通过闭包捕获的可变引用，编译器可能无法正确优化。

**模式三：非幂等的渲染逻辑。**

```tsx
function RandomColor() {
  // Math.random() 是非确定性的，缓存它会导致行为变化
  const color = `hsl(${Math.random() * 360}, 70%, 50%)`;
  return <div style={{ backgroundColor: color }} />;
}
```

编译器通常能检测到 `Math.random()`、`Date.now()` 等非确定性调用，并跳过对包含它们的代码块的优化。

### 10.6.2 `"use no memo"` 指令

React Compiler 提供了一个逃生舱——`"use no memo"` 指令，允许开发者禁用特定函数的编译器优化：

```tsx
function DebugPanel({ state }: Props) {
  "use no memo"; // 告诉编译器不要优化这个函数

  // 这个组件故意在每次渲染时都重新计算
  console.log('DebugPanel rendered at', Date.now());

  return (
    <pre>
      {JSON.stringify(state, null, 2)}
    </pre>
  );
}
```

这个指令类似于 TypeScript 中的 `// @ts-ignore` 或 Rust 中的 `unsafe` 块——它是一种"我知道自己在做什么"的显式声明。

### 10.6.3 编译器的配置选项

React Compiler 可以通过配置文件进行调整：

```typescript
// react-compiler.config.ts
import type { CompilerConfig } from 'react-compiler';

const config: CompilerConfig = {
  // 编译目标
  target: '19',               // React 版本

  // 源码处理
  sources: (filename: string) => {
    // 只编译 src 目录下的文件
    return filename.startsWith('/src/');
  },

  // 日志与调试
  logger: {
    logEvent: (filename, event) => {
      if (event.kind === 'CompileError') {
        console.warn(`Compiler skipped ${filename}: ${event.detail}`);
      }
    },
  },

  // 环境配置
  environment: {
    // 告诉编译器哪些函数是纯函数
    customMacros: [
      { function: 'classNames', pure: true },
      { function: 'invariant', pure: true },
    ],
  },
};

export default config;
```

`sources` 配置特别有用——它允许你在大型项目中渐进地启用编译器，先对新代码或已知符合 Rules of React 的代码启用，再逐步扩大范围。

### 10.6.4 ESLint 插件：编译前的防护网

React Compiler 配套了一个 ESLint 插件 `eslint-plugin-react-compiler`，它在编辑阶段就能发现违反 Rules of React 的代码：

```typescript
// .eslintrc.js
module.exports = {
  plugins: ['react-compiler'],
  rules: {
    'react-compiler/react-compiler': 'error',
  },
};
```

这个插件会报告编译器遇到的问题，例如：

```tsx
function Problem({ items }: Props) {
  items.sort(); // ESLint 会警告：Mutating component props
  //    ^^^^
  // react-compiler/react-compiler:
  // Mutating a value returned from a function whose return value
  // should not be mutated. This is a violation of the Rules of React.

  return <List items={items} />;
}
```

## 10.7 与 Vue Compiler、Svelte Compiler、Solid Compiler 的横向对比

### 10.7.1 四种编译策略的哲学差异

理解 React Compiler 的定位，需要将它放在前端框架编译器的坐标系中审视。四大框架的编译策略代表了四种截然不同的设计哲学：

| 维度 | React Compiler | Vue Compiler | Svelte Compiler | Solid Compiler |
|------|---------------|-------------|-----------------|----------------|
| **编译目标** | 自动记忆化 | 模板优化 + 响应式转换 | 去虚拟 DOM | 细粒度响应式 |
| **运行时大小** | 大（保留完整运行时） | 中等（Tree-shakeable） | 小（编译掉框架本身） | 小（无虚拟 DOM） |
| **输入语言** | 标准 JSX/TSX | SFC 模板 + `<script setup>` | .svelte 自定义语法 | JSX（但语义不同） |
| **核心优化** | 跳过不变的计算 | 跳过不变的 DOM 更新 | 生成命令式 DOM 操作 | 只更新变化的 DOM 节点 |
| **虚拟 DOM** | 保留 | 保留（Vapor 模式除外） | 无 | 无 |
| **响应式追踪** | 编译时推断 | 运行时 Proxy | 编译时赋值追踪 | 编译时 Signal |

### 10.7.2 React Compiler vs Vue Compiler

Vue 的编译器在设计上比 React Compiler 早了很多年，但两者解决的问题维度不同。

**Vue Compiler 的核心优化——静态提升和 PatchFlag：**

```html
<!-- Vue 模板 -->
<template>
  <div>
    <h1>Static Title</h1>                    <!-- 静态节点，编译时提升 -->
    <p>{{ dynamicText }}</p>                   <!-- 动态节点，标记 PatchFlag -->
    <span class="static" :id="dynamicId">     <!-- 半静态，精确标记动态属性 -->
      Fixed text
    </span>
  </div>
</template>
```

```javascript
// Vue 编译输出（简化）
import { createVNode, toDisplayString, openBlock, createBlock } from 'vue';

// 静态节点在模块作用域创建，全局复用
const _hoisted_1 = createVNode('h1', null, 'Static Title');

export function render(ctx) {
  return (openBlock(), createBlock('div', null, [
    _hoisted_1,                              // 复用静态 VNode
    createVNode('p', null, toDisplayString(ctx.dynamicText), 1 /* TEXT */),
    createVNode('span', { class: 'static', id: ctx.dynamicId }, 'Fixed text', 8 /* PROPS */, ['id']),
  ]));
}
```

Vue 的编译器优化了**虚拟 DOM 的 Diff 过程**——通过 PatchFlag 告诉运行时"只有这些属性是动态的，只比较它们"。而 React Compiler 优化的是**组件的重渲染过程**——通过记忆化告诉运行时"这些值没变，不需要重新计算和创建"。

两者的差异根植于各自的架构选择：Vue 有模板语法，可以在编译时区分静态和动态内容；React 用 JSX，在编译时无法区分哪些 JSX 节点是"永远不变的"，所以选择了记忆化而非静态提升。

### 10.7.3 React Compiler vs Svelte Compiler

Svelte 走了一条更激进的路——完全消除虚拟 DOM。Svelte 的编译器将声明式的组件代码编译为**命令式的 DOM 操作**：

```svelte
<!-- Svelte 组件 -->
<script>
  let count = 0;
  $: doubled = count * 2;

  function increment() {
    count += 1;
  }
</script>

<button on:click={increment}>
  Count: {count}, Doubled: {doubled}
</button>
```

```javascript
// Svelte 编译输出（概念性简化）
function create_fragment(ctx) {
  let button;
  let t0, t1, t2;

  return {
    c() {
      // create：直接创建 DOM 节点
      button = document.createElement('button');
      t0 = document.createTextNode('Count: ');
      t1 = document.createTextNode(ctx[0]);    // count
      t2 = document.createTextNode(', Doubled: ' + ctx[1]); // doubled
      button.appendChild(t0);
      button.appendChild(t1);
      button.appendChild(t2);
    },
    m(target) {
      // mount：插入到 DOM
      target.appendChild(button);
      button.addEventListener('click', ctx[2]); // increment
    },
    p(ctx, dirty) {
      // patch：精确更新变化的部分
      if (dirty & 1) t1.data = ctx[0];         // 只更新 count 文本
      if (dirty & 2) t2.data = ', Doubled: ' + ctx[1]; // 只更新 doubled 文本
    },
    d() {
      // destroy：清理
      button.remove();
    }
  };
}
```

Svelte 的编译策略是"编译掉框架"——没有虚拟 DOM 的创建和 Diff，直接生成精确的 DOM 更新代码。`dirty` 位掩码追踪哪些状态变了，`p()` 函数只更新对应的 DOM 节点。

**React Compiler 与 Svelte Compiler 的根本差异**在于：React 的编译优化是在保留虚拟 DOM 的前提下进行的，它减少的是不必要的虚拟 DOM 创建，而不是消除虚拟 DOM 本身。Svelte 则完全跳过了虚拟 DOM 这一层抽象。

### 10.7.4 React Compiler vs Solid Compiler

Solid 的编译策略可能是与 React 表面最相似但内核最不同的。两者都使用 JSX，但 Solid 的 JSX 语义与 React 截然不同：

```tsx
// Solid 组件（看起来像 React，但语义完全不同）
function Counter() {
  const [count, setCount] = createSignal(0);

  // 这个 console.log 只执行一次！
  // Solid 的组件函数只在创建时执行一次，不会"重渲染"
  console.log('setup');

  return (
    <button onClick={() => setCount(c => c + 1)}>
      {/* count() 是一个 getter 调用，在 effect 上下文中自动追踪 */}
      Count: {count()}
    </button>
  );
}
```

```javascript
// Solid 编译输出（概念性简化）
function Counter() {
  const [count, setCount] = createSignal(0);
  console.log('setup');

  // 模板在编译时被提取为 HTML 字符串
  const _tmpl = template('<button>Count: </button>');

  const el = _tmpl.cloneNode(true);
  el.addEventListener('click', () => setCount(c => c + 1));

  // 动态部分通过 effect 自动更新
  createEffect(() => {
    el.firstChild.nextSibling.data = count(); // 精确更新文本节点
  });

  return el;
}
```

Solid 的编译器做了两件关键的事：
1. 将 JSX 模板编译为 `template()` 调用（利用浏览器的 HTML 解析器批量创建 DOM）
2. 将动态表达式包裹在 `createEffect` 中，通过 Signal 的自动追踪实现精确更新

### 10.7.5 编译策略的权衡总结

```
                    运行时开销 ←→ 编译时复杂度

  React             ████████░░  运行时重（VDOM + Reconciler）
  (+ Compiler)      ██████░░░░  编译器减少了不必要的 VDOM 创建

  Vue               ██████░░░░  运行时中等（VDOM + Proxy）
  (+ Vapor)         ████░░░░░░  Vapor 模式去掉 VDOM

  Svelte            ██░░░░░░░░  运行时轻（无 VDOM）

  Solid             ██░░░░░░░░  运行时轻（Signals + 直接 DOM）
```

React Compiler 的独特价值在于：**它在不改变 React 编程模型的前提下，显著降低了性能优化的认知负担**。你仍然用熟悉的 React 方式编写组件——props、state、JSX——但编译器在幕后为你做了手动优化时代需要做的一切。

这是一种保守但务实的策略。React 团队没有选择像 Svelte 或 Solid 那样重新定义编程模型，而是选择在现有模型上叠加编译时优化。这意味着迁移成本接近于零——对于已有的 React 代码库，启用编译器几乎不需要修改代码。

> **深度洞察**：四种编译策略的差异，本质上反映了一个工程哲学的光谱。在"运行时灵活性"和"编译时确定性"之间，React 选择了最偏向运行时的位置——保留完整的虚拟 DOM 和 Reconciler，让编译器只做"锦上添花"的优化。Svelte 和 Solid 则站在另一端——让编译器承担尽可能多的工作，将运行时压缩到最小。Vue 处于中间——模板语法给予编译器更多信息，但仍保留虚拟 DOM 作为通用抽象。没有绝对的优劣之分，只有适合不同场景的权衡。

## 10.8 本章小结

React Compiler 是 React 历史上最重要的架构变革之一。它标志着 React 从"一切由运行时决定"的纯运行时框架，转变为"编译时辅助 + 运行时执行"的混合架构。

关键要点：

1. **React Compiler 解决了手动优化的系统性问题**：`useMemo`/`useCallback` 的泛滥不是开发者的问题，而是框架设计的债务。编译器通过自动化记忆化，将开发者从"性能焦虑"中解放出来。

2. **编译管线采用经典编译器设计**：从 Babel AST 到 HIR，经过反应性分析、作用域构建、缓存槽位分配，最终生成带有 `useMemoCache` 调用的优化代码。多层中间表示使得每一阶段的分析都可以在合适的抽象层级上进行。

3. **Rules of React 是编译器正确性的契约**：幂等性、不可变性、纯渲染——这些规则不是新发明的，它们一直是 React 的最佳实践，编译器只是将它们从"建议"提升为了"要求"。

4. **缓存粒度优于手写**：编译器能看到整个函数的数据流图，做出比人类手动优化更精确的缓存决策——属性级依赖追踪、相邻作用域合并、跨表达式的依赖链优化。

5. **编译器是保守的**：当遇到无法安全分析的代码时，编译器选择跳过而非猜测。`"use no memo"` 指令提供了显式的逃生舱。

6. **React Compiler 的定位独一无二**：与 Vue/Svelte/Solid 的编译器不同，它不改变编程模型，不消除虚拟 DOM，不引入新的语法。它只是让你写的普通 React 代码自动获得优化版本的性能。

在下一章中，我们将深入 JSX 的编译过程——从 `React.createElement` 到新的 `jsx()` 运行时，理解 React 在编译入口处做了哪些关键的设计决策。

> **课程关联**：本章内容对应慕课网课程《React 源码深度解析》的扩展部分。React Compiler 是 React 19 的全新模块，课程中的 Hooks 和渲染机制基础是理解本章的前提，建议先完成课程基础部分的学习：[https://coding.imooc.com/class/650.html](https://coding.imooc.com/class/650.html)

---

### 思考题

1. **React Compiler 使用浅比较（`Object.is`）来判断缓存是否有效。** 如果一个组件接收一个对象 prop `config`，且父组件每次渲染都创建新的 `config` 对象（即使内容相同），编译器的缓存是否会失效？这与手写 `useMemo` 的行为有何不同？在这种场景下，编译器如何优化父组件来解决这个问题？

2. **编译器的反应性分析是一种前向数据流分析。** 考虑以下代码模式：一个组件从 `useContext` 获取一个大对象，但只使用其中一个属性。编译器能否做到"只在该属性变化时才重新计算"？如果不能，请解释静态分析在这里的局限性；如果能，请描述编译器需要执行的分析步骤。

3. **对比 React Compiler 的 `useMemoCache` 和 Vue 3 的响应式 `computed`。** 两者都实现了"输入不变则输出不变"的语义，但实现机制完全不同。请从缓存失效的精确度、运行时开销、内存占用三个维度分析它们的权衡。在什么场景下 React Compiler 的方案更优？在什么场景下 Vue 的方案更优？

4. **React Compiler 在遇到 `try-catch` 语句时的行为是什么？** `try` 块中的代码可能抛出异常，`catch` 块的执行取决于异常是否发生。这种控制流对编译器的作用域划分和缓存策略有什么影响？请构造一个具体的例子说明编译器可能需要放弃优化的场景。

</div>