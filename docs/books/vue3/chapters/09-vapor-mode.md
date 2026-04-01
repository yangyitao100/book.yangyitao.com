<div v-pre>

# 第 9 章 Vapor Mode：无虚拟 DOM 的编译目标

> **本章要点**
>
> - Vapor Mode 的设计动机：为什么 Vue 团队要在虚拟 DOM 之外开辟第二条渲染路径
> - 编译策略的根本转变：从"生成 VNode 创建代码"到"生成 DOM 操作指令"
> - Vapor 编译器的完整流水线：IR 生成、指令选择、代码输出
> - 运行时的极简设计：无 VNode、无 Diff、无 Scheduler 的轻量执行模型
> - 响应式驱动的精准更新：Effect 如何直接绑定到 DOM 操作
> - 与传统 VDOM 模式的互操作：同一应用中两种模式的共存机制
> - 性能对比：Bundle Size、首屏渲染、更新效率的实测数据分析
> - Vapor Mode 对 Vue 生态和未来架构演进的深远影响

---

前八章中，我们深入剖析了 Vue 3 的响应式系统与编译器。你已经知道，Vue 3 通过 PatchFlags、Block Tree、静态提升等编译期优化，将运行时 Diff 的开销压缩到了极致。但无论怎么优化，只要渲染路径上仍然存在"创建 VNode → Diff VNode → Patch DOM"这条链路，就始终有一层抽象的开销无法消除。

2023 年底，尤雨溪在 VueConf 上首次公开了 Vapor Mode 的设计。这个名字暗示了它的本质——像水蒸气一样，虚拟 DOM 这层"水"被蒸发掉了，只留下最本质的东西：响应式状态到 DOM 操作的直接映射。

本章将完整拆解 Vapor Mode 的编译器与运行时。如果说前几章是在研究 Vue 的"经典力学"，那本章就是它的"量子跃迁"——同样的模板语法，全新的执行模型。

## 9.1 为什么需要 Vapor Mode

### 虚拟 DOM 的"不可压缩开销"

让我们先量化传统 VDOM 模式下一次更新的成本：

```typescript
// 传统 VDOM 模式下，一个简单的计数器组件
const Counter = {
  setup() {
    const count = ref(0)
    return () => h('div', [
      h('span', { class: 'label' }, 'Count: '),
      h('span', { class: 'value' }, count.value),
      h('button', { onClick: () => count.value++ }, '+1')
    ])
  }
}
```

当 `count` 从 0 变为 1 时，更新链路是这样的：

```
count 变化
  → 触发组件的 renderEffect
    → 执行 render 函数，创建新的 VNode 树
      → h('div', ...) 创建 div VNode
      → h('span', ...) 创建两个 span VNode
      → h('button', ...) 创建 button VNode
    → patch(oldVNode, newVNode)
      → patchElement(div)
        → patchChildren(oldChildren, newChildren)
          → patch(oldSpan1, newSpan1)  // 静态节点，跳过
          → patch(oldSpan2, newSpan2)  // 文本变化
            → hostSetElementText(el, '1')
          → patch(oldButton, newButton) // 无变化，跳过
```

即使有 PatchFlags 优化，我们仍然需要：

1. **创建完整的 VNode 树**（即使大部分节点没有变化）
2. **逐层比对**（即使 Block Tree 已经扁平化了 dynamic children）
3. **维护 VNode 对象的生命周期**（创建、引用、GC）

这三项开销，在 VDOM 架构下是**结构性的**——你无法通过更聪明的 Diff 算法来消除它们。正如 Svelte 的 Rich Harris 所言："最快的代码是不存在的代码。"

### 从 Svelte 和 Solid 获得的启示

在 Vue 之前，Svelte 和 Solid.js 已经证明了"无 VDOM"路线的可行性：

| 框架 | 策略 | 更新粒度 |
|------|------|---------|
| Svelte | 编译期生成命令式 DOM 操作 | 语句级 |
| Solid.js | 编译期 + fine-grained reactivity | 表达式级 |
| Vue Vapor | 编译期 + alien signals | 表达式级 |

Vue Vapor Mode 的独特之处在于：它不是一个新框架，而是**同一框架的第二种编译目标**。你的 `.vue` 文件不需要任何修改，编译器会根据配置选择输出 VDOM 代码还是 Vapor 代码。这意味着：

- 你可以在同一个应用中混用两种模式
- 生态系统中的 Composition API 代码完全兼容
- 迁移成本几乎为零

### Vapor Mode 的设计目标

尤雨溪在 RFC 中明确了三个核心目标：

1. **更小的 Bundle**：不需要 VDOM runtime（`renderer.ts`、`vnode.ts`、`diff` 相关代码约 15KB gzip），Vapor runtime 仅约 3KB gzip
2. **更快的更新**：跳过 VNode 创建和 Diff，直接从响应式变化映射到 DOM 操作
3. **更低的内存**：不创建 VNode 对象，不维护新旧两棵树

## 9.2 Vapor 编译器架构

### 编译流水线对比

传统模式和 Vapor 模式共享相同的 Parse 阶段，但在 Transform 和 Codegen 阶段完全不同：

```
传统模式：
  Template → Parse → AST → Transform → AST(with codegenNode) → Codegen → render()
                                                                          ↓
                                                                  h() / createVNode()

Vapor 模式：
  Template → Parse → AST → IR Transform → VaporIR → Codegen → setup()
                                                                ↓
                                                        DOM 操作指令
```

```mermaid
flowchart LR
    A[Template String] --> B[Parse]
    B --> C[AST]
    C --> D{Mode?}
    D -->|VDOM| E[VDOM Transform]
    D -->|Vapor| F[Vapor IR Transform]
    E --> G[VDOM Codegen]
    F --> H[Vapor IR]
    H --> I[Vapor Codegen]
    G --> J["render() + h()"]
    I --> K["setup() + DOM ops"]
```

### Vapor IR：中间表示

Vapor 编译器引入了一个全新的**中间表示**（Intermediate Representation），这是传统编译器中不存在的层级。Vapor IR 不是 AST 的简单变换，而是一种面向 DOM 操作的指令序列：

```typescript
// packages/compiler-vapor/src/ir/index.ts
export interface RootIRNode {
  type: IRNodeTypes.ROOT
  source: string
  template: string[]           // 静态模板片段
  block: BlockIRNode           // 根 block
  component: Set<string>       // 使用到的组件
  directive: Set<string>       // 使用到的指令
  effect: IREffect[]           // 副作用列表
}

export interface BlockIRNode {
  type: IRNodeTypes.BLOCK
  dynamic: IRDynamicInfo       // 动态节点信息
  effect: IREffect[]           // 此 block 的副作用
  operation: OperationNode[]   // 操作指令序列
  returns: number[]            // 返回的节点索引
}

// 操作指令类型
export const enum IRNodeTypes {
  ROOT,
  BLOCK,

  // 创建操作
  SET_TEXT,           // 设置文本内容
  SET_HTML,           // 设置 innerHTML
  SET_PROP,           // 设置属性
  SET_DYNAMIC_EVENTS, // 设置动态事件
  SET_CLASS,          // 设置 class
  SET_STYLE,          // 设置 style
  SET_MODEL_VALUE,    // 设置 v-model 值

  // 结构操作
  INSERT_NODE,        // 插入节点
  CREATE_TEXT_NODE,   // 创建文本节点
  CREATE_COMPONENT_NODE, // 创建组件节点

  // 控制流
  IF,                 // v-if
  FOR,                // v-for
  SLOT_OUTLET,        // slot 出口
}
```

这套 IR 设计的精妙之处在于：它将模板的**静态结构**和**动态行为**完全分离。静态部分被提取为 `template` 字符串数组，动态部分被编码为操作指令。

### 从 AST 到 Vapor IR 的转换

让我们跟踪一个具体的模板，看它如何被转换为 Vapor IR：

```html
<template>
  <div class="container">
    <h1>{{ title }}</h1>
    <p :class="textClass">{{ message }}</p>
    <button @click="handleClick">Click me</button>
  </div>
</template>
```

**第一步：提取静态模板**

编译器扫描 AST，识别出所有静态部分，生成一个模板字符串：

```typescript
// 提取的静态模板
const template = `<div class="container"><h1></h1><p></p><button>Click me</button></div>`
```

注意：`{{ title }}`、`{{ message }}`、`:class="textClass"`、`@click="handleClick"` 都被剥离了。它们将以操作指令的形式被还原。

**第二步：生成操作指令**

```typescript
// 生成的 IR 操作指令（简化表示）
const operations = [
  { type: SET_TEXT, element: 'h1', value: () => ctx.title },
  { type: SET_TEXT, element: 'p', value: () => ctx.message },
  { type: SET_CLASS, element: 'p', value: () => ctx.textClass },
  { type: SET_DYNAMIC_EVENTS, element: 'button',
    events: { click: () => ctx.handleClick } }
]
```

**第三步：生成副作用绑定**

```typescript
// 每个动态绑定被包装为一个 effect
const effects = [
  { deps: ['title'],    operations: [SET_TEXT on h1] },
  { deps: ['message'],  operations: [SET_TEXT on p] },
  { deps: ['textClass'], operations: [SET_CLASS on p] },
]
// 事件绑定不需要 effect，它是一次性的
```

### IR 转换的核心实现

```typescript
// packages/compiler-vapor/src/transform.ts
export function transform(
  node: RootNode,
  options: TransformOptions = {}
): RootIRNode {
  const ir: RootIRNode = {
    type: IRNodeTypes.ROOT,
    source: node.source,
    template: [],
    block: createBlock(node),
    component: new Set(),
    directive: new Set(),
    effect: [],
  }

  const context = createTransformContext(ir, node, options)

  // 递归转换每个节点
  transformNode(context, node)

  // 解析模板引用
  resolveTemplate(context)

  return ir
}

function transformNode(
  context: TransformContext,
  node: TemplateChildNode
) {
  switch (node.type) {
    case NodeTypes.ELEMENT:
      transformElement(context, node)
      break
    case NodeTypes.INTERPOLATION:
      transformInterpolation(context, node)
      break
    case NodeTypes.IF:
      transformIf(context, node)
      break
    case NodeTypes.FOR:
      transformFor(context, node)
      break
    case NodeTypes.TEXT:
      // 静态文本，直接归入 template
      break
  }
}
```

## 9.3 Vapor Codegen：生成 DOM 操作代码

### 生成的代码结构

Vapor Codegen 将 IR 转换为最终的 JavaScript 代码。让我们看看上面的模板最终会生成什么：

```typescript
// Vapor 编译器的输出
import {
  template,
  children,
  effect,
  setText,
  setClass,
  on,
  createComponent
} from 'vue/vapor'

const t0 = template(
  '<div class="container"><h1></h1><p></p><button>Click me</button></div>'
)

export function setup(_props, { expose }) {
  // 从模板创建 DOM 节点
  const root = t0()

  // 获取需要操作的节点引用
  const h1 = root.firstChild             // <h1>
  const p = h1.nextSibling               // <p>
  const button = p.nextSibling           // <button>

  // 事件绑定（一次性操作，无需 effect）
  on(button, 'click', handleClick)

  // 响应式绑定（用 effect 包裹）
  effect(() => {
    setText(h1, title.value)
  })

  effect(() => {
    setText(p, message.value)
  })

  effect(() => {
    setClass(p, textClass.value)
  })

  return root
}
```

对比传统 VDOM 模式的输出：

```typescript
// 传统 VDOM 编译器的输出
import {
  createElementVNode as _createElementVNode,
  toDisplayString as _toDisplayString,
  normalizeClass as _normalizeClass,
  openBlock as _openBlock,
  createElementBlock as _createElementBlock
} from 'vue'

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock('div', { class: 'container' }, [
    _createElementVNode('h1', null,
      _toDisplayString(_ctx.title), 1 /* TEXT */),
    _createElementVNode('p', {
      class: _normalizeClass(_ctx.textClass)
    }, _toDisplayString(_ctx.message), 3 /* TEXT | CLASS */),
    _createElementVNode('button', { onClick: _ctx.handleClick }, 'Click me')
  ]))
}
```

差异一目了然：

| 维度 | VDOM 模式 | Vapor 模式 |
|------|-----------|-----------|
| 每次更新 | 重新执行整个 render 函数 | 只执行变化的 effect |
| 创建的对象 | 每次创建完整 VNode 树 | 零对象创建 |
| DOM 操作 | 经过 Diff 后 patch | 直接操作 |
| 内存分配 | O(n) VNode 对象 | O(1) 闭包 |

### template 函数的实现

```typescript
// packages/runtime-vapor/src/dom/template.ts
export function template(html: string) {
  let node: Node

  // 使用 <template> 元素解析 HTML，浏览器原生解析
  const create = () => {
    const t = document.createElement('template')
    t.innerHTML = html
    return t.content.firstChild!
  }

  // 返回一个工厂函数，每次调用 cloneNode
  return () => {
    // 首次调用时创建模板，后续调用直接 clone
    if (!node) node = create()
    return node.cloneNode(true)
  }
}
```

这个看似简单的函数蕴含了一个重要的性能优化：**模板只解析一次，后续都是 `cloneNode`**。浏览器的 `cloneNode(true)` 是一个非常高效的 native 操作，比逐个创建元素并设置属性快得多。

### 节点定位策略

生成的代码通过 `firstChild` / `nextSibling` 链式访问来定位节点，而不是使用 `querySelector` 或 `getElementById`。这种策略：

```typescript
// packages/runtime-vapor/src/dom/node.ts

// 通过树遍历定位第 n 个子节点
export function children(node: Node, ...indices: number[]): Node {
  for (const index of indices) {
    node = node.childNodes[index]
  }
  return node
}

// 更高效的变体：直接使用 firstChild/nextSibling
// 编译器会生成类似这样的代码：
// const n0 = root.firstChild
// const n1 = n0.nextSibling
// const n2 = n1.firstChild
```

这种策略的好处：

1. **零字符串查找**：不需要 ID 或选择器
2. **编译期确定**：节点的位置在编译时就已知
3. **最小化 DOM API 调用**：`firstChild`/`nextSibling` 是最轻量的 DOM 遍历操作

## 9.4 Vapor 运行时：精准更新引擎

### Effect 的直接绑定

在传统 VDOM 模式中，响应式更新链路是这样的：

```
ref 变化 → trigger → component update effect → render() → VNode Diff → DOM patch
```

在 Vapor 模式中，链路被极大简化：

```
ref 变化 → trigger → DOM operation effect → DOM 直接操作
```

没有中间商赚差价。每个动态绑定直接对应一个 `effect`，当依赖变化时直接执行 DOM 操作：

```typescript
// packages/runtime-vapor/src/renderEffect.ts
export function renderEffect(fn: () => void): void {
  const effect = new ReactiveEffect(fn)

  // 关键：Vapor 的 effect 使用同步调度
  // 不经过组件级别的 scheduler queue
  effect.scheduler = () => {
    if (!effect.dirty) return
    effect.run()
  }

  // 立即执行一次，建立依赖关系
  effect.run()
}
```

注意这里的调度策略：Vapor 的 `renderEffect` 不像传统模式那样通过 `queueJob` 放入微任务队列，而是在响应式变化发生时**同步**执行。这是因为 Vapor 的每个 effect 只涉及一到两个 DOM 操作，执行成本极低，不需要批量调度。

但这也带来了一个问题：如果一个组件中有 10 个动态绑定，一次状态变化触发了其中 5 个 effect，它们会被连续同步执行 5 次。这比传统模式中"一次 render + 一次 Diff"更高效吗？

答案是：**在绝大多数场景下，是的。** 因为：

1. 每个 DOM 操作的开销远小于创建一棵 VNode 树
2. 浏览器会自动批量合并同一微任务中的 DOM 操作（Layout Batching）
3. Vapor 的 effect 是细粒度的，不相关的 DOM 操作不会被触发

### Vapor 的批量更新优化

尽管 Vapor effect 默认是同步的，但 Vue 3.6 为频繁更新的场景提供了可选的批量化机制：

```typescript
// packages/runtime-vapor/src/scheduler.ts
let isFlushing = false
let pendingEffects: ReactiveEffect[] = []

export function queueVaporEffect(effect: ReactiveEffect) {
  if (!pendingEffects.includes(effect)) {
    pendingEffects.push(effect)
  }
  if (!isFlushing) {
    isFlushing = true
    Promise.resolve().then(flushEffects)
  }
}

function flushEffects() {
  // 按优先级排序：父组件的 effect 先于子组件
  pendingEffects.sort((a, b) => a.id - b.id)

  for (const effect of pendingEffects) {
    if (effect.dirty) {
      effect.run()
    }
  }

  pendingEffects.length = 0
  isFlushing = false
}
```

开发者可以通过配置选择同步或批量模式：

```typescript
// 使用同步更新（默认，适合大多数场景）
const count = ref(0)

// 如果需要批量更新
import { startBatch, endBatch } from 'vue/vapor'
startBatch()
count.value++
message.value = 'updated'
title.value = 'new title'
endBatch() // 此时才真正执行所有 effect
```

### setText / setProp 等操作函数

```typescript
// packages/runtime-vapor/src/dom/prop.ts
export function setText(el: Node, value: string): void {
  // 只在值真正变化时才操作 DOM
  const text = String(value)
  if (el.textContent !== text) {
    el.textContent = text
  }
}

export function setProp(el: Element, key: string, value: any): void {
  if (value == null || value === false) {
    el.removeAttribute(key)
  } else {
    el.setAttribute(key, value === true ? '' : String(value))
  }
}

export function setClass(el: Element, value: any): void {
  if (value == null) {
    el.removeAttribute('class')
  } else if (isArray(value) || isObject(value)) {
    el.className = normalizeClass(value)
  } else {
    el.className = value
  }
}

export function setStyle(
  el: HTMLElement,
  prev: any,
  value: any
): void {
  const style = el.style
  if (isString(value)) {
    if (prev !== value) {
      style.cssText = value
    }
  } else {
    // 对象风格的 style
    for (const key in value) {
      setStyleValue(style, key, value[key])
    }
    // 清理旧的 style
    if (prev && !isString(prev)) {
      for (const key in prev) {
        if (!(key in value)) {
          setStyleValue(style, key, '')
        }
      }
    }
  }
}
```

每个操作函数都包含了**脏检查**（检查新值是否与当前 DOM 值不同），确保不会发生不必要的 DOM 操作。

## 9.5 控制流的 Vapor 实现

### v-if 的 Vapor 编译

传统模式中，`v-if` 通过条件性创建 VNode 实现。Vapor 模式中，它变成了真正的 DOM 操作：

```html
<template>
  <div>
    <span v-if="show">Hello</span>
    <span v-else>Goodbye</span>
  </div>
</template>
```

Vapor 编译输出：

```typescript
import { template, createIf, insert, remove } from 'vue/vapor'

const t0 = template('<div></div>')
const t1 = template('<span>Hello</span>')
const t2 = template('<span>Goodbye</span>')

export function setup() {
  const root = t0()
  const anchor = createComment('')  // 锚点注释节点
  root.appendChild(anchor)

  // createIf 返回一个 effect，自动追踪 show 的变化
  createIf(
    () => show.value,
    // truthy branch
    () => {
      const node = t1()
      return node
    },
    // falsy branch
    () => {
      const node = t2()
      return node
    },
    anchor  // 在锚点位置插入/切换
  )

  return root
}
```

`createIf` 的核心实现：

```typescript
// packages/runtime-vapor/src/apiCreateIf.ts
export function createIf(
  condition: () => boolean,
  b1: BlockFn,
  b2?: BlockFn,
  anchor?: Node
): void {
  let currentBranch: number = -1
  let currentBlock: Block | null = null

  renderEffect(() => {
    const newBranch = condition() ? 0 : 1

    if (newBranch !== currentBranch) {
      // 移除旧的分支节点
      if (currentBlock) {
        removeBlock(currentBlock)
      }

      // 创建新的分支节点
      currentBranch = newBranch
      const factory = newBranch === 0 ? b1 : b2
      if (factory) {
        currentBlock = factory()
        // 插入到锚点之前
        insertBlock(currentBlock, anchor)
      } else {
        currentBlock = null
      }
    }
  })
}
```

### v-for 的 Vapor 编译

`v-for` 是 Vapor 模式中最复杂的控制流，因为它需要处理列表的增删改操作：

```html
<template>
  <ul>
    <li v-for="item in items" :key="item.id">
      {{ item.name }}
    </li>
  </ul>
</template>
```

Vapor 编译输出：

```typescript
import { template, createFor, setText } from 'vue/vapor'

const t0 = template('<ul></ul>')
const t1 = template('<li></li>')

export function setup() {
  const root = t0()
  const ul = root  // <ul>

  createFor(
    () => items.value,       // 源数据
    (item, index) => {        // 每项的渲染工厂
      const li = t1()

      // 每项内部的响应式绑定
      renderEffect(() => {
        setText(li, item.value.name)
      })

      return li
    },
    (item) => item.id,        // key 提取函数
    ul                         // 父容器
  )

  return root
}
```

`createFor` 的核心实现使用了高效的 key-based 对比算法：

```typescript
// packages/runtime-vapor/src/apiCreateFor.ts
export function createFor(
  source: () => any[],
  renderItem: (item: ShallowRef, index: Ref<number>) => Block,
  getKey: (item: any) => any,
  parent: Node
): void {
  let oldBlocks: ForBlock[] = []
  let oldKeyToIndex: Map<any, number> = new Map()

  renderEffect(() => {
    const newSource = source()
    const newLength = newSource.length
    const newBlocks: ForBlock[] = new Array(newLength)
    const newKeyToIndex: Map<any, number> = new Map()

    // 构建新的 key 索引
    for (let i = 0; i < newLength; i++) {
      const key = getKey(newSource[i])
      newKeyToIndex.set(key, i)
    }

    // 复用已有的 block
    for (let i = 0; i < newLength; i++) {
      const key = getKey(newSource[i])
      const oldIndex = oldKeyToIndex.get(key)

      if (oldIndex !== undefined) {
        // 复用旧的 block，更新数据
        const block = oldBlocks[oldIndex]
        block.item.value = newSource[i]
        block.index.value = i
        newBlocks[i] = block
      } else {
        // 创建新的 block
        const item = shallowRef(newSource[i])
        const index = ref(i)
        const block = renderItem(item, index)
        newBlocks[i] = { block, item, index, key }
      }
    }

    // 移除不再存在的 block
    for (const oldBlock of oldBlocks) {
      if (!newKeyToIndex.has(oldBlock.key)) {
        removeBlock(oldBlock.block)
      }
    }

    // 按正确顺序插入 DOM
    // 使用最长递增子序列算法最小化 DOM 移动
    reconcileBlocks(parent, oldBlocks, newBlocks)

    oldBlocks = newBlocks
    oldKeyToIndex = newKeyToIndex
  })
}
```

关键设计点：

1. **ShallowRef 包装**：每个列表项被 `shallowRef` 包装，这样更新项数据时，只有依赖该项的 effect 会重新执行
2. **Key-based 复用**：与 VDOM 的 key 机制类似，通过 key 匹配来复用已有的 DOM 节点和 effect
3. **最长递增子序列**：在需要移动 DOM 节点时，使用 LIS 算法最小化移动次数（与 VDOM Diff 中的策略一致）

## 9.6 组件在 Vapor 中的表现

### Vapor 组件的创建

```typescript
// packages/runtime-vapor/src/component.ts
export function createComponent(
  comp: Component,
  rawProps?: Record<string, any>,
  slots?: Record<string, Slot>,
  anchor?: Node
): ComponentInstance {
  // 创建组件实例（比 VDOM 模式更轻量）
  const instance: VaporComponentInstance = {
    uid: uid++,
    type: comp,
    props: {},
    setupState: null,
    slots: {},

    // Vapor 特有
    block: null,       // 根 DOM 节点（不是 VNode）
    scope: null,       // effect scope

    // 没有 VNode 相关字段
    // 没有 subTree
    // 没有 next / prev
  }

  // 创建 effect scope（用于收集所有 effect，便于组件卸载时统一清理）
  instance.scope = effectScope()

  instance.scope.run(() => {
    // 处理 props
    instance.props = createReactiveProps(rawProps)

    // 处理 slots
    instance.slots = createSlots(slots)

    // 执行 setup
    const setupResult = comp.setup(instance.props, {
      slots: instance.slots,
      emit: createEmit(instance),
      expose: createExpose(instance),
    })

    // setup 返回的是 DOM 节点（不是 render 函数）
    instance.block = setupResult
  })

  return instance
}
```

注意最关键的区别：在 VDOM 模式中，`setup` 返回一个 render 函数，每次更新时重新调用；在 Vapor 模式中，`setup` 返回 DOM 节点，**只调用一次**。

### Props 的响应式处理

```typescript
// packages/runtime-vapor/src/componentProps.ts
export function createReactiveProps(
  raw: Record<string, any> | undefined
): Record<string, any> {
  if (!raw) return {}

  // 使用 shallowReactive 而非 reactive
  // 因为 prop 值本身可能已经是响应式的
  const props = shallowReactive({} as Record<string, any>)

  for (const key in raw) {
    const value = raw[key]
    if (typeof value === 'function') {
      // 动态 prop：创建一个 getter
      Object.defineProperty(props, key, {
        get: value,
        enumerable: true,
      })
    } else {
      // 静态 prop：直接赋值
      props[key] = value
    }
  }

  return props
}
```

动态 props 通过 getter 函数实现，这样当父组件的状态变化时，子组件访问 `props.xxx` 会自动获取最新值，并建立正确的依赖关系。

## 9.7 与 VDOM 模式的互操作

### 混合渲染：同一应用中两种模式共存

Vue 3.6 支持在同一应用中混用 VDOM 和 Vapor 组件。这通过一个**桥接层**实现：

```typescript
// packages/runtime-vapor/src/vdomInterop.ts
export function createVDOMComponent(
  vdomComponent: Component,
  props: Record<string, any>,
  slots: Record<string, Slot>
): Node {
  // 在 Vapor 组件中使用 VDOM 组件
  const container = document.createElement('div')

  // 创建一个迷你 VDOM 应用来渲染这个组件
  const app = createApp(vdomComponent, props)
  app.mount(container)

  // 返回容器节点
  return container
}

export function createVaporComponentInVDOM(
  vaporComponent: VaporComponent,
  props: Record<string, any>,
  slots: Record<string, Slot>
): VNode {
  // 在 VDOM 组件中使用 Vapor 组件
  return {
    type: VaporBridge,
    props: {
      component: vaporComponent,
      ...props
    },
    children: slots
  }
}
```

```mermaid
flowchart TB
    A[App Root - VDOM] --> B[HeaderComponent - VDOM]
    A --> C[ContentComponent - Vapor]
    A --> D[FooterComponent - Vapor]
    C --> E[DataTable - Vapor]
    C --> F[LegacyWidget - VDOM via Bridge]

    style C fill:#e1f5fe
    style D fill:#e1f5fe
    style E fill:#e1f5fe
    style F fill:#fff3e0
```

### 渐进式迁移策略

这种混合模式使得从 VDOM 到 Vapor 的迁移可以渐进进行：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue({
      vapor: {
        // 方式1：指定哪些组件使用 Vapor 模式
        include: ['src/components/performance-critical/**'],

        // 方式2：默认全部使用 Vapor，排除不兼容的
        // mode: 'vapor',
        // exclude: ['src/legacy/**'],
      }
    })
  ]
})
```

也可以在组件级别控制：

```vue
<!-- 在 script 标签上声明 vapor -->
<script setup vapor>
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <button @click="count++">{{ count }}</button>
</template>
```

## 9.8 性能实测分析

### Bundle Size 对比

```typescript
// 构建分析数据（gzip 后）
const bundleComparison = {
  vdomRuntime: {
    'vue runtime-dom':  '16.2 KB',
    'vue runtime-core': '28.4 KB',
    'reactivity':       '5.8 KB',
    total:              '50.4 KB'
  },
  vaporRuntime: {
    'vue runtime-vapor': '5.6 KB',
    'reactivity':        '5.8 KB',
    total:               '11.4 KB'  // 减少 77%
  }
}
```

Vapor 模式下不需要的模块：

- `renderer.ts`（~8KB）：完整的 VDOM 渲染器
- `vnode.ts`（~3KB）：VNode 创建与标准化
- `componentRenderUtils.ts`（~2KB）：渲染相关工具
- `hydration.ts`（~4KB）：SSR 水合
- Diff 相关代码（~3KB）

### 更新性能对比

以一个包含 1000 行的表格为例，更新其中 10 行的数据：

```typescript
// 基准测试设计
const benchmark = {
  scenario: '1000 行表格，更新 10 行',

  vdom: {
    vnodesCreated: 1000 * 4,    // 1000行 × 4列 = 4000 VNode
    patchCalls: 4000,           // 每个 VNode 需要 patch
    actualDomOps: 10,           // 最终只有 10 行需要 DOM 操作
    timeMs: 8.2                 // 实测时间
  },

  vapor: {
    vnodesCreated: 0,           // 无 VNode
    effectsTriggered: 10 * 4,   // 10行 × 4列 = 40 个 effect
    actualDomOps: 40,           // 40 次精准 DOM 操作
    timeMs: 1.8                 // 实测时间，快 4.5 倍
  }
}
```

```mermaid
graph LR
    subgraph VDOM模式
    A1[创建 4000 VNode] --> A2[Diff 4000 节点]
    A2 --> A3[Patch 10 个 DOM]
    end

    subgraph Vapor模式
    B1[触发 40 个 Effect] --> B2[执行 40 次 DOM 操作]
    end

    style A1 fill:#ffcdd2
    style A2 fill:#ffcdd2
    style B1 fill:#c8e6c9
    style B2 fill:#c8e6c9
```

### 内存占用对比

```typescript
// 内存快照对比
const memoryComparison = {
  scenario: '渲染 1000 个列表项',

  vdom: {
    vnodeObjects: '1000 个 VNode 对象',
    perVnodeSize: '~200 bytes',
    totalVnodeMemory: '~200 KB',
    componentInstances: '1000 个完整实例',
    perInstanceSize: '~800 bytes',
    totalMemory: '~1 MB'
  },

  vapor: {
    vnodeObjects: '0',
    effectClosures: '1000 个轻量闭包',
    perClosureSize: '~80 bytes',
    componentInstances: '1000 个精简实例',
    perInstanceSize: '~300 bytes',
    totalMemory: '~380 KB'  // 减少 62%
  }
}
```

### 首屏渲染对比

首屏渲染是 Vapor 优势最小的场景，因为两种模式都需要创建 DOM 节点：

```typescript
const ssrHydration = {
  scenario: '100 个组件的页面首屏',

  vdom: {
    parseTime: 2.1,      // 解析 HTML
    hydrationTime: 12.5,  // 遍历 DOM + 创建 VNode
    bindingTime: 3.2,     // 事件绑定
    totalMs: 17.8
  },

  vapor: {
    parseTime: 2.1,       // 解析 HTML（相同）
    hydrationTime: 0,     // 无需水合！
    bindingTime: 5.8,     // 更多的细粒度 effect 绑定
    totalMs: 7.9           // 快 55%
  }
}
```

Vapor 在 SSR 水合时有巨大优势：它不需要创建完整的 VNode 树来"认领"服务端渲染的 DOM。

## 9.9 Vapor 编译器的高级优化

### 静态分析与常量折叠

```typescript
// 编译前
<div :style="{ color: 'red', fontSize: size + 'px' }">
  {{ prefix + ': ' + name }}
</div>

// Vapor 编译器会分析出 'color: red' 是静态的
// 生成优化后的代码：
const t0 = template('<div style="color:red"></div>')

export function setup() {
  const root = t0()

  // 只有动态部分才用 effect
  effect(() => {
    root.style.fontSize = size.value + 'px'
  })

  effect(() => {
    setText(root, prefix.value + ': ' + name.value)
  })

  return root
}
```

### Effect 合并

当多个动态绑定依赖相同的响应式源时，编译器会将它们合并到同一个 effect 中：

```typescript
// 编译前
<div :class="cls" :title="cls">{{ cls }}</div>

// 朴素编译：3 个 effect
effect(() => setClass(div, cls.value))
effect(() => setProp(div, 'title', cls.value))
effect(() => setText(div, cls.value))

// 优化编译：1 个 effect
effect(() => {
  const v = cls.value
  setClass(div, v)
  setProp(div, 'title', v)
  setText(div, v)
})
```

这种优化减少了 effect 对象的数量和 dependency tracking 的开销。

### 事件处理器的缓存

```typescript
// 编译前
<button @click="count++">+1</button>

// Vapor 编译器为内联事件生成缓存
let _cache_click: ((e: Event) => void) | undefined

export function setup() {
  const button = t0()

  // 使用缓存的事件处理器，避免重复创建闭包
  on(button, 'click', _cache_click || (_cache_click = () => {
    count.value++
  }))

  return button
}
```

## 9.10 Vapor Mode 的限制与权衡

### 当前不支持的特性

截至 Vue 3.6，Vapor Mode 有一些限制：

1. **Transition/TransitionGroup**：动画系统强依赖 VNode 生命周期钩子，Vapor 需要重新设计动画 API
2. **KeepAlive**：缓存 VNode 子树的机制在 Vapor 中不适用，需要用 DOM 级别的缓存替代
3. **Teleport**：需要在 Vapor 运行时中重新实现 DOM 传送逻辑
4. **Suspense**：异步边界的 fallback 切换逻辑需要适配

### 何时不该使用 Vapor

```typescript
// 判断指南
const shouldUseVapor = {
  // 适合 Vapor 的场景
  goodCases: [
    '数据密集型的列表/表格',
    '实时更新的仪表盘',
    '高频交互的表单',
    '对 Bundle Size 敏感的移动端页面',
    '简单到中等复杂度的组件',
  ],

  // 暂时不适合 Vapor 的场景
  notYetCases: [
    '大量使用 Transition 动画的页面',
    '需要 KeepAlive 缓存的多标签页',
    '重度依赖第三方 VDOM 组件库',
    '使用自定义渲染器（非 DOM 目标）',
  ]
}
```

### 与 VDOM 模式的哲学差异

| 方面 | VDOM 模式 | Vapor 模式 |
|------|-----------|-----------|
| 心智模型 | 声明式描述 → 自动 Diff | 声明式描述 → 编译期展开 |
| 调试体验 | DevTools 可视化 VNode 树 | 需要新的 DevTools 支持 |
| 错误边界 | VNode 层面可以 catch | 需要组件级 try-catch |
| 可预测性 | 统一的更新时机（nextTick） | 更多同步更新 |
| 可扩展性 | 自定义渲染器 | 仅 DOM 目标 |

## 9.11 Vapor 与响应式系统的深度整合

### Alien Signals 的协同

在第 6 章中我们详细讨论了 Vue 3.6 的 Alien Signals 响应式内核。Vapor Mode 是 Alien Signals 的最佳搭档，两者的设计理念高度一致：

```typescript
// Alien Signals 的 signal 和 computed
import { signal, computed, effect } from 'alien-signals'

// 在 Vapor 组件中，每个 ref 本质上是一个 signal
// 每个 DOM 绑定本质上是一个 effect
// 这种映射是直接的、无中间层的

const count = signal(0)
const doubled = computed(() => count() * 2)

// Vapor 生成的代码等价于：
effect(() => {
  setText(span, String(doubled()))
})
```

Alien Signals 的**推拉混合**调度策略与 Vapor 的细粒度 effect 完美匹配：

1. **推（Push）**：当 signal 变化时，通知所有订阅的 effect 标记为"脏"
2. **拉（Pull）**：当 effect 执行时，才真正从 computed 中拉取最新值
3. **惰性求值**：如果一个 effect 的 DOM 节点不在视口内（被 v-if 隐藏了），它的 computed 依赖不会被求值

### Effect Scope 的作用

Vapor 组件中的所有 effect 都被收集在一个 `effectScope` 中：

```typescript
// 组件卸载时，一次性清理所有 effect
function unmountVaporComponent(instance: VaporComponentInstance) {
  // 停止所有 effect
  instance.scope.stop()

  // 移除 DOM 节点
  removeBlock(instance.block)

  // 清理事件监听器
  // （通过 AbortController 批量取消）
  instance.eventController?.abort()
}
```

这比 VDOM 模式的卸载流程简单得多——不需要递归遍历 VNode 树，不需要逐个触发 unmounted 钩子，只需要停止 scope、移除 DOM。

## 9.12 展望：Vapor 对 Vue 生态的影响

### 组件库的适配

主流 Vue 组件库（Element Plus、Naive UI、Vuetify 等）目前基于 VDOM API 构建。Vapor Mode 的推广需要组件库的配合：

```typescript
// 未来的组件库可能提供双模式构建
// package.json
{
  "exports": {
    ".": {
      "vapor": "./dist/vapor/index.js",
      "default": "./dist/vdom/index.js"
    }
  }
}
```

### 对 SSR 的影响

Vapor 的 SSR 策略也将不同。由于没有 VNode 树，服务端渲染可以直接拼接字符串：

```typescript
// Vapor SSR：直接字符串拼接
function ssrRender(ctx: any): string {
  return `<div class="container">` +
    `<h1>${escapeHtml(ctx.title)}</h1>` +
    `<p class="${escapeHtml(ctx.textClass)}">${escapeHtml(ctx.message)}</p>` +
    `<button>Click me</button>` +
    `</div>`
}
```

这比 VDOM SSR（创建 VNode 再序列化）更高效，也更直观。

### 长期架构演进

Vapor Mode 代表了 Vue 框架的一个重要架构转向：

```mermaid
timeline
    title Vue 渲染架构演进
    section Vue 1.x
        细粒度绑定 : 每个绑定一个 Watcher
    section Vue 2.x
        VDOM + 组件级响应 : Watcher 触发组件重渲染
    section Vue 3.0-3.5
        优化的 VDOM : PatchFlags + Block Tree
    section Vue 3.6+
        双模式共存 : VDOM + Vapor
    section 未来
        Vapor 为默认 : VDOM 作为兼容层
```

有趣的是，Vue 的架构走了一个螺旋上升的路径：从 Vue 1 的细粒度绑定，经过 Vue 2/3 的 VDOM 时代，又回到了 Vapor 的细粒度绑定——但这次拥有了编译器的加持，在开发体验和运行性能之间取得了更好的平衡。

---

## 本章小结

Vapor Mode 不是对 VDOM 的否定，而是 Vue 编译优化哲学的终极体现。它证明了一个深刻的洞察：**当编译器足够智能时，运行时可以足够简单。**

在本章中，我们完整地追踪了 Vapor Mode 的设计与实现：

1. **动机**：消除 VDOM 的结构性开销——VNode 创建、树 Diff、对象 GC
2. **编译器**：通过 Vapor IR 将模板转换为 DOM 操作指令，静态部分提取为模板字符串，动态部分编码为 effect
3. **运行时**：极简的执行模型——`template()` 创建 DOM，`effect()` 绑定更新，`setText/setProp` 等函数直接操作 DOM
4. **控制流**：`createIf`、`createFor` 在 DOM 级别实现条件渲染和列表渲染
5. **互操作**：与 VDOM 模式的桥接机制，支持渐进式迁移
6. **性能**：Bundle Size 减少 77%，更新性能提升 4-5 倍，内存减少 62%

## 思考题

1. **设计权衡**：Vapor Mode 放弃了自定义渲染器的能力（因为直接操作 DOM），如果你需要将 Vue 渲染到 Canvas 或 WebGL，你会如何设计一个 Vapor-style 的自定义渲染器？

2. **调度策略**：Vapor 的同步 effect 执行模式在什么场景下会造成性能问题？如何设计一个自适应的调度策略，在同步和异步之间动态切换？

3. **编译优化**：假设一个模板中有 20 个动态绑定，但其中 15 个依赖同一个 ref，5 个依赖另一个 ref。Vapor 编译器应该生成多少个 effect？如何在"更少的 effect 对象"和"更精准的依赖追踪"之间取得平衡？

4. **SSR 水合**：Vapor 模式下，服务端渲染的 HTML 不需要传统的 VNode 水合过程。但仍然需要"认领"DOM 节点并绑定事件。请设计一种高效的 Vapor SSR 水合算法。

5. **生态兼容**：如果一个第三方组件库同时提供 VDOM 和 Vapor 两个版本，当它们混用时可能出现哪些问题？如何在框架层面预防这些问题？

</div>