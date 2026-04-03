<div v-pre>

# 第17章 React 性能工程

> **本章要点**
>
> - Profiler API 的内核实现：onRender 回调的触发时机与度量指标的采集原理
> - React DevTools Profiler 与 Chrome Performance 面板的协同分析方法论
> - 渲染瀑布（Render Waterfall）的识别模式与系统性消除策略
> - React Compiler 时代性能优化范式的根本性变化：从手动记忆化到编译时自动优化
> - 大列表虚拟化的工程实现：react-window 与 @tanstack/virtual 的架构对比
> - Suspense 分片加载与流式渲染的协作机制
> - 闭包陷阱与事件监听器导致的 Memory Leak 检测与修复

---

性能优化是一个危险的话题。

之所以说危险，是因为绝大多数"性能优化"的文章在教你做的事情，要么是过早优化，要么是在没有度量的情况下凭直觉修改代码。React 核心团队成员 Dan Abramov 曾反复强调一个观点：**在你能证明存在性能问题之前，不要优化**。这不是一句空话——每一次优化都引入了复杂性，而复杂性是软件系统中最昂贵的东西。

然而，当你的应用确实出现了性能问题——列表滚动卡顿、输入框响应迟钝、页面加载白屏时间过长——你需要的不是零散的技巧，而是一套系统化的**性能工程方法论**。这套方法论包含三个核心环节：**度量**（Measure）、**诊断**（Diagnose）、**治理**（Fix）。它们必须按顺序执行，跳过任何一步都可能让你在错误的方向上浪费大量时间。

React 19 和 React Compiler 的出现，让这套方法论发生了深刻的变化。过去我们花费大量精力手动添加的 `useMemo`、`useCallback`、`React.memo`，在编译器时代可能变得完全不必要。但与此同时，新的性能挑战也在涌现——Server Components 的瀑布请求、Suspense 边界的选择策略、大规模并发渲染下的内存压力。本章将带你建立一套适应 React 19 时代的完整性能工程体系。

## 17.1 性能分析工具链：从度量开始

性能优化的第一原则是：**没有度量，就没有优化**。React 提供了从 API 层到工具层的完整性能分析体系，我们从最底层的 Profiler API 开始。

### 17.1.1 Profiler 组件与 onRender 回调

React 内置的 `<Profiler>` 组件是性能度量的基础设施。它不是一个开发模式专属的工具——你可以在生产环境中使用它来采集真实用户的渲染性能数据。

```tsx
import { Profiler, ProfilerOnRenderCallback } from 'react';

const onRender: ProfilerOnRenderCallback = (
  id,           // Profiler 树的唯一标识
  phase,        // "mount" | "update" | "nested-update"
  actualDuration,   // 本次渲染实际花费的时间（ms）
  baseDuration,     // 在没有任何优化的情况下，完整渲染子树的预估时间
  startTime,        // 本次渲染开始的时间戳
  commitTime         // 本次 commit 的时间戳
) => {
  // 发送到性能监控系统
  performanceMonitor.report({
    component: id,
    phase,
    actualDuration,
    baseDuration,
    timestamp: commitTime,
  });
};

function App() {
  return (
    <Profiler id="App" onRender={onRender}>
      <Header />
      <Profiler id="MainContent" onRender={onRender}>
        <ProductList />
        <Sidebar />
      </Profiler>
      <Footer />
    </Profiler>
  );
}
```

这段代码看起来简单，但要理解它的度量含义，需要深入 React 内核。

`actualDuration` 和 `baseDuration` 的区别是理解 React 性能模型的关键。`actualDuration` 是本次渲染中，这棵子树**实际执行**的渲染时间——如果某些子组件因为 `memo` 或 Compiler 优化而被跳过，它们的渲染时间不会被计入。而 `baseDuration` 是假设没有任何优化、所有组件都重新渲染的**理论最大时间**。

```typescript
// React 源码中 Profiler 计时的核心逻辑
// 位于 ReactFiberCommitWork.js

function commitProfilerUpdate(
  finishedWork: Fiber,
  current: Fiber | null,
) {
  const { onRender } = finishedWork.memoizedProps;

  if (typeof onRender === 'function') {
    // actualDuration 存储在 Fiber 节点上
    // 在 beginWork/completeWork 过程中累加
    let actualDuration = finishedWork.actualDuration;

    // baseDuration 是子树中所有 Fiber 节点的 selfBaseDuration 之和
    // 即使组件被跳过，baseDuration 也会包含它的时间
    let baseDuration = finishedWork.selfBaseDuration;
    let child = finishedWork.child;
    while (child !== null) {
      baseDuration += child.treeBaseDuration;
      child = child.sibling;
    }

    onRender(
      finishedWork.memoizedProps.id,
      current === null ? 'mount' : 'update',
      actualDuration,
      baseDuration,
      finishedWork.actualStartTime,
      commitTime,
    );
  }
}
```

> **深度洞察**：`baseDuration` 与 `actualDuration` 的差值，就是你的优化"收益"。如果 `baseDuration` 是 50ms，`actualDuration` 是 5ms，说明优化措施（无论是手动 memo 还是 Compiler 自动优化）帮你跳过了 90% 的渲染工作。但如果两者几乎相等，说明几乎每个组件都在重新渲染——这时你需要检查状态提升是否正确、是否有不必要的 Context 更新。

### 17.1.2 生产环境的 Profiler 采样策略

在生产环境使用 Profiler 需要注意性能开销。Profiler 本身会引入大约 5-15% 的额外开销（取决于组件树的深度），因此建议使用采样策略：

```typescript
// 生产环境的采样 Profiler 封装
const SAMPLE_RATE = 0.05; // 5% 采样率

function createSampledProfiler() {
  const shouldSample = Math.random() < SAMPLE_RATE;

  const onRender: ProfilerOnRenderCallback = (
    id, phase, actualDuration, baseDuration, startTime, commitTime
  ) => {
    if (!shouldSample) return;

    // 只上报超过阈值的慢渲染
    if (actualDuration > 16) { // 超过一帧（60fps）
      navigator.sendBeacon('/api/perf', JSON.stringify({
        id,
        phase,
        actualDuration,
        baseDuration,
        url: window.location.pathname,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
      }));
    }
  };

  return onRender;
}
```

这里有一个关键的阈值判断：`actualDuration > 16`。16ms 是 60fps 下每帧的时间预算。如果一次渲染超过了这个时间，意味着这次渲染至少占用了整整一帧，用户可能感知到卡顿。在实际项目中，你可能还需要区分不同的阈值等级：

```typescript
type PerformanceSeverity = 'info' | 'warning' | 'critical';

function classifyRenderDuration(duration: number): PerformanceSeverity {
  if (duration > 100) return 'critical';  // 超过 100ms：严重卡顿
  if (duration > 50) return 'warning';    // 超过 50ms：可感知延迟
  if (duration > 16) return 'info';       // 超过 16ms：可能丢帧
  return 'info';
}
```

### 17.1.3 React DevTools Profiler 的使用方法论

React DevTools 的 Profiler 面板是日常开发中最常用的性能分析工具。它提供了三种视图，各有不同的分析侧重：

**Flamegraph（火焰图）视图**：展示组件树的渲染层次结构。每个组件显示为一个色条，宽度表示渲染耗时，颜色从绿色（快）到黄色、橙色、红色（慢）。灰色表示这个组件在本次渲染中被跳过。

**Ranked（排序）视图**：将所有重新渲染的组件按耗时从高到低排列。这是快速定位"最慢组件"的最佳视图——排在最顶部的组件就是你应该首先调查的对象。

**Timeline（时间线）视图**：展示每次 commit 的时间关系，可以看到 state 更新触发了哪些渲染、渲染之间的间隔是多少。这对于分析"连锁渲染"（cascading renders）特别有用。

分析性能问题的标准流程是：

```
1. 在 Profiler 面板点击录制按钮
2. 在应用中执行你认为有性能问题的操作
3. 停止录制
4. 首先查看 Ranked 视图，找到耗时最长的组件
5. 切换到 Flamegraph 视图，查看该组件在树中的位置
6. 点击该组件，查看"Why did this render?"信息
7. 根据渲染原因制定优化策略
```

### 17.1.4 Chrome Performance 面板与 React 的协作

当 React DevTools 的 Profiler 无法解释性能问题时——比如卡顿发生在 React 渲染之外（DOM 操作、布局计算、垃圾回收）——你需要使用 Chrome Performance 面板。

在 React 的开发构建中，React 会通过 `performance.mark()` 和 `performance.measure()` API 在 Chrome 的 User Timing 轨道中留下标记：

```typescript
// React 源码中的 Performance 标记（简化）
// 位于 ReactFiberWorkLoop.js

function performUnitOfWork(unitOfWork: Fiber): void {
  if (enableProfilerTimer) {
    // 在 Chrome Performance 面板中显示为一个标记
    performance.mark(`⚛️ ${getComponentName(unitOfWork.type)} [mount]`);
  }

  const next = beginWork(current, unitOfWork, renderLanes);

  if (enableProfilerTimer) {
    performance.measure(
      `⚛️ ${getComponentName(unitOfWork.type)}`,
      `⚛️ ${getComponentName(unitOfWork.type)} [mount]`
    );
  }
}
```

在 Chrome Performance 面板中，你可以看到：

1. **Main 轨道**：JavaScript 执行的调用栈，可以看到 `performSyncWorkOnRoot`、`beginWork`、`completeWork` 等 React 内部函数
2. **User Timing 轨道**：React 标记的组件渲染信息，带有 ⚛️ 前缀
3. **Frames 轨道**：帧率信息，红色帧表示掉帧
4. **Layout/Paint 轨道**：DOM 操作触发的布局和绘制

> **深度洞察**：很多性能问题不在 React 的渲染阶段，而在浏览器的布局和绘制阶段。一个典型的例子是读取 `offsetHeight` 触发的强制同步布局（Forced Synchronous Layout）。React 通过批量化 DOM 操作来避免这个问题，但如果你在 `useLayoutEffect` 中读取 DOM 几何属性、然后修改样式，仍然会触发布局抖动。Chrome Performance 面板中的紫色条（Layout）如果出现在 JavaScript 调用栈内部，就是强制同步布局的信号。

## 17.2 渲染瀑布的识别与消除

渲染瀑布（Render Waterfall）是 React 应用中最常见的性能反模式。它指的是一个组件的渲染触发了另一个组件的状态更新，而后者的渲染又触发了更多的状态更新，形成链式反应。

### 17.2.1 什么是渲染瀑布

考虑以下代码：

```tsx
function Parent() {
  const [items, setItems] = useState<Item[]>([]);

  return (
    <div>
      <DataFetcher onData={setItems} />
      <ItemList items={items} />
    </div>
  );
}

function DataFetcher({ onData }: { onData: (items: Item[]) => void }) {
  const [query, setQuery] = useState('');

  // ❌ 渲染瀑布：useEffect 在渲染后触发状态更新
  useEffect(() => {
    fetch(`/api/items?q=${query}`)
      .then(res => res.json())
      .then(data => onData(data));
  }, [query, onData]);

  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}

function ItemList({ items }: { items: Item[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ❌ 又一个瀑布：items 变化时需要重置选中状态
  useEffect(() => {
    if (items.length > 0 && !items.find(i => i.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  return (
    <ul>
      {items.map(item => (
        <li
          key={item.id}
          className={item.id === selectedId ? 'selected' : ''}
          onClick={() => setSelectedId(item.id)}
        >
          {item.name}
        </li>
      ))}
    </ul>
  );
}
```

这段代码的渲染流程如下：

```
用户输入 → setQuery → Parent 渲染 → DataFetcher 渲染 →
  useEffect 触发 fetch → fetch 返回 → onData(data) → setItems →
    Parent 再次渲染 → ItemList 渲染 →
      useEffect 发现 selectedId 无效 → setSelectedId →
        ItemList 再次渲染
```

用户的一次输入触发了**至少 3 轮渲染**。在 React DevTools 的 Timeline 视图中，你会看到多次紧密排列的 commit，这就是渲染瀑布的典型特征。

### 17.2.2 瀑布的四种常见模式

**模式一：useEffect 中的状态同步**

这是最常见的瀑布来源。开发者习惯用 `useEffect` 来"响应" prop 变化并更新 state：

```tsx
// ❌ 反模式：useEffect 做 prop → state 同步
function SearchResults({ query }: { query: string }) {
  const [results, setResults] = useState<Result[]>([]);
  const [page, setPage] = useState(1);

  // query 变化时重置页码
  useEffect(() => {
    setPage(1); // 触发额外渲染！
  }, [query]);

  // ...
}

// ✅ 正确做法：用 key 重置组件
function SearchPage() {
  const [query, setQuery] = useState('');
  return <SearchResults key={query} query={query} />;
}

function SearchResults({ query }: { query: string }) {
  const [page, setPage] = useState(1); // query 变化时组件重新挂载，state 自然重置
  // ...
}
```

**模式二：派生状态的冗余存储**

```tsx
// ❌ 反模式：把派生数据存在 state 里
function FilteredList({ items, filter }: Props) {
  const [filteredItems, setFilteredItems] = useState<Item[]>([]);

  useEffect(() => {
    setFilteredItems(items.filter(item => item.category === filter));
  }, [items, filter]);

  return <List items={filteredItems} />;
}

// ✅ 正确做法：直接在渲染中计算
function FilteredList({ items, filter }: Props) {
  // 在 Compiler 时代，这会被自动记忆化
  const filteredItems = items.filter(item => item.category === filter);
  return <List items={filteredItems} />;
}
```

**模式三：请求瀑布（Request Waterfall）**

这在 Server Components 和 Suspense 场景中尤为严重：

```tsx
// ❌ 请求瀑布：子组件的请求依赖父组件的请求结果
function UserProfile({ userId }: { userId: string }) {
  const user = use(fetchUser(userId)); // 第一个请求

  return (
    <div>
      <h1>{user.name}</h1>
      {/* 第二个请求必须等第一个完成后才能开始 */}
      <Suspense fallback={<Skeleton />}>
        <UserPosts userId={user.id} />
      </Suspense>
    </div>
  );
}

function UserPosts({ userId }: { userId: string }) {
  const posts = use(fetchPosts(userId)); // 要等 UserProfile 渲染完才开始
  return <PostList posts={posts} />;
}
```

```
时间线：
[========= fetchUser =========]
                                [========= fetchPosts =========]
                                                                 → 渲染完成
总时间 = fetchUser + fetchPosts（串行）
```

解决方案是将请求提升到同一层级，并行发起：

```tsx
// ✅ 并行请求：在父组件预先发起所有请求
function UserProfile({ userId }: { userId: string }) {
  // 同时发起两个请求（Promise 在创建时就开始执行）
  const userPromise = fetchUser(userId);
  const postsPromise = fetchPosts(userId);

  const user = use(userPromise);

  return (
    <div>
      <h1>{user.name}</h1>
      <Suspense fallback={<Skeleton />}>
        <UserPosts postsPromise={postsPromise} />
      </Suspense>
    </div>
  );
}
```

```
时间线：
[========= fetchUser =========]
[========= fetchPosts =========]
                                 → 渲染完成
总时间 = max(fetchUser, fetchPosts)（并行）
```

**模式四：useLayoutEffect 引发的同步瀑布**

```tsx
// ❌ 最危险的瀑布：useLayoutEffect 中的状态更新会阻塞绘制
function Tooltip({ targetRef, content }: Props) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const rect = targetRef.current?.getBoundingClientRect();
    if (rect) {
      // 同步触发重渲染，浏览器必须等待第二次渲染完成才能绘制
      setPosition({ top: rect.bottom + 8, left: rect.left });
    }
  });

  return (
    <div style={{ position: 'absolute', top: position.top, left: position.left }}>
      {content}
    </div>
  );
}
```

`useLayoutEffect` 中的状态更新是**同步**的——React 会立即重新渲染组件，浏览器要等第二次渲染完成后才能绘制到屏幕上。这意味着用户看到的是两次渲染的结果，但中间没有任何视觉反馈。如果这个组件的渲染很重，用户会感知到明显的卡顿。

### 17.2.3 系统性消除瀑布的策略

消除渲染瀑布的核心原则：

1. **能在渲染中计算的，不要放在 Effect 中**——派生状态直接用表达式或 `useMemo`
2. **能用 key 重置的，不要用 Effect 同步**——改变 key 让 React 重新挂载组件
3. **能并行请求的，不要串行**——在同一层级发起所有独立的数据请求
4. **能用事件处理的，不要用 Effect**——用户操作的响应应该在事件处理函数中完成

```tsx
// 一个综合优化的例子
function Dashboard({ userId }: { userId: string }) {
  // ✅ 并行发起所有请求
  const profilePromise = useMemo(() => fetchProfile(userId), [userId]);
  const statsPromise = useMemo(() => fetchStats(userId), [userId]);
  const activityPromise = useMemo(() => fetchActivity(userId), [userId]);

  return (
    <div className="dashboard">
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileCard profilePromise={profilePromise} />
      </Suspense>
      <Suspense fallback={<StatsSkeleton />}>
        <StatsPanel statsPromise={statsPromise} />
      </Suspense>
      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityFeed activityPromise={activityPromise} />
      </Suspense>
    </div>
  );
}
```

## 17.3 React Compiler 时代的性能优化策略变化

React Compiler 的出现，标志着 React 性能优化从**手动时代**进入**自动时代**。这不是一个渐进的改进，而是一次范式转换。

### 17.3.1 手动优化时代的心智负担

在 React Compiler 之前，性能优化的核心三件套是 `React.memo`、`useMemo`、`useCallback`：

```tsx
// 手动优化时代的典型代码
const ExpensiveList = React.memo(function ExpensiveList({
  items,
  onItemClick,
}: {
  items: Item[];
  onItemClick: (id: string) => void;
}) {
  return (
    <ul>
      {items.map(item => (
        <ExpensiveItem key={item.id} item={item} onClick={onItemClick} />
      ))}
    </ul>
  );
});

const ExpensiveItem = React.memo(function ExpensiveItem({
  item,
  onClick,
}: {
  item: Item;
  onClick: (id: string) => void;
}) {
  return (
    <li onClick={() => onClick(item.id)}>
      {/* 假设这里有昂贵的渲染逻辑 */}
      <ComplexVisualization data={item.data} />
    </li>
  );
});

function Parent() {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 必须用 useCallback，否则 ExpensiveList 的 memo 会失效
  const handleItemClick = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  // 必须用 useMemo，否则每次渲染都会创建新的过滤结果
  const visibleItems = useMemo(
    () => items.filter(item => item.visible),
    [items]
  );

  return <ExpensiveList items={visibleItems} onItemClick={handleItemClick} />;
}
```

这段代码的问题不在于它不能工作——它确实能带来性能提升。问题在于**认知负担**：

1. 你需要**记住**哪些组件应该被 `React.memo` 包裹
2. 你需要**追踪**每个传入 memo 组件的 prop 是否是稳定引用
3. 你需要**确保**每个回调函数都用 `useCallback` 包裹
4. 你需要**判断**哪些计算值应该用 `useMemo` 缓存
5. 你需要**正确设置**每个 `useMemo` 和 `useCallback` 的依赖数组

遗漏任何一步，优化都会静默失效——没有错误、没有警告，只是性能回退到未优化的状态。

### 17.3.2 React Compiler 的自动记忆化

React Compiler 通过静态分析，自动为你的代码添加记忆化。让我们看看编译器是如何工作的：

```tsx
// 你写的代码（编译前）
function ProductCard({ product, onAddToCart }: Props) {
  const discount = product.price * 0.1;
  const formattedPrice = `¥${(product.price - discount).toFixed(2)}`;

  return (
    <div className="card">
      <h3>{product.name}</h3>
      <p>{formattedPrice}</p>
      <button onClick={() => onAddToCart(product.id)}>
        加入购物车
      </button>
    </div>
  );
}

// React Compiler 编译后（概念性伪代码）
function ProductCard({ product, onAddToCart }: Props) {
  const $ = _c(7); // 创建缓存槽位数组

  let discount;
  let formattedPrice;
  if ($[0] !== product.price) {
    discount = product.price * 0.1;
    formattedPrice = `¥${(product.price - discount).toFixed(2)}`;
    $[0] = product.price;
    $[1] = discount;
    $[2] = formattedPrice;
  } else {
    discount = $[1];
    formattedPrice = $[2];
  }

  let t0;
  if ($[3] !== onAddToCart || $[4] !== product.id) {
    t0 = () => onAddToCart(product.id);
    $[3] = onAddToCart;
    $[4] = product.id;
    $[5] = t0;
  } else {
    t0 = $[5];
  }

  let t1;
  if ($[6] !== product.name || $[2] !== formattedPrice || $[5] !== t0) {
    t1 = (
      <div className="card">
        <h3>{product.name}</h3>
        <p>{formattedPrice}</p>
        <button onClick={t0}>加入购物车</button>
      </div>
    );
    $[6] = product.name;
    // ... 缓存 JSX 结果
  }

  return t1;
}
```

编译器做了几件关键的事情：

1. **分析数据依赖**：`discount` 依赖 `product.price`，`formattedPrice` 依赖 `discount`，箭头函数依赖 `onAddToCart` 和 `product.id`
2. **创建缓存槽位**：每个需要缓存的中间值分配一个槽位
3. **生成条件判断**：只有当依赖发生变化时才重新计算，否则复用缓存值
4. **缓存 JSX 结构**：最终的 JSX 元素也被缓存，如果输入不变就直接返回

### 17.3.3 Compiler 时代仍需手动优化的场景

React Compiler 并不能消除所有性能问题。以下场景仍然需要开发者的手动干预：

**场景一：组件拆分仍然是你的责任**

```tsx
// ❌ Compiler 无法帮你拆分组件
function Page() {
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <p>当前时间：{clock.toLocaleTimeString()}</p>
      {/* 这个昂贵的组件每秒都会重新执行！ */}
      <ExpensiveChart data={staticData} />
    </div>
  );
}

// ✅ 通过组件拆分隔离频繁更新
function Page() {
  return (
    <div>
      <Clock />
      <ExpensiveChart data={staticData} />
    </div>
  );
}

function Clock() {
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <p>当前时间：{clock.toLocaleTimeString()}</p>;
}
```

Compiler 可以缓存 `<ExpensiveChart data={staticData} />` 这个 JSX 元素，使得 `staticData` 不变时跳过子树渲染。但如果 `ExpensiveChart` 被内联在频繁更新的组件中且依赖了变化的上下文，Compiler 的缓存就无法发挥作用。**组件边界的设计永远是开发者的架构决策**。

**场景二：Context 的粒度问题**

```tsx
// ❌ 粗粒度的 Context 会导致大面积重渲染
const AppContext = createContext<{
  user: User;
  theme: Theme;
  notifications: Notification[];
  settings: Settings;
} | null>(null);

// ✅ 拆分为独立的 Context
const UserContext = createContext<User | null>(null);
const ThemeContext = createContext<Theme>('light');
const NotificationContext = createContext<Notification[]>([]);
```

React Compiler 无法改变 Context 的订阅粒度。当一个 Context 的值发生变化时，所有消费该 Context 的组件都会重新渲染——无论它们是否使用了变化的那部分数据。这是 React 架构层面的限制，编译器无法绕过。

**场景三：列表虚拟化**

无论 Compiler 多么智能，如果你渲染了 10000 个 DOM 节点，浏览器的布局和绘制阶段就会成为瓶颈——这不是 React 的渲染层能优化的。虚拟化是唯一的解决方案，这属于下一节的内容。

### 17.3.4 如何判断是否需要 React Compiler

```typescript
// 使用 eslint-plugin-react-compiler 检查代码是否兼容
// .eslintrc.js
module.exports = {
  plugins: ['eslint-plugin-react-compiler'],
  rules: {
    'react-compiler/react-compiler': 'error',
  },
};
```

Compiler 的核心假设是你的代码遵循 **Rules of React**：

1. 组件和 Hook 必须是**纯函数**（相同输入产生相同输出）
2. props 和 state 是**不可变的**——不要直接修改它们
3. Hook 的返回值和参数是**不可变的**
4. 传入 JSX 的值在传入后**不会被修改**

如果你的代码违反了这些规则，Compiler 会跳过该组件的优化（降级为不优化，而不是产生错误的代码）。你可以使用 `'use no memo'` 指令显式退出优化：

```tsx
function LegacyComponent() {
  'use no memo'; // 告诉 Compiler 不要优化这个组件
  // ... 包含 mutation 的遗留代码
}
```

## 17.4 大列表虚拟化与 Suspense 分片加载

当你需要渲染包含数千甚至数万条记录的列表时，即使 React 的渲染速度足够快，浏览器的 DOM 操作和布局计算也会成为瓶颈。虚拟化（Virtualization）是解决这个问题的标准方案。

### 17.4.1 虚拟化的核心原理

虚拟化的基本思想很简单：**只渲染用户能看到的部分**。如果一个列表有 10000 个条目，但视口中只能同时显示 20 个，那么只需要渲染这 20 个条目（加上少量的缓冲区）。

```
┌─────────────────────────────┐
│  ┊     不渲染（上方）       ┊  │ ← overscanCount 个缓冲项
│  ├─────────────────────────┤  │
│  │  Item 45                │  │
│  │  Item 46                │  │ ← 可见区域（viewport）
│  │  Item 47                │  │
│  │  Item 48                │  │
│  │  ...                    │  │
│  │  Item 60                │  │
│  ├─────────────────────────┤  │
│  ┊     不渲染（下方）       ┊  │ ← overscanCount 个缓冲项
└─────────────────────────────┘

滚动容器的总高度 = itemCount × itemSize
实际渲染的 DOM 节点数 ≈ visibleCount + 2 × overscanCount
```

### 17.4.2 react-window 的架构分析

`react-window` 是 Brian Vaughn（前 React 团队成员）编写的虚拟化库，它是 `react-virtualized` 的轻量级替代品：

```tsx
import { FixedSizeList as List } from 'react-window';

interface RowProps {
  index: number;
  style: React.CSSProperties;
  data: Item[];
}

const Row = ({ index, style, data }: RowProps) => (
  <div style={style} className="row">
    <span>{data[index].name}</span>
    <span>{data[index].price}</span>
  </div>
);

function VirtualizedProductList({ products }: { products: Item[] }) {
  return (
    <List
      height={600}          // 视口高度
      itemCount={products.length}
      itemSize={50}         // 每行高度（固定）
      width="100%"
      itemData={products}   // 传递给 Row 的数据
      overscanCount={5}     // 上下各多渲染 5 个缓冲项
    >
      {Row}
    </List>
  );
}
```

`react-window` 的核心实现逻辑可以概括为：

```typescript
// react-window 内部逻辑的简化版
function FixedSizeList({ height, itemCount, itemSize, children: Row, overscanCount = 1 }) {
  const [scrollOffset, setScrollOffset] = useState(0);

  // 1. 计算可见范围
  const startIndex = Math.floor(scrollOffset / itemSize);
  const endIndex = Math.min(
    itemCount - 1,
    Math.floor((scrollOffset + height) / itemSize)
  );

  // 2. 加上 overscan 缓冲
  const overscanStartIndex = Math.max(0, startIndex - overscanCount);
  const overscanEndIndex = Math.min(itemCount - 1, endIndex + overscanCount);

  // 3. 只渲染可见范围内的项
  const items = [];
  for (let i = overscanStartIndex; i <= overscanEndIndex; i++) {
    items.push(
      <Row
        key={i}
        index={i}
        style={{
          position: 'absolute',
          top: i * itemSize,
          height: itemSize,
          width: '100%',
        }}
      />
    );
  }

  return (
    <div
      style={{ height, overflow: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollOffset(e.currentTarget.scrollTop)}
    >
      {/* 撑开滚动容器的总高度 */}
      <div style={{ height: itemCount * itemSize, position: 'relative' }}>
        {items}
      </div>
    </div>
  );
}
```

### 17.4.3 @tanstack/react-virtual 的现代方案

`@tanstack/react-virtual`（TanStack Virtual）是更现代的虚拟化方案，它提供了 headless 的 API——只负责计算逻辑，不渲染任何 DOM，给你完全的样式控制权：

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualList({ items }: { items: Item[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50, // 预估每项高度
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      style={{ height: '600px', overflow: 'auto' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {items[virtualItem.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

TanStack Virtual 的关键优势在于：

1. **动态高度支持**：通过 `measureElement` 回调实时测量每项的实际高度
2. **水平和网格虚拟化**：不仅支持垂直列表，还支持水平滚动和二维网格
3. **框架无关**：核心逻辑与 React 解耦，同时支持 Vue、Svelte、Solid 等

```tsx
// 动态高度的虚拟化
function DynamicHeightList({ items }: { items: Item[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // 初始估算高度
    overscan: 3,
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement} // 关键：测量实际高度
            data-index={virtualItem.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <ItemCard item={items[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

> **深度洞察**：虚拟化的本质是一种**时空权衡**——用更多的计算（滚动时的位置计算和 DOM 操作）换取更少的空间（DOM 节点数量）。对于 DOM 节点数量在 1000 以内的列表，虚拟化引入的额外计算复杂度（滚动事件处理、位置计算、DOM 回收）可能反而降低性能。虚拟化的盈亏平衡点通常在 500-1000 个节点之间——低于这个数量级，简单的 `React.memo` 或 Compiler 自动优化通常就足够了。

### 17.4.4 Suspense 分片加载

当数据量特别大时，除了渲染层面的虚拟化，还需要在数据层面进行分片加载。Suspense 为此提供了优雅的声明式接口：

```tsx
// 分片加载的数据源
function createPaginatedResource<T>(
  fetchPage: (page: number, pageSize: number) => Promise<T[]>,
  pageSize: number = 50
) {
  const cache = new Map<number, Promise<T[]>>();

  return {
    getPage(page: number): Promise<T[]> {
      if (!cache.has(page)) {
        cache.set(page, fetchPage(page, pageSize));
      }
      return cache.get(page)!;
    },
    prefetch(page: number): void {
      if (!cache.has(page)) {
        cache.set(page, fetchPage(page, pageSize));
      }
    },
  };
}

// 使用 Suspense 的分片加载列表
const productResource = createPaginatedResource(
  (page, pageSize) =>
    fetch(`/api/products?page=${page}&size=${pageSize}`).then(r => r.json())
);

function InfiniteProductList() {
  const [pages, setPages] = useState([0]);

  // 预取下一页
  useEffect(() => {
    const lastPage = pages[pages.length - 1];
    productResource.prefetch(lastPage + 1);
  }, [pages]);

  return (
    <div>
      {pages.map(page => (
        <Suspense key={page} fallback={<ListSkeleton />}>
          <ProductPage page={page} />
        </Suspense>
      ))}
      <button onClick={() => setPages(p => [...p, p.length])}>
        加载更多
      </button>
    </div>
  );
}

function ProductPage({ page }: { page: number }) {
  const products = use(productResource.getPage(page));
  return (
    <div>
      {products.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
```

这种模式的精妙之处在于：

1. **每一页都被独立的 Suspense 边界包裹**——新页面的加载不会影响已有内容的显示
2. **预取机制**——在用户点击"加载更多"之前就开始请求下一页
3. **缓存机制**——已加载的页面不会重复请求

### 17.4.5 Suspense 边界的精确放置策略

Suspense 边界的放置位置直接影响用户体验。边界放得太高，整个页面会显示加载状态；边界放得太低，会出现大量零碎的加载指示器：

```tsx
// ❌ 边界太高：整个页面都被 Suspense 覆盖
function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Header />
      <Sidebar />
      <MainContent />
      <Footer />
    </Suspense>
  );
}

// ❌ 边界太低：每个小组件都有自己的加载状态，视觉混乱
function Dashboard() {
  return (
    <div>
      <Suspense fallback={<Skeleton />}><UserAvatar /></Suspense>
      <Suspense fallback={<Skeleton />}><UserName /></Suspense>
      <Suspense fallback={<Skeleton />}><UserEmail /></Suspense>
      {/* 三个独立的加载状态闪烁 */}
    </div>
  );
}

// ✅ 边界恰到好处：按语义分组
function Dashboard() {
  return (
    <div>
      {/* 用户信息作为一个整体加载 */}
      <Suspense fallback={<UserCardSkeleton />}>
        <UserCard />
      </Suspense>
      {/* 统计面板独立加载 */}
      <Suspense fallback={<StatsPanelSkeleton />}>
        <StatsPanel />
      </Suspense>
      {/* 活动流独立加载 */}
      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityFeed />
      </Suspense>
    </div>
  );
}
```

> **深度洞察**：Suspense 边界的最佳实践是——**按用户的心理模型分组**。用户不会把"头像"和"用户名"当作两个独立的内容块，它们在认知上是一个整体。当你划分 Suspense 边界时，问自己："如果这部分内容正在加载，用户是否能理解当前页面的状态？"如果答案是"不能"，说明你的边界放得太低了。

## 17.5 Memory Leak 的常见模式与检测

Memory Leak（内存泄漏）是 React 应用中最隐蔽的性能问题。它不会立即导致崩溃，而是随着用户使用时间的增长，应用逐渐变慢、响应迟钝，最终可能导致页面崩溃。

### 17.5.1 React 中内存泄漏的三大来源

**来源一：未清理的副作用**

这是最常见的内存泄漏来源。当组件卸载后，如果 `useEffect` 中注册的事件监听器、定时器、WebSocket 连接没有被清理，它们会持续持有对组件作用域中变量的引用，阻止垃圾回收：

```tsx
// ❌ 内存泄漏：组件卸载后定时器仍在运行
function Polling({ url }: { url: string }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    const timer = setInterval(async () => {
      const response = await fetch(url);
      const json = await response.json();
      setData(json); // 组件已卸载，但 setData 仍被调用
      // 更严重的是，闭包持有对 url 的引用
      // 如果 url 是一个大型对象，它无法被 GC 回收
    }, 5000);

    // ❌ 忘记返回清理函数
  }, [url]);

  return <pre>{JSON.stringify(data)}</pre>;
}

// ✅ 正确：返回清理函数
function Polling({ url }: { url: string }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false; // 防止对已卸载组件调用 setState

    const timer = setInterval(async () => {
      const response = await fetch(url);
      const json = await response.json();
      if (!cancelled) {
        setData(json);
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url]);

  return <pre>{JSON.stringify(data)}</pre>;
}
```

**来源二：闭包导致的意外引用持有**

JavaScript 闭包会隐式地持有外部作用域中的所有变量（在 V8 引擎中是只持有实际引用的变量，但在某些引擎中可能不同）。在 React 中，这意味着事件处理函数和 Effect 回调可能意外地持有大型对象的引用：

```tsx
// ❌ 闭包导致的内存泄漏
function ImageGallery({ images }: { images: ImageData[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    // 这个闭包持有 images 数组的引用
    // 即使 images prop 更新了，旧的 images 数组也无法被 GC
    // 因为上一次 Effect 的清理函数还在等待执行
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setSelectedIndex(i => Math.min(i + 1, images.length - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [images]); // images 作为依赖，每次变化都重新绑定

  // 如果 images 频繁更新且每次都是新的大数组
  // 旧的数组会被闭包持有直到下次 Effect 执行
  return <img src={images[selectedIndex]?.url} />;
}

// ✅ 改进：使用 ref 持有最新值，避免闭包捕获
function ImageGallery({ images }: { images: ImageData[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    // 闭包只持有 imagesRef（一个稳定的引用）
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setSelectedIndex(i => Math.min(i + 1, imagesRef.current.length - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // 依赖为空，Effect 只执行一次

  return <img src={images[selectedIndex]?.url} />;
}
```

**来源三：全局缓存的无限增长**

```tsx
// ❌ 缓存无限增长
const queryCache = new Map<string, unknown>();

function useCachedQuery<T>(key: string, fetcher: () => Promise<T>): T | null {
  const [data, setData] = useState<T | null>(
    queryCache.has(key) ? (queryCache.get(key) as T) : null
  );

  useEffect(() => {
    if (!queryCache.has(key)) {
      fetcher().then(result => {
        queryCache.set(key, result); // 永远不会被删除！
        setData(result);
      });
    }
  }, [key, fetcher]);

  return data;
}

// ✅ 改进：使用 LRU 缓存或 WeakRef
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移到最新位置（Map 的插入顺序）
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 删除最早插入的项
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

const queryCache = new LRUCache<string, unknown>(100); // 最多缓存 100 个查询
```

### 17.5.2 AbortController 模式：防止请求泄漏

在异步操作中，一个被遗忘的 `fetch` 请求不仅浪费带宽，还会在响应到达后尝试更新已卸载的组件。`AbortController` 是现代浏览器提供的标准取消机制：

```tsx
function useAsyncData<T>(url: string): { data: T | null; loading: boolean; error: Error | null } {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: Error | null;
  }>({ data: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();

    setState(prev => ({ ...prev, loading: true, error: null }));

    fetch(url, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setState({ data, loading: false, error: null });
      })
      .catch(error => {
        // AbortError 是预期行为，不是真正的错误
        if (error.name !== 'AbortError') {
          setState({ data: null, loading: false, error });
        }
      });

    return () => {
      controller.abort(); // 组件卸载或 url 变化时取消请求
    };
  }, [url]);

  return state;
}
```

### 17.5.3 使用 Chrome DevTools 检测内存泄漏

Chrome DevTools 的 Memory 面板提供了三种内存分析工具：

**Heap Snapshot（堆快照）**：

```
检测步骤：
1. 打开 Chrome DevTools → Memory 面板
2. 执行一次触发怀疑泄漏的操作前，拍摄 Snapshot 1
3. 执行操作（如打开/关闭模态框多次）
4. 手动触发垃圾回收（点击垃圾桶图标）
5. 拍摄 Snapshot 2
6. 选择 Snapshot 2，在视图中选择 "Comparison"
7. 对比两次快照，查找 "# Delta" > 0 的对象类型
8. 重点关注 Detached DOM tree 和 EventListener
```

**Allocation Timeline（分配时间线）**：

```
检测步骤：
1. 选择 "Allocation instrumentation on timeline"
2. 开始录制
3. 执行导致泄漏的操作
4. 停止录制
5. 蓝色条表示仍存活的分配（可能是泄漏）
6. 灰色条表示已被回收的分配（正常）
7. 点击蓝色条查看分配的对象详情和保留路径（Retaining Path）
```

**Retaining Path 分析**——这是定位泄漏根因的关键。它展示了一条从 GC Root 到泄漏对象的引用链。典型的泄漏路径可能是：

```
GC Root
  → Window
    → addEventListener('resize', handler)
      → handler (closure)
        → component scope variables
          → large data array ← 这就是泄漏的对象
```

### 17.5.4 React 专用的内存泄漏检测模式

除了通用的内存分析工具，还有一些 React 特定的检测技巧：

```typescript
// 开发环境的内存泄漏检测 Hook
function useMemoryLeakDetector(componentName: string) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const ref = new WeakRef({}); // 创建一个弱引用对象

    return () => {
      // 组件卸载后，检查弱引用是否被回收
      setTimeout(() => {
        if (ref.deref() !== undefined) {
          // 如果还能访问到，说明可能有泄漏
          // （注意：GC 时机不确定，这不是 100% 准确的检测）
          console.warn(
            `[Memory Leak Detector] ${componentName} 的清理可能不完整。` +
            `组件已卸载但相关对象未被回收。`
          );
        }
      }, 5000);
    };
  }, [componentName]);
}

// 使用 FinalizationRegistry 进行更精确的追踪
const registry = new FinalizationRegistry((componentName: string) => {
  console.log(`[GC] ${componentName} 的关联对象已被垃圾回收`);
});

function useTrackGC(componentName: string) {
  useEffect(() => {
    const trackingObj = { component: componentName };
    registry.register(trackingObj, componentName);

    return () => {
      // 注意：unregister 可选，这里不调用
      // 因为我们想追踪的正是卸载后是否被 GC
    };
  }, [componentName]);
}
```

> **深度洞察**：React 18+ 的 Strict Mode 在开发环境下会执行"挂载→卸载→重新挂载"的双重渲染。这个看似恼人的行为其实是一个强大的内存泄漏检测工具——如果你的 Effect 没有正确返回清理函数，双重渲染会让问题更容易暴露。当你看到一个副作用被执行了两次（比如建立了两个 WebSocket 连接），这就是 Strict Mode 在告诉你：你的清理逻辑有缺陷。**不要关闭 Strict Mode 来"修复"这个问题——它是在帮你找出将来在生产环境中可能导致内存泄漏的代码**。

## 17.6 本章小结

性能工程不是一次性的活动，而是一个持续的实践。React 19 和 React Compiler 改变了性能优化的许多规则，但核心方法论——度量、诊断、治理——永远不会过时。

关键要点：

1. **度量先行**：使用 Profiler API 和 React DevTools 建立性能基线，永远不要在没有数据支撑的情况下优化
2. **`actualDuration` vs `baseDuration`**：前者是实际渲染时间，后者是理论最大时间，两者的差值就是优化收益
3. **渲染瀑布是最常见的性能杀手**：useEffect 中的状态同步、派生状态的冗余存储、串行请求——识别并消除它们
4. **React Compiler 消除了手动记忆化的负担**：但组件拆分、Context 粒度、虚拟化仍然是开发者的责任
5. **虚拟化的盈亏平衡点在 500-1000 个节点**：低于此数量级的列表，Compiler 的自动优化通常足够
6. **Suspense 边界按用户心理模型分组**：不要太高（整页加载），也不要太低（视觉碎片化）
7. **内存泄漏的三大来源**：未清理的副作用、闭包的意外引用持有、全局缓存的无限增长

在下一章中，我们将进入更高层的架构视角——设计模式与架构决策。我们将从 React 源码中提炼出核心设计模式，分析从 Class 到 Hooks 到 Compiler 的 API 设计哲学演进，并在四大前端框架之间进行终极架构对比。

> **课程关联**：本章内容对应慕课网课程《React 源码深度解析》的性能优化实战部分。课程中演示了使用 Profiler 和 Chrome DevTools 分析真实项目性能瓶颈的完整流程，建议配合学习：[https://coding.imooc.com/class/650.html](https://coding.imooc.com/class/650.html)

---

### 思考题

1. **React Profiler 的 `baseDuration` 在并发模式下如何计算？** 当一个渲染被中断并恢复时，`baseDuration` 是否包含被丢弃的工作时间？从 `completeWork` 中 `treeBaseDuration` 的累加逻辑分析，并思考 Time Slicing 对性能度量的影响。

2. **为什么 React Compiler 不能自动将大列表虚拟化？** 从 Compiler 的静态分析能力出发，分析虚拟化所需的运行时信息（视口高度、滚动位置、DOM 测量），解释为什么这超出了编译时优化的能力范围。同时思考：未来是否可能出现一个框架级的自动虚拟化方案？

3. **构造一个 React Compiler 无法优化、但手动 `useMemo` 可以优化的场景。** 提示：考虑违反 Rules of React 的代码模式，以及 Compiler 选择"保守降级"的情况。这个场景说明了什么关于自动优化与手动优化的边界？

4. **在一个使用 `@tanstack/react-virtual` 的虚拟列表中，如果每个列表项内部都包含一个 `<Suspense>` 边界用于懒加载图片，会出现什么问题？** 分析虚拟化的 DOM 回收机制与 Suspense 的状态保持之间的冲突，并提出解决方案。

</div>
