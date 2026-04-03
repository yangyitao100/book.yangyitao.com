<div v-pre>

# 第4章 JS 沙箱机制深度剖析

> "沙箱的本质不是隔离——是在不隔离的环境中制造隔离的幻觉。"

> **本章要点**
> - 理解三代沙箱的演进脉络：从快照全量 diff 到 Proxy 单实例再到 Proxy 多实例
> - 深入 SnapshotSandbox 的实现原理：暴力遍历 window 属性的全量快照与恢复
> - 掌握 LegacySandbox 的 Proxy 拦截机制：用三个 Map 精准追踪变更
> - 剖析 ProxySandbox 的 fakeWindow 设计：createFakeWindow 如何构造隔离的全局对象
> - 认识沙箱的边界与逃逸：哪些东西是 JS 沙箱无论如何也隔离不了的
> - 手写实现三种沙箱核心逻辑，与乾坤源码逐行对照

---

在前面的章节中，我们了解了乾坤的整体架构和应用加载机制。但如果说应用加载是微前端的"骨架"，那么 JS 沙箱就是它的"免疫系统"——没有沙箱，多个子应用运行在同一个页面中，就像多个陌生人共用一间没有隔板的办公室，全局变量的冲突、原型链的污染、事件监听器的残留……一切都会变成灾难。

这一章是全书技术密度最高的章节。我们将从乾坤源码出发，逐行拆解三代 JS 沙箱的设计与实现，理解每一代方案"为什么这样做"，以及"代价是什么"。读完这一章，你不仅能看懂乾坤的沙箱源码，更能理解一个深刻的事实：**在浏览器中实现完美的 JS 隔离，在理论上就是不可能的。** 所有沙箱都是工程上的近似解——区别只在于近似到什么程度，以及付出了多少代价。

## 4.1 三代沙箱的演进

乾坤的 JS 沙箱经历了三代演进，每一代都是对上一代痛点的精准回应。在深入每一代的实现之前，我们先从宏观视角理解它们的关系。

### 4.1.1 为什么需要沙箱

当多个子应用运行在同一个页面中，它们共享同一个 `window` 对象。这意味着：

```typescript
// 子应用 A 设置了一个全局变量
window.globalConfig = { theme: 'dark', language: 'zh-CN' };

// 子应用 B 也设置了同名的全局变量
window.globalConfig = { apiBaseUrl: 'https://api.example.com' };

// 子应用 A 再次读取时——灾难发生了
console.log(window.globalConfig.theme); // undefined！
```

更隐蔽的问题是原型链污染：

```typescript
// 子应用 A 给 Array 原型加了一个方法
Array.prototype.last = function() {
  return this[this.length - 1];
};

// 子应用 B 遍历数组时
const arr = [1, 2, 3];
for (const key in arr) {
  console.log(key); // "0", "1", "2", "last" —— 多了一个不该有的属性
}
```

还有事件监听器的残留：

```typescript
// 子应用 A 挂载时注册了 resize 监听
window.addEventListener('resize', handleResize);

// 子应用 A 卸载了，但 handleResize 还在！
// 当窗口大小变化时，handleResize 还会被调用
// 而此时子应用 A 的 DOM 已经被移除，handleResize 中的 DOM 操作会报错
```

沙箱的使命就是：**让每个子应用以为自己独占了 `window`，但实际上它们的修改互不影响。**

### 4.1.2 三代沙箱对比总览

| 特性 | SnapshotSandbox | LegacySandbox | ProxySandbox |
|------|----------------|---------------|--------------|
| **实现原理** | 全量 diff window | Proxy 拦截 + 记录变更 | Proxy + fakeWindow |
| **多实例支持** | 不支持 | 不支持 | 支持 |
| **性能** | 差（遍历 window） | 好（精准拦截） | 好 |
| **浏览器兼容** | IE 9+ | ES6 Proxy | ES6 Proxy |
| **隔离粒度** | 激活/失活时整体切换 | 激活/失活时整体切换 | 每个实例独立 |
| **对 window 的影响** | 直接修改 window | 直接修改 window | 不修改 window |
| **适用场景** | 降级方案 | 单实例过渡方案 | 生产推荐方案 |

三代沙箱的演进轨迹非常清晰：

1. **SnapshotSandbox**：不支持 Proxy 的环境下的降级方案，通过保存和恢复 window 快照实现隔离
2. **LegacySandbox**：引入 Proxy，不再需要遍历 window，但仍然直接修改真实的 window 对象
3. **ProxySandbox**：引入 fakeWindow，子应用的所有修改都写入 fakeWindow，真实 window 完全不受影响

每一步演进都在解决上一代的核心痛点：SnapshotSandbox 性能差 → LegacySandbox 用 Proxy 解决；LegacySandbox 不支持多实例 → ProxySandbox 用 fakeWindow 解决。

### 4.1.3 沙箱的生命周期

无论哪一代沙箱，都遵循相同的生命周期模型：

```typescript
interface SandboxLifecycle {
  // 激活沙箱：子应用挂载前调用
  active(): void;

  // 失活沙箱：子应用卸载时调用
  inactive(): void;
}

// 在乾坤中的调用时机
async function mountApp(app: MicroApp) {
  // 1. 激活沙箱
  app.sandbox.active();

  // 2. 执行子应用的 JS 代码（在沙箱环境中）
  evalSubAppScripts(app.scripts, app.sandbox.proxy);

  // 3. 调用子应用的 mount 生命周期
  await app.mount(props);
}

async function unmountApp(app: MicroApp) {
  // 1. 调用子应用的 unmount 生命周期
  await app.unmount(props);

  // 2. 失活沙箱
  app.sandbox.inactive();
}
```

理解了这个生命周期模型，我们就有了分析每一代沙箱的基本框架。接下来让我们逐一深入。

## 4.2 快照沙箱：暴力但可靠的全量 diff

SnapshotSandbox 是乾坤最早期的沙箱实现，也是最容易理解的一种。它的思想极其朴素：**在子应用激活前，把 window 的所有属性拍一张快照；在子应用失活时，把 window 恢复到快照状态。**

### 4.2.1 核心思想

想象你和室友合租一间房间，但你们不能同时在房间里。你的使用时段是白天，室友是晚上。为了避免冲突，你们约定：

1. 你进入房间前，拍一张照片记录房间的初始状态
2. 你在房间里随意使用——挪桌子、换窗帘、贴海报
3. 你离开时，对比当前状态和初始照片，把所有改动记录下来，然后恢复原样
4. 下次你再进来时，根据之前的记录重新应用你的改动

这就是 SnapshotSandbox 的全部逻辑。

### 4.2.2 乾坤源码剖析

让我们看乾坤源码中 SnapshotSandbox 的实现：

```typescript
// 来自 qiankun/src/sandbox/snapshotSandbox.ts（简化后）

type WindowSnapshot = Record<string, any>;

class SnapshotSandbox implements SandBox {
  name: string;
  type = SandBoxType.Snapshot;
  sandboxRunning = false;

  // 激活前的 window 快照
  private windowSnapshot!: WindowSnapshot;
  // 子应用运行期间对 window 做的修改
  private modifyPropsMap: Record<string, any> = {};
  proxy: WindowProxy;

  constructor(name: string) {
    this.name = name;
    this.proxy = window;
    // 注意：proxy 就是 window 本身！
    // 这意味着子应用直接操作的就是真实的 window
  }

  active() {
    // 1. 拍摄当前 window 的快照
    this.windowSnapshot = {} as WindowSnapshot;
    for (const prop in window) {
      if (window.hasOwnProperty(prop)) {
        this.windowSnapshot[prop] = (window as any)[prop];
      }
    }

    // 2. 如果之前有改动记录，恢复这些改动
    Object.keys(this.modifyPropsMap).forEach((prop) => {
      (window as any)[prop] = this.modifyPropsMap[prop];
    });

    this.sandboxRunning = true;
  }

  inactive() {
    // 1. 记录子应用对 window 做的所有修改
    this.modifyPropsMap = {};
    for (const prop in window) {
      if (window.hasOwnProperty(prop)) {
        if ((window as any)[prop] !== this.windowSnapshot[prop]) {
          // 记录变更
          this.modifyPropsMap[prop] = (window as any)[prop];
          // 恢复原值
          (window as any)[prop] = this.windowSnapshot[prop];
        }
      }
    }

    this.sandboxRunning = false;
  }
}
```

### 4.2.3 执行流程详解

让我们通过一个具体的时序来理解这段代码的工作方式：

```typescript
// 假设初始 window 状态
// window.existingVar = 'original'

const sandbox = new SnapshotSandbox('app-A');

// ===== 第一次激活 =====
sandbox.active();
// windowSnapshot = { existingVar: 'original', ... }
// modifyPropsMap 为空，所以没有需要恢复的改动

// 子应用 A 运行期间
window.existingVar = 'modified by A';  // 修改已有属性
window.newVar = 'created by A';         // 新增属性

// ===== 第一次失活 =====
sandbox.inactive();
// 遍历 window，发现两处变化：
// modifyPropsMap = { existingVar: 'modified by A', newVar: 'created by A' }
// 恢复 window：
// window.existingVar = 'original'  （恢复）
// window.newVar = 'original'?      —— 注意！这里有个问题

// ===== 第二次激活 =====
sandbox.active();
// 重新拍快照
// 从 modifyPropsMap 恢复子应用 A 的改动：
// window.existingVar = 'modified by A'
// window.newVar = 'created by A'
```

### 4.2.4 性能问题分析

SnapshotSandbox 的致命问题在于性能。`window` 对象上有多少属性？

```typescript
// 在 Chrome 中测试
let count = 0;
for (const prop in window) {
  if (window.hasOwnProperty(prop)) {
    count++;
  }
}
console.log(count); // 通常 200-400+，取决于页面加载的脚本

// 每次 active() 和 inactive() 都需要遍历所有属性
// 如果子应用频繁切换（比如用户快速在多个 Tab 之间切换），
// 这个开销会变得非常明显

// 更糟糕的是：for...in 遍历的性能本身就不好
// 它需要遍历整个原型链，而 window 的原型链很深：
// window → Window.prototype → WindowProperties → EventTarget.prototype → Object.prototype
```

让我们量化这个开销：

```typescript
// 性能测试
function benchmarkSnapshotSandbox() {
  const sandbox = new SnapshotSandbox('bench');

  // 模拟子应用添加一些属性
  sandbox.active();
  for (let i = 0; i < 100; i++) {
    (window as any)[`__test_prop_${i}`] = i;
  }

  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    sandbox.inactive();
    sandbox.active();
  }
  const end = performance.now();

  console.log(`100 次切换耗时: ${end - start}ms`);
  // 典型结果：50-200ms（取决于 window 上的属性数量）
  // 对比：ProxySandbox 的切换几乎是 0ms
}
```

### 4.2.5 SnapshotSandbox 的局限性

除了性能问题，SnapshotSandbox 还有以下局限：

```typescript
// 局限 1：不支持多实例
// 因为它直接修改 window，同一时刻只能有一个沙箱处于激活状态
const sandboxA = new SnapshotSandbox('A');
const sandboxB = new SnapshotSandbox('B');

sandboxA.active();
sandboxB.active(); // 如果 A 还没 inactive，B 的快照会包含 A 的修改！

// 局限 2：无法拦截属性的读取
// 快照沙箱只能在 active/inactive 时做 diff
// 在子应用运行期间，它无法知道子应用读取了哪些属性

// 局限 3：for...in 遍历遗漏不可枚举属性
// window 上有些属性是不可枚举的（如 window.NaN, window.undefined）
// for...in 无法遍历到它们
// 如果子应用修改了这些属性，SnapshotSandbox 无法检测到

// 局限 4：新增属性在恢复时不会被删除
// 假设子应用新增了 window.newProp
// inactive() 时虽然记录了 modifyPropsMap.newProp
// 但恢复逻辑是 window[prop] = snapshot[prop]
// 如果 snapshot 中没有 newProp，window.newProp 会被设置为 undefined
// 而不是被 delete 掉——这有微妙的区别：
console.log('newProp' in window); // true —— 属性还在！只是值是 undefined
```

> **深度洞察：SnapshotSandbox 存在的意义**
>
> 看完这些局限性，你可能会想：既然 SnapshotSandbox 这么多问题，为什么乾坤还要保留它？答案是一个字：**兼容**。Proxy 是 ES6 的特性，不支持 polyfill——如果用户的浏览器不支持 Proxy（主要是 IE），SnapshotSandbox 是唯一的选择。这体现了一个重要的工程哲学：**先保证能用，再追求好用。** 降级方案的价值不在于它有多优雅，而在于它在极端条件下仍然能工作。

## 4.3 单实例代理沙箱：Proxy 的性能优化

LegacySandbox 是乾坤的第二代沙箱。它用 ES6 Proxy 替代了全量 diff，实现了精准的属性变更追踪。

### 4.3.1 设计动机

SnapshotSandbox 的根本问题在于：它用**事后 diff** 来检测变更。每次 active/inactive 都要遍历整个 window。而 LegacySandbox 换了一个思路：**用 Proxy 实时拦截每一次写入，在写入的瞬间就记录变更。** 这样，active/inactive 时只需要处理那些确实被修改过的属性，而不需要遍历整个 window。

### 4.3.2 三个关键的 Map

LegacySandbox 的精妙之处在于它用三个 Map 来追踪不同类型的变更：

```typescript
// 来自 qiankun/src/sandbox/legacy/sandbox.ts（简化后）

class LegacySandbox implements SandBox {
  name: string;
  type = SandBoxType.LegacyProxy;
  sandboxRunning = false;
  proxy: WindowProxy;

  // Map 1：子应用新增的属性
  // 这些属性在子应用激活前不存在于 window 上
  private addedPropsMapInSandbox = new Map<PropertyKey, any>();

  // Map 2：子应用修改的属性的原始值
  // key 是属性名，value 是修改前的原始值
  private modifiedPropsOriginalValueMapInSandbox = new Map<PropertyKey, any>();

  // Map 3：子应用运行期间设置过的所有属性的当前值
  // 这是一个"全记录"，包含新增和修改
  private currentUpdatedPropsValueMap = new Map<PropertyKey, any>();

  constructor(name: string) {
    this.name = name;

    const { addedPropsMapInSandbox, modifiedPropsOriginalValueMapInSandbox, currentUpdatedPropsValueMap } = this;
    const rawWindow = window;
    const fakeWindow = Object.create(null);

    this.proxy = new Proxy(fakeWindow, {
      set(_: Window, prop: PropertyKey, value: any) {
        if (!rawWindow.hasOwnProperty(prop)) {
          // 新增属性
          addedPropsMapInSandbox.set(prop, value);
        } else if (!modifiedPropsOriginalValueMapInSandbox.has(prop)) {
          // 修改已有属性（且是第一次修改）
          // 记录原始值，后续恢复时使用
          const originalValue = (rawWindow as any)[prop];
          modifiedPropsOriginalValueMapInSandbox.set(prop, originalValue);
        }

        // 无论新增还是修改，都记录当前值
        currentUpdatedPropsValueMap.set(prop, value);

        // 关键：仍然直接修改真实的 window！
        (rawWindow as any)[prop] = value;

        return true;
      },

      get(_: Window, prop: PropertyKey) {
        return (rawWindow as any)[prop];
      },
    });
  }

  active() {
    // 恢复子应用之前的修改
    this.currentUpdatedPropsValueMap.forEach((value, prop) => {
      (window as any)[prop] = value;
    });
    this.sandboxRunning = true;
  }

  inactive() {
    // 恢复修改过的属性的原始值
    this.modifiedPropsOriginalValueMapInSandbox.forEach((value, prop) => {
      (window as any)[prop] = value;
    });

    // 删除新增的属性
    this.addedPropsMapInSandbox.forEach((_value, prop) => {
      delete (window as any)[prop];
    });

    this.sandboxRunning = false;
  }
}
```

### 4.3.3 三个 Map 的分工

为什么需要三个 Map？让我们用一个例子理解它们各自的职责：

```typescript
// 初始状态：window.existingVar = 'original'

const sandbox = new LegacySandbox('app-A');

// ===== 激活 =====
sandbox.active();

// 操作 1：修改已有属性
sandbox.proxy.existingVar = 'modified';
// addedPropsMapInSandbox: {} （不是新增）
// modifiedPropsOriginalValueMapInSandbox: { existingVar: 'original' }
// currentUpdatedPropsValueMap: { existingVar: 'modified' }
// window.existingVar = 'modified'  ← 真实 window 被修改了

// 操作 2：再次修改同一属性
sandbox.proxy.existingVar = 'modified again';
// addedPropsMapInSandbox: {} （不变）
// modifiedPropsOriginalValueMapInSandbox: { existingVar: 'original' } （不变！只记录第一次的原始值）
// currentUpdatedPropsValueMap: { existingVar: 'modified again' }
// window.existingVar = 'modified again'

// 操作 3：新增属性
sandbox.proxy.newVar = 'created';
// addedPropsMapInSandbox: { newVar: 'created' }
// modifiedPropsOriginalValueMapInSandbox: { existingVar: 'original' } （不变）
// currentUpdatedPropsValueMap: { existingVar: 'modified again', newVar: 'created' }
// window.newVar = 'created'

// ===== 失活 =====
sandbox.inactive();
// 1. 遍历 modifiedPropsOriginalValueMapInSandbox，恢复原始值：
//    window.existingVar = 'original'
// 2. 遍历 addedPropsMapInSandbox，删除新增属性：
//    delete window.newVar

// 此时 window 恢复到了初始状态！

// ===== 再次激活 =====
sandbox.active();
// 遍历 currentUpdatedPropsValueMap，恢复子应用的修改：
// window.existingVar = 'modified again'
// window.newVar = 'created'
```

关键设计点：

- `modifiedPropsOriginalValueMapInSandbox` 只记录**第一次修改前**的原始值，所以恢复时能精准还原
- `addedPropsMapInSandbox` 记录新增属性，恢复时用 `delete` 而不是设为 `undefined`
- `currentUpdatedPropsValueMap` 是"全记录"，用于再次激活时恢复子应用的所有变更

### 4.3.4 性能对比

LegacySandbox 相比 SnapshotSandbox 的性能优势是巨大的：

```typescript
// SnapshotSandbox 的 active/inactive 复杂度
// 时间复杂度：O(N)，N = window 上的属性数量（200-400+）
// 每次切换都遍历整个 window

// LegacySandbox 的 active/inactive 复杂度
// 时间复杂度：O(M)，M = 子应用实际修改的属性数量（通常 10-50）
// 只处理确实被修改过的属性

// 量化对比
function benchmark() {
  // 假设 window 上有 300 个属性
  // 子应用修改了 20 个属性

  // SnapshotSandbox: 每次切换遍历 300 个属性
  // LegacySandbox: 每次切换只处理 20 个属性

  // 性能提升：15 倍
  // 当 window 属性更多时（大型应用中可能有 1000+），优势更明显
}
```

### 4.3.5 LegacySandbox 的致命局限

尽管性能大幅提升，LegacySandbox 仍然有一个根本性的问题：**它直接修改了真实的 window 对象。**

```typescript
// 在 set trap 中：
(rawWindow as any)[prop] = value;
// 这一行直接修改了 window！

// 这意味着：同一时刻只能有一个沙箱处于激活状态
// 如果两个子应用同时运行：

const sandboxA = new LegacySandbox('A');
const sandboxB = new LegacySandbox('B');

sandboxA.active();
sandboxB.active();

sandboxA.proxy.config = 'A';  // window.config = 'A'
sandboxB.proxy.config = 'B';  // window.config = 'B'

// sandboxA 读取时会得到 'B' —— 隔离失败！
console.log(sandboxA.proxy.config); // 'B' !!!
```

这就是为什么它叫 "Legacy"——它是一个**过渡方案**。真正解决多实例问题的是 ProxySandbox。

> **深度洞察：为什么 LegacySandbox 选择修改真实 window**
>
> 你可能会问：既然已经用了 Proxy，为什么不把值存在 fakeWindow 里，而要修改真实 window？原因在于兼容性。很多第三方库（如 jQuery、Lodash）会直接通过 `window.xxx` 读取全局变量，而不经过 Proxy。如果子应用的变量只存在 fakeWindow 中，这些库就读不到。LegacySandbox 选择修改真实 window，正是为了保证这些"不走 Proxy"的读取方式也能正常工作。这是一个**兼容性优先**的设计决策——用多实例能力换兼容性。

## 4.4 多实例代理沙箱：fakeWindow 的精妙设计

ProxySandbox 是乾坤目前生产环境中推荐使用的沙箱方案。它解决了前两代沙箱最根本的问题：**多实例支持**。通过 fakeWindow 机制，每个子应用拥有自己独立的"虚拟 window"，彼此之间完全隔离，真实 window 不受任何影响。

### 4.4.1 fakeWindow：虚拟的全局对象

ProxySandbox 的核心创新在于 `createFakeWindow` 函数。它创建了一个"假 window"，作为子应用全局变量的容器：

```typescript
// 来自 qiankun/src/sandbox/proxySandbox.ts（简化后）

function createFakeWindow(globalContext: Window): {
  fakeWindow: Window;
  propertiesWithGetter: Map<PropertyKey, boolean>;
} {
  const propertiesWithGetter = new Map<PropertyKey, boolean>();

  const fakeWindow = {} as Window;

  // 核心逻辑：从真实 window 上复制不可配置的属性到 fakeWindow
  // 为什么只复制不可配置的属性？
  // 因为 Proxy 的 invariant 约束：
  // 如果目标对象上某个属性是不可配置的，
  // Proxy 的 get trap 必须返回与目标对象一致的值
  // 否则会抛出 TypeError

  Object.getOwnPropertyNames(globalContext)
    .filter((prop) => {
      const descriptor = Object.getOwnPropertyDescriptor(globalContext, prop);
      return !descriptor?.configurable;
    })
    .forEach((prop) => {
      const descriptor = Object.getOwnPropertyDescriptor(globalContext, prop)!;

      if (descriptor.get) {
        // 记录有 getter 的属性，后续特殊处理
        propertiesWithGetter.set(prop, true);
      }

      // 将不可配置的属性定义到 fakeWindow 上
      // 保持与原始 window 完全一致的属性描述符
      Object.defineProperty(fakeWindow, prop, {
        ...descriptor,
        // 关键：将 configurable 改为 true
        // 这样 fakeWindow 上的这些属性后续还能被修改
        configurable: descriptor.configurable,
      });
    });

  return { fakeWindow, propertiesWithGetter };
}
```

### 4.4.2 Proxy 的 invariant 约束

上面代码中提到了一个关键概念：Proxy 的 invariant 约束。这是理解 fakeWindow 设计的钥匙：

```typescript
// ES 规范中的 Proxy invariant 示例

const target = {};
Object.defineProperty(target, 'name', {
  value: 'fixed',
  writable: false,
  configurable: false,
});

const proxy = new Proxy(target, {
  get(target, prop) {
    if (prop === 'name') {
      return 'fake'; // 试图返回不同的值
    }
    return Reflect.get(target, prop);
  },
});

// TypeError: 'get' on proxy: property 'name' is a read-only and
// non-configurable data property on the proxy target but the proxy
// did not return its actual value
console.log(proxy.name);

// 这就是为什么 createFakeWindow 必须把不可配置的属性
// 复制到 fakeWindow（也就是 Proxy 的 target）上
// 否则 Proxy 的 get trap 无法返回正确的值
```

### 4.4.3 ProxySandbox 完整实现

```typescript
// 来自 qiankun/src/sandbox/proxySandbox.ts（简化后的核心逻辑）

class ProxySandbox implements SandBox {
  name: string;
  type = SandBoxType.Proxy;
  sandboxRunning = false;
  proxy: WindowProxy;

  // 属性变更记录
  private updatedValueSet = new Set<PropertyKey>();

  constructor(name: string) {
    this.name = name;

    const { fakeWindow, propertiesWithGetter } = createFakeWindow(window);
    const descriptorTargetMap = new Map<PropertyKey, 'target' | 'globalContext'>();
    const rawWindow = window;

    this.proxy = new Proxy(fakeWindow, {
      set: (target: Window, prop: PropertyKey, value: any): boolean => {
        if (this.sandboxRunning) {
          // 直接写入 fakeWindow，不修改真实 window！
          (target as any)[prop] = value;
          this.updatedValueSet.add(prop);

          // 特殊处理：如果修改的是 window 上必须同步的属性
          // 比如 document.title 等
          return true;
        }

        // 沙箱未激活时的写入，静默忽略
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[qiankun] Set window.${String(prop)} while sandbox destroyed or inactive in ${name}!`);
        }
        return true;
      },

      get: (target: Window, prop: PropertyKey): any => {
        // 特殊属性处理
        if (prop === Symbol.unscopables) return undefined;
        if (prop === 'window' || prop === 'self' || prop === 'globalThis') {
          return this.proxy;
        }

        // 避免 window.window.window... 无限递归
        if (prop === 'top' || prop === 'parent') {
          // 如果不在 iframe 中，top 和 parent 指向自身
          if (rawWindow === rawWindow.parent) {
            return this.proxy;
          }
          return (rawWindow as any)[prop];
        }

        // 如果 fakeWindow 上有这个属性，优先从 fakeWindow 读取
        if (target.hasOwnProperty(prop)) {
          // 有 getter 的属性需要特殊处理
          // 比如 window.location 有 getter
          // 我们需要确保 this 指向正确
          const getterValue = propertiesWithGetter.get(prop);
          if (getterValue) {
            return (rawWindow as any)[prop];
          }
          return (target as any)[prop];
        }

        // fakeWindow 上没有，从真实 window 读取
        const rawValue = (rawWindow as any)[prop];

        // 如果是函数，需要绑定正确的 this
        if (typeof rawValue === 'function') {
          // 确保函数的 this 指向真实 window
          // 否则 window.addEventListener 等方法会报错
          const boundValue = rawValue.bind(rawWindow);

          // 但也要保留函数上的属性
          // 比如 window.addEventListener.toString()
          for (const key of Object.keys(rawValue)) {
            boundValue[key] = rawValue[key];
          }
          return boundValue;
        }

        return rawValue;
      },

      has: (target: Window, prop: PropertyKey): boolean => {
        // with 语句中的属性查找会触发 has trap
        // 子应用的代码会被包裹在 with(sandbox.proxy) { ... } 中
        return prop in target || prop in rawWindow;
      },

      getOwnPropertyDescriptor: (target: Window, prop: PropertyKey) => {
        // 优先返回 fakeWindow 上的描述符
        if (target.hasOwnProperty(prop)) {
          const descriptor = Object.getOwnPropertyDescriptor(target, prop);
          // 确保 configurable 为 true
          // 否则后续的 defineProperty 可能失败
          if (descriptor) {
            descriptor.configurable = true;
          }
          return descriptor;
        }

        // 否则返回真实 window 上的描述符
        const descriptor = Object.getOwnPropertyDescriptor(rawWindow, prop);
        if (descriptor) {
          descriptor.configurable = true;
        }
        return descriptor;
      },

      defineProperty: (target: Window, prop: PropertyKey, descriptor: PropertyDescriptor): boolean => {
        // 定义属性时，写入 fakeWindow
        Object.defineProperty(target, prop, descriptor);
        return true;
      },

      deleteProperty: (target: Window, prop: PropertyKey): boolean => {
        if (target.hasOwnProperty(prop)) {
          delete (target as any)[prop];
          this.updatedValueSet.delete(prop);
          return true;
        }
        return true;
      },
    });
  }

  active() {
    this.sandboxRunning = true;
  }

  inactive() {
    this.sandboxRunning = false;
  }
}
```

### 4.4.4 为什么 active/inactive 如此简单

注意到了吗？ProxySandbox 的 `active()` 和 `inactive()` 方法极其简单——只是翻转一个 `sandboxRunning` 标志。

这正是 ProxySandbox 最优雅的地方：**因为所有变更都写入 fakeWindow 而不是真实 window，切换沙箱时不需要做任何恢复操作。** 每个沙箱实例拥有自己的 fakeWindow，互不干扰。

```typescript
// 对比三代沙箱的切换成本

// SnapshotSandbox：
// active()  → 遍历 window 拍快照 + 恢复之前的修改  O(N)
// inactive() → 遍历 window 做 diff + 恢复原始值      O(N)

// LegacySandbox：
// active()  → 遍历 currentUpdatedPropsValueMap 恢复   O(M)
// inactive() → 遍历两个 Map 恢复 + 删除               O(M)

// ProxySandbox：
// active()  → this.sandboxRunning = true               O(1)
// inactive() → this.sandboxRunning = false              O(1)

// 这就是架构设计的力量：
// 从 O(N) → O(M) → O(1)
// 不是通过优化算法，而是通过改变数据结构
```

### 4.4.5 多实例的工作方式

```typescript
// 创建两个独立的沙箱
const sandboxA = new ProxySandbox('app-A');
const sandboxB = new ProxySandbox('app-B');

// 同时激活——这在前两代沙箱中是不可能的！
sandboxA.active();
sandboxB.active();

// 子应用 A 设置全局变量
sandboxA.proxy.config = { theme: 'dark' };
// 写入 sandboxA 的 fakeWindow，window.config 不受影响

// 子应用 B 设置同名全局变量
sandboxB.proxy.config = { theme: 'light' };
// 写入 sandboxB 的 fakeWindow

// 各自读取——完美隔离
console.log(sandboxA.proxy.config); // { theme: 'dark' }
console.log(sandboxB.proxy.config); // { theme: 'light' }
console.log(window.config);         // undefined —— 真实 window 完全不受影响！
```

### 4.4.6 get trap 中的函数绑定问题

ProxySandbox 的 get trap 中有一个容易被忽视的细节：从真实 window 上读取的函数需要重新绑定 `this`。

```typescript
// 为什么需要绑定 this？

// 如果不绑定：
const proxyWindow = sandbox.proxy;
const addEventListener = proxyWindow.addEventListener;
addEventListener('click', handler);
// 报错！因为 addEventListener 的 this 指向了 proxy
// 而浏览器的原生方法期望 this 是真实的 window

// 绑定后：
const boundAddEventListener = rawWindow.addEventListener.bind(rawWindow);
boundAddEventListener('click', handler);
// 正常工作

// 但这里有个更微妙的问题：
// window.setTimeout 也是一个函数
// 但 setTimeout 不需要绑定 this（它是全局函数）
// 而 window.addEventListener 需要绑定 this（它是方法）
// 乾坤的做法是统一绑定——多绑定不会有副作用

// 还有一个陷阱：
// Function.prototype.bind 会创建一个新函数
// 新函数没有原函数上的自定义属性
// 所以需要手动复制属性
```

> **深度洞察：Proxy 沙箱的"读写分离"策略**
>
> ProxySandbox 的设计可以概括为一个极其精炼的策略：**写入操作写 fakeWindow，读取操作先查 fakeWindow 再查 window。** 这种"读写分离"在数据库领域是老生常谈，但在 JS 沙箱中却是一个巧妙的创新。它的优雅之处在于：子应用无需做任何改造就能正常工作——写入时自动隔离到 fakeWindow，读取时如果 fakeWindow 上没有就自动降级到真实 window（读取全局 API 如 `console`、`setTimeout` 等）。这种"写时隔离、读时降级"的策略，在隔离性和兼容性之间找到了最佳平衡点。

## 4.5 沙箱的边界与逃逸：那些隔离不了的东西

到目前为止，三代沙箱看起来已经相当强大了。但真相是：**JS 沙箱有大量隔离不了的东西。** 这不是实现的问题，而是浏览器架构决定的根本性限制。

### 4.5.1 原型链污染

```typescript
// 沙箱能拦截 window.xxx = value 这样的赋值
// 但无法拦截原型链上的修改

// 在子应用 A 中（通过沙箱执行）
Array.prototype.customMethod = function() { return 'polluted'; };

// 在子应用 B 中
const arr = [1, 2, 3];
console.log(arr.customMethod()); // 'polluted' —— 被污染了！

// 为什么拦截不了？
// 因为 Array.prototype 不是 window 的直接属性
// 子应用通过 proxy.Array 获取到的 Array 是真实的 Array
// 修改 Array.prototype 不会触发 proxy 的 set trap

// 类似的还有：
Object.prototype.injected = true;
String.prototype.customTrim = function() { /* ... */ };
Promise.prototype.customThen = function() { /* ... */ };
// 所有内建对象的原型链修改都无法被拦截
```

### 4.5.2 DOM 事件监听器

```typescript
// 沙箱拦截不了直接的 DOM API 调用

// 子应用 A
document.addEventListener('click', handlerA);
document.body.addEventListener('scroll', scrollHandlerA);

// 即使子应用 A 被卸载，这些监听器依然存在
// 因为 document 和 document.body 是共享的
// Proxy 只能拦截 window 上的属性访问
// document.addEventListener 不走 Proxy 的 set trap

// 乾坤的解决方案：在沙箱层面 patch addEventListener
// 记录子应用注册的所有事件监听器
// 卸载时自动移除

function patchDocumentEvents(sandbox: SandBox) {
  const bindEvents: Array<[string, EventListener]> = [];

  const originalAddEventListener = document.addEventListener;
  document.addEventListener = function(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ) {
    bindEvents.push([type, listener]);
    originalAddEventListener.call(document, type, listener, options);
  };

  return function unpatch() {
    bindEvents.forEach(([type, listener]) => {
      document.removeEventListener(type, listener);
    });
    document.addEventListener = originalAddEventListener;
  };
}
```

### 4.5.3 全局定时器

```typescript
// setTimeout/setInterval 返回的 ID 是全局的
// 子应用设置了定时器但卸载时没有清除，定时器还会继续触发

// 子应用 A
const timerId = setInterval(() => {
  // 这个回调会持续执行，即使子应用 A 已经卸载
  updateDashboard(); // 可能操作已经不存在的 DOM
}, 1000);

// 乾坤的解决方案：patch setTimeout/setInterval
function patchTimer(sandbox: SandBox) {
  const timerIds: number[] = [];

  const originalSetInterval = window.setInterval;
  (sandbox.proxy as any).setInterval = function(
    callback: Function,
    delay: number,
    ...args: any[]
  ) {
    const id = originalSetInterval(callback, delay, ...args);
    timerIds.push(id);
    return id;
  };

  return function unpatch() {
    timerIds.forEach((id) => clearInterval(id));
  };
}
```

### 4.5.4 localStorage 和 sessionStorage

```typescript
// localStorage 是共享的，沙箱无法拦截

// 子应用 A
localStorage.setItem('token', 'app-a-token');

// 子应用 B
localStorage.setItem('token', 'app-b-token');

// 子应用 A 再读取
localStorage.getItem('token'); // 'app-b-token' —— 被覆盖了！

// 潜在的解决方案：给 key 加命名空间前缀
function createScopedStorage(appName: string): Storage {
  return new Proxy(localStorage, {
    get(target, prop: keyof Storage) {
      if (prop === 'getItem') {
        return (key: string) => target.getItem(`${appName}:${key}`);
      }
      if (prop === 'setItem') {
        return (key: string, value: string) => target.setItem(`${appName}:${key}`, value);
      }
      if (prop === 'removeItem') {
        return (key: string) => target.removeItem(`${appName}:${key}`);
      }
      return Reflect.get(target, prop);
    },
  });
}

// 但乾坤默认并没有做 localStorage 隔离
// 因为很多场景下子应用之间需要共享 localStorage（如登录 token）
```

### 4.5.5 History 和 Location

```typescript
// history 和 location 是特殊的全局对象
// 它们代表的是浏览器的真实状态，不可能被沙箱替换

// 子应用 A
history.pushState(null, '', '/order/list');

// 这个操作直接影响了浏览器地址栏
// 无法被沙箱隔离——因为浏览器只有一个地址栏

// 类似的还有：
// - navigator（设备信息是共享的）
// - screen（屏幕信息是共享的）
// - performance（性能测量是共享的）
// - fetch/XMLHttpRequest（网络请求是共享的）
```

### 4.5.6 CSS 副作用

```typescript
// JS 沙箱完全无法隔离 CSS

// 子应用 A 通过 JS 动态创建样式
const style = document.createElement('style');
style.textContent = `
  body { background: red; }
  .btn { color: blue; }
`;
document.head.appendChild(style);

// 这些样式是全局生效的
// 会影响所有子应用和主应用
// JS 沙箱无能为力——CSS 隔离需要另一套机制
// （我们在第 5 章会详细讨论）
```

### 4.5.7 逃逸总结

```typescript
// 完整的沙箱逃逸清单
interface SandboxEscapes {
  // 完全无法隔离
  prototypeChain: '原型链修改（Array.prototype 等）';
  sharedDOM: '共享的 DOM 节点（document, document.body）';
  browserAPIs: 'history, location, navigator, screen';
  networkAPIs: 'fetch, XMLHttpRequest, WebSocket';
  storage: 'localStorage, sessionStorage, cookie';
  css: '所有 CSS 副作用';
  webWorkers: 'Worker, SharedWorker, ServiceWorker';

  // 需要额外 patch 才能隔离
  timers: 'setTimeout, setInterval, requestAnimationFrame';
  eventListeners: 'document/window 上的事件监听器';
  mutationObserver: 'MutationObserver';
  resizeObserver: 'ResizeObserver';

  // 可以被 Proxy 沙箱隔离
  windowProperties: 'window 上的直接属性读写';
  globalVariables: '全局变量声明';
}
```

> **深度洞察：完美的 JS 隔离在浏览器中是不可能的**
>
> 为什么浏览器中无法实现完美的 JS 隔离？根源在于浏览器的架构：**同一个页面中的所有 JS 代码共享一个 V8 Isolate 实例。** 而真正的隔离需要独立的 Isolate——这正是 iframe、Web Worker 和 Node.js 的 vm 模块所做的。Proxy 沙箱本质上是在"同一个 Isolate 内模拟多个上下文"，这注定只能拦截属性访问层面的操作，无法拦截引擎层面的共享状态（原型链、内建对象、DOM 树）。这不是乾坤的实现不够好——而是 Proxy 机制本身的理论边界。理解这一点很重要：选择 Proxy 沙箱，就意味着接受"近似隔离"而不是"完美隔离"。如果你的场景需要完美隔离，唯一的选择是 iframe。

## 4.6 手写实现三种沙箱核心逻辑

理论分析完了，让我们从零开始实现三种沙箱。通过手写实现，你会对沙箱的每一个设计决策形成肌肉记忆。

### 4.6.1 手写 SnapshotSandbox

```typescript
// 完整的可运行实现

enum SandBoxType {
  Snapshot = 'Snapshot',
  LegacyProxy = 'LegacyProxy',
  Proxy = 'Proxy',
}

interface SandBox {
  name: string;
  type: SandBoxType;
  proxy: WindowProxy;
  sandboxRunning: boolean;
  active(): void;
  inactive(): void;
}

class MiniSnapshotSandbox implements SandBox {
  name: string;
  type = SandBoxType.Snapshot;
  sandboxRunning = false;
  proxy: WindowProxy;

  private windowSnapshot: Record<string, any> = {};
  private modifyPropsMap: Record<string, any> = {};

  constructor(name: string) {
    this.name = name;
    this.proxy = window; // 直接使用 window
  }

  active() {
    // 第一步：拍摄快照
    this.windowSnapshot = {};
    for (const prop in window) {
      if (window.hasOwnProperty(prop)) {
        this.windowSnapshot[prop] = (window as any)[prop];
      }
    }

    // 第二步：恢复之前的修改
    for (const prop in this.modifyPropsMap) {
      (window as any)[prop] = this.modifyPropsMap[prop];
    }

    this.sandboxRunning = true;
    console.log(`[${this.name}] Snapshot sandbox activated`);
  }

  inactive() {
    this.modifyPropsMap = {};

    // 对比当前 window 与快照，找出差异
    for (const prop in window) {
      if (window.hasOwnProperty(prop)) {
        const currentValue = (window as any)[prop];
        const snapshotValue = this.windowSnapshot[prop];

        if (currentValue !== snapshotValue) {
          // 记录变更
          this.modifyPropsMap[prop] = currentValue;
          // 恢复快照值
          (window as any)[prop] = snapshotValue;
        }
      }
    }

    this.sandboxRunning = false;
    console.log(`[${this.name}] Snapshot sandbox deactivated. Changes recorded: ${Object.keys(this.modifyPropsMap).length}`);
  }
}

// 验证
function testSnapshotSandbox() {
  const sandbox = new MiniSnapshotSandbox('test-app');

  // 记录初始状态
  (window as any).__test_original = 'original';

  sandbox.active();
  (window as any).__test_original = 'modified';
  (window as any).__test_new = 'new value';

  console.log((window as any).__test_original); // 'modified'
  console.log((window as any).__test_new);      // 'new value'

  sandbox.inactive();
  console.log((window as any).__test_original); // 'original' ← 恢复了
  console.log((window as any).__test_new);      // undefined  ← 被清理了

  sandbox.active();
  console.log((window as any).__test_original); // 'modified' ← 重新应用了
  console.log((window as any).__test_new);      // 'new value' ← 重新应用了

  // 清理
  sandbox.inactive();
  delete (window as any).__test_original;
  delete (window as any).__test_new;
}
```

### 4.6.2 手写 LegacySandbox

```typescript
class MiniLegacySandbox implements SandBox {
  name: string;
  type = SandBoxType.LegacyProxy;
  sandboxRunning = false;
  proxy: WindowProxy;

  // 新增的属性
  private addedPropsMap = new Map<PropertyKey, any>();
  // 被修改的属性的原始值
  private modifiedPropsOriginalValueMap = new Map<PropertyKey, any>();
  // 所有变更的当前值（新增 + 修改）
  private currentUpdatedPropsValueMap = new Map<PropertyKey, any>();

  constructor(name: string) {
    this.name = name;

    const self = this;
    const rawWindow = window;
    const fakeWindow = Object.create(null);

    this.proxy = new Proxy(fakeWindow, {
      set(_target: Window, prop: PropertyKey, value: any): boolean {
        if (!self.sandboxRunning) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[${name}] Setting ${String(prop)} while sandbox inactive`);
          }
          return true;
        }

        const originalHasProperty = rawWindow.hasOwnProperty(prop);
        const originalValue = (rawWindow as any)[prop];

        if (!originalHasProperty) {
          // 新增属性
          self.addedPropsMap.set(prop, value);
        } else if (!self.modifiedPropsOriginalValueMap.has(prop)) {
          // 修改已有属性（仅记录第一次修改前的原始值）
          self.modifiedPropsOriginalValueMap.set(prop, originalValue);
        }

        // 记录当前值
        self.currentUpdatedPropsValueMap.set(prop, value);

        // 直接修改真实 window
        (rawWindow as any)[prop] = value;

        return true;
      },

      get(_target: Window, prop: PropertyKey): any {
        // 特殊处理：确保 proxy.window === proxy
        if (prop === 'window' || prop === 'self' || prop === 'globalThis') {
          return self.proxy;
        }
        return (rawWindow as any)[prop];
      },

      has(_target: Window, prop: PropertyKey): boolean {
        return prop in rawWindow;
      },

      deleteProperty(_target: Window, prop: PropertyKey): boolean {
        if (rawWindow.hasOwnProperty(prop)) {
          // 如果是子应用新增的属性，从记录中移除
          if (self.addedPropsMap.has(prop)) {
            self.addedPropsMap.delete(prop);
          }
          // 删除真实 window 上的属性
          delete (rawWindow as any)[prop];
          self.currentUpdatedPropsValueMap.delete(prop);
        }
        return true;
      },
    });
  }

  active() {
    // 恢复子应用的所有变更
    this.currentUpdatedPropsValueMap.forEach((value, prop) => {
      (window as any)[prop] = value;
    });

    this.sandboxRunning = true;
    console.log(`[${this.name}] Legacy sandbox activated`);
  }

  inactive() {
    // 恢复被修改的属性的原始值
    this.modifiedPropsOriginalValueMap.forEach((originalValue, prop) => {
      (window as any)[prop] = originalValue;
    });

    // 删除新增的属性
    this.addedPropsMap.forEach((_value, prop) => {
      delete (window as any)[prop];
    });

    this.sandboxRunning = false;
    console.log(`[${this.name}] Legacy sandbox deactivated`);
  }
}

// 验证
function testLegacySandbox() {
  const sandbox = new MiniLegacySandbox('test-legacy');
  sandbox.active();

  // 通过 proxy 设置
  (sandbox.proxy as any).__legacy_test = 'hello';
  console.log((window as any).__legacy_test); // 'hello' ← 真实 window 被修改了

  sandbox.inactive();
  console.log((window as any).__legacy_test); // undefined ← 恢复了

  sandbox.active();
  console.log((window as any).__legacy_test); // 'hello' ← 重新应用了

  sandbox.inactive();
}
```

### 4.6.3 手写 ProxySandbox

这是最复杂也是最精妙的实现：

```typescript
function miniCreateFakeWindow(globalContext: Window) {
  const propertiesWithGetter = new Map<PropertyKey, boolean>();
  const fakeWindow = {} as Window;

  // 复制不可配置的属性
  Object.getOwnPropertyNames(globalContext)
    .filter((prop) => {
      const descriptor = Object.getOwnPropertyDescriptor(globalContext, prop);
      return !descriptor?.configurable;
    })
    .forEach((prop) => {
      const descriptor = Object.getOwnPropertyDescriptor(globalContext, prop)!;

      if (descriptor.get) {
        propertiesWithGetter.set(prop, true);
      }

      // 复制到 fakeWindow
      // 注意：这里使用 rawDescriptor，保持与原始属性一致
      Object.defineProperty(fakeWindow, prop, {
        ...descriptor,
        // 对于不可配置的属性，我们不能改变它的 configurable
        // 但可以复制其值
      });
    });

  return { fakeWindow, propertiesWithGetter };
}

class MiniProxySandbox implements SandBox {
  name: string;
  type = SandBoxType.Proxy;
  sandboxRunning = false;
  proxy: WindowProxy;

  private updatedValueSet = new Set<PropertyKey>();

  constructor(name: string) {
    this.name = name;

    const self = this;
    const rawWindow = window;
    const { fakeWindow, propertiesWithGetter } = miniCreateFakeWindow(rawWindow);

    this.proxy = new Proxy(fakeWindow, {
      set(target: Window, prop: PropertyKey, value: any): boolean {
        if (self.sandboxRunning) {
          // 写入 fakeWindow，不修改真实 window
          (target as any)[prop] = value;
          self.updatedValueSet.add(prop);
        } else {
          console.warn(`[${name}] Setting ${String(prop)} while sandbox inactive`);
        }
        return true;
      },

      get(target: Window, prop: PropertyKey): any {
        // 避免逃逸：确保 window.window 返回 proxy 而不是真实 window
        if (prop === 'window' || prop === 'self' || prop === 'globalThis') {
          return self.proxy;
        }

        if (prop === Symbol.unscopables) {
          return undefined;
        }

        // 特殊处理 top 和 parent
        if (prop === 'top' || prop === 'parent') {
          if (rawWindow === rawWindow.parent) {
            return self.proxy;
          }
          return (rawWindow as any)[prop];
        }

        // 优先从 fakeWindow 读取
        if (target.hasOwnProperty(prop)) {
          // 有 getter 的属性从真实 window 读取
          if (propertiesWithGetter.has(prop)) {
            return (rawWindow as any)[prop];
          }
          return (target as any)[prop];
        }

        // fakeWindow 上没有，从真实 window 读取
        const rawValue = (rawWindow as any)[prop];

        // 函数需要绑定 this 到 rawWindow
        if (typeof rawValue === 'function') {
          // 某些原生构造函数不能 bind（如 Map, Set, Symbol）
          // 使用 try-catch 兜底
          try {
            const boundFn = rawValue.bind(rawWindow);
            // 保留函数的可枚举属性
            for (const key of Object.keys(rawValue)) {
              boundFn[key] = (rawValue as any)[key];
            }
            return boundFn;
          } catch (e) {
            return rawValue;
          }
        }

        return rawValue;
      },

      has(target: Window, prop: PropertyKey): boolean {
        return prop in target || prop in rawWindow;
      },

      getOwnPropertyDescriptor(target: Window, prop: PropertyKey) {
        if (target.hasOwnProperty(prop)) {
          const descriptor = Object.getOwnPropertyDescriptor(target, prop);
          if (descriptor) {
            descriptor.configurable = true;
          }
          return descriptor;
        }

        const descriptor = Object.getOwnPropertyDescriptor(rawWindow, prop);
        if (descriptor) {
          descriptor.configurable = true;
        }
        return descriptor;
      },

      defineProperty(target: Window, prop: PropertyKey, attributes: PropertyDescriptor): boolean {
        Object.defineProperty(target, prop, attributes);
        return true;
      },

      deleteProperty(target: Window, prop: PropertyKey): boolean {
        if (target.hasOwnProperty(prop)) {
          delete (target as any)[prop];
          self.updatedValueSet.delete(prop);
        }
        return true;
      },

      ownKeys(target: Window): ArrayLike<string | symbol> {
        return [...new Set([
          ...Reflect.ownKeys(rawWindow),
          ...Reflect.ownKeys(target),
        ])];
      },
    });
  }

  active() {
    this.sandboxRunning = true;
    console.log(`[${this.name}] Proxy sandbox activated`);
  }

  inactive() {
    this.sandboxRunning = false;
    console.log(`[${this.name}] Proxy sandbox deactivated`);
  }
}

// 验证多实例隔离
function testProxySandbox() {
  const sandboxA = new MiniProxySandbox('app-A');
  const sandboxB = new MiniProxySandbox('app-B');

  // 同时激活
  sandboxA.active();
  sandboxB.active();

  // 各自设置同名属性
  (sandboxA.proxy as any).__proxy_test = 'value from A';
  (sandboxB.proxy as any).__proxy_test = 'value from B';

  // 验证隔离
  console.log((sandboxA.proxy as any).__proxy_test); // 'value from A'
  console.log((sandboxB.proxy as any).__proxy_test); // 'value from B'
  console.log((window as any).__proxy_test);         // undefined

  // 验证 window 上的属性可以读取
  console.log((sandboxA.proxy as any).console === console); // true
  console.log((sandboxA.proxy as any).Array === Array);     // true

  // 验证 window.window 指向 proxy
  console.log((sandboxA.proxy as any).window === sandboxA.proxy); // true

  sandboxA.inactive();
  sandboxB.inactive();
}
```

### 4.6.4 子应用代码如何在沙箱中执行

有了沙箱，还需要一个关键环节：**如何让子应用的代码运行在沙箱中而不是真实 window 上。** 乾坤使用了 `with` 语句 + `eval` 的组合：

```typescript
// 乾坤执行子应用 JS 的核心逻辑（简化）

function execScriptInSandbox(
  scriptText: string,
  proxy: WindowProxy,
  strictGlobal: boolean
): void {
  // 将子应用的代码包裹在 with 语句中
  // with(proxy) 使得代码中的全局变量查找会通过 proxy 的 has/get trap
  const executableScript = strictGlobal
    ? `;(function(window, self, globalThis){
        with(window){
          ${scriptText}
        }
      }).bind(window.proxy)(window.proxy, window.proxy, window.proxy);`
    : `;(function(window, self, globalThis){
        ${scriptText}
      }).bind(window.proxy)(window.proxy, window.proxy, window.proxy);`;

  // 通过 eval 执行
  (0, eval)(executableScript);
}

// 为什么用 (0, eval) 而不是 eval？
// 直接 eval 是"直接调用"，代码在当前作用域执行
// (0, eval) 是"间接调用"，代码在全局作用域执行
// 我们需要全局作用域——否则子应用的代码会受到当前函数作用域的影响
```

`with` 语句是沙箱机制的关键粘合剂。当子应用的代码在 `with(proxy)` 中执行时：

```typescript
// 子应用的原始代码
var name = 'my-app';
console.log(name);
window.config = { version: '1.0' };

// 在 with(proxy) 中执行时的行为：
// var name = 'my-app'    → 触发 proxy 的 set trap（var 声明的变量会挂载到 with 对象上）
// console.log(name)      → 先触发 proxy 的 has trap，然后触发 get trap
// window.config = ...    → window 参数已被替换为 proxy，所以写入 proxy
```

### 4.6.5 三种沙箱的源码对照表

| 设计决策 | SnapshotSandbox | LegacySandbox | ProxySandbox |
|---------|----------------|---------------|--------------|
| `proxy` 指向 | `window` 自身 | `new Proxy(fakeWindow, ...)` | `new Proxy(fakeWindow, ...)` |
| 写入目标 | `window`（直接） | `window`（通过 set trap） | `fakeWindow`（通过 set trap） |
| 读取来源 | `window`（直接） | `window`（通过 get trap） | `fakeWindow` 优先，降级 `window` |
| 变更追踪 | 事后 diff | 实时记录（3 个 Map） | `updatedValueSet` |
| active 操作 | 拍快照 + 恢复修改 | 恢复所有变更 | 翻转标志位 |
| inactive 操作 | diff + 恢复快照 | 恢复原值 + 删新增 | 翻转标志位 |
| 多实例 | 不支持 | 不支持 | 支持 |
| 性能等级 | O(N) per switch | O(M) per switch | O(1) per switch |

### 4.6.6 沙箱选择策略

```typescript
// 乾坤内部的沙箱选择逻辑（简化）

function createSandbox(
  appName: string,
  useLooseSandbox: boolean,
  singular: boolean
): SandBox {
  // 如果浏览器不支持 Proxy，只能用快照沙箱
  if (!window.Proxy) {
    return new SnapshotSandbox(appName);
  }

  // 如果是单实例模式且使用宽松沙箱
  if (useLooseSandbox && singular) {
    return new LegacySandbox(appName);
  }

  // 默认使用 ProxySandbox
  return new ProxySandbox(appName);
}

// 在实际使用中，绝大多数情况会走到 ProxySandbox
// LegacySandbox 主要是为了向后兼容
// SnapshotSandbox 是 IE 环境的降级方案
```

---

## 本章小结

- **SnapshotSandbox** 通过全量 diff window 实现隔离，实现简单但性能差（O(N)），是 IE 环境的降级方案
- **LegacySandbox** 用 Proxy 实时拦截写入，用三个 Map 精准追踪变更，性能提升到 O(M)，但仍直接修改 window，不支持多实例
- **ProxySandbox** 引入 fakeWindow 实现"写时隔离、读时降级"，切换成本降为 O(1)，支持多实例，是生产环境推荐方案
- **createFakeWindow** 的设计受 Proxy invariant 约束驱动：不可配置的属性必须复制到 target 对象上
- JS 沙箱存在根本性的隔离边界：原型链污染、DOM 事件、定时器、localStorage、History/Location、CSS 副作用等均无法通过 Proxy 拦截
- 完美的 JS 隔离在浏览器中是理论上不可能的——同一页面共享一个 V8 Isolate，Proxy 只能拦截属性访问，无法拦截引擎层面的共享状态
- 子应用代码通过 `with(proxy)` + `(0, eval)` 的方式在沙箱中执行，`with` 语句使全局变量查找走 Proxy 的 has/get trap

## 思考题

1. **源码理解**：LegacySandbox 中的 `modifiedPropsOriginalValueMapInSandbox` 只在第一次修改某个属性时记录原始值。如果删掉这个"只记录第一次"的逻辑（即每次修改都更新原始值），会导致什么问题？请用一个具体的例子说明。

2. **设计分析**：ProxySandbox 的 get trap 中，从 window 上读取函数后会做 `rawValue.bind(rawWindow)`。如果去掉这个 bind 操作，哪些常用的浏览器 API 会出错？请列出至少三个并解释原因。

3. **性能对比**：假设一个子应用在运行期间修改了 30 个 window 属性，而 window 上共有 500 个属性。请分别计算三种沙箱在一次 active + inactive 周期中的属性操作次数，并分析在什么条件下 SnapshotSandbox 的性能反而优于 LegacySandbox。

4. **架构思考**：本章指出"完美的 JS 隔离在浏览器中是不可能的"。如果让你设计一个新的浏览器 API 来实现完美的页面内 JS 隔离（不用 iframe），你会怎么设计？需要 V8 引擎做哪些配合？

5. **实战问题**：你的团队在使用乾坤时发现：子应用 A 修改了 `Array.prototype.toJSON`，导致子应用 B 的 JSON 序列化结果异常。JS 沙箱无法拦截原型链修改，你会如何解决这个问题？请给出至少两种方案并分析各自的优缺点。


</div>
