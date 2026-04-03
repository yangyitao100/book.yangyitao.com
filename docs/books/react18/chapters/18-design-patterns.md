<div v-pre>

# 第18章 设计模式与架构决策

> **本章要点**
>
> - React 源码中 10 个核心设计模式的识别与深度剖析：从 Observer 到 Visitor 的工程实践
> - 从 Class 到 Hooks 到 Compiler：三次 API 范式跃迁背后的设计哲学演变
> - Algebraic Effects 与 Prepack：React 团队探索过又放弃的技术方案考古
> - React vs Vue vs Svelte vs Solid：四大框架从响应式模型到编译策略的终极架构对比
> - React 的技术决策方法论：为什么"选择不做什么"比"选择做什么"更重要
> - React 下一个十年的技术趋势：从运行时框架到全栈编译器平台

---

写完前面十七章，我们已经从 JSX 编译、Fiber 架构、调度器、Reconciliation、Commit 阶段、Hooks 实现、并发模式、Server Components、React Compiler 等各个维度，完成了对 React 19 内核的全面解剖。如果把前面的章节比作"显微镜"——逐行逐函数地观察 React 机体的每一个细胞，那么本章我们需要换一种工具：**望远镜**。

站在足够远的距离回望 React 的源码，你会发现一个令人惊叹的事实：在那些看似复杂的实现细节之下，存在着一组反复出现的设计模式。它们不是教科书上的学术练习，而是 React 团队在十余年工程实践中，面对真实约束做出的真实选择。同时，React 的发展史本身就是一部"技术决策史"——每一次重大版本更新，都意味着一次架构哲学的重新审视。理解这些决策的"为什么"，远比记住它们的"是什么"更有价值。

本章是全书的收官之章。我们将从设计模式、API 设计哲学、技术考古、框架对比、未来展望五个维度，为你构建一幅 React 架构决策的全景图。这不仅是对前面所有章节的一次高维度总结，更是帮助你建立**框架设计者的思维方式**——当你下次面对"为什么 React 要这样做"的问题时，你能从第一性原理给出答案。

## 18.1 React 源码中的 10 个核心设计模式

React 的源码从来不是为了展示设计模式而写的——它是为了解决问题。但当你用设计模式的"棱镜"去观察这些解决方案时，会发现 Gang of Four 书中的经典模式几乎无处不在。以下是 React 源码中最核心的 10 个设计模式，按照它们在渲染流程中出现的顺序排列。

### 18.1.1 Observer 模式：状态变更的订阅与通知

Observer（观察者）模式是 React 响应式系统的基石。当你调用 `setState` 时，React 需要知道哪些组件依赖了这个状态，然后通知它们重新渲染。这本质上就是一个发布-订阅关系。

```typescript
// React 中 Observer 模式的核心体现：useState 的更新链路
// 文件：packages/react-reconciler/src/ReactFiberHooks.js

function dispatchSetState<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A
): void {
  // 1. 创建 update 对象（"事件"）
  const update: Update<S, A> = {
    lane,
    revertLane: NoLane,
    action,      // 用户传入的新值或 updater 函数
    hasEagerState: false,
    eagerState: null,
    next: null as any,
  };

  // 2. 将 update 入队（"通知"排队）
  const alternate = fiber.alternate;
  if (fiber === currentlyRenderingFiber ||
      (alternate !== null && alternate === currentlyRenderingFiber)) {
    // 渲染阶段的更新，特殊处理
    didScheduleRenderPhaseUpdateDuringThisPass = true;
    // ...
  } else {
    // 3. 调度更新（"通知"观察者）
    const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, lane);  // 触发重新渲染
    }
  }
}
```

这段代码是经典 Observer 模式的 React 变体。`useState` 返回的 `setState` 函数就是"发布"操作，而 `scheduleUpdateOnFiber` 则是通知调度器"有东西变了，需要重新渲染"。但与传统 Observer 不同的是，React 不直接通知每个组件，而是通知**调度器**——由调度器决定何时、以何种优先级去"通知"（重新渲染）组件。这是一种**间接观察者模式**，调度器充当了中介。

> **深度洞察**：Vue 使用的是直接 Observer 模式——每个响应式属性都维护自己的依赖列表，变更时直接通知依赖的 effect。React 则选择了间接模式——任何状态变更都先进入调度器，由调度器统一协调。这两种选择没有绝对优劣，但它们深刻地影响了两个框架的性能特征：Vue 的更新粒度更细（组件级），React 的调度能力更强（可中断、可排优先级）。

### 18.1.2 Strategy 模式：可插拔的协调策略

Strategy（策略）模式允许算法在运行时被替换。React 的 Reconciler 就是一个巨大的策略容器——它不关心最终的渲染目标是 DOM、Native 组件还是字符串，只负责协调逻辑。

```typescript
// React Reconciler 的策略注入接口
// 文件：packages/react-reconciler/src/ReactFiberReconciler.js

// HostConfig 就是策略接口——不同的宿主环境提供不同的实现
export type HostConfig = {
  // 创建实例的策略
  createInstance(
    type: string,
    props: Props,
    rootContainerInstance: Container,
    hostContext: HostContext,
    internalInstanceHandle: Object
  ): Instance;

  // 创建文本节点的策略
  createTextInstance(
    text: string,
    rootContainerInstance: Container,
    hostContext: HostContext,
    internalInstanceHandle: Object
  ): TextInstance;

  // 提交更新的策略
  commitUpdate(
    instance: Instance,
    type: string,
    oldProps: Props,
    newProps: Props,
    internalInstanceHandle: Object
  ): void;

  // 添加子节点的策略
  appendChild(parentInstance: Instance, child: Instance | TextInstance): void;

  // ... 还有数十个策略方法
};
```

React DOM 实现了一套 HostConfig，React Native 实现了另一套，React Three Fiber（3D 渲染）实现了又一套。Reconciler 的核心代码完全不需要改变——这就是 Strategy 模式的威力。

```typescript
// react-dom 的策略实现
// 文件：packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js

export function createInstance(
  type: string,
  props: Props,
  rootContainerInstance: Container,
  hostContext: HostContext,
  internalInstanceHandle: Object
): Instance {
  const domElement: Instance = createElement(type, props, rootContainerInstance, hostContext);
  precacheFiberNode(internalInstanceHandle, domElement);
  updateFiberProps(domElement, props);
  return domElement;
}

// react-native 的策略实现则完全不同——创建的是 Native View 而不是 DOM Element
```

### 18.1.3 Factory 模式：Fiber 节点的创建

Factory（工厂）模式在 React 中最显著的应用是 Fiber 节点的创建。React 需要根据不同的 Element 类型（函数组件、类组件、原生元素、Fragment、Portal 等）创建不同结构的 Fiber 节点。

```typescript
// Fiber 创建的工厂逻辑
// 文件：packages/react-reconciler/src/ReactFiber.js

export function createFiberFromElement(
  element: ReactElement,
  mode: TypeOfMode,
  lanes: Lanes
): Fiber {
  const type = element.type;
  const key = element.key;
  const props = element.props;

  let fiberTag: WorkTag = IndeterminateComponent; // 默认为"待确定"类型

  if (typeof type === 'function') {
    // 函数组件或类组件（此时还不确定，需要后续在 beginWork 中判断）
    if (shouldConstruct(type)) {
      fiberTag = ClassComponent;
    } else {
      fiberTag = FunctionComponent;
    }
  } else if (typeof type === 'string') {
    // 原生 DOM 元素：div、span、p 等
    fiberTag = HostComponent;
  } else {
    // 特殊类型：Fragment、Suspense、Portal 等
    getTag: switch (type) {
      case REACT_FRAGMENT_TYPE:
        return createFiberFromFragment(props.children, mode, lanes, key);
      case REACT_SUSPENSE_TYPE:
        fiberTag = SuspenseComponent;
        break getTag;
      case REACT_SUSPENSE_LIST_TYPE:
        fiberTag = SuspenseListComponent;
        break getTag;
      // ... 更多类型
    }
  }

  const fiber = createFiber(fiberTag, props, key, mode);
  fiber.elementType = type;
  fiber.type = type;
  fiber.lanes = lanes;
  return fiber;
}
```

注意这里有一个微妙的设计：函数组件最初被标记为 `IndeterminateComponent`，直到第一次 `beginWork` 时才确定它到底是函数组件还是类组件。这种"延迟决策"策略也是 Factory 模式的一种变体——工厂不急于确定产品的最终类型，而是留到必要时刻再决定。

### 18.1.4 Visitor 模式：Fiber 树的遍历

Visitor（访问者）模式允许你在不修改数据结构的情况下，为其添加新的操作。React 的 `beginWork` 和 `completeWork` 就是 Fiber 树上的两个"访问者"——它们遍历 Fiber 树，但对每种类型的 Fiber 节点执行不同的操作。

```typescript
// beginWork 本质上是一个 Visitor 的 visit 方法
// 文件：packages/react-reconciler/src/ReactFiberBeginWork.js

function beginWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes
): Fiber | null {
  // 根据 Fiber 节点的 tag（类型），分派到不同的处理函数
  switch (workInProgress.tag) {
    case FunctionComponent:
      return updateFunctionComponent(current, workInProgress, /*...*/);
    case ClassComponent:
      return updateClassComponent(current, workInProgress, /*...*/);
    case HostComponent:
      return updateHostComponent(current, workInProgress, /*...*/);
    case SuspenseComponent:
      return updateSuspenseComponent(current, workInProgress, /*...*/);
    case MemoComponent:
      return updateMemoComponent(current, workInProgress, /*...*/);
    case ForwardRef:
      return updateForwardRef(current, workInProgress, /*...*/);
    case LazyComponent:
      return mountLazyComponent(current, workInProgress, /*...*/);
    // ... 20+ 种节点类型
  }
}
```

这个巨大的 `switch` 语句就是 Visitor 模式的特征标志。每种 Fiber 类型定义了自己被"访问"时的行为，而遍历逻辑（`workLoop` → `performUnitOfWork` → `beginWork`/`completeWork`）与节点处理逻辑完全分离。

### 18.1.5 Command 模式：Update 与 Effect

Command（命令）模式将操作封装为对象，使得操作可以排队、撤销、重放。React 中有两个经典的 Command 模式应用：

**Update 对象**——每一次 `setState` 调用都被封装为一个 Update 命令：

```typescript
// Update 就是一个 Command 对象
type Update<S, A> = {
  lane: Lane;               // 优先级
  revertLane: Lane;          // 回退优先级（用于 useOptimistic）
  action: A;                 // 命令的载荷
  hasEagerState: boolean;    // 是否已提前计算
  eagerState: S | null;      // 提前计算的结果
  next: Update<S, A> | null; // 链表下一个命令
};
```

**Effect 对象**——`useEffect`、`useLayoutEffect` 产生的副作用也是 Command：

```typescript
type Effect = {
  tag: HookFlags;              // 副作用类型标记
  create: () => (() => void) | void;  // 执行命令
  destroy: (() => void) | void;       // 撤销命令（cleanup）
  deps: Array<mixed> | null;          // 依赖条件
  next: Effect | null;                // 链表下一个命令
};
```

这些 Command 对象被创建后不会立即执行，而是排入队列，等待 Reconciler 在合适的时机统一处理。这使得 React 能够实现**批量更新**（多个 setState 合并为一次渲染）和**优先级调度**（高优先级的 Update 先处理）。

### 18.1.6 Mediator 模式：Scheduler 作为中央调度者

Mediator（中介者）模式定义一个中介对象来封装一系列对象之间的交互。React 的 Scheduler 就是整个运行时的 Mediator——所有的更新请求都经过它，由它决定执行顺序和时机。

```typescript
// Scheduler 作为 Mediator 的角色
// 文件：packages/scheduler/src/forks/Scheduler.js

function unstable_scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: Callback,
  options?: { delay: number }
): Task {
  const currentTime = getCurrentTime();
  const startTime = typeof options === 'object' && options !== null
    ? currentTime + options.delay
    : currentTime;

  // 根据优先级计算超时时间
  let timeout: number;
  switch (priorityLevel) {
    case ImmediatePriority:   timeout = -1; break;
    case UserBlockingPriority: timeout = 250; break;
    case NormalPriority:       timeout = 5000; break;
    case LowPriority:         timeout = 10000; break;
    case IdlePriority:        timeout = maxSigned31BitInt; break;
  }

  const expirationTime = startTime + timeout;

  const newTask: Task = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  };

  // 根据开始时间分配到不同队列
  if (startTime > currentTime) {
    // 延迟任务 → timerQueue（小顶堆）
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
  } else {
    // 即时任务 → taskQueue（小顶堆）
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);
  }

  // 请求调度
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback();
  }

  return newTask;
}
```

Scheduler 不关心更新从哪来（用户交互？网络请求？定时器？），也不关心更新要做什么（重新渲染？提交 DOM？执行 Effect？）。它只负责根据优先级和时间约束，决定"什么时候执行什么"。所有模块都通过 Scheduler 这个 Mediator 进行间接通信。

### 18.1.7 Memento 模式：双缓冲与状态快照

Memento（备忘录）模式在不暴露对象实现细节的情况下保存和恢复对象的状态。React 的双缓冲树（current/workInProgress）就是 Memento 模式的应用——`current` 树保存着当前屏幕上的状态"快照"，而 `workInProgress` 树是正在计算的新状态。

```typescript
// 双缓冲切换：Memento 的"恢复"操作
// 文件：packages/react-reconciler/src/ReactFiberWorkLoop.js

function commitRootImpl(root: FiberRoot, /*...*/) {
  // ... 执行各种 DOM 操作

  // 关键：将 workInProgress 树"提升"为新的 current 树
  // 旧的 current 树变成下一轮的 workInProgress 模板
  root.current = finishedWork;

  // 如果渲染过程中出错，可以"回退"到 current 树——这就是 Memento 的恢复能力
}
```

当并发渲染被更高优先级的更新中断时，React 可以丢弃未完成的 `workInProgress` 树，"恢复"到 `current` 树的状态。这种能力正是 Memento 模式赋予的。

### 18.1.8 Composite 模式：组件树的递归结构

Composite（组合）模式将对象组合成树形结构以表示"部分-整体"的层次结构。React 的组件模型天然就是 Composite 模式——每个组件既可以是叶子节点（如 `<input />`），也可以是容器节点（如 `<div>{children}</div>`），而 React 用完全一致的方式处理它们。

```tsx
// Composite 模式的用户空间体现
function App() {
  return (
    <Layout>           {/* 容器 */}
      <Header />       {/* 叶子 */}
      <Content>        {/* 容器 */}
        <Article />    {/* 叶子 */}
        <Sidebar />    {/* 叶子 */}
      </Content>
      <Footer />       {/* 叶子 */}
    </Layout>
  );
}
// Layout、Content 是容器节点，Header、Article、Sidebar、Footer 是叶子节点
// 但在 Fiber 树中，它们都是 Fiber 节点，通过 child/sibling/return 链接
```

### 18.1.9 Iterator 模式：Hooks 链表的遍历

Iterator（迭代器）模式提供一种方式来顺序访问聚合对象中的元素。React 的 Hooks 链表就使用了 Iterator 模式——每个 Hook 调用会推进"游标"到下一个节点：

```typescript
// Hooks 链表的迭代机制
// 文件：packages/react-reconciler/src/ReactFiberHooks.js

let currentHook: Hook | null = null;        // 当前正在处理的 Hook
let workInProgressHook: Hook | null = null; // 正在构建的 Hook

function updateWorkInProgressHook(): Hook {
  // "迭代"到下一个 Hook
  let nextCurrentHook: Hook | null;

  if (currentHook === null) {
    // 首个 Hook：从 Fiber 的 memoizedState 开始
    const current = currentlyRenderingFiber.alternate;
    nextCurrentHook = current !== null ? current.memoizedState : null;
  } else {
    // 后续 Hook：移动到链表的下一个节点
    nextCurrentHook = currentHook.next;
  }

  currentHook = nextCurrentHook;

  // 克隆为 workInProgress Hook
  const newHook: Hook = {
    memoizedState: currentHook.memoizedState,
    baseState: currentHook.baseState,
    baseQueue: currentHook.baseQueue,
    queue: currentHook.queue,
    next: null,
  };

  if (workInProgressHook === null) {
    currentlyRenderingFiber.memoizedState = newHook;
    workInProgressHook = newHook;
  } else {
    workInProgressHook.next = newHook;
    workInProgressHook = newHook;
  }

  return workInProgressHook;
}
```

这就是为什么 Hooks 不能在条件语句中调用——迭代器必须按照固定顺序遍历，否则"游标位置"就会错乱。

### 18.1.10 Proxy 模式：Ref 与 Lazy 的延迟访问

Proxy（代理）模式为另一个对象提供一个替身以控制对它的访问。`React.lazy` 和 `useRef` 都是 Proxy 模式的体现。

```typescript
// React.lazy：Proxy 模式的经典应用
// 文件：packages/react/src/ReactLazy.js

export function lazy<T>(
  ctor: () => Thenable<{ default: T }>
): LazyComponent<T, Payload<T>> {
  const payload: Payload<T> = {
    _status: Uninitialized,
    _result: ctor,  // 存储工厂函数，而不是实际组件
  };

  const lazyType: LazyComponent<T, Payload<T>> = {
    $$typeof: REACT_LAZY_TYPE,
    _payload: payload,
    _init: lazyInitializer,  // 首次访问时才初始化
  };

  return lazyType;
}

function lazyInitializer<T>(payload: Payload<T>): T {
  if (payload._status === Uninitialized) {
    const ctor = payload._result;
    const thenable = ctor();  // 此时才真正加载
    // ...
    payload._status = Pending;
    payload._result = thenable;
  }
  // ...
}
```

`React.lazy` 创建了一个"代理"组件，它在第一次被渲染之前不会加载真正的组件代码。这种延迟加载的行为就是 Proxy 模式的核心价值。

> **深度洞察**：如果你仔细观察以上 10 个模式，会发现它们不是孤立存在的——它们构成了一个"模式系统"。Observer 触发更新，Command 封装更新，Mediator 调度更新，Strategy 执行更新，Visitor 遍历树，Factory 创建节点，Composite 组织树结构，Iterator 遍历 Hooks，Memento 保存快照，Proxy 延迟加载。整个 React 渲染流程就是这 10 个模式的协奏曲。

## 18.2 从 Class 到 Hooks 到 Compiler：API 设计哲学的三次演进

React 的 API 不是一成不变的。从 2013 年开源至今，React 经历了三次根本性的 API 范式转变。每一次转变都不仅仅是语法的改变，更是**设计哲学**的重新定义。

### 18.2.1 Class 时代（2013-2018）：面向对象的组件模型

React 最初的 API 设计深受面向对象思想的影响。一个组件就是一个类，状态封装在实例中，生命周期方法定义了组件在不同阶段的行为。

```typescript
// Class 组件：面向对象的设计范式
class UserProfile extends React.Component<Props, State> {
  state = { user: null, loading: true };

  // 生命周期方法——模拟"对象生命历程"
  componentDidMount() {
    this.fetchUser();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.userId !== this.props.userId) {
      this.fetchUser();
    }
  }

  componentWillUnmount() {
    this.abortController?.abort();
  }

  // 方法——对象的行为
  async fetchUser() {
    this.abortController = new AbortController();
    this.setState({ loading: true });
    const user = await fetchUserById(
      this.props.userId,
      this.abortController.signal
    );
    this.setState({ user, loading: false });
  }

  render() {
    const { user, loading } = this.state;
    if (loading) return <Spinner />;
    return <div>{user.name}</div>;
  }
}
```

Class 组件的核心设计理念是：**组件是一个有状态的对象，它有明确的生命周期阶段。** 这种模型直观、容易理解，但有三个深层问题：

1. **逻辑碎片化**：数据获取的逻辑分散在 `componentDidMount`、`componentDidUpdate`、`componentWillUnmount` 三个方法中，难以作为整体理解和复用。
2. **`this` 的困境**：JavaScript 的 `this` 在回调函数中的行为与直觉不符，导致了大量的 `.bind(this)` 和箭头函数属性。
3. **复用困难**：高阶组件（HOC）和 Render Props 虽然能实现逻辑复用，但会导致"wrapper hell"——组件层级深度膨胀。

### 18.2.2 Hooks 时代（2018-2024）：代数效应的启示

2018 年 React Conf 上，Dan Abramov 用一场现场编码演示引入了 Hooks。这不是一次渐进式改进，而是一次范式革命——从面向对象到**函数式 + 效应式**。

```typescript
// 同样的功能，用 Hooks 实现
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);

    fetchUserById(userId, abortController.signal)
      .then(user => {
        setUser(user);
        setLoading(false);
      });

    return () => abortController.abort();  // cleanup 与 setup 在一起
  }, [userId]);  // 依赖声明——"当 userId 变化时重新执行"

  if (loading) return <Spinner />;
  return <div>{user.name}</div>;
}
```

Hooks 的设计理念转变可以用一句话概括：**组件不是对象，而是一个从数据到 UI 的函数，副作用是这个函数的"附带效应"。**

这个理念的灵感来源之一是 **Algebraic Effects（代数效应）**——一种来自编程语言理论的概念。代数效应允许函数"声明"它需要某种能力（如读取状态、执行副作用），而将这些能力的"实现"交给调用者。Dan Abramov 在 2019 年的博客文章 "Algebraic Effects for the Rest of Us" 中明确阐述了这种联系：

```typescript
// 代数效应的伪代码（不是有效的 JavaScript）
function UserProfile({ userId }) {
  // "perform" 声明了一个效应——"我需要状态"
  const [user, setUser] = perform useState(null);

  // "perform" 声明了另一个效应——"我需要副作用"
  perform useEffect(() => {
    fetchUserById(userId).then(setUser);
  }, [userId]);

  return <div>{user.name}</div>;
}

// React 运行时是"handler"——它"处理"这些效应
// 不同的渲染上下文（客户端/服务端/测试）可以提供不同的 handler
```

虽然 JavaScript 没有原生的代数效应支持，React 团队通过 Hooks 的链表机制模拟了这种效果。Hooks 的"规则"（不能条件调用、必须在顶层调用）就是这种模拟的代价——真正的代数效应不需要这些限制。

### 18.2.3 Compiler 时代（2024-）：心智模型的解放

React Compiler 代表了第三次范式转变。它的核心洞察是：**开发者不应该需要思考"如何优化"，优化应该是编译器的工作。**

```typescript
// Compiler 之前：开发者需要手动优化
function ProductList({ products, category }: Props) {
  // 需要 useMemo 避免每次渲染都重新过滤
  const filteredProducts = useMemo(
    () => products.filter(p => p.category === category),
    [products, category]
  );

  // 需要 useCallback 避免传给子组件的函数引用变化
  const handleClick = useCallback(
    (id: string) => { navigate(`/product/${id}`); },
    [navigate]
  );

  return filteredProducts.map(p => (
    // 需要 React.memo 避免不必要的子组件重渲染
    <ProductCard key={p.id} product={p} onClick={handleClick} />
  ));
}

const ProductCard = React.memo(({ product, onClick }: CardProps) => (
  <div onClick={() => onClick(product.id)}>{product.name}</div>
));
```

```typescript
// Compiler 之后：相同的代码，但不需要手动优化
function ProductList({ products, category }: Props) {
  // 编译器会自动分析依赖并缓存
  const filteredProducts = products.filter(p => p.category === category);

  const handleClick = (id: string) => {
    navigate(`/product/${id}`);
  };

  return filteredProducts.map(p => (
    <ProductCard key={p.id} product={p} onClick={handleClick} />
  ));
}

// 编译器自动注入等效的 memo 行为
function ProductCard({ product, onClick }: CardProps) {
  return <div onClick={() => onClick(product.id)}>{product.name}</div>;
}
```

三次范式演进的对比：

| 维度 | Class 时代 | Hooks 时代 | Compiler 时代 |
|------|-----------|-----------|--------------|
| **核心抽象** | 组件是对象 | 组件是函数 | 组件是声明 |
| **状态管理** | 实例属性 (this.state) | 闭包捕获 (useState) | 自动记忆化 |
| **逻辑复用** | HOC / Render Props | 自定义 Hooks | 自定义 Hooks + 零样板 |
| **性能优化** | shouldComponentUpdate | useMemo / useCallback / memo | 编译器自动完成 |
| **心智负担** | 高（生命周期、this） | 中（依赖数组、规则） | 低（直觉编写） |
| **编译时参与** | 无 | 最小（JSX 转换） | 深度（依赖分析、记忆化注入） |

> **深度洞察**：三次演进有一个共同方向——**减少开发者需要关心的"附带复杂度"**。Class 时代，你需要理解 `this`、生命周期、HOC 的工作原理。Hooks 时代，你需要理解依赖数组、闭包陷阱、memo 优化。Compiler 时代，你只需要理解 React 的基本规则——"组件是纯函数"——编译器会处理其余一切。React 的终极目标不是让框架更强大，而是让框架"消失"。

## 18.3 React 的技术决策考古：被放弃的方案

React 的历史不仅是"做了什么"的历史，也是"没做什么"的历史。那些被探索过又被放弃的技术方案，往往比最终选择更能揭示 React 团队的决策逻辑。

### 18.3.1 Algebraic Effects：Hooks 的理想与现实

如前所述，Hooks 的设计灵感部分来自 Algebraic Effects。但为什么 React 没有直接使用或实现 Algebraic Effects？

Algebraic Effects 的核心思想是：一个函数可以"抛出"一个效应（effect），运行时会捕获这个效应，执行相应的处理，然后**恢复**函数的执行。这与异常处理类似，但关键区别是：异常是单向的（抛出后不会回到抛出点），而效应是双向的（处理完后会继续执行抛出点之后的代码）。

```typescript
// 假设 JavaScript 支持 Algebraic Effects（纯虚构语法）
function UserProfile({ userId }) {
  // "perform" 抛出一个效应，React 的 handler 会处理它
  // 处理完成后，结果被"注入"回来，函数继续执行
  const user = perform ReadUser(userId);    // 可恢复的效应
  const theme = perform ReadContext(Theme);  // 可恢复的效应

  // 如果这里是条件语句中的 perform，完全没问题
  if (user.isPremium) {
    const premiumTheme = perform ReadContext(PremiumTheme);
    return <PremiumView theme={premiumTheme} user={user} />;
  }

  return <StandardView theme={theme} user={user} />;
}
```

如果 JavaScript 原生支持 Algebraic Effects，React 不需要 Hooks 链表、不需要"规则"（不能条件调用）、不需要闭包陷阱——所有这些问题都是因为 Hooks 是 Algebraic Effects 的一种**不完美模拟**。

React 团队没有选择在 JavaScript 中实现真正的 Algebraic Effects，原因有三：

1. **语言层面不可行**：JavaScript 没有 one-shot delimited continuations，无法实现可恢复的效应处理。Generator 函数虽然可以暂停和恢复，但它们的语法限制太多，无法透明地用于组件。

2. **性能开销**：即使能实现，模拟 continuations 需要拷贝调用栈的状态，在频繁渲染的场景下开销不可接受。

3. **生态兼容性**：一种全新的执行模型会使得所有现有的 JavaScript 工具（调试器、性能分析器、错误追踪工具）无法正常工作。

React 选择了一种务实的折中：用链表模拟效应的顺序执行，用闭包捕获状态。代价是"Hooks 规则"，但收益是与现有 JavaScript 生态的完全兼容。

### 18.3.2 Prepack：死代码消除的超前尝试

2017-2019 年间，Meta 开发了一个名为 Prepack 的工具，目标是通过**部分求值（Partial Evaluation）** 在编译时执行 JavaScript 代码，消除运行时开销。React 团队曾认真考虑将 Prepack 集成到 React 的编译管线中。

```typescript
// Prepack 的工作原理示意

// 输入代码
function getGreeting(name: string) {
  const prefix = "Hello";
  const separator = ", ";
  const suffix = "!";
  return prefix + separator + name + suffix;
}

const message = getGreeting("World");

// Prepack 编译后
const message = "Hello, World!";
// Prepack 在编译时"执行"了函数，直接产出结果
```

对于 React 组件，Prepack 的愿景是：

```typescript
// 输入：一个使用常量 props 的组件
function StaticBanner() {
  const config = { color: "blue", size: "large" };
  return (
    <div style={{ color: config.color }}>
      <span className={`banner-${config.size}`}>Welcome</span>
    </div>
  );
}

// Prepack 理论上的输出：跳过所有中间计算
function StaticBanner() {
  return {
    $$typeof: Symbol.for('react.element'),
    type: 'div',
    props: {
      style: { color: 'blue' },
      children: {
        $$typeof: Symbol.for('react.element'),
        type: 'span',
        props: {
          className: 'banner-large',
          children: 'Welcome'
        }
      }
    }
  };
}
```

Prepack 最终在 2019 年被停止开发，原因包括：

1. **复杂度爆炸**：对于包含副作用、闭包、异步操作的真实代码，部分求值的分析复杂度呈指数增长。React 组件几乎不可能是纯静态的——它们依赖 props、state、context，这些都是运行时才能确定的值。

2. **收益有限**：对于大多数 React 应用，性能瓶颈不在于组件函数的执行开销，而在于不必要的重渲染。Prepack 优化的是"函数执行速度"，但 React 真正需要优化的是"渲染频率"。

3. **维护成本**：Prepack 需要实现一个完整的 JavaScript 语义解释器，跟上 ECMAScript 标准的演进速度是一个巨大的工程负担。

React Compiler 吸取了 Prepack 的教训。它不试图"执行"代码，而是分析代码的**依赖关系**，自动注入记忆化。这是一个范围更窄但更可行的目标——你不需要理解代码"做了什么"，只需要理解"什么变了"。

### 18.3.3 其他被放弃的技术方案

**React Fire（2018）**：一个计划重写 React DOM 事件系统的项目，目标是让 React 的事件行为更接近原生 DOM 事件。项目最终没有以独立版本发布，但其部分成果（如将事件委托从 `document` 移到 `root`）被整合进了 React 17。

**React Flare（2019）**：一个实验性的高级事件处理系统，目标是提供跨平台的事件抽象（如 Press、Hover、Focus），使得同一套事件代码可以在 Web 和 React Native 上运行。项目因复杂度和维护负担被放弃。

**Concurrent Mode "全有或全无"（2019-2020）**：React 最初计划以一种"开关式"的方式启用并发模式——要么整个应用是并发的，要么不是。后来发现这对于大型应用的渐进式迁移是灾难性的，于是改为了通过 `startTransition`、`useDeferredValue` 等 API 逐步开启并发特性。

> **深度洞察**：React 团队放弃一个技术方案的速度，往往和他们探索一个技术方案的热情一样令人印象深刻。这种"快速原型、快速失败"的方法论，使得 React 能够在"正确但昂贵的解决方案"和"可行且实用的解决方案"之间做出明智的取舍。Prepack 教会了他们"编译时优化应该做什么"，Algebraic Effects 教会了他们"函数式组件应该是什么样子"——即使这两个项目都没有直接变成产品。

## 18.4 React vs Vue vs Svelte vs Solid：四大框架的终极架构对比

站在 2026 年的时间点回望，前端框架的竞争格局已经从"哪个更快"演变为"哪种架构理念更能经受时间的考验"。以下是四大框架在核心架构层面的系统对比。

### 18.4.1 响应式模型：推与拉的哲学之争

四大框架在响应式模型上的选择，决定了它们几乎所有其他设计决策。

**React：Pull-based（拉模型）**

```typescript
// React 的更新是"拉"的——组件被调度器"拉"去重新渲染
function Counter() {
  const [count, setCount] = useState(0);

  // 当 setCount 被调用时，React 不会立即更新
  // 而是标记组件"脏"，然后在下一个调度周期"拉"组件重新渲染
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
// React 重新执行整个函数，通过 diff 找出变化——"不知道什么变了，所以全部重新算"
```

**Vue：Push-based（推模型）**

```typescript
// Vue 的更新是"推"的——响应式系统直接推送变更到依赖的 effect
import { ref, watchEffect } from 'vue';

const count = ref(0);

// Vue 在 watchEffect 执行时自动收集依赖
// 当 count.value 变化时，Vue 知道"精确地哪些 effect 需要重新运行"
watchEffect(() => {
  document.title = `Count: ${count.value}`;
});
// Vue 使用 Proxy 拦截属性访问，建立精确的依赖关系图
```

**Svelte：Compile-time Push（编译时推模型）**

```typescript
// Svelte 在编译时将声明式代码转换为命令式更新
// 源代码
let count = 0;
$: doubled = count * 2;

// 编译后（简化）
function update() {
  if (changed.count) {
    doubled = count * 2;                  // 直接赋值
    set_text(t0, count);                  // 直接操作 DOM
    set_text(t1, doubled);                // 不经过 VDOM
  }
}
```

**Solid：Fine-grained Push（细粒度推模型）**

```typescript
// Solid 使用信号（Signal）实现细粒度推更新
import { createSignal, createEffect } from 'solid-js';

function Counter() {
  const [count, setCount] = createSignal(0);

  // 这个组件函数只执行一次！
  // createEffect 建立了 count → DOM 的直接绑定
  createEffect(() => {
    document.title = `Count: ${count()}`;
  });

  // JSX 中的表达式被编译为响应式绑定，而不是每次都重新执行整个函数
  return <button onClick={() => setCount(c => c + 1)}>{count()}</button>;
}
```

### 18.4.2 架构对比全景表

| 维度 | React | Vue 3 | Svelte 5 | Solid |
|------|-------|-------|----------|-------|
| **响应式模型** | Pull（调度器拉取） | Push（Proxy 推送） | 编译时推送 | 细粒度 Signal 推送 |
| **虚拟 DOM** | 有（Fiber 树） | 有（VNode 树） | 无（编译为命令式） | 无（细粒度绑定） |
| **组件更新粒度** | 组件级（整个函数重执行） | 组件级（模板级优化） | 语句级（编译时分析） | 表达式级（Signal 追踪） |
| **编译器角色** | 深度（Compiler 自动 memo） | 中度（模板优化、静态提升） | 核心（运行时极小） | 中度（JSX 转响应式绑定） |
| **运行时大小** | ~40KB (gzipped) | ~33KB (gzipped) | ~2KB (gzipped) | ~7KB (gzipped) |
| **并发渲染** | 原生支持（Scheduler） | 不支持 | 不支持 | 不支持 |
| **Server Components** | 原生支持 | 实验性 | 不支持 | 实验性 |
| **状态管理** | 外部库为主 | 内建响应式系统 | 内建 runes | 内建 Signal |
| **TypeScript 支持** | 原生（类型体操友好） | 优秀（模板类型检查） | 良好 | 优秀 |
| **学习曲线** | 陡峭（并发模型复杂） | 适中 | 平缓 | 适中 |
| **生态系统规模** | 最大 | 大 | 中 | 小 |

### 18.4.3 Diff 策略对比

四大框架在处理列表更新时的 Diff 策略差异显著：

```typescript
// React：两轮遍历 + Map 查找
// 时间复杂度：O(n)，但常数因子较大
// 特点：优先处理位置不变的节点，再处理移动的节点

// Vue 3：双端对比 + 最长递增子序列
// 时间复杂度：O(n log n)（LIS 部分），但实际 DOM 操作次数更少
// 特点：从两端向中间收缩，最小化 DOM 移动

// Svelte 5：编译时生成的命令式更新
// 不需要传统意义上的 Diff——编译器已经知道什么会变
// 对于动态列表仍需运行时 keyed each 块

// Solid：无 Diff
// 依赖细粒度 Signal，每个列表项独立追踪
// <For> 组件直接管理 DOM 节点的增删改
```

### 18.4.4 各框架的"甜蜜区"

每个框架都有它最擅长的场景。理解这一点比争论"谁更好"有价值得多。

**React 的甜蜜区**：
- 大型团队协作的复杂应用（强类型、规范化的 API 降低沟通成本）
- 需要并发渲染能力的场景（如包含大量实时交互的 dashboard）
- 全栈 React 场景（Server Components + Server Actions）
- 需要跨平台渲染的项目（React Native、Three.js 等）

**Vue 的甜蜜区**：
- 中等复杂度的应用（内建的响应式系统减少了外部依赖）
- 渐进式采用的场景（可以从一个 `<script>` 标签开始）
- 模板偏好的团队（模板比 JSX 更容易进行静态分析和优化）

**Svelte 的甜蜜区**：
- 对 bundle 大小极度敏感的场景（如嵌入式 widget、弱网环境）
- 中小型应用（编译器消除了大量运行时开销）
- 追求极致性能的静态内容站点

**Solid 的甜蜜区**：
- 对更新性能要求极高的场景（如实时数据可视化、游戏 UI）
- 不需要并发渲染但需要极致响应速度的应用
- 偏好 JSX 但希望获得细粒度响应式的开发者

> **深度洞察**：四大框架的核心分歧在于一个根本性的问题——**谁负责追踪变化？** React 的回答是"没人追踪，我全部重新算"（然后用 Diff 和 Compiler 来弥补性能）。Vue 的回答是"运行时 Proxy 自动追踪"。Svelte 的回答是"编译器在构建时就知道什么会变"。Solid 的回答是"Signal 在运行时精确追踪到表达式级别"。没有哪种选择是绝对正确的——每一种都是在"性能"、"开发体验"、"灵活性"三角中做出的不同权衡。React 选择牺牲初始运行时性能，换取调度的灵活性和生态的广泛性——这个选择在"大型复杂应用"的场景下被证明是极其成功的。

## 18.5 展望：React 的下一个十年

预测技术的未来是危险的，但我们可以从 React 团队的公开言论、RFC、实验性分支和已有的技术轨迹中，推断出几个高确信度的方向。

### 18.5.1 React Compiler 的全面成熟

React Compiler 在 2024 年以 "React Compiler Beta" 的形式进入公众视野，截至 2026 年初已经在 Meta 的多个大型产品（Instagram、Facebook）中得到验证。它的下一步发展方向包括：

**更深层的静态分析**：当前的 Compiler 主要进行"自动记忆化"——识别不需要重新计算的值和不需要重新渲染的组件。未来的版本可能会进行更激进的优化：

```typescript
// 未来 Compiler 可能的优化：自动 code splitting
function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  // Compiler 可以分析出 Charts、Table、Settings 是互斥渲染的
  // 自动为它们生成 lazy 加载边界
  return (
    <Tabs value={activeTab} onChange={setActiveTab}>
      <Tab label="Overview"><Charts /></Tab>
      <Tab label="Data"><Table /></Tab>
      <Tab label="Settings"><Settings /></Tab>
    </Tabs>
  );
}

// 未来 Compiler 的潜在输出：
function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  // 自动注入的 lazy 加载
  const Charts = __lazy(() => import('./Charts'));
  const Table = __lazy(() => import('./Table'));
  const Settings = __lazy(() => import('./Settings'));
  // ...
}
```

**编译时类型检查增强**：Compiler 已经拥有了对 React 代码的深层理解，未来可能会扩展为一个 React 专用的类型检查/lint 工具，在编译时捕获更多的错误模式（如违反 Hooks 规则、不安全的并发访问等）。

### 18.5.2 Server Components 的生态扩展

Server Components 目前与 Next.js 紧密绑定，但 React 团队的长期目标是使其成为一个**通用协议**。

```typescript
// 未来可能的 RSC 协议独立化

// 任何服务端框架都可以实现 RSC 协议
// rsc-protocol.ts
interface RSCProtocol {
  // 将 Server Component 树序列化为流
  renderToRSCStream(tree: ReactElement): ReadableStream;

  // 客户端消费 RSC 流
  createFromRSCStream(stream: ReadableStream): ReactElement;

  // Server Actions 的 RPC 协议
  callServerAction(id: string, args: unknown[]): Promise<unknown>;
}

// 不同的框架可以提供自己的实现
// - Next.js App Router
// - Remix RSC
// - Waku
// - 自定义 Node.js 服务器
```

### 18.5.3 运行时的进一步精简

随着 Compiler 承担更多的优化职责，React 运行时有机会变得更小：

1. **Hooks 规则的放松**：如果 Compiler 能在编译时保证 Hooks 的调用顺序，运行时就不需要维护 Hooks 链表，开发者也不再需要遵守"不能条件调用"的规则。这本质上是用编译时分析来补偿 JavaScript 缺少 Algebraic Effects 的不足。

2. **Diff 算法的优化**：Compiler 可以在编译时标记哪些子树是静态的（永远不会变化），使得运行时可以跳过这些子树的 Diff。Vue 3 已经通过模板编译实现了类似的"静态提升"，React Compiler 有能力在 JSX 上实现同等甚至更强的优化。

3. **选择性引入**：随着 tree-shaking 技术的成熟，未来的 React 可能会将并发渲染、Suspense、Server Components 等特性做成"按需加载"的模块——如果你的应用不使用并发特性，对应的调度器代码不会进入 bundle。

### 18.5.4 跨平台能力的深化

React 的 Strategy 模式（HostConfig）使其天然具备跨平台能力。未来这种能力可能进一步深化：

```typescript
// 未来可能的统一跨平台 API

// 共享的业务逻辑层
function useProductSearch(query: string) {
  const [results, setResults] = useState<Product[]>([]);
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const data = await searchProducts(query);
      setResults(data);
    });
  }, [query]);

  return { results, loading };
}

// Web 渲染
function WebProductList({ query }: Props) {
  const { results, loading } = useProductSearch(query);
  return <div className="product-grid">...</div>;  // DOM
}

// Native 渲染
function NativeProductList({ query }: Props) {
  const { results, loading } = useProductSearch(query);
  return <ScrollView style={styles.grid}>...</ScrollView>;  // Native View
}

// 3D 渲染（React Three Fiber）
function ThreeDProductList({ query }: Props) {
  const { results, loading } = useProductSearch(query);
  return <group>...</group>;  // Three.js Scene
}

// 终端 UI 渲染（Ink）
function TerminalProductList({ query }: Props) {
  const { results, loading } = useProductSearch(query);
  return <Box flexDirection="column">...</Box>;  // 终端字符
}
```

四种渲染目标共享了相同的 Hooks 逻辑和状态管理，只是"策略"（HostConfig）不同。这种架构使得 React 的价值不仅在于"做 Web 开发的框架"，更在于"声明式 UI 编程的通用范式"。

### 18.5.5 从框架到平台

React 正在从一个"前端框架"逐步演变为一个"全栈应用平台"。这个演变的轨迹已经清晰可见：

- **React 16**：UI 渲染引擎（Fiber + 虚拟 DOM）
- **React 18**：并发 UI 引擎（Concurrent Mode + Suspense）
- **React 19**：全栈 UI 引擎（Server Components + Actions + Compiler）
- **React 未来**：全栈编译器平台（Compiler 驱动的自动优化 + RSC 协议 + 跨平台渲染）

这个方向意味着"React 开发者"的定义正在扩展——不仅是写组件的人，更是构建"从数据库到像素"完整链路的工程师。

> **深度洞察**：React 的"下一个十年"最引人注目的趋势不是某个具体的技术特性，而是一种范式转移——从"运行时做更多事"到"编译时做更多事"。这并不意味着运行时变得不重要，而是说运行时的复杂度应该对开发者隐藏，由编译器来管理。就像高级语言隐藏了汇编指令一样，React Compiler 的终极目标是让"性能优化"这件事对开发者完全透明。当这一天到来时，我们回头看 `useMemo` 和 `useCallback`，就像今天回头看手动管理内存一样——它们曾经是必要的，但终将成为历史。

## 18.6 本章小结

本章从五个维度完成了对 React 架构的全景审视：

1. **设计模式**：React 源码中的 10 个核心设计模式不是偶然出现的——Observer 驱动更新、Command 封装变更、Mediator 协调调度、Strategy 实现跨平台、Visitor 遍历 Fiber 树、Factory 创建节点、Composite 组织层级、Iterator 遍历 Hooks、Memento 保存快照、Proxy 延迟加载。它们共同构成了 React 运行时的"设计骨架"。

2. **API 设计哲学**：从 Class 到 Hooks 到 Compiler 的三次演进，方向始终一致——减少附带复杂度，让开发者专注于业务逻辑。每一次演进都是在"表达力"和"简单性"之间寻找更优的平衡点。

3. **技术考古**：Algebraic Effects 启发了 Hooks 但因语言限制无法直接实现，Prepack 探索了编译时执行但因复杂度被放弃，React Fire/Flare 推动了事件系统改进但未独立发布。这些"失败"的探索深刻影响了 React 最终选择的方向。

4. **框架对比**：React（Pull + VDOM）、Vue（Push + Proxy）、Svelte（编译时推送）、Solid（细粒度 Signal）代表了四种不同的架构哲学。没有最好的框架，只有最适合特定约束条件的选择。

5. **未来展望**：React 正从运行时框架向编译器平台演进。Compiler 的全面成熟、RSC 的生态扩展、运行时的精简、跨平台能力的深化，共同指向一个方向——让 React 从"你需要学习的框架"变成"你几乎不需要意识到它存在的基础设施"。

作为全书的收官章节，我希望你带走的不仅是技术细节，更是一种**思维方式**：当你面对技术选型和架构决策时，不要只问"哪个更好"，要问"在当前的约束条件下，哪种取舍最合理"。React 团队十年来的每一个重大决策——选择虚拟 DOM 而非细粒度响应式、选择 Hooks 而非 Algebraic Effects、选择 Compiler 而非手动优化——都不是因为它们是"最好的"方案，而是因为它们是在给定约束下"最合理的"方案。这种务实的工程思维，才是 React 给我们最宝贵的遗产。

> **课程关联**：本章内容对应慕课网课程《React 源码深度解析》的高级扩展部分。课程中从源码层面系统讲解了 React 的核心架构，而本章所涉及的设计模式、哲学分析与框架对比是在扎实源码理解之上的升维思考，建议先完成课程基础部分的学习：[https://coding.imooc.com/class/650.html](https://coding.imooc.com/class/650.html)

---

### 思考题

1. **React 的 Reconciler 使用 Strategy 模式实现了宿主环境的可插拔性，但 Scheduler 目前是 Reconciler 内建的。** 如果要将 Scheduler 也设计为可插拔的（例如允许 React Native 使用不同于 Web 的调度策略），你会如何设计 SchedulerConfig 接口？这种设计会带来哪些好处和风险？

2. **Algebraic Effects 的"可恢复性"是 Hooks 无法完美模拟的核心能力。** 假设未来 TC39 引入了类似 `perform/handle` 的语法到 JavaScript 标准中，React 的 Hooks 系统需要做哪些根本性的改变？"Hooks 规则"是否可以被完全取消？请从 Fiber 和 Hooks 链表的实现角度分析。

3. **在 React vs Vue vs Svelte vs Solid 的架构对比中，我们提到 React 选择了"Pull 模型"。** 但 React Compiler 的自动记忆化实际上引入了一种"编译时依赖追踪"——这是否意味着 React 正在向 Push 模型靠拢？如果是，React 最终会变成一个使用 Signal 的框架吗？如果不是，React 的 Pull 模型有什么不可替代的优势？

4. **Prepack 被放弃的核心原因之一是"React 组件依赖运行时才能确定的值"。** 但 Server Components 改变了这一前提——Server Component 在服务端执行时，所有的 props 和数据都是已知的。这是否意味着 Prepack 的部分求值思想可以在 Server Components 的编译管线中"复活"？设计一个概念验证方案。

</div>