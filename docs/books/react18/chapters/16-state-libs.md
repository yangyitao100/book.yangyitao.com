<div v-pre>

# 第16章 状态管理库的内核机制

> **本章要点**
>
> - Context 的性能瓶颈根源：Provider value 变化时的全子树重渲染问题与 changedBits 的废弃历史
> - useSyncExternalStore 的设计动机：外部状态如何安全接入并发渲染
> - Redux Toolkit 的中间件链：compose 与 applyMiddleware 的函数式编程范式
> - Zustand 的极简内核：用 200 行代码实现一个完备的状态管理库
> - Jotai 的原子依赖图：自底向上的响应式状态传播
> - 选型决策框架：从项目规模、团队认知、性能需求三个维度做出理性选择

---

React 内置了两种状态管理原语：组件内部的 `useState`/`useReducer` 和跨组件的 `Context`。对于中小型应用，这两者足以应对大部分场景。但当应用规模膨胀到一定程度，Context 的性能缺陷和心智负担开始显现——它不是一个真正的状态管理方案，而是一个依赖注入机制。

这就是第三方状态管理库存在的根本原因。Redux、Zustand、Jotai——这些库的诞生不是因为 React 的能力不足，而是因为它们各自找到了不同维度上的最优解。Redux 选择了可预测性，Zustand 选择了极简性，Jotai 选择了细粒度响应性。理解这些库的内核实现，不仅能帮助你做出更合理的技术选型，更能让你理解"状态管理"这个看似简单的问题背后蕴含的深层工程权衡。

本章将从 React 自身的 Context 性能问题出发，深入到 `useSyncExternalStore` 这个连接 React 并发渲染与外部状态的关键 Hook，然后逐一剖析三大主流状态管理库的内核实现。在这个过程中，你会发现一个有趣的事实：最好的状态管理库往往不是功能最丰富的，而是约束最恰当的。

## 16.1 Context 的性能问题与 useSyncExternalStore

### 16.1.1 Context 的传播机制

在深入第三方状态管理库之前，我们必须先理解 React 内置方案的局限性。Context 的核心实现在 `propagateContextChange` 函数中：

```typescript
// react-reconciler/src/ReactFiberNewContext.js
function propagateContextChange<T>(
  workInProgress: Fiber,
  context: ReactContext<T>,
  renderLanes: Lanes
): void {
  let fiber = workInProgress.child;
  if (fiber !== null) {
    fiber.return = workInProgress;
  }

  while (fiber !== null) {
    let nextFiber: Fiber | null = null;
    const list = fiber.dependencies;

    if (list !== null) {
      nextFiber = fiber.child;
      let dependency = list.firstContext;
      while (dependency !== null) {
        // 检查这个 Fiber 是否依赖了发生变化的 Context
        if (dependency.context === context) {
          // 找到了依赖此 Context 的消费者
          if (fiber.tag === ClassComponent) {
            const update = createUpdate(renderLanes);
            update.tag = ForceUpdate;
            enqueueUpdate(fiber, update, renderLanes);
          }

          // 关键操作：标记该 Fiber 需要更新
          fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
          const alternate = fiber.alternate;
          if (alternate !== null) {
            alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
          }

          // 向上冒泡 childLanes
          scheduleContextWorkOnParentPath(
            fiber.return,
            renderLanes,
            workInProgress
          );

          list.lanes = mergeLanes(list.lanes, renderLanes);
          break;
        }
        dependency = dependency.next;
      }
    }

    // 继续深度优先遍历
    // ...省略遍历逻辑
    fiber = nextFiber;
  }
}
```

这段代码揭示了 Context 性能问题的根源：**当 Provider 的 value 发生变化时，React 必须遍历整个子树来找到所有消费者**。这是一个 O(n) 的操作，其中 n 是 Provider 下的所有 Fiber 节点数量，而不仅仅是消费者的数量。

更致命的问题在于 Context 的更新粒度：

```tsx
interface AppState {
  theme: string;
  locale: string;
  user: User;
  notifications: Notification[];
}

const AppContext = createContext<AppState>(defaultState);

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    // 当任何字段变化时，所有消费者都会重渲染
    <AppContext.Provider value={state}>
      <Header />    {/* 只用了 theme */}
      <Sidebar />   {/* 只用了 notifications */}
      <Content />   {/* 只用了 user */}
    </AppContext.Provider>
  );
}

function Header() {
  // 即使只读取了 theme，当 notifications 变化时也会重渲染
  const { theme } = useContext(AppContext);
  return <header className={theme}>...</header>;
}
```

### 16.1.2 changedBits：一个被废弃的优化尝试

很少有人知道，React 曾经尝试过一个叫做 `changedBits` 的 Context 优化方案。它出现在 React 16 的早期版本中，允许开发者指定哪些位发生了变化：

```typescript
// 这是一个已被废弃的 API，仅作历史分析
const MyContext = createContext(defaultValue, (prev, next) => {
  let changedBits = 0;
  if (prev.theme !== next.theme) changedBits |= 0b01;
  if (prev.locale !== next.locale) changedBits |= 0b10;
  return changedBits;
});

// 消费者可以指定只关心哪些位
<MyContext.Consumer unstable_observedBits={0b01}>
  {value => <div>{value.theme}</div>}
</MyContext.Consumer>
```

这个方案最终被移除了。原因有三：第一，位运算限制了最多 31 个可追踪的字段；第二，它将 Context 的内部实现暴露给了用户，违背了 React 一贯的"声明式"设计哲学；第三，React 团队决定将细粒度订阅的职责交给用户空间的状态管理库，而不是在核心中实现一个必然不完善的方案。

> 🔥 **深度洞察：React 的设计哲学是"做少而精的事"**
>
> Context 的性能问题不是一个 bug，而是一个有意识的设计取舍。React 团队选择让 Context 保持简单——它是一个依赖注入机制，不是一个状态管理系统。细粒度订阅、派生状态、中间件——这些功能属于用户空间，而不是框架核心。这个决策催生了繁荣的状态管理生态，也让每个库可以在各自的维度上做到极致。

### 16.1.3 useSyncExternalStore：并发安全的外部状态桥梁

React 18 引入并发渲染后，所有外部状态管理库都面临一个严峻的问题：**tearing（撕裂）**。在并发模式下，一次渲染可能被中断和恢复，如果外部状态在渲染过程中发生变化，不同组件可能读取到同一状态的不同版本，导致 UI 不一致。

`useSyncExternalStore` 就是为解决这个问题而设计的。它的源码实现比大多数人想象的要复杂得多：

```typescript
// react-reconciler/src/ReactFiberHooks.js
function mountSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  const fiber = currentlyRenderingFiber;
  const hook = mountWorkInProgressHook();

  const nextSnapshot = getSnapshot();

  // 检测快照是否在渲染期间发生了变化（tearing 检测）
  const root = getWorkInProgressRoot();
  if (!includesBlockingLane(root, renderLanes)) {
    // 非阻塞渲染（并发渲染）中，需要额外检查
    pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
  }

  hook.memoizedState = nextSnapshot;

  const inst: StoreInstance<T> = {
    value: nextSnapshot,
    getSnapshot,
  };
  hook.queue = inst;

  // 使用 useEffect 订阅外部 store
  mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe]);

  // 使用 useEffect 检测 getSnapshot 或 value 的变化
  mountEffect(
    updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot),
    null // 每次渲染都执行
  );

  return nextSnapshot;
}
```

这段代码中最关键的是 `pushStoreConsistencyCheck`。在并发渲染中，React 会在渲染完成后、提交之前，检查所有 `useSyncExternalStore` 消费者的快照是否仍然与当前外部状态一致：

```typescript
function pushStoreConsistencyCheck<T>(
  fiber: Fiber,
  getSnapshot: () => T,
  renderedSnapshot: T,
): void {
  fiber.flags |= StoreConsistency;

  const check: StoreConsistencyCheck<T> = {
    getSnapshot,
    value: renderedSnapshot,
  };

  // 挂载到当前渲染的根节点上
  let checks = renderPhaseUpdates;
  if (checks === null) {
    checks = renderPhaseUpdates = [];
  }
  checks.push(check);
}
```

如果检查失败——即外部状态在渲染过程中发生了变化——React 会**同步重新渲染整棵树**，强制使用最新的快照。这个设计保证了一个关键特性：即使在并发模式下，UI 也永远不会出现撕裂。

这就是 `useSyncExternalStore` 名字中 "Sync" 的含义——它不是说订阅是同步的，而是说当检测到不一致时，它会强制同步渲染来确保一致性。

### 16.1.4 useSyncExternalStore 的使用模式

理解了内核实现后，`useSyncExternalStore` 的三个参数就不再神秘了：

```typescript
function useSyncExternalStore<T>(
  // 订阅函数：当外部状态变化时调用 callback
  subscribe: (callback: () => void) => () => void,
  // 获取当前快照：必须返回不可变值（或缓存的引用）
  getSnapshot: () => T,
  // SSR 时使用的快照（可选）
  getServerSnapshot?: () => T
): T;
```

一个最小实现的外部 store 如下：

```typescript
function createStore<T>(initialState: T) {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (nextState: T | ((prev: T) => T)) => {
      state = typeof nextState === 'function'
        ? (nextState as (prev: T) => T)(state)
        : nextState;
      // 通知所有订阅者
      listeners.forEach(listener => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// 在 React 组件中使用
const counterStore = createStore({ count: 0 });

function Counter() {
  const state = useSyncExternalStore(
    counterStore.subscribe,
    counterStore.getState
  );

  return <div>{state.count}</div>;
}
```

注意一个关键约束：`getSnapshot` 的返回值必须满足引用稳定性要求。如果每次调用都返回一个新对象，即使内容相同，也会触发无限重渲染。这正是许多状态管理库内部使用 selector + shallow comparison 的原因。

## 16.2 Redux Toolkit 与 React 19 的协作模式

### 16.2.1 Redux 的核心模型

在深入 Redux Toolkit 之前，让我们回到 Redux 最原始的核心——`createStore`。整个 Redux 的核心实现只有不到 100 行：

```typescript
// redux/src/createStore.ts（简化版，保留核心逻辑）
function createStore<S, A extends Action>(
  reducer: Reducer<S, A>,
  preloadedState?: S,
  enhancer?: StoreEnhancer
): Store<S, A> {
  // enhancer 是一个高阶函数，用于扩展 createStore 的能力
  if (typeof enhancer !== 'undefined') {
    return enhancer(createStore)(reducer, preloadedState);
  }

  let currentReducer = reducer;
  let currentState = preloadedState as S;
  let currentListeners: (() => void)[] | null = [];
  let nextListeners = currentListeners;
  let isDispatching = false;

  function getState(): S {
    if (isDispatching) {
      throw new Error('不能在 reducer 执行过程中调用 getState');
    }
    return currentState;
  }

  function subscribe(listener: () => void): () => void {
    if (isDispatching) {
      throw new Error('不能在 reducer 执行过程中调用 subscribe');
    }

    let isSubscribed = true;

    // 关键设计：写时复制（Copy-on-Write）
    ensureCanMutateNextListeners();
    nextListeners.push(listener);

    return function unsubscribe() {
      if (!isSubscribed) return;
      isSubscribed = false;
      ensureCanMutateNextListeners();
      const index = nextListeners.indexOf(listener);
      nextListeners.splice(index, 1);
      currentListeners = null;
    };
  }

  function dispatch(action: A): A {
    if (isDispatching) {
      throw new Error('Reducer 不允许 dispatch');
    }

    try {
      isDispatching = true;
      currentState = currentReducer(currentState, action);
    } finally {
      isDispatching = false;
    }

    // 通知所有监听者
    const listeners = (currentListeners = nextListeners);
    for (let i = 0; i < listeners.length; i++) {
      listeners[i]();
    }

    return action;
  }

  // 初始化：通过一个特殊 action 让 reducer 返回初始状态
  dispatch({ type: '@@redux/INIT' } as any);

  return { dispatch, subscribe, getState };
}
```

仔细观察 `subscribe` 的实现——它使用了**写时复制（Copy-on-Write）**模式。`nextListeners` 和 `currentListeners` 是两个独立的数组，只有当需要修改时才会创建副本。这个设计确保了在 `dispatch` 触发通知的过程中，即使有新的 subscribe/unsubscribe 操作，也不会影响当前正在遍历的监听者列表。

### 16.2.2 中间件链：compose 与 applyMiddleware

Redux 中间件是其最优雅的设计之一。理解中间件链的关键在于理解两个函数：`compose` 和 `applyMiddleware`。

```typescript
// compose：从右到左组合函数
// compose(f, g, h) 等价于 (...args) => f(g(h(...args)))
function compose(...funcs: Function[]): Function {
  if (funcs.length === 0) {
    return <T>(arg: T) => arg;
  }
  if (funcs.length === 1) {
    return funcs[0];
  }
  return funcs.reduce(
    (a, b) =>
      (...args: any) =>
        a(b(...args))
  );
}
```

`compose` 的实现只有一行核心代码，但它是理解中间件链的关键。让我们看看 `applyMiddleware` 如何使用它：

```typescript
function applyMiddleware(
  ...middlewares: Middleware[]
): StoreEnhancer {
  return (createStore) => (reducer, preloadedState) => {
    const store = createStore(reducer, preloadedState);

    let dispatch: Dispatch = () => {
      throw new Error('不允许在中间件构建过程中 dispatch');
    };

    // middlewareAPI 是每个中间件接收的参数
    const middlewareAPI: MiddlewareAPI = {
      getState: store.getState,
      dispatch: (action, ...args) => dispatch(action, ...args),
    };

    // 第一步：让每个中间件访问 store API
    const chain = middlewares.map(middleware => middleware(middlewareAPI));

    // 第二步：通过 compose 将中间件串联成一条链
    dispatch = compose(...chain)(store.dispatch);

    return {
      ...store,
      dispatch,
    };
  };
}
```

这里有一个精妙的设计：`middlewareAPI.dispatch` 使用了闭包引用，而不是直接引用 `store.dispatch`。这意味着中间件通过 `middlewareAPI` 调用 `dispatch` 时，调用的是经过整个中间件链增强后的 `dispatch`。这个"自引用"的设计是 `redux-thunk` 等异步中间件能够工作的基础。

让我们用一个具体例子展开中间件链的执行过程：

```typescript
// 一个典型的中间件签名
// middleware: (api) => (next) => (action) => result
const logger: Middleware = (api) => (next) => (action) => {
  console.log('dispatching', action);
  const result = next(action);
  console.log('next state', api.getState());
  return result;
};

const thunk: Middleware = (api) => (next) => (action) => {
  if (typeof action === 'function') {
    return action(api.dispatch, api.getState);
  }
  return next(action);
};

// applyMiddleware(thunk, logger) 的执行链：
// dispatch(action)
//   → thunk(action)  — 如果 action 是函数，调用它
//     → logger(action) — 打印日志
//       → store.dispatch(action) — 实际的 reducer 执行
```

这是一个经典的**洋葱模型**：请求（action）从外层中间件进入，一层层传递到核心（store.dispatch），然后结果从内层一层层返回到外层。每个中间件都可以在 `next(action)` 前后执行自己的逻辑。

### 16.2.3 Redux Toolkit 的 createSlice

Redux Toolkit 是 Redux 官方推荐的工具集，其核心 API `createSlice` 通过 Immer 实现了"可变式写法的不可变更新"：

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface CounterState {
  value: number;
  history: number[];
}

const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0, history: [] } as CounterState,
  reducers: {
    // 看起来是在直接修改状态——但 Immer 在背后创建了不可变副本
    increment(state) {
      state.value += 1;
      state.history.push(state.value);
    },
    decrement(state) {
      state.value -= 1;
      state.history.push(state.value);
    },
    incrementByAmount(state, action: PayloadAction<number>) {
      state.value += action.payload;
      state.history.push(state.value);
    },
  },
});
```

`createSlice` 内部对每个 reducer 函数用 `createReducer` 包装，而 `createReducer` 使用了 Immer 的 `produce`：

```typescript
// @reduxjs/toolkit 内部简化实现
function createReducer<S>(
  initialState: S,
  builderCallback: (builder: ActionReducerMapBuilder<S>) => void
): Reducer<S> {
  // ...构建 action -> reducer 的映射
  const actionsMap = buildActionsMap(builderCallback);

  return function reducer(state = initialState, action: Action): S {
    const caseReducer = actionsMap[action.type];
    if (!caseReducer) return state;

    // 使用 Immer 的 produce 包装
    return produce(state, (draft) => {
      return caseReducer(draft, action);
    });
  };
}
```

Immer 的核心是 **Proxy** 拦截：它创建一个原始对象的代理（draft），记录所有对代理的修改操作，然后基于这些修改创建一个新的不可变对象。这让开发者可以用直觉的"可变"语法编写实际上不可变的更新逻辑。

### 16.2.4 react-redux 的 useSelector 与并发安全

`react-redux` v8+ 底层正是基于 `useSyncExternalStore` 实现的。`useSelector` 的核心逻辑如下：

```typescript
// react-redux/src/hooks/useSelector.ts（简化版）
function useSelector<TState, TSelected>(
  selector: (state: TState) => TSelected,
  equalityFn: EqualityFn<TSelected> = refEquality
): TSelected {
  const store = useReduxStore();

  const selectedState = useSyncExternalStore(
    // subscribe：订阅 Redux store
    store.subscribe,
    // getSnapshot：通过 selector 获取派生状态
    () => selector(store.getState()),
    // getServerSnapshot：SSR 场景
    () => selector(store.getState())
  );

  return selectedState;
}
```

但实际实现比这复杂得多。核心问题在于 `getSnapshot` 每次调用都会执行 `selector(store.getState())`，如果 selector 返回一个新的引用（如数组 filter、对象解构），会导致无限循环。`react-redux` 通过 `useRef` 缓存上一次的 selector 结果和输入来解决这个问题：

```typescript
// react-redux 的实际实现（简化）
function useSelectorWithStore<TState, TSelected>(
  selector: (state: TState) => TSelected,
  equalityFn: EqualityFn<TSelected>,
  store: Store<TState>
): TSelected {
  const lastSnapshot = useRef<TState>();
  const lastSelection = useRef<TSelected>();
  const lastSelector = useRef<typeof selector>();

  let selection: TSelected;

  const currentSnapshot = store.getState();

  if (
    selector !== lastSelector.current ||
    currentSnapshot !== lastSnapshot.current
  ) {
    const newSelection = selector(currentSnapshot);
    if (
      lastSelection.current !== undefined &&
      equalityFn(newSelection, lastSelection.current)
    ) {
      // 引用不同但值相等：复用旧引用，避免不必要的重渲染
      selection = lastSelection.current;
    } else {
      selection = newSelection;
    }
  } else {
    selection = lastSelection.current!;
  }

  // 更新缓存
  useEffect(() => {
    lastSnapshot.current = currentSnapshot;
    lastSelection.current = selection;
    lastSelector.current = selector;
  });

  return useSyncExternalStore(
    store.subscribe,
    () => selection
  );
}
```

这段代码体现了一个重要的工程原则：**在框架的边界层，性能优化的代码量往往远超核心逻辑**。`useSelector` 的核心功能只需要三行代码，但引用稳定性的处理却需要数十行。

## 16.3 Zustand 的极简设计哲学

### 16.3.1 create() 的完整实现

如果说 Redux 是状态管理的"Java"——完整、规范、充满仪式感，那么 Zustand 就是状态管理的"Python"——极简、直觉、几乎零配置。Zustand 的核心实现 `createStore` 只有约 50 行代码：

```typescript
// zustand/src/vanilla.ts（完整核心实现）
type SetStateInternal<T> = {
  (
    partial: T | Partial<T> | ((state: T) => T | Partial<T>),
    replace?: boolean
  ): void;
};

interface StoreApi<T> {
  setState: SetStateInternal<T>;
  getState: () => T;
  getInitialState: () => T;
  subscribe: (listener: (state: T, prevState: T) => void) => () => void;
}

function createStore<T>(
  createState: (
    setState: StoreApi<T>['setState'],
    getState: StoreApi<T>['getState'],
    store: StoreApi<T>
  ) => T
): StoreApi<T> {
  let state: T;
  const listeners = new Set<(state: T, prevState: T) => void>();

  const setState: SetStateInternal<T> = (partial, replace) => {
    const nextState =
      typeof partial === 'function'
        ? (partial as (state: T) => T)(state)
        : partial;

    // Object.is 比较：只有引用变化才触发更新
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state =
        replace ?? (typeof nextState !== 'object' || nextState === null)
          ? (nextState as T)
          : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };

  const getState: StoreApi<T>['getState'] = () => state;

  const getInitialState: StoreApi<T>['getInitialState'] = () => initialState;

  const subscribe: StoreApi<T>['subscribe'] = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const api = { setState, getState, getInitialState, subscribe };

  // 调用用户的 createState 函数来创建初始状态
  const initialState = (state = createState(setState, getState, api));

  return api;
}
```

对比 Redux 的 `createStore`，Zustand 做了几个关键的设计选择：

1. **没有 reducer 概念**。状态更新通过 `setState` 直接进行，可以传入部分状态或更新函数。这消除了 action type 字符串和 switch/case 的仪式感。

2. **没有 dispatch 概念**。action 就是普通的函数调用，不需要序列化的 action 对象。这让异步操作变得自然。

3. **自动合并（shallow merge）**。`Object.assign({}, state, nextState)` 实现了浅合并，类似 React Class 组件的 `setState`。开发者不需要手动展开整个状态对象。

4. **listener 接收新旧状态**。`listener(state, previousState)` 传递两个参数，让订阅者可以做精确的比较和派生。

### 16.3.2 React 绑定层：useStore 的实现

Zustand 的 React 绑定层同样精简，核心是通过 `useSyncExternalStore` 连接 vanilla store 和 React：

```typescript
// zustand/src/react.ts（简化版）
import { useSyncExternalStore } from 'react';

type ExtractState<S> = S extends { getState: () => infer T } ? T : never;

function useStore<S extends StoreApi<unknown>, U>(
  api: S,
  selector: (state: ExtractState<S>) => U = api.getState as any,
  equalityFn?: (a: U, b: U) => boolean
): U {
  const slice = useSyncExternalStore(
    api.subscribe,
    () => selector(api.getState() as ExtractState<S>),
    () => selector(api.getInitialState() as ExtractState<S>)
  );

  return slice;
}

// 用户侧的 create API
function create<T>(createState: StateCreator<T>) {
  const api = createStore(createState);

  // 返回一个自带 selector 功能的 Hook
  const useBoundStore = <U>(
    selector?: (state: T) => U
  ) => useStore(api, selector);

  // 将 store API 方法直接暴露在 Hook 函数上
  Object.assign(useBoundStore, api);

  return useBoundStore;
}
```

这就是为什么 Zustand 的用法如此简洁：

```typescript
// 定义 store
const useCounterStore = create<{
  count: number;
  increment: () => void;
  decrement: () => void;
}>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
}));

// 在组件中使用——selector 确保只在 count 变化时重渲染
function Counter() {
  const count = useCounterStore((state) => state.count);
  const increment = useCounterStore((state) => state.increment);

  return <button onClick={increment}>{count}</button>;
}

// 在 React 之外使用——Zustand 的 store 是框架无关的
useCounterStore.getState().increment();
```

### 16.3.3 中间件系统：函数组合的力量

Zustand 的中间件不是通过专门的 API 注册的，而是通过**高阶函数的嵌套组合**实现的。每个中间件本质上是一个接收 `createState` 函数并返回增强版 `createState` 的函数：

```typescript
// Zustand 中间件的类型签名
type StateCreator<T> = (
  setState: StoreApi<T>['setState'],
  getState: StoreApi<T>['getState'],
  store: StoreApi<T>
) => T;

type Middleware<T> = (
  createState: StateCreator<T>
) => StateCreator<T>;
```

以 `devtools` 中间件为例：

```typescript
// zustand/middleware/devtools（简化版）
const devtools = <T>(
  createState: StateCreator<T>,
  options?: { name?: string }
): StateCreator<T> => (set, get, api) => {
  const devtoolsExtension = window.__REDUX_DEVTOOLS_EXTENSION__;
  if (!devtoolsExtension) return createState(set, get, api);

  const devtools = devtoolsExtension.connect({
    name: options?.name || 'Zustand Store',
  });

  // 增强 setState：每次状态更新都通知 DevTools
  const enhancedSet: typeof set = (...args) => {
    set(...args);
    devtools.send(
      { type: args[1] ? 'setState(replace)' : 'setState' },
      get()
    );
  };

  devtools.init(get());

  return createState(enhancedSet, get, {
    ...api,
    setState: enhancedSet,
  });
};

// 使用方式：中间件通过函数嵌套组合
const useStore = create(
  devtools(
    persist(
      (set) => ({
        count: 0,
        increment: () => set((s) => ({ count: s.count + 1 })),
      }),
      { name: 'counter-storage' }
    ),
    { name: 'Counter' }
  )
);
```

对比 Redux 用 `applyMiddleware` + `compose` 实现的中间件链，Zustand 的方式更加直觉——就是函数嵌套。但两者的底层原理是相同的：**通过拦截和增强 `setState`（对应 Redux 的 `dispatch`）来注入横切关注点**。

> 🔥 **深度洞察：Zustand 的"极简"不是"简陋"**
>
> Zustand 的代码量只有 Redux 的十分之一，但它的表达力并不逊色。这得益于两个设计决策：第一，将 actions 定义在 state 中而不是分离成 reducer + action creator，消除了大量模板代码；第二，利用 JavaScript 闭包的天然能力替代了 Redux 的中间件注册机制。Zustand 证明了一个深刻的工程哲理：**最好的抽象不是增加新概念，而是移除不必要的概念**。

### 16.3.4 Zustand 的 selector 性能优化

在大型应用中，selector 的性能至关重要。Zustand 提供了 `shallow` 比较函数来避免不必要的重渲染：

```typescript
import { shallow } from 'zustand/shallow';

interface AppState {
  user: User;
  todos: Todo[];
  filter: string;
  setFilter: (filter: string) => void;
}

// 不推荐：每次渲染都返回新的对象引用
function BadComponent() {
  // ❌ 解构会创建新对象，导致每次外部状态变化都重渲染
  const { user, todos } = useAppStore();
  return <div>...</div>;
}

// 推荐方式一：单独选择每个值
function GoodComponent() {
  const user = useAppStore((state) => state.user);
  const todos = useAppStore((state) => state.todos);
  return <div>...</div>;
}

// 推荐方式二：使用 shallow 比较
function BetterComponent() {
  const { user, todos } = useAppStore(
    (state) => ({ user: state.user, todos: state.todos }),
    shallow  // 浅比较：逐个对比对象的每个属性
  );
  return <div>...</div>;
}
```

`shallow` 函数的实现揭示了它的比较策略：

```typescript
// zustand/shallow
function shallow<T>(objA: T, objB: T): boolean {
  if (Object.is(objA, objB)) return true;
  if (
    typeof objA !== 'object' || objA === null ||
    typeof objB !== 'object' || objB === null
  ) {
    return false;
  }

  if (objA instanceof Map && objB instanceof Map) {
    if (objA.size !== objB.size) return false;
    for (const [key, value] of objA) {
      if (!Object.is(value, objB.get(key))) return false;
    }
    return true;
  }

  if (objA instanceof Set && objB instanceof Set) {
    if (objA.size !== objB.size) return false;
    for (const value of objA) {
      if (!objB.has(value)) return false;
    }
    return true;
  }

  const keysA = Object.keys(objA);
  if (keysA.length !== Object.keys(objB).length) return false;

  for (const key of keysA) {
    if (
      !Object.prototype.hasOwnProperty.call(objB, key) ||
      !Object.is((objA as any)[key], (objB as any)[key])
    ) {
      return false;
    }
  }
  return true;
}
```

## 16.4 Jotai 与原子化状态管理

### 16.4.1 原子化的设计哲学

Zustand 和 Redux 都是"自顶向下"的状态管理——先定义一个全局 store，然后通过 selector 从中提取需要的部分。Jotai 的设计哲学完全相反：它是"自底向上"的，从最小的原子状态单元出发，通过组合构建复杂的状态图。

这种差异可以用一个类比来理解：**Redux/Zustand 像是关系型数据库——先设计表结构，再查询需要的列；Jotai 像是图数据库——先定义节点，再通过关系连接它们。**

```typescript
import { atom, useAtom, useAtomValue } from 'jotai';

// 定义原子：每个原子是一个独立的状态单元
const countAtom = atom(0);
const doubledAtom = atom((get) => get(countAtom) * 2);
const nameAtom = atom('React');

// 派生原子：依赖其他原子，形成依赖图
const summaryAtom = atom((get) => {
  const count = get(countAtom);
  const name = get(nameAtom);
  return `${name}: ${count}`;
});

// 可写派生原子
const incrementAtom = atom(
  null, // 读取函数为 null，表示这不是一个可读原子
  (get, set) => {
    set(countAtom, get(countAtom) + 1);
  }
);
```

### 16.4.2 atom() 的内部实现

Jotai 的 `atom` 函数出奇地简单——它只是创建了一个配置对象，不持有任何状态：

```typescript
// jotai/src/vanilla/atom.ts（简化版）
let keyCount = 0;

function atom<Value, Args extends unknown[], Result>(
  read: Value | ((get: Getter) => Value),
  write?: (...args: [Getter, Setter, ...Args]) => Result
): Atom<Value> {
  const key = `atom${++keyCount}`;

  const config = {
    // 唯一标识
    toString: () => key,
  } as WritableAtom<Value, Args, Result>;

  if (typeof read === 'function') {
    // 派生原子：read 是一个函数
    config.read = read as (get: Getter) => Value;
  } else {
    // 原始原子：read 是一个初始值
    config.init = read;
    config.read = defaultRead;    // (get) => get(config)
    config.write = defaultWrite;  // (get, set, arg) => set(config, typeof arg === 'function' ? arg(get(config)) : arg)
  }

  if (write) {
    config.write = write;
  }

  return config;
}
```

关键洞察：**atom 只是一个配置描述符，不是一个状态容器**。真正持有状态的是 Jotai 的 Store。这个设计使得同一个 atom 配置可以在不同的 Store 中拥有不同的值——实现了状态的"模板化"。

### 16.4.3 Store：原子依赖图的管理中枢

Jotai 的 Store 是整个库最复杂的部分。它维护了一个**原子到状态值的映射**以及**原子之间的依赖关系图**：

```typescript
// jotai/src/vanilla/store.ts（核心结构简化版）
type AtomState<Value = unknown> = {
  // 依赖关系
  dependencies: Map<AnyAtom, number>;  // atom -> 版本号
  dependents: Set<AnyAtom>;            // 依赖这个原子的其他原子

  // 状态
  value?: Value;
  error?: unknown;

  // 版本号：用于检测变化
  epochNumber: number;
};

function createStore(): Store {
  const atomStateMap = new WeakMap<AnyAtom, AtomState>();
  const mountedAtoms = new Set<AnyAtom>();
  const pendingListeners = new Set<() => void>();

  function getAtomState<V>(atom: Atom<V>): AtomState<V> {
    let atomState = atomStateMap.get(atom) as AtomState<V> | undefined;
    if (!atomState) {
      atomState = {
        dependencies: new Map(),
        dependents: new Set(),
        epochNumber: 0,
      };
      atomStateMap.set(atom, atomState);
    }
    return atomState;
  }

  // 核心：读取原子值，自动建立依赖追踪
  function readAtom<V>(atom: Atom<V>): V {
    const atomState = getAtomState(atom);

    // 如果有缓存且依赖没有变化，直接返回
    if (
      'value' in atomState &&
      !isDependenciesChanged(atomState)
    ) {
      return atomState.value as V;
    }

    // 需要重新计算
    const dependencies = new Map<AnyAtom, number>();

    const getter: Getter = <T>(depAtom: Atom<T>): T => {
      // 递归读取依赖的原子
      const depValue = readAtom(depAtom);
      const depState = getAtomState(depAtom);

      // 记录依赖关系
      dependencies.set(depAtom, depState.epochNumber);
      depState.dependents.add(atom);

      return depValue;
    };

    let value: V;
    if (atom.read === defaultRead) {
      // 原始原子：直接返回存储的值
      value = ('value' in atomState ? atomState.value : atom.init) as V;
    } else {
      // 派生原子：执行 read 函数
      value = atom.read(getter);
    }

    // 更新依赖关系和缓存
    atomState.dependencies = dependencies;
    atomState.value = value;

    return value;
  }

  // 核心：写入原子值，触发依赖更新
  function writeAtom<V, Args extends unknown[], Result>(
    atom: WritableAtom<V, Args, Result>,
    ...args: Args
  ): Result {
    const getter: Getter = <T>(a: Atom<T>) => readAtom(a);

    const setter: Setter = <T, A extends unknown[], R>(
      targetAtom: WritableAtom<T, A, R>,
      ...setArgs: A
    ): R => {
      if (targetAtom.write === defaultWrite) {
        // 原始原子的写入
        const atomState = getAtomState(targetAtom);
        const prevValue = atomState.value;
        const nextValue =
          typeof setArgs[0] === 'function'
            ? (setArgs[0] as Function)(prevValue)
            : setArgs[0];

        if (!Object.is(prevValue, nextValue)) {
          atomState.value = nextValue;
          atomState.epochNumber++;

          // 关键：通知所有依赖此原子的派生原子
          propagateUpdate(targetAtom);
        }
        return undefined as R;
      }
      // 可写派生原子：递归调用其 write 函数
      return targetAtom.write(getter, setter, ...setArgs);
    };

    return atom.write(getter, setter, ...args);
  }

  // 依赖传播：当一个原子更新时，通知其所有下游依赖
  function propagateUpdate(atom: AnyAtom): void {
    const atomState = getAtomState(atom);

    // 广度优先遍历所有依赖者
    const visited = new Set<AnyAtom>();
    const queue: AnyAtom[] = [atom];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const currentState = getAtomState(current);
      for (const dependent of currentState.dependents) {
        const depState = getAtomState(dependent);
        // 标记为需要重新计算
        depState.epochNumber++;
        queue.push(dependent);
      }
    }

    // 通知所有挂载的订阅者
    flushPendingListeners();
  }

  // ...subscribe, mount, unmount 等方法

  return { get: readAtom, set: writeAtom, sub: subscribe };
}
```

这段代码展示了 Jotai 最核心的设计：**基于依赖图的惰性求值**。当一个原始原子的值发生变化时，Jotai 不会立即重新计算所有派生原子，而是通过 `epochNumber` 标记哪些原子"可能过期"了。只有当某个原子被真正读取时，才会检查其依赖的版本号，决定是否需要重新计算。

这与 Vue 的响应式系统有异曲同工之妙，但实现路径完全不同——Vue 使用 Proxy 自动追踪依赖，Jotai 使用显式的 `get()` 调用追踪依赖。

### 16.4.4 useAtom 的 React 集成

Jotai 的 `useAtom` Hook 也是基于 `useSyncExternalStore` 构建的：

```typescript
// jotai/src/react/useAtom.ts（简化版）
function useAtomValue<V>(atom: Atom<V>): V {
  const store = useStore();

  const getSnapshot = useCallback(
    () => store.get(atom),
    [store, atom]
  );

  const subscribe = useCallback(
    (callback: () => void) => store.sub(atom, callback),
    [store, atom]
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useSetAtom<V, A extends unknown[], R>(
  atom: WritableAtom<V, A, R>
): (...args: A) => R {
  const store = useStore();

  return useCallback(
    (...args: A) => store.set(atom, ...args),
    [store, atom]
  );
}

function useAtom<V, A extends unknown[], R>(
  atom: WritableAtom<V, A, R>
): [V, (...args: A) => R] {
  return [useAtomValue(atom), useSetAtom(atom)];
}
```

注意 Jotai 的订阅粒度：**每个 atom 都有独立的订阅**。当 `countAtom` 更新时，只有使用了 `countAtom` 或依赖 `countAtom` 的派生原子的组件会重渲染。这种细粒度的订阅模型是 Jotai 性能优势的根本来源。

### 16.4.5 原子化模式的威力：异步原子与原子家族

Jotai 的原子化设计使得复杂模式的实现变得自然而优雅：

```typescript
// 异步原子：天然支持 Suspense
const userAtom = atom(async (get) => {
  const id = get(userIdAtom);
  const response = await fetch(`/api/users/${id}`);
  return response.json();
});

// 在组件中使用时自动触发 Suspense
function UserProfile() {
  // 如果 Promise 还在 pending，触发最近的 Suspense 边界
  const user = useAtomValue(userAtom);
  return <div>{user.name}</div>;
}

// 原子家族（atomFamily）：参数化的原子工厂
function atomFamily<Param, Value>(
  initializeAtom: (param: Param) => Atom<Value>,
  areEqual?: (a: Param, b: Param) => boolean
) {
  const atoms = new Map<string, Atom<Value>>();

  return (param: Param): Atom<Value> => {
    const key = JSON.stringify(param);
    if (!atoms.has(key)) {
      atoms.set(key, initializeAtom(param));
    }
    return atoms.get(key)!;
  };
}

// 使用原子家族管理列表中每个项目的状态
const todoAtomFamily = atomFamily((id: string) =>
  atom({ id, text: '', completed: false })
);

const todoIdsAtom = atom<string[]>([]);

function TodoItem({ id }: { id: string }) {
  const [todo, setTodo] = useAtom(todoAtomFamily(id));
  // 只有这个 todo 变化时，这个组件才重渲染
  return (
    <div>
      <input
        value={todo.text}
        onChange={(e) =>
          setTodo((prev) => ({ ...prev, text: e.target.value }))
        }
      />
    </div>
  );
}
```

> 🔥 **深度洞察：原子化是 React 状态管理的终极形态吗？**
>
> Jotai 的原子化模型与 React 自身的组件模型形成了完美的镜像——组件是 UI 的原子，atom 是状态的原子。这种对称性使得状态的拆分粒度可以精确匹配组件的拆分粒度，从根本上消除了"状态在哪一层管理"的困扰。但原子化也有代价：当原子数量膨胀到数百甚至上千时，依赖图的调试和可视化变成了新的挑战。工程中没有银弹，只有对问题域的深刻理解所导向的最优权衡。

## 16.5 选型决策框架

### 16.5.1 三个维度的评估模型

选择状态管理库不是一个技术问题，而是一个**工程决策问题**。技术问题有正确答案，工程决策只有在特定约束下的最优解。以下是一个基于三个维度的评估框架：

**维度一：状态拓扑（State Topology）**

```
单一全局状态（Redux/Zustand）
├── 优势：状态快照可序列化、时间旅行调试、SSR 水合简单
├── 代价：单一 store 可能成为性能瓶颈、需要 selector 优化
└── 适合：业务逻辑重、需要全局一致性的应用（电商、SaaS 后台）

原子化分散状态（Jotai）
├── 优势：天然细粒度更新、组件级状态隔离、Suspense 原生集成
├── 代价：全局快照难以获取、调试工具不如 Redux 成熟
└── 适合：交互密集、状态局部性强的应用（编辑器、可视化工具）

组件树状态（Context + useReducer）
├── 优势：零依赖、与 React 生命周期深度绑定
├── 代价：性能问题、缺乏中间件和 DevTools
└── 适合：小型应用或状态只需在局部子树共享的场景
```

**维度二：团队认知成本**

| 方案 | 核心概念数 | 学习曲线 | 模板代码量 |
|------|-----------|---------|-----------|
| Context + useReducer | 2 | 低 | 中 |
| Redux Toolkit | 5（store, slice, reducer, action, selector） | 中高 | 低（RTK 大幅降低） |
| Zustand | 2（store, selector） | 低 | 极低 |
| Jotai | 3（atom, derived atom, store） | 中 | 低 |

**维度三：运行时性能特征**

```typescript
// 基准测试场景：1000 个组件，每个订阅不同的状态切片

// Redux：一次 dispatch 触发 1000 次 selector 计算
// （但只有状态真正变化的组件会重渲染）
// 开销 = N * selector计算时间 + M * 重渲染时间
// N = 总订阅者数, M = 状态真正变化的组件数

// Zustand：与 Redux 类似（底层共享 useSyncExternalStore）
// 但没有 reducer + action 的调度开销

// Jotai：一次原子写入只通知依赖图中的下游原子
// 开销 = K * 原子重计算时间 + M * 重渲染时间
// K = 依赖子图大小（通常远小于 N）
```

### 16.5.2 决策流程图

基于上述维度，我们可以构建一个具体的决策流程：

```
应用规模如何？
├── 小型（< 10 个共享状态）
│   └── ✅ Context + useReducer（无需额外依赖）
│
├── 中型（10-50 个共享状态）
│   ├── 需要 DevTools 和时间旅行？
│   │   ├── 是 → ✅ Redux Toolkit
│   │   └── 否 → ✅ Zustand
│   └── 状态之间有复杂的派生关系？
│       ├── 是 → ✅ Jotai
│       └── 否 → ✅ Zustand
│
└── 大型（50+ 共享状态）
    ├── 团队已有 Redux 经验？
    │   ├── 是 → ✅ Redux Toolkit（生态完善、规范统一）
    │   └── 否 → 评估 Zustand（迁移成本低）或 Jotai（性能上限高）
    └── 有严格的性能要求？
        ├── 是 → ✅ Jotai（细粒度更新）
        └── 否 → ✅ Redux Toolkit 或 Zustand
```

### 16.5.3 React 19 带来的变量

React 19 的几个新特性正在改变状态管理的格局：

**1. React Compiler 削弱了手动优化的必要性**

React Compiler 自动记忆化组件和表达式，这意味着即使 Context 导致了不必要的重渲染，Compiler 也可能通过跳过没有变化的子树来消除性能影响。在 Compiler 完全普及后，Context 的性能问题将大大缓解。

**2. use() Hook 改变了异步状态的消费模式**

```typescript
// 传统方式：需要状态管理库处理异步
const useUser = () => {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetchUser().then(setUser);
  }, []);
  return user;
};

// React 19 方式：use + Suspense
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise);
  return <div>{user.name}</div>;
}
```

这降低了"异步状态管理"这个维度对第三方库的依赖。

**3. Server Components 重新定义了"状态的边界"**

在 RSC 架构中，服务端组件没有状态，只有客户端组件需要状态管理。这意味着全局 store 的范围缩小了——很多之前放在全局状态中的数据（如用户信息、权限配置），现在可以作为服务端组件的 props 直接传递。

```typescript
// Server Component：不需要状态管理
async function DashboardPage() {
  const user = await getUser();         // 服务端直接获取
  const config = await getAppConfig();  // 服务端直接获取

  return (
    <Dashboard user={user} config={config}>
      {/* 只有交互状态需要客户端状态管理 */}
      <InteractivePanel />
    </Dashboard>
  );
}

// Client Component：只管理交互状态
'use client';
function InteractivePanel() {
  // Zustand store 只管理 UI 交互状态
  const { activeTab, setActiveTab } = useUIStore();
  return <Tabs active={activeTab} onChange={setActiveTab} />;
}
```

### 16.5.4 混合使用的实践

在大型应用中，混合使用多种状态管理方案往往是最务实的选择：

```typescript
// 层次化的状态管理策略
// Layer 1：服务端状态 → React Query / SWR / RSC
// Layer 2：全局客户端状态 → Zustand（少量，如主题、侧边栏状态）
// Layer 3：功能模块状态 → Jotai（编辑器、画布等复杂交互）
// Layer 4：组件局部状态 → useState / useReducer

// 示例：一个文档编辑器应用
// Zustand：管理应用级 UI 状态
const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  theme: 'light',
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

// Jotai：管理编辑器内部的原子化状态
const cursorPositionAtom = atom({ line: 0, column: 0 });
const selectionAtom = atom<Selection | null>(null);
const documentAtom = atom<DocumentNode>(emptyDocument);

// 派生原子：自动计算
const selectedTextAtom = atom((get) => {
  const selection = get(selectionAtom);
  const document = get(documentAtom);
  if (!selection) return '';
  return extractText(document, selection);
});

const wordCountAtom = atom((get) => {
  const doc = get(documentAtom);
  return countWords(doc);
});
```

## 16.6 本章小结

状态管理是前端工程中最容易被过度设计也最容易被低估的领域。本章从 React 内置的 Context 机制出发，剖析了它的传播机制和性能瓶颈，然后深入了 `useSyncExternalStore` 这个连接 React 并发渲染与外部状态的关键桥梁。

关键要点：

1. **Context 不是状态管理方案**：它是依赖注入机制。当 Provider value 变化时，React 必须遍历整个子树寻找消费者，这个 O(n) 的开销在大型应用中不可接受。

2. **useSyncExternalStore 是所有现代状态管理库的基石**：它通过渲染后的一致性检查解决了并发渲染下的 tearing 问题，所有主流库（Redux、Zustand、Jotai）都在底层依赖它。

3. **Redux 的力量在于约束**：reducer 的纯函数约束使得状态变更可预测、可追踪、可回放。中间件的洋葱模型提供了强大的横切关注点注入能力。

4. **Zustand 证明了"少即是多"**：通过消除 action type、reducer、dispatch 等概念，用 JavaScript 原生的闭包和函数组合替代框架层面的抽象，实现了最低的认知开销。

5. **Jotai 的原子化模型提供了最优的更新粒度**：基于依赖图的惰性求值和精确的订阅传播，使得大规模状态图下的性能表现远优于全局 store 方案。

6. **没有"最好的"状态管理库，只有"最适合的"**：选型是一个多维约束优化问题，需要综合考虑状态拓扑、团队认知、性能需求和 React 版本演进趋势。

在下一章中，我们将转向 React 应用的性能工程——不是理论上的优化技巧，而是从 Profiler API、Chrome Performance 面板到生产环境监控的完整性能工具链。理解了状态管理的内核之后，你将能够精确地定位性能瓶颈出现在状态层、渲染层还是 DOM 层。

> **课程关联**：本章内容涉及的 React 并发渲染基础和 Hooks 内核知识，对应慕课网课程《React 源码深度解析》的核心部分。建议先完成课程中关于 Fiber 架构和 Hooks 系统的章节，再回顾本章对外部状态管理库的分析：[https://coding.imooc.com/class/650.html](https://coding.imooc.com/class/650.html)

---

### 思考题

1. **useSyncExternalStore 的一致性检查在什么情况下会失败，导致同步重渲染？** 构造一个具体场景：一个 Zustand store 在并发渲染的 render 阶段被外部事件修改，描述从检测到不一致到同步重渲染完成的完整流程。这个"降级到同步渲染"的策略对用户体验有什么影响？

2. **Zustand 的 `setState` 使用 `Object.assign` 进行浅合并，而 Redux 要求 reducer 返回全新的状态对象。** 分析这两种策略在嵌套状态更新场景下的行为差异。如果 Zustand 的状态中有一个三层嵌套的对象 `state.a.b.c`，直接调用 `set({ a: { b: { c: newValue } } })` 会发生什么？为什么 Immer 在这种场景下比手动展开更安全？

3. **Jotai 的派生原子使用"惰性求值 + 版本号检查"来避免不必要的重计算，而 Vue 的 computed 使用"脏标记 + 缓存"策略。** 对比这两种实现的时间复杂度和空间复杂度。在一个拥有 1000 个原子、依赖图深度为 10 的场景下，当根原子更新时，两种策略各自需要多少次计算？

4. **React Compiler 的自动记忆化是否会使 Context 的性能问题消失，从而减少对第三方状态管理库的需求？** 从 React Compiler 的静态分析能力出发，分析它能否优化 `useContext` 返回值变化导致的子组件重渲染。如果 Compiler 无法完全解决这个问题，根本原因是什么？

</div>