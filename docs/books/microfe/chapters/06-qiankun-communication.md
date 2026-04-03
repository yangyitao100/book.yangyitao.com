<div v-pre>

# 第6章 乾坤的应用间通信

> "微前端架构中，沙箱隔离的目的是让应用互不干扰——但业务永远需要它们彼此对话。如何在隔离与协作之间找到精确的平衡点，是每个微前端方案必须回答的核心问题。"

> **本章要点**
> - 深入 `initGlobalState` 源码，理解乾坤基于发布订阅模式实现全局状态通信的完整机制
> - 掌握 Props 传递的实现原理，理解主应用与子应用之间直接通信的数据流向
> - 剖析 `loadMicroApp` 手动加载模式下通信的差异与适用场景
> - 对比 CustomEvent、BroadcastChannel、共享 Store 等替代方案，在性能与复杂度之间做出理性权衡

---

微前端的沙箱机制——无论是 `SnapshotSandbox` 还是 `ProxySandbox`——都在做一件事：**隔离**。它们用精心设计的代理拦截和快照恢复，确保子应用之间的全局变量不会互相污染。前几章我们已经深入理解了这些隔离机制的实现原理。

但隔离只是硬币的一面。

回到现实业务场景：用户在主应用的导航栏点击头像，弹出个人信息面板——这个面板属于"用户中心"子应用。用户修改了头像，主应用的导航栏需要立即更新。与此同时，"消息中心"子应用也需要知道头像变了，因为它在消息列表里展示了用户头像。

三个独立部署的应用，需要在同一个浏览器窗口中**实时同步**一份数据。沙箱把它们隔开了，但业务又要求它们协作。这就像你精心设计了一栋公寓——每户都有独立的门锁和隔音墙——然后住户们说："我们需要一个公共公告板。"

乾坤对此的回答是三种通信机制：全局状态（`initGlobalState`）、Props 传递、以及 `loadMicroApp` 的手动加载模式。它们各自适用于不同场景，背后的实现原理也截然不同。这一章，我们将逐行阅读这些机制的源码，理解它们的设计意图，然后跳出乾坤本身，对比更广泛的微前端通信方案——因为只有理解了全部选项，你才能为自己的项目做出正确的架构决策。

## 6.1 initGlobalState：基于发布订阅的全局状态

### 6.1.1 从使用方式开始

先看 `initGlobalState` 的典型使用方式，带着"它要解决什么问题"的思维去阅读实现代码。

```typescript
// 主应用 - main-app/src/micro.ts
import { initGlobalState, MicroAppStateActions } from 'qiankun';

const actions: MicroAppStateActions = initGlobalState({
  user: { name: '杨艺韬', avatar: '/default.png' },
  theme: 'light',
  locale: 'zh-CN',
});

actions.onGlobalStateChange((state, prevState) => {
  console.log('主应用感知到状态变化：', state);
  updateNavbar(state.user);
});

actions.setGlobalState({
  user: { name: '杨艺韬', avatar: '/new-avatar.png' },
});
```

```typescript
// 子应用 - sub-app/src/main.ts
export function mount(props) {
  const { onGlobalStateChange, setGlobalState } = props;

  onGlobalStateChange((state, prevState) => {
    console.log('子应用感知到状态变化：', state);
    store.commit('updateUser', state.user);
  });

  setGlobalState({ theme: 'dark' });
}
```

API 很简洁——初始化一个全局状态对象，主应用和子应用都可以监听变化、修改状态。但简洁的 API 背后，隐藏着几个值得深入思考的设计决策：

1. **为什么全局状态只能由主应用初始化？** 子应用不能调用 `initGlobalState`。如果任何子应用都能初始化全局状态，状态的"起点"就变得不可预测——你永远不知道哪个子应用先加载、先初始化。
2. **子应用通过 `props` 获取通信能力，而不是直接导入。** 这意味着通信能力是由主应用"授予"的，子应用没有办法在主应用不知情的情况下参与全局通信。
3. **`setGlobalState` 是合并（merge）而非替换（replace）。** 子应用修改 `theme` 不会丢失 `user` 数据。这降低了子应用之间的协调成本——你不需要知道全局状态的完整结构就能安全地修改自己关心的部分。

带着这些问题，我们进入源码。

### 6.1.2 initGlobalState 的核心实现

乾坤的全局状态管理核心逻辑不到 100 行，但信息密度极高。

```typescript
// qiankun/src/globalState.ts

import { cloneDeep } from 'lodash';

let globalState: Record<string, any> = {};
const deps: Record<string, OnGlobalStateChangeCallback> = {};

type OnGlobalStateChangeCallback = (
  state: Record<string, any>,
  prevState: Record<string, any>
) => void;
```

第一个值得注意的设计：`globalState` 和 `deps` 都是**模块级变量**。它们不在 `window` 上，也不在任何类实例上。这意味着不受子应用沙箱的影响——`ProxySandbox` 代理的是 `window`，而不是乾坤内部的模块变量。放在模块作用域，是最简单也最安全的位置。

```typescript
// qiankun/src/globalState.ts

export function initGlobalState(state: Record<string, any> = {}) {
  if (state === globalState) {
    console.warn('[qiankun] state has not changed！');
    return getMicroAppStateActions(`global-${+new Date()}`);
  }

  const prevGlobalState = cloneDeep(globalState);
  globalState = cloneDeep(state);
  emitGlobal(globalState, prevGlobalState);
  return getMicroAppStateActions(`global-${+new Date()}`);
}
```

几个关键事实：使用 `cloneDeep` 确保外部修改不会绕过通信机制；初始化时立即触发 `emitGlobal` 通知已注册的订阅者；时间戳 `global-${+new Date()}` 用于在 `deps` 中唯一标识主应用的回调。

### 6.1.3 发布与通知：emitGlobal

```typescript
function emitGlobal(state: Record<string, any>, prevState: Record<string, any>) {
  Object.keys(deps).forEach((id: string) => {
    if (deps[id] instanceof Function) {
      deps[id](cloneDeep(state), cloneDeep(prevState));
    }
  });
}
```

一个不起眼却至关重要的细节：**每次通知都传递深拷贝**。如果传递引用，子应用的回调可以直接修改全局状态而不触发其他订阅者的通知——这是灾难性的。深拷贝确保了**只有 `setGlobalState` 才是修改全局状态的合法通道**，与 Redux 的"单一数据流"理念异曲同工。

> 🔥 **深度洞察：深拷贝的性能代价与设计取舍**
>
> `cloneDeep` 的时间复杂度是 O(n)。如果全局状态包含大型数组，每次 `emitGlobal` 会产生 N 次深拷贝（N 是订阅者数量）。对 3 个子应用这完全不是问题，但 20 个子应用加上 10000 条记录的列表，性能就可能成为瓶颈。乾坤选择"安全优先"而非"性能优先"，这是正确的默认值——但在极端场景下，你需要意识到这个代价。

### 6.1.4 MicroAppStateActions：操作句柄的生成

```typescript
export function getMicroAppStateActions(
  id: string,
  isMaster?: boolean
): MicroAppStateActions {
  return {
    onGlobalStateChange(callback: OnGlobalStateChangeCallback, fireImmediately?: boolean) {
      if (!(callback instanceof Function)) {
        console.error('[qiankun] callback must be function!');
        return;
      }
      if (deps[id]) {
        console.warn(`[qiankun] bindId: ${id} bindCallback already exists, will be overwrite.`);
      }
      deps[id] = callback;
      if (fireImmediately) {
        const cloneState = cloneDeep(globalState);
        callback(cloneState, cloneState);
      }
    },

    setGlobalState(state: Record<string, any> = {}) {
      if (state === globalState) {
        console.warn('[qiankun] state has not changed！');
        return false;
      }

      const changeKeys: string[] = [];
      const prevGlobalState = cloneDeep(globalState);

      globalState = cloneDeep(
        Object.keys(state).reduce((_globalState, changeKey) => {
          if (isMaster || _globalState.hasOwnProperty(changeKey)) {
            changeKeys.push(changeKey);
            return Object.assign(_globalState, { [changeKey]: state[changeKey] });
          }
          console.warn(
            `[qiankun] globalState does not have the key: ${changeKey}, ` +
            `it's not allowed to add new key after initGlobalState.`
          );
          return _globalState;
        }, globalState)
      );

      if (changeKeys.length === 0) {
        console.warn('[qiankun] state has not changed！');
        return false;
      }
      emitGlobal(globalState, prevGlobalState);
      return true;
    },

    offGlobalStateChange() {
      delete deps[id];
      return true;
    },
  };
}
```

`setGlobalState` 中那个 `reduce` 循环是核心——它实现了**权限分级**：

- **主应用**（`isMaster === true`）：可以添加新的顶层 key，拥有完全的状态控制权。
- **子应用**（`isMaster === false`）：只能修改**已存在**的顶层 key，不能添加新 key。

为什么要做这个限制？想象一个没有限制的世界：

```typescript
// 子应用 A 添加了一个 key
setGlobalState({ featureFlagA: true });

// 子应用 B 也添加了一个 key
setGlobalState({ featureFlagB: true });

// 子应用 C 又加了一个...
setGlobalState({ tempData: { /* 一大堆临时数据 */ } });

// 三个月后，globalState 变成了一个巨大的垃圾场
// 没人知道哪些 key 还在被使用，哪些已经是僵尸数据
```

通过限制子应用只能修改已有 key，乾坤确保了**主应用是全局状态结构的唯一定义者**。这是一种"合同制"——主应用定义了全局状态的"Schema"，子应用只能在这个 Schema 内操作。

### 6.1.5 完整的数据流

```
1. 主应用调用 initGlobalState({ user, theme, locale })
   ├── globalState = cloneDeep({ user, theme, locale })
   ├── emitGlobal(globalState, prevGlobalState)
   └── return getMicroAppStateActions('global-xxx', true)

2. 乾坤加载子应用时，在 props 中注入通信能力
   ├── const appActions = getMicroAppStateActions(appInstanceId, false)
   └── props.onGlobalStateChange / props.setGlobalState

3. 子应用调用 setGlobalState({ theme: 'dark' })
   ├── isMaster = false → 检查 'theme' 存在 → 允许修改
   ├── emitGlobal → 通知所有订阅者（每个拿到深拷贝）
   └── return true

4. 子应用卸载时 → delete deps['app-xxx']
```

### 6.1.6 initGlobalState 的局限性

```typescript
// 局限 1：只支持一层浅合并
// 子应用想改 user.preferences.theme，必须传递整个 user 对象
// 遗漏 fontSize 就会丢失——Object.assign 只做第一层合并

// 局限 2：没有选择性订阅（selector）
// 任何 key 变化，所有回调都触发

// 局限 3：没有中间件、时间旅行、DevTools
```

这些局限性不是设计缺陷——而是**有意为之的简化**。乾坤的全局状态机制定位是"轻量级的跨应用通信"，而不是"完整的状态管理"。如果你需要 Redux 级别的能力——中间件、时间旅行、selector、DevTools——应该使用独立的状态管理方案（我们会在 6.4 节讨论）。

理解一个工具的边界，和理解它的能力同样重要。当你清楚地知道 `initGlobalState` 能做什么、不能做什么，才能在项目中做出准确的技术选型，而不是在错误的场景下使用它然后抱怨它的局限。

## 6.2 Props 传递：父子应用的直接通信

### 6.2.1 Props 的注入时机

当乾坤加载子应用时，在生命周期函数中注入 `props`：

```typescript
// qiankun/src/loader.ts（简化）
export async function loadApp(app: LoadableApp, configuration, lifeCycles) {
  const { name: appName, props: userProps = {} } = app;
  // ... 加载 HTML、解析脚本 ...
  const { mount: appMount, unmount: appUnmount, update: appUpdate } =
    getLifecyclesFromExports(/* ... */);

  const parcelConfig = {
    mount: [
      async (props: any) => appMount({
        ...props,
        container: appWrapperGetter(),
        setGlobalState: actions.setGlobalState,
        onGlobalStateChange: actions.onGlobalStateChange,
      }),
    ],
    unmount: [
      async (props: any) => appUnmount({ ...props, container: appWrapperGetter() }),
    ],
    update: async (props: any) => appUpdate?.({ ...props, container: appWrapperGetter() }),
  };
  return parcelConfig;
}
```

看到了吗？子应用的 `mount` 函数接收到的 `props` 是由乾坤**组装**而成的。它包含三个来源：

1. **single-spa 注入的 props**：包含 `name`、`singleSpa` 实例等基础信息
2. **用户自定义的 props**：主应用在 `registerMicroApps` 时传入的 `props` 对象
3. **乾坤注入的通信 API**：`setGlobalState`、`onGlobalStateChange`

这种组装式的设计意味着，子应用不需要知道自己运行在乾坤环境中——它只需要按照约定的接口读取 `props`。

```typescript
registerMicroApps([{
  name: 'sub-app',
  entry: '//localhost:7100',
  container: '#subapp-container',
  activeRule: '/sub-app',
  props: {
    navigate: (path: string) => router.push(path),
    getToken: () => localStorage.getItem('token'),
    showGlobalModal: (config: ModalConfig) => modal.show(config),
    baseApiUrl: 'https://api.example.com',
    eventBus: mitt(),
  },
}]);
```

### 6.2.2 Props 与 GlobalState 的本质区别

```typescript
// GlobalState：发布-订阅模式 —— 多对多、异步通知、数据驱动
// Props：依赖注入模式 —— 一对一、同步传递、能力驱动
```

```typescript
// 用 GlobalState 传递数据（广播）
initGlobalState({ user: { id: 1001, name: '杨艺韬', role: 'admin' } });

// 用 Props 传递能力（授权）
registerMicroApps([{
  name: 'order-app',
  props: {
    navigateToProduct: (id: string) => router.push(`/product/${id}`),
    checkPermission: (action: string) => permissionService.check(currentUser, action),
    reportError: (error: Error, ctx: Record<string, any>) => sentry.captureException(error, { extra: ctx }),
  },
}]);
```

> 🔥 **深度洞察：Props 是"能力传递"，GlobalState 是"数据共享"**
>
> 如果传递的是数据，用 GlobalState；如果传递的是能力（函数、服务、实例），用 Props。不要通过 GlobalState 传递函数（深拷贝会丢失函数引用），也不要通过 Props 传递需要实时同步的数据（Props 没有响应式通知机制）。把这两者混为一谈，是微前端通信设计中最常见的反模式。

### 6.2.3 动态 Props 更新

Props 在子应用加载时传递，但业务场景中经常需要**动态更新**。在路由注册模式（`registerMicroApps`）下，Props 是**静态的**——子应用在每次 mount 时拿到的是注册时定义的 props，主应用无法在运行时更新它们。只有在 `loadMicroApp` 模式下，才能通过 `update` 方法动态更新 Props（详见 6.3 节）。

这也是很多团队选择 `loadMicroApp` 而非 `registerMicroApps` 的重要原因之一。

### 6.2.4 Props 传递的陷阱与最佳实践

```typescript
// 陷阱 1：闭包陷阱 —— Props 中的函数捕获了过时的变量
registerMicroApps([{
  name: 'sub-app',
  props: {
    getToken: () => token,  // ❌ token 是注册时的值，可能已过期
  },
}]);

// 正确做法：让函数在调用时才读取最新值
registerMicroApps([{
  name: 'sub-app',
  props: {
    getToken: () => localStorage.getItem('token'),  // ✅ 每次调用时读取
  },
}]);
```

```typescript
// 陷阱 2：引用泄露 —— Props 中传递了可变对象
const sharedConfig = { apiUrl: 'https://api.example.com' };

registerMicroApps([{
  name: 'sub-app',
  props: { config: sharedConfig },  // ❌ 子应用可能修改这个对象
}]);

// 正确做法：传递不可变数据或冻结对象
registerMicroApps([{
  name: 'sub-app',
  props: {
    config: Object.freeze({ apiUrl: 'https://api.example.com' }),  // ✅
  },
}]);
```

```typescript
// 陷阱 3：传递了不可序列化的内容
registerMicroApps([{
  name: 'sub-app',
  props: {
    domElement: document.getElementById('app'),  // ⚠️ DOM 引用
    circularRef: objWithCircularRef,              // ⚠️ 循环引用
  },
}]);
// Props 是直接传引用（不序列化），上述用法不会报错
// 但会造成子应用与主应用的紧耦合，违背微前端的独立部署原则
```

## 6.3 loadMicroApp：手动加载模式的实现

### 6.3.1 从路由驱动到手动控制

在第 3 章中我们了解到，乾坤的默认模式是**路由驱动**——通过 `registerMicroApps` 注册子应用，由 URL 变化自动触发加载和卸载。但很多实际场景不是路由驱动的：

```typescript
// 场景 1：一个页面中同时展示多个子应用（仪表盘的多个面板）
// 场景 2：弹窗中加载子应用
// 场景 3：根据用户权限动态加载管理面板
```

`loadMicroApp` 就是为这些场景设计的。它的实现与路由驱动模式共享大部分基础设施，但在通信方面有一些关键差异。

```typescript
// qiankun/src/apis.ts（简化）
export function loadMicroApp(app: LoadableApp, configuration?, lifeCycles?): MicroApp {
  const props = app.props ?? {};

  // 与 registerMicroApps 不同：使用 single-spa 的 mountRootParcel 直接挂载
  const microApp = mountRootParcel(
    () => loadApp(app, configuration, lifeCycles),
    { domElement: document.createElement('div'), ...props }
  );

  return {
    ...microApp,
    update: (updatedProps) => microApp.update?.(updatedProps),
    unmount: () => microApp.unmount(),
    getStatus: () => microApp.getStatus(),
  };
}
```

### 6.3.2 Parcel 与 Application 的通信差异

这里需要理解 single-spa 中两个核心概念的区别：

- **Application**：由路由自动管理生命周期，通过 `registerApplication` 注册。Props 在注册时确定，之后无法更新。
- **Parcel**：由开发者手动管理生命周期，通过 `mountRootParcel` 挂载。Props 可以通过 `update()` 动态更新。

`loadMicroApp` 使用的就是 Parcel 模式。它的 `update` 方法实际上会触发子应用的 `update` 生命周期：

```typescript
// 子应用需要额外导出 update 生命周期
export async function mount(props) { renderApp(props); }
export async function update(props) { rerenderApp(props); }  // 仅 loadMicroApp 模式
export async function unmount(props) { destroyApp(); }
```

### 6.3.3 loadMicroApp 的通信模式实践

```typescript
// 主应用 - React 组件中使用 loadMicroApp
function DashboardPanel({ data, onAction }: SubAppProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const microAppRef = useRef<MicroApp | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    microAppRef.current = loadMicroApp({
      name: 'dashboard-panel',
      entry: '//localhost:7101',
      container: containerRef.current,
      props: { data, onAction },
    });
    return () => { microAppRef.current?.unmount(); };
  }, []);

  useEffect(() => {
    if (microAppRef.current?.getStatus() === 'MOUNTED') {
      microAppRef.current.update({ props: { data, onAction } });
    }
  }, [data, onAction]);

  return <div ref={containerRef} />;
}
```

> 🔥 **深度洞察：loadMicroApp 让微前端回归组件化思维**
>
> `registerMicroApps` 的心智模型是"多个独立应用共享一个浏览器窗口"，`loadMicroApp` 的心智模型是"一个应用中嵌入另一个应用的组件"。前者适合页面级微前端，后者适合组件级微前端。通信方案也随之明朗——页面级用 GlobalState 广播，组件级用 Props 传递。

### 6.3.4 多实例场景的通信挑战

`loadMicroApp` 允许同一子应用加载多个实例。乾坤为每个实例生成唯一 `appInstanceId`，GlobalState 回调独立。但子应用内部的模块级变量——

```typescript
let instanceData = null;  // 模块级变量
export function mount(props) {
  instanceData = props.data;  // 第二个实例覆盖第一个实例的数据！
}
```

——就需要开发者自己处理多实例的数据隔离。乾坤的沙箱能隔离 `window` 上的全局变量，但无法隔离子应用模块内部的变量。这是一个容易被忽视的陷阱。正确做法是以容器作为作用域：

```typescript
export function mount(props) {
  const { container } = props;
  const app = createApp(App);
  app.mount(container.querySelector('#app'));
  container.__vue_app__ = app;
}
export function unmount(props) {
  props.container.__vue_app__?.unmount();
}
```

## 6.4 通信方案的性能与复杂度权衡

### 6.4.1 五种方案的全景对比

到目前为止，我们深入分析了乾坤内置的两种通信机制。但在实际项目中，团队往往会结合或替代使用其他方案——有些是浏览器原生 API，有些是社区成熟的状态管理库。让我们系统性地对比五种主流方案，帮助你建立完整的技术视野：

```typescript
// 方案 1：乾坤 initGlobalState（已详细分析）
// 方案 2：Props 传递（已详细分析）
// 方案 3：CustomEvent（浏览器原生）
// 方案 4：BroadcastChannel（浏览器原生，跨 Tab）
// 方案 5：共享 Store（Redux/Zustand/Pinia）
```

**方案 3：CustomEvent**

```typescript
function emitMicroEvent(eventName: string, detail: any) {
  window.dispatchEvent(new CustomEvent(`micro:${eventName}`, { detail }));
}

function onMicroEvent(eventName: string, handler: (detail: any) => void) {
  const listener = (event: CustomEvent) => handler(event.detail);
  window.addEventListener(`micro:${eventName}`, listener as EventListener);
  return () => window.removeEventListener(`micro:${eventName}`, listener as EventListener);
}
```

CustomEvent 方案的优势是**零依赖**——它是浏览器原生 API，不需要引入任何库。但它在沙箱环境下的表现值得关注：

```typescript
// 在 ProxySandbox 中：
// - window.addEventListener 会被代理
// - 子应用卸载时，沙箱会清理子应用添加的事件监听
// - 不需要手动 removeEventListener，但你对监听生命周期失去了部分控制

// 在 SnapshotSandbox 中：
// - 事件监听不会被沙箱管理
// - 必须手动清理，否则产生内存泄漏
```

另外，CustomEvent 没有"状态"概念——它是纯事件驱动的。如果子应用在事件发出之后才加载，它将错过之前的所有事件。这与 `initGlobalState` 不同——后者的 `fireImmediately` 参数允许新订阅者立即获取当前状态。

**方案 4：BroadcastChannel**

```typescript
// 主应用
const channel = new BroadcastChannel('micro-frontend');
channel.postMessage({ type: 'USER_UPDATED', payload: { id: 1001, name: '杨艺韬' } });

// 子应用
const channel = new BroadcastChannel('micro-frontend');
channel.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;
  if (type === 'USER_UPDATED') updateUser(payload);
};
export function unmount() { channel.close(); }
```

BroadcastChannel 的独特价值在于**跨 Tab 通信**。如果你的微前端应用允许用户同时打开多个浏览器 Tab（比如后台管理系统），用户在一个 Tab 中修改了设置，其他 Tab 需要同步更新——这是 `initGlobalState` 无法做到的。

```typescript
// BroadcastChannel 的限制
// 1. 数据必须是可序列化的（不能传递函数、DOM 引用、类实例）
// 2. 是异步的（postMessage 不会立即触发 onmessage）
// 3. 没有"状态"概念——纯事件驱动，不保存历史数据
// 4. 在沙箱环境中，BroadcastChannel 可能被代理或限制
```

**方案 5：共享 Store**

```typescript
// 主应用创建 store，通过 props 传递
import { create } from 'zustand';
export const useGlobalStore = create<GlobalStore>((set) => ({
  user: null, theme: 'light', locale: 'zh-CN',
  setUser: (user) => set({ user }),
  setTheme: (theme) => set({ theme }),
}));

registerMicroApps([{ name: 'sub-app', props: { globalStore: useGlobalStore } }]);

// 或通过 externals 共享模块
// webpack externals: { '@shared/store': 'SharedStore' }
// 子应用直接 import { useGlobalStore } from '@shared/store';
```

### 6.4.2 性能对比

```typescript
const benchmarks = [
  { method: 'Props 传递',        latencyUs: 1,   note: '直接函数调用，无中间层' },
  { method: '共享 Store',         latencyUs: 5,   note: '状态更新 + selector' },
  { method: 'CustomEvent',       latencyUs: 10,  note: 'DOM 事件分发' },
  { method: 'initGlobalState',   latencyUs: 50,  note: 'cloneDeep 开销' },
  { method: 'BroadcastChannel',  latencyUs: 200, note: '结构化克隆 + 异步' },
];
```

几个关键观察：

1. **Props 传递是最快的**——因为它本质上就是函数调用，没有任何中间层。
2. **BroadcastChannel 是最慢的**——结构化克隆（structured clone）的成本远高于深拷贝，而且是异步的。
3. **`initGlobalState` 的瓶颈在 `cloneDeep`**——对于小型状态对象，50 微秒完全不是问题；但如果全局状态中包含大型数组，性能会急剧下降。
4. **共享 Store 的 selector 机制**是一个巨大的优势——Zustand 的 `subscribe` 支持 selector，只有被选择的状态片段变化时才触发回调。`initGlobalState` 没有这个能力，每次任何 key 变化，所有订阅者都会被通知。

### 6.4.3 复杂度对比

```typescript
// 维护复杂度评估

// 1. initGlobalState
// 引入成本：★☆☆☆☆（零配置，乾坤内置）
// 类型安全：★★☆☆☆（需要手动维护类型定义）
// 调试体验：★★☆☆☆（没有 DevTools，只能 console.log）
// 团队协作：★★★☆☆（主应用定义 Schema，子应用遵循）
// 适用规模：3-5 个子应用，状态字段 < 20 个

// 2. Props 传递
// 引入成本：★☆☆☆☆（零配置）
// 类型安全：★★★★☆（可以用 TypeScript 接口约束）
// 调试体验：★★★☆☆（props 可以在组件树中追踪）
// 团队协作：★★★★☆（接口契约清晰）
// 适用规模：任意规模，但仅限主应用 → 子应用方向

// 3. CustomEvent
// 引入成本：★★☆☆☆（需要封装工具函数）
// 类型安全：★★☆☆☆（event.detail 是 any）
// 调试体验：★★★☆☆（浏览器 Event 面板可见）
// 团队协作：★★☆☆☆（事件名容易冲突，需要命名规范）
// 适用规模：简单的事件通知场景

// 4. BroadcastChannel
// 引入成本：★★☆☆☆（原生 API，但需要处理兼容性）
// 类型安全：★☆☆☆☆（MessageEvent.data 是 any）
// 调试体验：★☆☆☆☆（异步、跨 Tab，极难调试）
// 团队协作：★★☆☆☆（消息格式需要团队约定）
// 适用规模：跨 Tab 同步场景

// 5. 共享 Store
// 引入成本：★★★★☆（需要额外引入状态管理库，配置 externals 或 shared）
// 类型安全：★★★★★（完整的 TypeScript 支持）
// 调试体验：★★★★★（Redux DevTools / Zustand DevTools）
// 团队协作：★★★★★（统一的状态管理范式）
// 适用规模：大型项目，10+ 子应用，复杂状态逻辑
```

### 6.4.4 实战决策树

```
你的微前端项目需要什么类型的通信？
│
├─ 数据共享（用户信息、主题、权限等）
│  ├─ 子应用 ≤ 5，字段 ≤ 10 → ✅ initGlobalState
│  ├─ 子应用 > 5 或数据复杂 → ✅ 共享 Store（Zustand/Redux）
│  └─ 需要跨 Tab 同步 → ✅ BroadcastChannel + 本地 Store
│
├─ 能力注入（路由、权限、错误上报）→ ✅ Props 传递
│
├─ 事件通知（无状态事件）
│  ├─ 主应用↔子应用 → ✅ Props 回调函数
│  └─ 子应用间广播 → ✅ CustomEvent
│
└─ 组件级嵌入 → ✅ loadMicroApp + Props + update()
```

### 6.4.5 混合方案的架构设计

大型项目应**分层组合**：

```typescript
// 第一层：Props —— 能力注入
registerMicroApps([{
  name: 'sub-app',
  props: {
    navigate: (path: string) => router.push(path),
    checkAuth: (perm: string) => authService.check(perm),
    reportError: (err: Error) => errorService.report(err),
  },
}]);

// 第二层：initGlobalState —— 轻量级数据共享
const actions = initGlobalState({ user: currentUser, theme: 'light', locale: 'zh-CN' });

// 第三层：共享 Store（可选）—— 复杂业务状态
import { useCartStore } from '@shared/stores';

// 第四层：CustomEvent（可选）—— 临时性事件通知
window.dispatchEvent(new CustomEvent('micro:order:created', { detail: { orderId: '12345' } }));
```

将这些封装为统一 API，降低子应用接入成本：

```typescript
interface MicroCommunication {
  call: <T>(capability: string, ...args: any[]) => T;
  getState: <T>(key: string) => T;
  watch: <T>(key: string, callback: (value: T, prev: T) => void) => () => void;
  setState: (key: string, value: any) => void;
  emit: (event: string, payload?: any) => void;
  on: (event: string, handler: (payload: any) => void) => () => void;
}

function createMicroCommunication(props: any): MicroCommunication {
  return {
    call: (capability, ...args) => {
      const fn = props[capability];
      if (typeof fn !== 'function') throw new Error(`Capability "${capability}" not found`);
      return fn(...args);
    },
    getState: (key) => currentGlobalState[key],
    watch: (key, callback) => {
      let prevValue = currentGlobalState[key];
      props.onGlobalStateChange((state: any) => {
        if (state[key] !== prevValue) {
          const old = prevValue;
          prevValue = state[key];
          callback(state[key], old);
        }
      });
      return () => props.offGlobalStateChange?.();
    },
    setState: (key, value) => props.setGlobalState({ [key]: value }),
    emit: (event, payload) => window.dispatchEvent(new CustomEvent(`micro:${event}`, { detail: payload })),
    on: (event, handler) => {
      const listener = (e: Event) => handler((e as CustomEvent).detail);
      window.addEventListener(`micro:${event}`, listener);
      return () => window.removeEventListener(`micro:${event}`, listener);
    },
  };
}
```

> 🔥 **深度洞察：通信架构的演进方向**
>
> 乾坤的 `initGlobalState` 发布于 2019 年，那时微前端还处于"能跑起来就不错了"的阶段。到 2026 年，Module Federation 2.0 的 shared scope 和 Rspack 的模块共享机制从编译层面解决了模块共享——你不再需要运行时传递 store 引用，而是构建时约定共享模块。这是根本性的范式转换：**从运行时的消息传递，到编译时的模块共享**。但运行时通信不会消失——它仍然是处理动态事件和临时状态的最佳方式。未来一定是编译时共享（静态依赖）+ 运行时通信（动态事件）的组合。

### 6.4.6 类型安全的通信层

`initGlobalState` 的最大痛点是 `Record<string, any>`——拼写错误在编译时不会被发现。用极低成本的包装解决：

```typescript
interface GlobalState {
  user: { id: number; name: string; avatar: string; role: 'admin' | 'user' } | null;
  theme: 'light' | 'dark';
  locale: 'zh-CN' | 'en-US' | 'ja-JP';
}

function createTypedGlobalState<T extends Record<string, any>>(initialState: T) {
  const actions = initGlobalState(initialState);
  return {
    onChange(callback: (state: T, prevState: T) => void, fireImmediately?: boolean) {
      actions.onGlobalStateChange(callback as any, fireImmediately);
    },
    setState<K extends keyof T>(key: K, value: T[K]) {
      actions.setGlobalState({ [key]: value } as any);
    },
    batchUpdate(partial: Partial<T>) {
      actions.setGlobalState(partial as any);
    },
    offChange() { actions.offGlobalStateChange(); },
  };
}

const globalState = createTypedGlobalState<GlobalState>({
  user: null, theme: 'light', locale: 'zh-CN',
});

// 现在有完整的类型提示和编译时检查
globalState.setState('theme', 'dark');    // ✅ 类型正确
globalState.setState('theme', 'blue');    // ❌ TypeScript 报错：'blue' 不在 'light' | 'dark' 中
globalState.setState('typo', 'value');    // ❌ TypeScript 报错：'typo' 不在 keyof GlobalState 中

globalState.onChange((state) => {
  // state.user 的类型是 { id: number; name: string; ... } | null
  if (state.user) {
    console.log(state.user.name);  // 完整的类型推断和自动补全
  }
});
```

这个包装层的代价几乎为零——它只是在编译时增加了类型检查，运行时没有任何额外开销。但它带来的收益是巨大的：拼写错误在编译时就被发现，IDE 提供完整的自动补全，代码审查时一眼就能看出状态结构。在任何 TypeScript 微前端项目中，这种封装都应该在项目初期就建立。

## 本章小结

- `initGlobalState` 基于发布订阅模式，使用模块级变量存储状态和订阅者，通过深拷贝确保状态不被绕过正式 API 直接修改
- 主应用拥有完全的状态控制权（可以添加新 key），子应用只能修改已有 key——这是"合同制"的权限设计
- Props 传递是依赖注入模式，适合传递**能力**（函数、服务实例），而 GlobalState 适合传递**数据**
- `loadMicroApp` 通过 Parcel 机制支持动态 Props 更新，适用于"组件级"微前端场景
- 五种通信方案各有适用场景：initGlobalState（轻量数据共享）、Props（能力注入）、CustomEvent（事件通知）、BroadcastChannel（跨 Tab）、共享 Store（复杂状态）
- 大型项目应采用分层通信架构，并尽早建立类型安全的通信层封装

## 思考题

1. **源码理解**：`emitGlobal` 每次通知订阅者时都执行 `cloneDeep`。如果改为只在 `setGlobalState` 入口做一次深拷贝，然后把同一个拷贝传给所有订阅者，会有什么潜在风险？请从多个订阅者并发修改回调参数的角度分析。

2. **设计分析**：乾坤限制子应用不能添加新的顶层 key。请设计一个方案，在保留这个限制的前提下，允许子应用"申请"新的状态字段——主应用审批后生效。这个方案的 API 应该是什么样的？

3. **方案对比**：一个电商平台有 8 个子应用，需要实现：(a) 用户登录状态同步，(b) 子应用 A 创建订单后通知子应用 B 刷新物流列表，(c) 主应用的权限校验服务需要被所有子应用调用。请为每种需求选择最合适的方案并说明理由。

4. **性能优化**：全局状态包含 5000 条记录的数组，每当有新消息时需要通知 10 个子应用。使用 `initGlobalState` 会产生多少次深拷贝？请提出优化方案。

5. **架构设计**：Module Federation 2.0 的 shared scope 允许编译时共享同一个 Zustand store。这种"编译时共享"与乾坤的"运行时通信"在本质上有什么区别？各自的故障模式（failure mode）是什么？

</div>
