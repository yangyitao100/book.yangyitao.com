<div v-pre>

# 第9章 并发模式深度解析

> **本章要点**
>
> - 并发渲染的本质：不是多线程，而是可中断、可恢复的渲染模型
> - Lane 模型与优先级调度：从二进制位运算到任务插队的完整机制
> - Transition 的实现原理：entangled transitions 与状态一致性
> - Suspense 的挂起与恢复：Promise 协议、Offscreen Fiber 与回退策略
> - Selective Hydration：服务端渲染场景下的并发注水策略
> - Tearing 问题：并发模式下的状态撕裂与 `useSyncExternalStore` 的解决方案
> - 并发的本质不是"做得更快"，而是"让用户感觉更快"

---

2022 年 3 月，React 18 正式发布。在所有的新特性中，有一个被反复提及却最常被误解的概念——**并发模式**（Concurrent Mode）。

许多开发者第一次听到"并发"这个词时，脑海中浮现的是操作系统课程里的多线程模型：多个线程同时执行，通过锁和信号量协调共享资源。这种直觉是危险的，因为 React 的并发与多线程完全无关。JavaScript 只有一个主线程，React 不能也不会创建新的线程。那么，React 的"并发"到底是什么？

答案是：**可中断的渲染**。在传统的同步渲染模型中，一旦 React 开始处理一次更新，它会一口气遍历整棵 Fiber 树，直到所有工作完成。在这个过程中，主线程被完全占用——用户的点击、输入、滚动都无法得到响应。并发模式改变了这个契约：React 可以开始渲染一棵树，在中途暂停，去处理更紧急的工作（比如用户输入），然后回来继续之前的渲染。更进一步地，React 甚至可以**丢弃**正在进行的渲染，转而开始一次全新的渲染。这种能力，是 `startTransition`、`Suspense`、`use` 等所有现代 React API 的底层基石。

## 9.1 什么是并发渲染

### 9.1.1 同步渲染的天花板

在 React 18 之前，所有的渲染都是同步的。让我们用一个具体的场景来理解这意味着什么：

```tsx
function SearchResults({ query }: { query: string }) {
  // 假设这个组件需要渲染 10000 个搜索结果
  const results = computeResults(query); // 耗时 200ms
  return (
    <ul>
      {results.map(item => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  );
}

function SearchPage() {
  const [query, setQuery] = useState('');
  return (
    <div>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <SearchResults query={query} />
    </div>
  );
}
```

在同步渲染模式下，每次用户按下键盘，`setQuery` 触发的更新会立即开始一次完整的渲染。`SearchResults` 需要 200ms 来计算和渲染——在这 200ms 内，输入框无法响应用户的下一次击键。用户感受到的是明显的卡顿和输入延迟。

同步渲染的核心问题在于：**它假设所有更新都具有相同的紧急程度**。但在真实的用户交互中，"输入框立即显示用户输入的字符"和"搜索结果列表更新"显然不是同等紧急的事情。

### 9.1.2 可中断渲染的工作模型

并发渲染的核心思想可以用一个类比来理解：想象你是一个厨师，正在准备一道需要 30 分钟的炖菜。在同步模式下，你必须站在锅前盯着 30 分钟，期间无法处理任何其他事情。在并发模式下，你可以先把锅放上火，然后去处理一个刚到的外卖订单（紧急任务），处理完后再回来继续看管炖菜。

在 React 的实现中，这种"中断"发生在 Fiber 节点的边界：

```typescript
// packages/react-reconciler/src/ReactFiberWorkLoop.js
function workLoopConcurrent() {
  // 并发模式的工作循环：每处理一个 Fiber 都检查是否需要让出
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}

function workLoopSync() {
  // 同步模式的工作循环：一口气做完所有工作
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}
```

区别只有一个条件——`shouldYield()`。这个来自 Scheduler 的函数检查当前时间切片（通常为 5ms）是否已经用完。如果用完了，React 会把控制权交还给浏览器，让浏览器有机会处理用户事件和渲染更新。

### 9.1.3 Lane 模型：并发的优先级引擎

并发渲染的实现依赖于一个精密的优先级系统——**Lane 模型**。每次更新都被分配一个 Lane（车道），不同的 Lane 代表不同的优先级：

```typescript
// packages/react-reconciler/src/ReactFiberLane.js
export const NoLanes: Lanes = /*                        */ 0b0000000000000000000000000000000;
export const NoLane: Lane = /*                          */ 0b0000000000000000000000000000000;

export const SyncLane: Lane = /*                        */ 0b0000000000000000000000000000010;
export const InputContinuousLane: Lane = /*             */ 0b0000000000000000000000000001000;
export const DefaultLane: Lane = /*                     */ 0b0000000000000000000000000100000;

export const TransitionLane1: Lane = /*                 */ 0b0000000000000000000001000000000;
export const TransitionLane2: Lane = /*                 */ 0b0000000000000000000010000000000;
export const TransitionLane3: Lane = /*                 */ 0b0000000000000000000100000000000;
export const TransitionLane4: Lane = /*                 */ 0b0000000000000000001000000000000;
// ... 更多 Transition Lanes

export const RetryLane1: Lane = /*                      */ 0b0000001000000000000000000000000;
export const RetryLane2: Lane = /*                      */ 0b0000010000000000000000000000000;

export const OffscreenLane: Lane = /*                   */ 0b1000000000000000000000000000000;
```

这个设计极为巧妙。使用二进制位来表示优先级有几个关键优势：

1. **集合操作极其高效**：合并两个 Lane 只需位或 `a | b`，取交集用位与 `a & b`，检查是否包含用 `a & b !== 0`
2. **同一优先级可以有多个车道**：Transition 有 16 条车道，允许多个 Transition 同时存在而互不干扰
3. **优先级比较通过位置判断**：位越低（越靠右），优先级越高

```typescript
// 判断一组 Lanes 中最高优先级的 Lane
function getHighestPriorityLane(lanes: Lanes): Lane {
  // 位运算技巧：取最低位的 1
  return lanes & -lanes;
}

// 判断是否包含某个 Lane
function includesSomeLane(a: Lanes, b: Lanes): boolean {
  return (a & b) !== NoLanes;
}

// 合并两组 Lanes
function mergeLanes(a: Lanes, b: Lanes): Lanes {
  return a | b;
}

// 从集合中移除某些 Lanes
function removeLanes(set: Lanes, subset: Lanes): Lanes {
  return set & ~subset;
}
```

当 React 开始一次渲染时，它需要决定本次渲染要处理哪些 Lane。这个决策过程称为 **`getNextLanes`**，它的逻辑遵循严格的优先级层次：

```typescript
function getNextLanes(root: FiberRoot, wipLanes: Lanes): Lanes {
  const pendingLanes = root.pendingLanes;
  if (pendingLanes === NoLanes) return NoLanes;

  // 优先级决策的核心逻辑：
  // 1. 先看非空闲的 Lanes 中，有没有未被 Suspense 挂起的
  // 2. 如果都被挂起了，看有没有被 ping（Promise resolved）的
  // 3. 最后才考虑空闲优先级的 Lanes
  // 在每一层中，都取最高优先级的 Lane（最低位的 1）

  const nonIdlePendingLanes = pendingLanes & NonIdleLanes;
  if (nonIdlePendingLanes !== NoLanes) {
    const nonIdleUnblockedLanes = nonIdlePendingLanes & ~suspendedLanes;
    if (nonIdleUnblockedLanes !== NoLanes) {
      return getHighestPriorityLanes(nonIdleUnblockedLanes);
    }
    const nonIdlePingedLanes = nonIdlePendingLanes & pingedLanes;
    if (nonIdlePingedLanes !== NoLanes) {
      return getHighestPriorityLanes(nonIdlePingedLanes);
    }
  }

  return getHighestPriorityLanes(pendingLanes & ~suspendedLanes);
}
```

> **深度洞察**：Lane 模型的设计灵感来自高速公路的车道系统。在高速公路上，不同车道有不同的速度限制——快车道（SyncLane）只允许高速通行，慢车道（TransitionLane）允许低速行驶。当快车道有车来时，慢车道上的车必须让路。React 的并发调度本质上就是这样一个车道管理系统：高优先级更新可以"超车"低优先级更新，而低优先级更新在等待太久后会被"提速"（过期机制），防止饥饿。

## 9.2 Transition 的实现机制

### 9.2.1 startTransition：标记低优先级更新

`startTransition` 是并发模式最核心的用户侧 API。它的作用看似简单——将一个状态更新标记为"非紧急"：

```tsx
function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // 紧急更新：立即更新输入框
    setQuery(e.target.value);

    // 非紧急更新：搜索结果可以延迟
    startTransition(() => {
      setResults(computeResults(e.target.value));
    });
  }

  return (
    <div>
      <input value={query} onChange={handleChange} />
      <ResultsList results={results} />
    </div>
  );
}
```

但在源码层面，`startTransition` 的实现远比你想象的复杂。它涉及 Lane 的分配、Transition 上下文的管理，以及跨更新的状态一致性保证：

```typescript
// packages/react/src/ReactStartTransition.js
function startTransition(
  scope: () => void,
  options?: StartTransitionOptions
): void {
  const prevTransition = ReactSharedInternals.T;

  // 创建一个新的 Transition 对象
  const transition: BatchConfigTransition = {};
  ReactSharedInternals.T = transition;

  const currentTransition = ReactSharedInternals.T;

  if (__DEV__) {
    ReactSharedInternals.T._updatedFibers = new Set();
  }

  try {
    // 在 Transition 上下文中执行回调
    // 回调中的所有 setState 都会被分配 TransitionLane
    const returnValue = scope();

    // React 19: 支持异步 Transition
    if (
      typeof returnValue === 'object' &&
      returnValue !== null &&
      typeof returnValue.then === 'function'
    ) {
      // 异步 Transition：追踪 Promise 的完成
      entangleAsyncAction(transition, returnValue);
    }
  } finally {
    // 恢复之前的 Transition 上下文
    ReactSharedInternals.T = prevTransition;
  }
}
```

关键点在于 `ReactSharedInternals.T`。当这个值不为 `null` 时，所有通过 `dispatchSetState` 触发的更新都会被分配 TransitionLane，而不是默认的 SyncLane 或 DefaultLane：

```typescript
// packages/react-reconciler/src/ReactFiberHooks.js
function dispatchSetState<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A
): void {
  const lane = requestUpdateLane(fiber);
  // ...
}

function requestUpdateLane(fiber: Fiber): Lane {
  // 检查是否在 Transition 上下文中
  const isTransition = ReactSharedInternals.T !== null;
  if (isTransition) {
    // 分配一个 Transition Lane
    const actionScopeLane = peekEntangledActionLane();
    return actionScopeLane !== NoLane
      ? actionScopeLane
      : requestTransitionLane();
  }

  // 非 Transition 的更新根据触发事件的类型确定优先级
  const updateLane: Lane = getCurrentUpdatePriority();
  if (updateLane !== NoLane) {
    return updateLane;
  }

  // 从事件系统获取优先级
  const eventLane: Lane = getCurrentEventPriority();
  return eventLane;
}
```

### 9.2.2 Entangled Transitions：交织的一致性

React 19 引入了一个关键概念——**entangled transitions**（交织的过渡）。当多个 Transition 更新共享相关状态时，React 必须确保它们作为一个整体被提交，而不是部分提交导致 UI 处于不一致的中间状态。

```typescript
// packages/react-reconciler/src/ReactFiberLane.js
export function entangleTransitions(
  root: FiberRoot,
  fiber: Fiber,
  lane: Lane
): void {
  const updateQueue = fiber.updateQueue;
  if (updateQueue === null) {
    return;
  }

  const sharedQueue = updateQueue.shared;
  if (isTransitionLane(lane)) {
    let queueLanes = sharedQueue.lanes;

    // 将当前 Lane 与队列中已有的 Lanes 纠缠在一起
    queueLanes = intersectLanes(queueLanes, root.pendingLanes);

    const newQueueLanes = mergeLanes(queueLanes, lane);
    sharedQueue.lanes = newQueueLanes;

    // 在 root 上标记这些 Lanes 是纠缠的
    markRootEntangled(root, newQueueLanes);
  }
}

export function markRootEntangled(root: FiberRoot, entangledLanes: Lanes): void {
  // 在 root.entanglements 数组中，确保所有纠缠的 Lanes 互相引用
  // 遍历每个 Lane，如果它属于纠缠集合，就将整个纠缠集合加入它的关联列表
  root.entangledLanes |= entangledLanes;
  const entanglements = root.entanglements;
  let lanes = root.entangledLanes;
  while (lanes) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    if ((lane & entangledLanes) | (entanglements[index] & entangledLanes)) {
      entanglements[index] |= entangledLanes;
    }
    lanes &= ~lane;
  }
}
```

这段代码的效果是：如果 TransitionLane1 和 TransitionLane2 都修改了同一个组件的更新队列，它们就会被"纠缠"在一起。当 React 决定渲染 TransitionLane1 时，它必须同时处理 TransitionLane2，确保这两个更新要么都被提交，要么都不被提交。

> **深度洞察**：Entangled transitions 的命名灵感来自量子力学中的量子纠缠。两个纠缠的粒子，无论相距多远，测量其中一个会立即影响另一个的状态。React 中的 entangled lanes 有着类似的语义：当两个 Lane 被纠缠后，它们就成为了不可分割的整体——你不能只处理其中一个而忽略另一个，因为这会导致 UI 状态的不一致。

### 9.2.3 Transition 的中断与重启

当一个 Transition 正在渲染的过程中，如果一个更高优先级的更新到来（比如用户点击了一个按钮），React 会中断当前的 Transition 渲染，优先处理紧急更新：

```typescript
// packages/react-reconciler/src/ReactFiberWorkLoop.js
function ensureRootIsScheduled(root: FiberRoot): void {
  const nextLanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes
  );

  const newCallbackPriority = getHighestPriorityLane(nextLanes);

  // 如果已有调度且优先级相同，复用
  if (root.callbackPriority === newCallbackPriority) return;

  // 有更高优先级的工作：取消当前调度
  if (root.callbackNode != null) {
    cancelCallback(root.callbackNode);
  }

  if (includesSyncLane(newCallbackPriority)) {
    // 同步优先级：加入同步队列，通过微任务执行
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));
    scheduleMicrotask(flushSyncCallbacks);
    root.callbackNode = null;
  } else {
    // 异步优先级：将 Lane 优先级映射到 Scheduler 优先级
    // DiscreteEvent → Immediate, ContinuousEvent → UserBlocking,
    // Default → Normal, Idle → Idle
    const schedulerPriority = lanesToSchedulerPriority(nextLanes);
    root.callbackNode = scheduleCallback(
      schedulerPriority,
      performConcurrentWorkOnRoot.bind(null, root)
    );
  }
  root.callbackPriority = newCallbackPriority;
}
```

当高优先级更新处理完毕后，React 会重新评估还有哪些 pending lanes 需要处理。被中断的 Transition 不会从中断的地方继续——它会**从头开始重新渲染**。这看似浪费，但实际上是正确的做法：因为高优先级更新可能已经改变了某些状态，从中断点继续可能产生不一致的结果。

```typescript
function performConcurrentWorkOnRoot(root: FiberRoot, didTimeout: boolean) {
  // 每次进入都重新计算要处理的 Lanes（可能已被高优先级更新改变）
  const lanes = getNextLanes(root, root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes);
  if (lanes === NoLanes) return null;

  // 三种情况下不允许时间切片，必须同步完成：
  // 1. 包含阻塞 Lane（SyncLane, InputContinuousLane）
  // 2. 包含过期 Lane（等太久了）
  // 3. Scheduler 超时（didTimeout）
  const shouldTimeSlice =
    !includesBlockingLane(root, lanes) && !includesExpiredLane(root, lanes) && !didTimeout;

  const exitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes);

  if (exitStatus === RootCompleted) {
    root.finishedWork = root.current.alternate;
    root.finishedLanes = lanes;
    finishConcurrentRender(root, exitStatus, root.finishedWork, lanes);
  }

  ensureRootIsScheduled(root);
}
```

## 9.3 Suspense 的挂起与恢复

### 9.3.1 Suspense 的核心协议：throw Promise

Suspense 是 React 并发模式中最具创新性的特性之一。它的实现基于一个看起来有些"反常规"的机制：**组件通过抛出一个 Promise 来告诉 React 自己还没准备好**。

```typescript
// Suspense 的基本模式
function DataComponent() {
  // 如果数据还没准备好，use 会抛出一个 Promise
  const data = use(dataPromise);
  return <div>{data.name}</div>;
}

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <DataComponent />
    </Suspense>
  );
}
```

当一个组件抛出 Promise 时，React 需要：

1. 找到最近的 Suspense 边界
2. 显示 fallback UI
3. 监听 Promise 的完成
4. Promise resolve 后，重新渲染被挂起的子树

让我们深入源码来理解这个过程：

```typescript
// packages/react-reconciler/src/ReactFiberWorkLoop.js
function handleThrow(root: FiberRoot, thrownValue: mixed): void {
  // 重置当前渲染状态
  resetHooksAfterThrow();

  if (thrownValue === SuspenseException) {
    // Suspense 场景：组件抛出了一个 thenable
    thrownValue = getSuspendedThenable();
    workInProgressSuspendedReason =
      shouldRemainOnPreviousScreen() &&
      !includesNonIdleWork(workInProgressRootSkippedLanes) &&
      !includesNonIdleWork(workInProgressRootInterleavedUpdatedLanes)
        ? SuspendedOnData
        : SuspendedOnImmediate;
  } else {
    // 普通错误
    const isWakeable =
      thrownValue !== null &&
      typeof thrownValue === 'object' &&
      typeof thrownValue.then === 'function';

    workInProgressSuspendedReason = isWakeable
      ? SuspendedOnDeprecatedThrowPromise
      : SuspendedOnError;
  }

  workInProgressThrownValue = thrownValue;
}
```

### 9.3.2 Suspense Fiber 的双面结构

Suspense 组件在 Fiber 树中有一个特殊的结构。它有两个可能的子树：**主内容**（primary children）和**回退内容**（fallback children）。React 使用一个名为 `OffscreenComponent` 的特殊 Fiber 类型来管理这个切换：

```typescript
// packages/react-reconciler/src/ReactFiberBeginWork.js
function updateSuspenseComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes
): Fiber | null {
  const nextProps = workInProgress.pendingProps;

  let showFallback = false;
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;

  if (didSuspend) {
    showFallback = true;
    // 清除 DidCapture 标记
    workInProgress.flags &= ~DidCapture;
  }

  const nextPrimaryChildren = nextProps.children;
  const nextFallbackChildren = nextProps.fallback;

  if (current === null) {
    // 首次挂载
    if (showFallback) {
      // 挂起状态：渲染 fallback
      return mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes
      );
    } else {
      // 正常状态：渲染主内容
      return mountSuspensePrimaryChildren(
        workInProgress,
        nextPrimaryChildren,
        renderLanes
      );
    }
  } else {
    // 更新
    if (showFallback) {
      return updateSuspenseFallbackChildren(
        current,
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes
      );
    } else {
      return updateSuspensePrimaryChildren(
        current,
        workInProgress,
        nextPrimaryChildren,
        renderLanes
      );
    }
  }
}
```

当显示 fallback 时，主内容不会被完全卸载——它被包裹在一个 `mode: 'hidden'` 的 Offscreen Fiber 中：

```typescript
function mountSuspenseFallbackChildren(
  workInProgress: Fiber,
  primaryChildren: ReactNodeList,
  fallbackChildren: ReactNodeList,
  renderLanes: Lanes
): Fiber {
  const mode = workInProgress.mode;

  // 主内容包裹在 Offscreen 组件中，标记为隐藏
  const primaryChildFragment = mountWorkInProgressOffscreenFiber(
    { mode: 'hidden', children: primaryChildren },
    mode,
    NoLanes, // 不在当前渲染中处理主内容
  );

  // Fallback 正常渲染
  const fallbackChildFragment = createFiberFromFragment(
    fallbackChildren,
    mode,
    renderLanes,
    null
  );

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  return fallbackChildFragment;
}
```

这个设计使得当 Promise resolve 后，React 可以快速切换回主内容，因为主内容的 Fiber 结构一直保留在内存中。

### 9.3.3 Promise 解析后的恢复流程

当被挂起的 Promise resolve 后，React 需要触发一次重新渲染。这个过程通过 **ping** 机制实现。在第 8 章中我们已经看到 `trackUsedThenable` 如何追踪 Promise 状态并在 pending 时抛出 `SuspenseException`。挂起后，React 在 `throwException` 中找到最近的 Suspense 边界，并通过 `attachPingListener` 注册回调：

```typescript
// packages/react-reconciler/src/ReactFiberThrow.js
function throwException(
  root: FiberRoot,
  returnFiber: Fiber,
  sourceFiber: Fiber,
  value: mixed,
  rootRenderLanes: Lanes
): void {
  sourceFiber.flags |= Incomplete;

  if (
    value !== null &&
    typeof value === 'object' &&
    typeof value.then === 'function'
  ) {
    const wakeable: Wakeable = (value: any);
    const suspenseBoundary = getSuspenseHandler();
    if (suspenseBoundary !== null) {
      suspenseBoundary.flags &= ~ForceClientRender;
      markSuspenseBoundaryShouldCapture(
        suspenseBoundary, returnFiber, sourceFiber, root, rootRenderLanes
      );
      // 注册 ping 监听器
      attachPingListener(root, wakeable, rootRenderLanes);
    }
  }
}

function attachPingListener(
  root: FiberRoot,
  wakeable: Wakeable,
  lanes: Lanes
): void {
  let pingCache = root.pingCache;

  let threadIDs;
  if (pingCache === null) {
    pingCache = root.pingCache = new WeakMap();
    threadIDs = new Set<mixed>();
    pingCache.set(wakeable, threadIDs);
  } else {
    threadIDs = pingCache.get(wakeable);
    if (threadIDs === undefined) {
      threadIDs = new Set();
      pingCache.set(wakeable, threadIDs);
    }
  }

  if (!threadIDs.has(lanes)) {
    threadIDs.add(lanes);

    // 当 Promise resolve 时，ping root 触发重新渲染
    const ping = pingSuspendedRoot.bind(null, root, wakeable, lanes);
    wakeable.then(ping, ping);
  }
}

function pingSuspendedRoot(
  root: FiberRoot,
  wakeable: Wakeable,
  pingedLanes: Lanes
): void {
  const pingCache = root.pingCache;
  if (pingCache !== null) {
    // 清除缓存，因为 Promise 已经 resolve
    pingCache.delete(wakeable);
  }

  // 标记这些 Lanes 已被 ping
  markRootPinged(root, pingedLanes);

  // 触发重新调度
  ensureRootIsScheduled(root);
}
```

整个流程形成了一个闭环：组件抛出 Promise → React 显示 fallback 并监听 Promise → Promise resolve → ping root → 重新渲染 → 组件正常返回数据 → 显示主内容。

### 9.3.4 Suspense 在 Transition 中的特殊行为

Suspense 在 Transition 上下文中有一个至关重要的行为差异：**它不会立即显示 fallback**。

```tsx
function App() {
  const [tab, setTab] = useState('home');

  function switchTab(nextTab: string) {
    startTransition(() => {
      setTab(nextTab);
    });
  }

  return (
    <div>
      <nav>
        <button onClick={() => switchTab('home')}>Home</button>
        <button onClick={() => switchTab('posts')}>Posts</button>
      </nav>
      <Suspense fallback={<Spinner />}>
        {tab === 'home' ? <Home /> : <Posts />}
      </Suspense>
    </div>
  );
}
```

当用户点击 "Posts" 时，如果 `Posts` 组件触发了 Suspense（例如通过 `use` 加载数据），在 Transition 中 React 不会立即切换到 `<Spinner />`，而是**继续显示当前的 `<Home />` 组件**，直到新内容准备好。

这个行为的实现在 `shouldRemainOnPreviousScreen` 中：

```typescript
function shouldRemainOnPreviousScreen(): boolean {
  const handler = getSuspenseHandler();
  if (handler === null) {
    return false;
  }

  // 如果 Suspense 边界已经在显示内容（不是 fallback），
  // 并且当前渲染是一个 Transition，则保留当前画面
  if (includesOnlyTransitions(workInProgressRootRenderLanes)) {
    if (getShellBoundary() === null) {
      // 不是 shell 渲染，可以保留之前的画面
      return true;
    }
  }

  return false;
}
```

> **深度洞察**：这个设计体现了 React 并发模式的核心哲学——**在后台准备新 UI，在前台保持旧 UI 的响应性**。这类似于现代操作系统中的双缓冲渲染：图形系统在后台缓冲区绘制下一帧画面，只有当新画面完全准备好后，才通过一次原子性的交换操作将其显示给用户。用户永远看不到绘制了一半的画面。React 的 Suspense + Transition 实现了同样的效果：用户永远看不到"加载了一半"的 UI。

## 9.4 Selective Hydration：服务端渲染的并发策略

### 9.4.1 传统 Hydration 的瓶颈

服务端渲染（SSR）中的 Hydration 是一个将服务端生成的静态 HTML "激活"为可交互 React 应用的过程。在传统的同步 Hydration 中，整棵组件树必须一次性完成注水：

```tsx
// 传统 SSR 的问题
// 服务端返回的 HTML 已经包含了完整的页面结构
// 但在 hydrate 完成之前，所有组件都是"死的"——点击按钮没有反应

// 如果页面有一个很大的评论区组件，hydration 会被它阻塞
function Page() {
  return (
    <Layout>
      <NavBar />          {/* 简单组件，快速 hydrate */}
      <Hero />            {/* 简单组件，快速 hydrate */}
      <Comments />        {/* 复杂组件，hydrate 耗时 500ms */}
      <Footer />          {/* 简单组件，但必须等 Comments 完成 */}
    </Layout>
  );
}
```

在同步 Hydration 中，即使 `NavBar` 和 `Hero` 只需要 10ms 就能 hydrate，用户也必须等到 `Comments` 的 500ms 完成后，才能与页面上的任何部分交互。

### 9.4.2 Selective Hydration 的工作原理

React 18 引入的 Selective Hydration 解决了这个问题。通过将 `Suspense` 边界与 Hydration 结合，React 可以**分段注水**：

```tsx
function Page() {
  return (
    <Layout>
      <NavBar />
      <Hero />
      <Suspense fallback={<CommentsSkeleton />}>
        <Comments />
      </Suspense>
      <Footer />
    </Layout>
  );
}
```

当 `Comments` 被 `Suspense` 包裹时，React 不需要等待它的 JavaScript 代码加载完成就可以开始 Hydration。其余的页面会先被 hydrate，`Comments` 区域会在其代码准备好后单独 hydrate。

在 Fiber 架构中，Selective Hydration 通过特殊的 `DehydratedFragment` 来实现：

```typescript
// packages/react-reconciler/src/ReactFiberHydrationContext.js
function tryHydrateSuspense(fiber: Fiber, nextInstance: any): boolean {
  const suspenseInstance = canHydrateSuspenseInstance(nextInstance);
  if (suspenseInstance !== null) {
    // 在 Fiber 上存储 dehydrated 状态
    // retryLane 设为 OffscreenLane：这是最低优先级，
    // 意味着其他更紧急的 hydration 可以插队
    fiber.memoizedState = {
      dehydrated: suspenseInstance,
      treeContext: getSuspenseTreeContext(),
      retryLane: OffscreenLane,
    };

    // 创建一个 dehydrated fragment 作为占位 fiber
    const dehydratedFragment = createFiberFromDehydratedFragment(suspenseInstance);
    dehydratedFragment.return = fiber;
    fiber.child = dehydratedFragment;
    return true;
  }
  return false;
}
```

### 9.4.3 用户交互驱动的优先级提升

Selective Hydration 最令人印象深刻的特性是：**用户的交互可以提升 Hydration 的优先级**。如果用户点击了一个尚未 hydrate 的 Suspense 边界，React 会立即提升该区域的 Hydration 优先级：

```typescript
// packages/react-dom-bindings/src/events/ReactDOMEventListener.js
function attemptSynchronousHydration(fiber: Fiber): void {
  switch (fiber.tag) {
    case HostRoot: {
      const root: FiberRoot = fiber.stateNode;
      if (isRootDehydrated(root)) {
        const lanes = getHighestPriorityPendingLanes(root);
        flushRoot(root, lanes);
      }
      break;
    }
    case SuspenseComponent: {
      // 将 Suspense 边界的 hydration 提升到 SyncLane
      const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
      if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, SyncLane);
      }
      flushSyncWork(); // 立即执行，不等下一个时间切片
      break;
    }
  }
}
```

这个设计意味着在一个包含多个 Suspense 边界的页面中，用户交互会自然地引导 React 优先 hydrate 用户正在交互的区域。如果用户先点击了导航栏，导航栏就先被 hydrate；如果用户先滚动到评论区并尝试点击，评论区就先被 hydrate。

更关键的是，React 还实现了**事件重放**。在 hydration 完成前，用户的点击事件会被放入队列 `queuedReplayableEvents`。当 hydration 完成后，这些事件会被重放，用户不需要再点一次：

```typescript
// packages/react-dom-bindings/src/events/ReactDOMEventReplaying.js
function queueDiscreteEvent(blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent) {
  const queuedEvent = { blockedOn, domEventName, nativeEvent, targetContainers: [targetContainer] };
  queuedReplayableEvents.push(queuedEvent);

  if (blockedOn !== null) {
    // 告诉 React 优先 hydrate 这个区域
    attemptSynchronousHydration(blockedOn);
  }
}
```

## 9.5 并发模式下的状态一致性保证

### 9.5.1 Tearing：状态撕裂问题

并发渲染引入了一个在同步渲染中不存在的问题——**tearing**（状态撕裂）。当一个渲染被中断时，外部状态可能在中断期间发生变化，导致同一次渲染中不同组件看到不同版本的状态：

```tsx
// 一个外部 store
let externalCounter = 0;

function ComponentA() {
  // 读取外部状态
  const value = externalCounter; // 假设此时是 0
  return <div>A: {value}</div>;
}

function ComponentB() {
  // 在 A 渲染后、B 渲染前，如果渲染被中断
  // 外部代码将 externalCounter 改为了 1
  const value = externalCounter; // 现在是 1
  return <div>B: {value}</div>;
}

// 结果：A 显示 0，B 显示 1——这就是 tearing
// 用户看到的是一个不一致的 UI
```

Tearing 只在并发渲染中出现，因为同步渲染不会被中断，所有组件在同一个微任务中读取外部状态，看到的一定是同一个值。

### 9.5.2 useSyncExternalStore：解决方案

React 18 引入了 `useSyncExternalStore` 来解决 tearing 问题。它的核心策略是：**在并发渲染中检测外部状态是否发生了变化，如果发生了变化，强制降级为同步渲染**。

```typescript
// packages/react-reconciler/src/ReactFiberHooks.js
function mountSyncExternalStore<T>(
  subscribe: (() => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T
): T {
  const fiber = currentlyRenderingFiber;
  const hook = mountWorkInProgressHook();
  const nextSnapshot = getSnapshot();

  if (!includesBlockingLane(getWorkInProgressRoot(), renderLanes)) {
    // 并发渲染中：注册一致性检查
    // 在渲染完成后，React 会重新调用 getSnapshot()
    // 如果值发生了变化，说明渲染过程中外部状态被修改了
    pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
  }

  hook.memoizedState = nextSnapshot;

  // 订阅外部 store：当 store 变化时触发重新渲染
  mountEffect(subscribeToStore.bind(null, fiber, hook.queue, subscribe), [subscribe]);

  return nextSnapshot;
}
```

一致性检查发生在渲染完成、提交之前。React 在每个使用了 `useSyncExternalStore` 的 Fiber 上标记 `StoreConsistency` flag，并记录渲染时的快照值。当并发渲染完成后，React 会重新调用 `getSnapshot()` 并与渲染时记录的值比较：

```typescript
// 渲染完成后的一致性检查
function renderRootConcurrent(root: FiberRoot, lanes: Lanes): RootExitStatus {
  // ... 渲染完成后 ...

  if (workInProgressRootExitStatus === RootCompleted) {
    // 遍历所有标记了 StoreConsistency 的 Fiber
    // 重新调用 getSnapshot() 并与渲染时的值比较
    const storeConsistencyErrors = checkStoreConsistency();
    if (storeConsistencyErrors) {
      // 检测到不一致：丢弃并发渲染结果
      // 切换为同步渲染，从头开始
      exitStatus = renderRootSync(root, lanes);
    }
  }

  return exitStatus;
}
```

### 9.5.3 React 内部状态的一致性保证

对于 React 自身管理的状态（`useState`、`useReducer`），tearing 问题并不存在。这是因为 React 的状态更新被存储在 Fiber 的更新队列中，而不是外部变量中。渲染过程中，状态的计算是基于更新队列的，而更新队列在渲染开始时就被"快照"了：

```typescript
function processUpdateQueue<State>(
  workInProgress: Fiber,
  props: any,
  instance: any,
  renderLanes: Lanes
): void {
  const queue: UpdateQueue<State> = (workInProgress.updateQueue: any);

  // 将 shared.pending 中的更新转移到 baseUpdate 链表
  let pendingQueue = queue.shared.pending;
  if (pendingQueue !== null) {
    queue.shared.pending = null;
    // 拼接到 baseUpdate 链表末尾...
  }

  let newState = queue.baseState;
  let update = queue.firstBaseUpdate;

  do {
    const updateLane = update.lane;

    if (!isSubsetOfLanes(renderLanes, updateLane)) {
      // 优先级不够，跳过这个更新
      // 但保留到 baseUpdate 链表中，下次渲染时处理
      // 关键：记录此刻的 state 作为 newBaseState
      // ...
    } else {
      // 这个更新需要处理
      if (newLastBaseUpdate !== null) {
        // 如果之前有被跳过的更新，后续所有更新都必须保留
        // 标记 lane 为 NoLane，确保下次一定被处理
        const clone = { ...update, lane: NoLane, next: null };
        newLastBaseUpdate = newLastBaseUpdate.next = clone;
      }

      newState = getStateFromUpdate(workInProgress, queue, update, newState, props, instance);
    }

    update = update.next;
  } while (update !== null);

  workInProgress.memoizedState = newState;
}
```

> **深度洞察**：`processUpdateQueue` 中有一个非常微妙的设计——当一个低优先级更新被跳过时，它之后的所有更新（即使是高优先级的）都会被保留到 baseUpdate 链表中，以便下次低优先级渲染时重新计算。这确保了状态的最终一致性。想象一个场景：状态 0 → +1（低优先级）→ ×2（高优先级）。如果高优先级渲染只处理 ×2，结果是 0。但正确的最终结果应该是 (0+1)×2 = 2。通过保留跳过更新之后的所有更新，React 确保在低优先级渲染中能够重新计算出正确的结果。

### 9.5.4 并发渲染中的副作用安全

并发渲染还带来了一个重要的约束：**渲染阶段不能有副作用**。因为渲染可能被中断、可能被丢弃、可能被执行多次，如果渲染阶段包含副作用（如 DOM 操作、网络请求），就会导致不可预测的行为：

```tsx
// ❌ 危险：渲染阶段的副作用——可能在并发渲染中被执行多次
function BadComponent() {
  fetch('/api/track-view');       // 网络请求可能发送多次
  document.title = 'New Title';  // 渲染被丢弃后留下错误状态
  return <div>Content</div>;
}

// ✅ 安全：副作用放在 effect 中——只在 commit 后执行一次
function GoodComponent() {
  useEffect(() => {
    fetch('/api/track-view');
    document.title = 'New Title';
  }, []);
  return <div>Content</div>;
}
```

React 的 StrictMode 通过在开发模式下**双重调用渲染函数**来帮助检测这类问题。在 `renderWithHooks` 中，当 `shouldDoubleRenderDEV` 为 `true` 时，组件函数会被调用两次——如果渲染函数包含副作用，两次调用会暴露问题（如网络请求被发送两次）。

## 9.6 并发特性的协同运作

### 9.6.1 一个完整的并发渲染场景

让我们通过一个完整的例子来理解所有并发特性如何协同工作：

```tsx
function App() {
  const [tab, setTab] = useState('home');
  const [isPending, startTransition] = useTransition();

  function switchTab(nextTab: string) {
    startTransition(() => {
      setTab(nextTab);
    });
  }

  return (
    <div>
      <TabBar
        currentTab={tab}
        isPending={isPending}
        onSwitch={switchTab}
      />
      <Suspense fallback={<PageSkeleton />}>
        <TabContent tab={tab} />
      </Suspense>
    </div>
  );
}

function TabContent({ tab }: { tab: string }) {
  const data = use(fetchTabData(tab)); // 可能触发 Suspense
  return <div>{data.content}</div>;
}
```

当用户从 "home" 切换到 "posts" 时，发生的完整序列是：

1. **事件触发**：`switchTab('posts')` 被调用
2. **Transition 上下文建立**：`startTransition` 设置 `ReactSharedInternals.T`
3. **低优先级更新入队**：`setTab('posts')` 被分配 TransitionLane
4. **调度开始**：`ensureRootIsScheduled` 安排一个并发任务
5. **并发渲染开始**：`renderRootConcurrent` 启动，使用 `workLoopConcurrent`
6. **Suspense 触发**：`TabContent` 中的 `use(fetchTabData('posts'))` 抛出 Promise
7. **保留旧画面**：因为在 Transition 中，React 决定保留 "home" 的 UI
8. **Promise 注册**：`attachPingListener` 监听 Promise 的 resolve
9. **`isPending` 变为 true**：`useTransition` 的 pending 标记允许显示加载指示器
10. **数据返回**：Promise resolve，`pingSuspendedRoot` 触发重新渲染
11. **最终渲染**：React 完成渲染，切换到 "posts" 的 UI
12. **`isPending` 变为 false**：加载指示器消失

### 9.6.2 时间切片的实际效果

让我们量化并发渲染带来的用户体验改善。假设一个列表组件渲染 1000 个子项需要 100ms：

```
同步渲染：
[===== 100ms 渲染 =====][浏览器绘制]
                          ↑ 用户点击在这里才能被响应

并发渲染（5ms 时间切片）：
[5ms][绘][5ms][绘][5ms][绘]...[5ms][绘]
     ↑       ↑       ↑
     每个间隙都能响应用户交互
```

虽然并发渲染的**总耗时**可能更长（因为有切换开销），但用户感知到的**响应延迟**从 100ms 降低到了最多 5ms。这就是并发模式的核心价值：**牺牲吞吐量，换取响应性**。

### 9.6.3 过期机制：防止饥饿

如果高优先级更新持续不断地到来，低优先级的 Transition 是否会被永远推迟？React 通过**过期机制**解决了这个问题：

```typescript
// packages/react-reconciler/src/ReactFiberLane.js
function markStarvedLanesAsExpired(root: FiberRoot, currentTime: number): void {
  const expirationTimes = root.expirationTimes;
  let lanes = root.pendingLanes & ~RetryLanes;

  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    if (expirationTimes[index] === NoTimestamp) {
      // 首次遇到：根据优先级设置过期时间
      // SyncLane/InputContinuousLane → 250ms
      // DefaultLane/TransitionLanes → 5000ms
      // RetryLanes → 永不过期
      expirationTimes[index] = computeExpirationTime(lane, currentTime);
    } else if (expirationTimes[index] <= currentTime) {
      // 已过期：标记为过期，下次渲染时必须同步处理
      root.expiredLanes |= lane;
    }

    lanes &= ~lane;
  }
}
```

一旦一个 Lane 过期，它会被加入 `root.expiredLanes`。在 `getNextLanes` 中，过期的 Lane 会被优先处理，而且会被标记为需要**同步渲染**（不能被再次中断）：

```typescript
function performConcurrentWorkOnRoot(root: FiberRoot, didTimeout: boolean) {
  const lanes = getNextLanes(root, NoLanes);

  const shouldTimeSlice =
    !includesBlockingLane(root, lanes) &&
    !includesExpiredLane(root, lanes) && // 过期的 Lane 不允许时间切片
    !didTimeout;

  // 过期的 Lane 会走同步渲染路径，确保尽快完成
  const exitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes);
}
```

## 9.7 本章小结

并发模式是 React 架构中最深层的创新。它不是一个单一的特性，而是一个贯穿整个渲染引擎的**设计范式**，使得 Transition、Suspense、Selective Hydration 等上层特性成为可能。

关键要点：

1. **并发 ≠ 多线程**：React 的并发是在单线程上通过可中断渲染实现的，核心是 `workLoopConcurrent` 中的 `shouldYield` 检查
2. **Lane 模型是优先级引擎**：31 位二进制数表示不同优先级，位运算使得集合操作极其高效
3. **Transition 将更新标记为可中断**：在 `startTransition` 上下文中的 `setState` 会被分配低优先级的 TransitionLane
4. **Entangled transitions 保证一致性**：共享更新队列的多个 Transition Lane 会被纠缠在一起，作为整体提交
5. **Suspense 通过 throw Promise 实现挂起**：在 Transition 中，Suspense 保留旧画面而不是显示 fallback
6. **Selective Hydration 分段激活页面**：用户交互可以动态提升 hydration 优先级
7. **useSyncExternalStore 解决 tearing**：在检测到外部状态不一致时，强制回退为同步渲染
8. **过期机制防止饥饿**：长时间未被处理的低优先级 Lane 会被升级，确保最终得到执行

在下一章中，我们将从 React 的内部架构转向实际应用——如何运用对源码的理解来诊断性能问题、优化渲染策略，以及在日常开发中做出更明智的架构决策。

> **课程关联**：本章内容对应慕课网课程《React 源码深度解析》的高级部分。课程中详细演示了并发渲染的调度过程和优先级中断机制，建议配合学习：[https://coding.imooc.com/class/650.html](https://coding.imooc.com/class/650.html)

---

### 思考题

1. **为什么 React 选择在渲染被中断后从头开始重新渲染，而不是从中断点继续？** 构造一个具体场景，说明如果从中断点继续会导致什么样的状态不一致问题。

2. **Transition Lane 有 16 条，为什么需要这么多？** 考虑一个页面中有多个独立的 `startTransition` 同时进行的场景。如果所有 Transition 共享同一条 Lane，在取消和重新渲染时会出现什么问题？

3. **`useSyncExternalStore` 检测到 tearing 后会强制同步渲染。这意味着如果一个页面中大量组件都使用了外部 store，并发渲染的优势可能被完全抵消。** 分析 Redux 和 Zustand 等状态管理库是如何在保持并发兼容性的同时最小化同步渲染回退的。

4. **Selective Hydration 中，如果用户在 hydration 完成前快速连续点击了三个不同的 Suspense 边界区域，React 会如何决定 hydration 的顺序？** 从 `queueDiscreteEvent` 和 `attemptSynchronousHydration` 的源码出发，追踪事件排队和优先级提升的完整流程。

</div>