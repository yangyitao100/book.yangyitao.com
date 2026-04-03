<div v-pre>

# 第11章 JSX 编译与代码转换

> **本章要点**
>
> - 从 React.createElement 到 jsx()：两代编译目标的架构差异与演进动机
> - 新 JSX Transform 的设计哲学：为什么不再需要 import React
> - Babel 插件 @babel/plugin-transform-react-jsx 的编译流程与 AST 变换细节
> - react/jsx-runtime 与 react/jsx-dev-runtime 的运行时实现
> - TypeScript 中 JSX.Element、JSX.IntrinsicElements 与泛型组件的类型推导机制
> - 自定义 JSX pragma 与 jsxImportSource：跨框架兼容的底层原理
> - createElement 与 jsx() 在 key 提取、children 处理、defaultProps 方面的关键差异

---

每一个 React 开发者都写过 JSX。但很少有人停下来思考一个根本性的问题：**浏览器不认识 JSX，那它是怎么运行的？**

答案藏在编译器里。JSX 不是 JavaScript 的语法扩展——它是一种需要被编译的 DSL（Domain-Specific Language）。当你写下 `<Button onClick={handleClick}>提交</Button>` 时，Babel 或 TypeScript 编译器会将它转换为一个函数调用。这个函数调用的目标，在 React 的历史上经历了一次意义深远的变革：从 `React.createElement` 到 `jsx()`。

这不仅仅是 API 名字的变化。这次变革改变了编译器的输出格式、消除了对 React 导入的强制依赖、优化了运行时性能、重新定义了 key 和 ref 的处理方式，甚至影响了 TypeScript 的类型推导策略。理解这一变革，不仅能让你在配置工具链时不再困惑，更能让你洞察 React 团队在"编译时 vs 运行时"这条战线上的长期战略——从 JSX Transform 到 React Compiler，编译时优化的思想一脉相承。

本章将带你深入 JSX 编译的每一个环节：从 Babel 插件的 AST 变换，到运行时函数的源码实现，再到 TypeScript 的类型体操。我们不仅要知道 "what"，更要理解 "why"。

## 11.1 JSX → React.createElement → jsx()：两代编译目标

### 11.1.1 第一代：React.createElement 的时代

从 2013 年 React 诞生到 2020 年 React 17，JSX 的编译目标一直是 `React.createElement`。这个函数的签名如下：

```typescript
function createElement(
  type: string | ComponentType,
  props: Record<string, any> | null,
  ...children: ReactNode[]
): ReactElement;
```

一段简单的 JSX：

```tsx
const element = (
  <div className="container">
    <h1>Hello</h1>
    <p>World</p>
  </div>
);
```

会被 Babel（使用 `@babel/plugin-transform-react-jsx`，runtime 设为 `"classic"`）编译为：

```typescript
const element = React.createElement(
  'div',
  { className: 'container' },
  React.createElement('h1', null, 'Hello'),
  React.createElement('p', null, 'World')
);
```

注意几个关键特征：

1. **children 作为额外参数传入**：第三个及之后的参数都是子元素，这意味着 `createElement` 必须使用 `arguments` 对象或 rest 参数来收集它们。
2. **必须在作用域中存在 `React`**：编译后的代码直接引用了 `React.createElement`，所以即使你的组件代码里看似没有用到 `React`，你也必须写 `import React from 'react'`——否则运行时会报 `React is not defined`。
3. **key 和 ref 混在 props 中传入**：它们被当作普通 props 传给 `createElement`，由函数内部负责提取。

让我们看看 `createElement` 的核心实现：

```typescript
// packages/react/src/ReactElement.js（简化版）
function createElement(type, config, ...children) {
  let propName;
  const props: Record<string, any> = {};
  let key: string | null = null;
  let ref = null;

  if (config != null) {
    // 从 config 中提取 key 和 ref
    if (hasValidRef(config)) {
      ref = config.ref;
    }
    if (hasValidKey(config)) {
      key = '' + config.key;
    }

    // 将剩余属性复制到 props 中
    for (propName in config) {
      if (
        hasOwnProperty.call(config, propName) &&
        !RESERVED_PROPS.hasOwnProperty(propName) // key, ref, __self, __source
      ) {
        props[propName] = config[propName];
      }
    }
  }

  // 处理 children
  if (children.length === 1) {
    props.children = children[0];
  } else if (children.length > 1) {
    props.children = children; // 数组
  }

  // 处理 defaultProps
  if (type && type.defaultProps) {
    const defaultProps = type.defaultProps;
    for (propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
  }

  return ReactElement(type, key, ref, undefined, undefined, ReactCurrentOwner.current, props);
}
```

这段代码揭示了 `createElement` 的三个性能问题：

**问题一：每次调用都要遍历 config 来提取 key 和 ref。** key 和 ref 不是普通的 prop，它们会被 React 内部消费而不会传递给组件。但在 `createElement` 中，它们和其他 props 混在同一个对象里传入，函数必须用循环和条件判断来分离它们。这个工作每次渲染都在做，完全是可以移到编译时的。

**问题二：children 通过 rest 参数传入，需要额外处理。** 多个 children 作为独立参数传入，函数内部要判断 children 的数量并决定是直接赋值还是创建数组。

**问题三：defaultProps 的处理在运行时进行。** 每次 `createElement` 被调用，都需要检查组件是否定义了 `defaultProps`，并在 props 中填充默认值。

这三个问题共同指向一个结论：**`createElement` 让运行时承担了太多本该在编译时解决的工作。**

### 11.1.2 第二代：jsx() 与新 JSX Transform

2020 年 10 月，React 团队发布了 React 17，其中最重要的改变之一就是**新 JSX Transform**。同样的 JSX：

```tsx
const element = (
  <div className="container">
    <h1>Hello</h1>
    <p>World</p>
  </div>
);
```

在新 Transform 下（`@babel/plugin-transform-react-jsx`，runtime 设为 `"automatic"`）会被编译为：

```typescript
import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';

const element = _jsxs('div', {
  className: 'container',
  children: [
    _jsx('h1', { children: 'Hello' }),
    _jsx('p', { children: 'World' }),
  ],
});
```

变化是根本性的：

1. **import 由编译器自动注入**：开发者不再需要手写 `import React from 'react'`。编译器会自动在文件顶部插入对 `react/jsx-runtime` 的导入。
2. **children 作为 props 的一部分传入**：不再使用 rest 参数，children 直接放在 props 对象中。这消除了运行时对 children 数量的判断逻辑。
3. **区分 jsx 和 jsxs**：单个 child 使用 `jsx()`，多个 children 使用 `jsxs()`。这让运行时可以跳过"children 是否为数组"的检查。
4. **key 从 props 中提取到独立参数**：如果元素有 key，它会作为第三个参数传入，而不是混在 props 里。

```typescript
// 有 key 的情况
<li key={item.id}>{item.name}</li>

// 编译为
_jsx('li', { children: item.name }, item.id);
```

让我们看看 `jsx()` 的源码实现，对比 `createElement` 的差异：

```typescript
// packages/react/src/jsx/ReactJSXElement.js（简化版）
function jsx(type, config, maybeKey) {
  let propName;
  const props: Record<string, any> = {};
  let key: string | null = null;
  let ref = null;

  // key 由编译器作为独立参数传入
  if (maybeKey !== undefined) {
    key = '' + maybeKey;
  }

  // 仍然需要检查 config 中的 key（兼容动态 key 的场景）
  if (hasValidKey(config)) {
    key = '' + config.key;
  }

  if (hasValidRef(config)) {
    ref = config.ref;
  }

  // 复制 props——注意 children 已经在 config 中了
  for (propName in config) {
    if (
      hasOwnProperty.call(config, propName) &&
      !RESERVED_PROPS.hasOwnProperty(propName)
    ) {
      props[propName] = config[propName];
    }
  }

  // 注意：没有 defaultProps 的处理！
  // React 19 中 defaultProps 已被废弃（函数组件）

  return ReactElement(type, key, ref, undefined, undefined, ReactCurrentOwner.current, props);
}
```

> **深度洞察**：从 `createElement` 到 `jsx()` 的变迁，体现了 React 团队一个持续多年的设计哲学——**将工作从运行时移向编译时**。这个思路在后来的 React Compiler 中达到了巅峰。JSX Transform 可以看作 React 编译时革命的第一枪：它证明了编译器可以承担更多责任，让运行时更轻更快。

### 11.1.3 createElement 与 jsx() 的七大差异

让我用一张完整的对比来总结两代编译目标的差异：

| 维度 | createElement (classic) | jsx / jsxs (automatic) |
|---|---|---|
| **导入方式** | 开发者手动 `import React` | 编译器自动注入 `import { jsx } from 'react/jsx-runtime'` |
| **children 传递** | 作为第 3~N 个参数 | 作为 `props.children` |
| **单/多 children 区分** | 运行时判断 `arguments.length` | 编译时区分 `jsx()` vs `jsxs()` |
| **key 的传递** | 混在 props 中 | 作为独立的第三个参数 |
| **ref 的传递** | 混在 props 中，运行时提取 | 混在 props 中，运行时提取（React 19 中 ref 成为普通 prop） |
| **defaultProps** | 运行时在 createElement 中处理 | 不处理（函数组件中已废弃） |
| **\_\_source / \_\_self** | 通过 Babel 插件注入到 props | 使用 `jsxDEV()` 作为独立参数传入 |

第七个差异值得深入展开。在开发模式下，旧 Transform 使用两个额外的 Babel 插件来注入调试信息：

```typescript
// 旧模式（classic）的开发构建
React.createElement('div', {
  className: 'container',
  __source: { fileName: 'App.tsx', lineNumber: 10, columnNumber: 5 },
  __self: this,
});
```

而新 Transform 使用一个专门的开发模式函数 `jsxDEV()`：

```typescript
// 新模式（automatic）的开发构建
import { jsxDEV as _jsxDEV } from 'react/jsx-dev-runtime';

_jsxDEV('div', { className: 'container' }, undefined, false, {
  fileName: 'App.tsx',
  lineNumber: 10,
  columnNumber: 5,
}, this);
```

`jsxDEV` 的签名是：

```typescript
function jsxDEV(
  type: ElementType,
  config: Record<string, any>,
  key: string | undefined,
  isStaticChildren: boolean,
  source: { fileName: string; lineNumber: number; columnNumber: number },
  self: any,
): ReactElement;
```

`isStaticChildren` 参数告诉 React 这个元素的 children 是否是静态的（即在 JSX 中直接写死的，而不是通过 `map` 等动态生成的）。这让 React 在开发模式下可以对 children 进行更精确的 key 验证。

## 11.2 新 JSX Transform 的设计动机与实现

### 11.2.1 三个设计动机

**动机一：消除"幽灵导入"。**

在旧模式下，每个包含 JSX 的文件都必须导入 React：

```tsx
import React from 'react'; // 看起来没有用到，但不能删！

function Greeting() {
  return <h1>Hello</h1>;
}
```

ESLint 会提示 `React is defined but never used`，于是需要配置特殊的规则来忽略这个警告。这不仅给新手造成困惑（"为什么要导入一个没用到的东西？"），还增加了 bundle size——即使是一个只返回 JSX 的纯展示组件，也必须把 React 拉进来。

新 Transform 彻底解决了这个问题。编译器负责注入正确的导入：

```tsx
// 你写的代码
function Greeting() {
  return <h1>Hello</h1>;
}

// 编译后（编译器自动添加的导入）
import { jsx as _jsx } from 'react/jsx-runtime';

function Greeting() {
  return _jsx('h1', { children: 'Hello' });
}
```

**动机二：为 React 的未来优化铺路。**

React 团队在设计新 Transform 时，考虑到了一系列未来可能的优化：

- **key 的静态分析**：当 key 作为独立参数传入时，编译器和运行时可以更容易地对 key 进行优化。例如，静态 key 可以在编译时内联，而不需要在运行时从 props 对象中提取。
- **children 的预分类**：通过 `jsx` vs `jsxs` 的区分，运行时可以直接知道 children 的结构，跳过不必要的类型检查。
- **去除 defaultProps**：新 Transform 不再在运行时处理 defaultProps（对于函数组件），这为后来 React 19 正式废弃函数组件的 defaultProps 做了铺垫。

**动机三：框架无关的 JSX 编译。**

旧模式硬编码了对 `React.createElement` 的依赖，如果你用 Preact、Emotion 或其他使用 JSX 的库，需要配置 `@jsx` pragma 或全局的 `pragma` 选项。新 Transform 引入了 `jsxImportSource` 的概念，使得编译器可以从任意包导入 JSX 工厂函数：

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
```

编译器会生成：

```typescript
import { jsx as _jsx } from 'preact/jsx-runtime';
```

这意味着任何框架只要暴露 `/jsx-runtime` 和 `/jsx-dev-runtime` 入口，就能使用标准的 JSX 编译管线。

### 11.2.2 Babel 插件的 AST 变换过程

让我们深入 Babel 插件 `@babel/plugin-transform-react-jsx` 的实现，看看 JSX 是如何一步步被转换为函数调用的。

整个过程可以分为四个阶段：

**阶段一：解析 JSX AST 节点**

Babel 的解析器（`@babel/parser`）将 JSX 语法解析为特殊的 AST 节点类型：

```typescript
// <div className="container">Hello</div> 的 AST 表示
{
  type: 'JSXElement',
  openingElement: {
    type: 'JSXOpeningElement',
    name: { type: 'JSXIdentifier', name: 'div' },
    attributes: [
      {
        type: 'JSXAttribute',
        name: { type: 'JSXIdentifier', name: 'className' },
        value: { type: 'StringLiteral', value: 'container' },
      },
    ],
  },
  children: [
    { type: 'JSXText', value: 'Hello' },
  ],
  closingElement: {
    type: 'JSXClosingElement',
    name: { type: 'JSXIdentifier', name: 'div' },
  },
}
```

**阶段二：提取 props、key、children**

插件遍历 `JSXOpeningElement` 的 `attributes` 数组，将 key 和 ref 分离出来，把其余属性收集为一个 `ObjectExpression`：

```typescript
// 插件内部（简化逻辑）
function buildProps(attribs: JSXAttribute[], file: PluginPass) {
  const props: ObjectProperty[] = [];
  let key: Expression | null = null;

  for (const attr of attribs) {
    if (isJSXIdentifier(attr.name, { name: 'key' })) {
      key = attr.value; // 单独提取
    } else if (isJSXIdentifier(attr.name, { name: '__source' })) {
      // 跳过（automatic 模式不再需要这个插件）
    } else if (isJSXIdentifier(attr.name, { name: '__self' })) {
      // 跳过
    } else {
      props.push(
        t.objectProperty(
          t.identifier(attr.name.name),
          convertAttrValue(attr.value),
        )
      );
    }
  }

  return { props: t.objectExpression(props), key };
}
```

**阶段三：处理 children**

children 被遍历并过滤（去除纯空白的 JSXText），然后决定使用 `jsx` 还是 `jsxs`：

```typescript
function buildChildren(children: JSXChild[]): Expression[] {
  const elements: Expression[] = [];

  for (const child of children) {
    if (isJSXText(child)) {
      const cleaned = cleanJSXText(child.value);
      if (cleaned !== '') {
        elements.push(t.stringLiteral(cleaned));
      }
    } else if (isJSXExpressionContainer(child)) {
      if (!isJSXEmptyExpression(child.expression)) {
        elements.push(child.expression);
      }
    } else if (isJSXElement(child) || isJSXFragment(child)) {
      elements.push(child); // 递归处理
    }
  }

  return elements;
}
```

`cleanJSXText` 函数负责处理 JSX 中文本节点的空白规则——这些规则与 HTML 不同，是 React 特有的：

- 行首和行尾的空白会被裁剪
- 多个连续空白会被合并为一个空格
- 只包含空白的行会被完全移除

**阶段四：生成函数调用**

最终，插件将收集到的信息组装为一个 `CallExpression`：

```typescript
function buildJSXElementCall(path: NodePath<JSXElement>, file: PluginPass) {
  const { props, key } = buildProps(path.node.openingElement.attributes, file);
  const children = buildChildren(path.node.children);
  const type = convertJSXIdentifier(path.node.openingElement.name);

  // 将 children 添加到 props 中
  if (children.length === 1) {
    props.properties.push(
      t.objectProperty(t.identifier('children'), children[0])
    );
  } else if (children.length > 1) {
    props.properties.push(
      t.objectProperty(t.identifier('children'), t.arrayExpression(children))
    );
  }

  // 选择 jsx 或 jsxs
  const isStaticChildren = children.length > 1;
  const jsxFn = isStaticChildren ? state.jsxsId : state.jsxId;

  const args: Expression[] = [type, props];
  if (key !== null) {
    args.push(key);
  }

  return t.callExpression(jsxFn, args);
}
```

注意这里的判断逻辑：当有多个静态 children 时，使用 `jsxs`；否则使用 `jsx`。但如果 children 是通过 `map` 动态生成的，即使结果是数组，也使用 `jsx`——因为那是一个表达式，不是多个静态子元素。

```tsx
// 多个静态 children → jsxs
<div>
  <h1>Title</h1>
  <p>Content</p>
</div>

// 单个动态 children（数组）→ jsx
<ul>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>
```

### 11.2.3 react/jsx-runtime 的入口结构

React 暴露了两个运行时入口：

```
react/jsx-runtime       → 生产环境
react/jsx-dev-runtime   → 开发环境
```

它们的导出如下：

```typescript
// react/jsx-runtime.js
export { Fragment } from 'react';
export { jsx, jsxs } from 'react/src/jsx/ReactJSXElement';

// react/jsx-dev-runtime.js
export { Fragment } from 'react';
export { jsxDEV } from 'react/src/jsx/ReactJSXElement';
```

`jsx` 和 `jsxs` 在生产环境中的实现几乎相同——`jsxs` 只是一个别名，运行时并不对静态/动态 children 做不同处理。区分它们的价值主要体现在**开发模式**中：

```typescript
// 开发模式下 jsxDEV 的额外检查
function jsxDEV(type, config, key, isStaticChildren, source, self) {
  // ... 创建元素的基本逻辑 ...

  if (isStaticChildren) {
    // 对静态 children 进行 key 检查
    // 如果在 jsxs 中传入了数组 children 且元素没有 key，发出警告
    if (Array.isArray(config.children)) {
      for (let i = 0; i < config.children.length; i++) {
        validateChildKeys(config.children[i], type);
      }
      // 冻结 children 数组（仅开发模式）
      if (Object.freeze) {
        Object.freeze(config.children);
      }
    }
  }

  return element;
}
```

> **深度洞察**：`jsx` 与 `jsxs` 的区分看似微小，但它背后体现了 React 团队的一个设计原则——**让开发模式尽可能严格，让生产模式尽可能精简**。在生产环境中，`jsxs` 不做任何额外检查；在开发环境中，`jsxDEV` 利用 `isStaticChildren` 参数来提供精确的 key 缺失警告。这种"编译时分流，运行时分治"的思路贯穿了 React 的方方面面。

## 11.3 TypeScript 中的 JSX 类型推导

### 11.3.1 TypeScript 的 JSX 编译模式

TypeScript 提供了五种 JSX 编译模式，通过 `tsconfig.json` 中的 `jsx` 选项控制：

| 模式 | 输出 | 适用场景 |
|---|---|---|
| `"react"` | `React.createElement(...)` | 旧版 React 项目 |
| `"react-jsx"` | `_jsx(...)` 并自动注入导入 | React 17+ 项目 |
| `"react-jsxdev"` | `_jsxDEV(...)` 并自动注入导入 | 开发模式 |
| `"preserve"` | 不转换 JSX，保留原样 | 由下游工具（如 Babel、esbuild）处理 |
| `"react-native"` | 同 preserve，但输出 `.js` 文件 | React Native 项目 |

在 `"react-jsx"` 模式下，TypeScript 不仅编译 JSX，还负责对 JSX 表达式进行**完整的类型检查**。这涉及一套专门的类型推导机制。

### 11.3.2 JSX 命名空间与类型声明

React 的类型定义（`@types/react`）声明了一个全局的 `JSX` 命名空间，TypeScript 用它来检查 JSX 表达式的类型正确性：

```typescript
// @types/react/index.d.ts（简化版）
declare global {
  namespace JSX {
    // JSX 表达式的返回类型
    interface Element extends React.ReactElement<any, any> {}

    // HTML 原生元素的 props 类型映射
    interface IntrinsicElements {
      div: React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;
      span: React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>;
      input: React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>;
      a: React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>;
      // ... 所有 HTML 元素
    }

    // 用于类组件的子类型检查
    interface ElementClass extends React.Component<any> {}

    // 组件 props 的属性名（用于从组件类型中提取 props 类型）
    interface ElementAttributesProperty {
      props: {};
    }

    // children 的属性名
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}
```

当 TypeScript 遇到一个 JSX 表达式时，它的类型检查流程如下：

```typescript
// 对于 <div className="foo" />
// TypeScript 的检查过程：
// 1. 'div' 是小写开头 → 在 JSX.IntrinsicElements 中查找
// 2. 找到 IntrinsicElements['div'] 的类型
// 3. 检查 { className: "foo" } 是否符合该类型
// 4. 返回类型为 JSX.Element

// 对于 <MyComponent name="Alice" />
// TypeScript 的检查过程：
// 1. 'MyComponent' 是大写开头 → 当作组件
// 2. 检查 MyComponent 是函数组件还是类组件
// 3. 提取其 props 类型（函数的第一个参数类型 / class 的 props 泛型参数）
// 4. 检查 { name: "Alice" } 是否符合 props 类型
// 5. 返回类型为 JSX.Element
```

### 11.3.3 泛型组件的类型推导

TypeScript 4.1+ 支持泛型 JSX 组件的类型推导，这是一个强大但容易被忽视的特性：

```tsx
// 泛型列表组件
interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}

function List<T>({ items, renderItem }: ListProps<T>) {
  return <ul>{items.map((item, i) => <li key={i}>{renderItem(item)}</li>)}</ul>;
}

// TypeScript 自动推导 T
<List
  items={[{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]}
  renderItem={(item) => <span>{item.name}</span>}
  // TypeScript 推导出 item 的类型是 { id: number; name: string }
/>
```

泛型推导的过程发生在 TypeScript 编译器的类型检查阶段：

1. TypeScript 看到 `List` 是一个泛型函数组件 `<T>`
2. 从 `items` 参数推导出 `T = { id: number; name: string }`
3. 将推导出的 `T` 应用到 `renderItem` 的参数类型上
4. `renderItem` 的 `item` 参数自动获得 `{ id: number; name: string }` 类型

这个机制在编译后完全消失——JSX 的类型信息纯粹是编译时的检查，不会影响运行时行为。

### 11.3.4 React 19 中类型系统的变化

React 19 对 TypeScript 类型做了几个重要的调整，这些调整与 JSX 编译直接相关：

**变化一：ref 成为普通 prop**

```typescript
// React 18：ref 不在 props 类型中，需要 forwardRef
const Input = React.forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  return <input ref={ref} {...props} />;
});

// React 19：ref 是 props 的一部分
interface InputProps {
  ref?: React.Ref<HTMLInputElement>;
  placeholder?: string;
}

function Input({ ref, placeholder }: InputProps) {
  return <input ref={ref} placeholder={placeholder} />;
}
```

在类型层面，`@types/react` 的更新使得 `ref` 不再被从 props 类型中排除：

```typescript
// React 18 的类型定义
type ComponentPropsWithRef<T extends ElementType> = /* 包含 ref */;
type ComponentPropsWithoutRef<T extends ElementType> = /* 不包含 ref */;

// React 19 中，函数组件的 props 本身就可以包含 ref
// forwardRef 被标记为 deprecated
```

**变化二：JSX.Element 的泛型化趋势**

React 19 的类型定义引入了更精确的 `ReactElement` 泛型：

```typescript
// 以前：JSX.Element 总是 ReactElement<any, any>
// 现在：可以通过泛型约束获得更精确的类型

type ReactElement<
  P = unknown,
  T extends string | JSXElementConstructor<any> =
    | string
    | JSXElementConstructor<any>,
> = {
  type: T;
  props: P;
  key: string | null;
};
```

### 11.3.5 自定义组件的 props 验证原理

理解 TypeScript 如何验证 JSX props，对于编写高质量的类型定义至关重要。让我们追踪一个完整的例子：

```tsx
interface ButtonProps {
  variant: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

function Button({ variant, size = 'md', onClick, children }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} btn-${size}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// TypeScript 类型检查过程：
<Button variant="primary">Submit</Button>      // ✅
<Button variant="danger">Submit</Button>        // ❌ Type '"danger"' is not assignable to type '"primary" | "secondary"'
<Button>Submit</Button>                          // ❌ Property 'variant' is missing
<Button variant="primary" size="xl">Submit</Button>  // ❌ Type '"xl"' is not assignable
```

TypeScript 的检查算法概括为：

1. 从组件函数（或类）的签名中提取 props 类型 `P`
2. 收集 JSX 属性构造一个对象类型 `A`
3. 检查 `A` 是否可赋值给 `P`（`A extends P`）
4. 对于多余属性，应用**严格对象字面量检查**（excess property check）

这也是为什么你可以通过展开运算符绕过多余属性检查的原因——展开运算符创建的不是对象字面量。

## 11.4 自定义 JSX pragma 与跨框架兼容

### 11.4.1 什么是 JSX pragma

"pragma"一词源自希腊语，意为"行动"或"实践"。在编程语言中，pragma 是给编译器的指令。JSX pragma 就是告诉编译器"当你遇到 JSX 时，应该调用哪个函数来处理"。

在旧模式（classic）下，可以通过文件级注释来指定 pragma：

```tsx
/** @jsx h */
import { h } from 'preact';

// 这个文件中的 JSX 会被编译为 h() 调用而非 React.createElement()
function App() {
  return <div>Preact App</div>;
}

// 编译为：
h('div', null, 'Preact App');
```

也可以在 Babel 配置中全局设置：

```json
{
  "plugins": [
    ["@babel/plugin-transform-react-jsx", {
      "runtime": "classic",
      "pragma": "h",
      "pragmaFrag": "Fragment"
    }]
  ]
}
```

### 11.4.2 jsxImportSource：新时代的跨框架方案

新 Transform（automatic 模式）用 `jsxImportSource` 取代了 `pragma`。这是一个更优雅的方案，因为它不要求开发者手动导入工厂函数——编译器会自动从指定的包导入。

```json
// .babelrc
{
  "plugins": [
    ["@babel/plugin-transform-react-jsx", {
      "runtime": "automatic",
      "importSource": "preact"
    }]
  ]
}
```

或者在 TypeScript 中：

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
```

编译器会自动生成：

```typescript
import { jsx as _jsx } from 'preact/jsx-runtime';
```

也可以使用文件级注释覆盖全局配置：

```tsx
/** @jsxImportSource @emotion/react */

// 这个文件中的 JSX 会使用 Emotion 的 jsx runtime
function StyledComponent() {
  return <div css={{ color: 'red' }}>Styled</div>;
}
```

### 11.4.3 Emotion 的 JSX Runtime：一个实战案例

Emotion（CSS-in-JS 库）是自定义 JSX runtime 最经典的使用场景。它通过拦截 JSX 编译来实现 `css` prop：

```typescript
// @emotion/react/jsx-runtime.js（简化版）
import { jsx as reactJsx } from 'react/jsx-runtime';

export function jsx(type, props, key) {
  // 如果 props 中有 css 属性，进行特殊处理
  if (props.css != null) {
    // 将 css prop 转换为 className
    const { css: cssProp, ...restProps } = props;
    const className = processCSS(cssProp); // Emotion 的样式处理
    restProps.className = mergeClassNames(restProps.className, className);
    return reactJsx(type, restProps, key);
  }

  // 没有 css prop，直接透传给 React
  return reactJsx(type, props, key);
}

export { jsxs } from 'react/jsx-runtime'; // jsxs 同理
export { Fragment } from 'react';
```

这个模式的精妙之处在于：Emotion 不需要修改 React 的任何代码，只需要在编译层"劫持"JSX 的工厂函数，就能为所有 JSX 元素添加 CSS-in-JS 能力。

### 11.4.4 实现一个自定义 JSX Runtime

为了彻底理解 JSX runtime 的机制，让我们从零实现一个简单的自定义 runtime。假设我们要做一个 "logging runtime"，在每个元素创建时打印日志：

```typescript
// my-jsx-runtime/jsx-runtime.ts

import { jsx as reactJsx, jsxs as reactJsxs, Fragment } from 'react/jsx-runtime';
import type { ReactElement } from 'react';

export { Fragment };

export function jsx(
  type: any,
  props: Record<string, any>,
  key?: string,
): ReactElement {
  if (__DEV__) {
    const typeName = typeof type === 'string' ? type : type.displayName || type.name || 'Unknown';
    console.log(`[JSX] Creating element: <${typeName}>`, { props, key });
  }
  return reactJsx(type, props, key);
}

export function jsxs(
  type: any,
  props: Record<string, any>,
  key?: string,
): ReactElement {
  if (__DEV__) {
    const childCount = Array.isArray(props.children) ? props.children.length : 1;
    const typeName = typeof type === 'string' ? type : type.displayName || type.name || 'Unknown';
    console.log(`[JSX] Creating element: <${typeName}> with ${childCount} children`);
  }
  return reactJsxs(type, props, key);
}
```

使用这个 runtime：

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "my-jsx-runtime"
  }
}
```

这种能力不仅适用于调试，还可以用于：

- **性能追踪**：记录每个元素的创建时间和频率
- **访问控制**：根据用户角色过滤某些组件
- **自动化测试**：在元素创建时注入 test-id
- **跨平台渲染**：将 JSX 编译为非 React 的渲染目标

### 11.4.5 框架兼容性矩阵

不同框架对 JSX runtime 协议的支持程度：

| 框架 | jsx-runtime 入口 | createElement 兼容 | jsxImportSource |
|---|---|---|---|
| React 17+ | `react/jsx-runtime` | 是 | `react` |
| Preact 10+ | `preact/jsx-runtime` | 是 | `preact` |
| Solid.js | `solid-js/h/jsx-runtime` | 否（使用自己的编译） | `solid-js/h` |
| Emotion | `@emotion/react/jsx-runtime` | 是（透传给 React） | `@emotion/react` |
| Theme UI | `theme-ui/jsx-runtime` | 是（透传给 React） | `theme-ui` |
| Vue 3 | 不支持（使用模板编译） | 不适用 | 不适用 |

值得注意的是，Solid.js 虽然使用 JSX 语法，但它的编译策略与 React 完全不同。Solid 的 Babel 插件将 JSX 编译为**直接的 DOM 操作**，而非虚拟 DOM 元素的创建：

```tsx
// Solid JSX
const element = <div className="container">Hello</div>;

// Solid 编译后（简化）
const _tmpl$ = document.createElement('template');
_tmpl$.innerHTML = '<div class="container">Hello</div>';

const element = _tmpl$.content.firstChild.cloneNode(true);
```

这从另一个角度说明了 JSX 的本质：**JSX 只是语法，编译目标完全由编译器决定。** 同样的 JSX 语法可以编译为 React 的虚拟 DOM 创建函数、Solid 的直接 DOM 操作、甚至任意其他的数据结构。

## 11.5 编译链路全景：从 JSX 到屏幕像素

### 11.5.1 完整的编译-执行链路

让我们追踪一段 JSX 从编写到渲染为真实 DOM 的完整链路：

```tsx
// 第一步：开发者编写 JSX
function App() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>+1</button>
    </div>
  );
}
```

```typescript
// 第二步：编译器转换（Babel / TypeScript / esbuild / SWC）
import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';

function App() {
  const [count, setCount] = useState(0);
  return _jsxs('div', {
    children: [
      _jsx('h1', { children: ['Count: ', count] }),
      _jsx('button', {
        onClick: () => setCount(count + 1),
        children: '+1',
      }),
    ],
  });
}
```

```typescript
// 第三步：jsx() 运行时函数创建 ReactElement
// jsx('div', { children: [...] }) 返回：
{
  $$typeof: Symbol.for('react.element'), // 安全标记，防止 XSS
  type: 'div',
  key: null,
  ref: null,
  props: {
    children: [
      { $$typeof: Symbol.for('react.element'), type: 'h1', ... },
      { $$typeof: Symbol.for('react.element'), type: 'button', ... },
    ],
  },
  _owner: currentFiber, // 开发模式下追踪创建者
}
```

```typescript
// 第四步：React Reconciler 将 ReactElement 转换为 Fiber 树
// （详见第4章 Fiber 架构）

// 第五步：Commit 阶段将 Fiber 树的变更应用到真实 DOM
// （详见第7章 Commit 阶段）
```

### 11.5.2 $$typeof 的安全设计

在上面的链路中，有一个容易被忽视但极其重要的细节：`$$typeof: Symbol.for('react.element')`。

这个字段的目的是防止 XSS 攻击。想象以下场景：

```typescript
// 恶意数据从服务器传来
const maliciousData = {
  type: 'div',
  props: {
    dangerouslySetInnerHTML: {
      __html: '<script>alert("XSS")</script>',
    },
  },
};

// 如果 React 不检查 $$typeof，这个对象可能被当作合法的 ReactElement 渲染
```

因为 `Symbol` 不能在 JSON 中序列化（`JSON.stringify` 会忽略 Symbol 属性），从服务器传来的恶意 JSON 对象无法伪造 `$$typeof` 字段。React 在 reconciliation 阶段会检查每个元素的 `$$typeof`，拒绝渲染不包含正确 Symbol 标记的对象。

```typescript
// React 源码中的检查
function isValidElement(object: any): boolean {
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_ELEMENT_TYPE // Symbol.for('react.element')
  );
}
```

这是 JSX 编译链路中一个精妙的安全设计——编译器生成的函数调用（`jsx()`）会自动添加 `$$typeof` 标记，而手动构造的普通对象不会有这个标记。

### 11.5.3 编译器选择：Babel vs TypeScript vs SWC vs esbuild

2026 年的 React 项目有多种编译器可以选择，它们对 JSX 的处理各有特点：

**Babel**：最灵活，支持所有 JSX 转换模式，可以通过插件自定义编译行为。但速度最慢。

```bash
# Babel 配置
npm install @babel/plugin-transform-react-jsx
```

**TypeScript (tsc)**：原生支持 JSX 编译和类型检查。速度中等。适合不需要额外 Babel 插件的项目。

**SWC**：Rust 实现的编译器，速度是 Babel 的 20-70 倍。Next.js 默认使用 SWC。

```json
// .swcrc
{
  "jsc": {
    "transform": {
      "react": {
        "runtime": "automatic",
        "importSource": "react"
      }
    }
  }
}
```

**esbuild**：Go 实现的编译器，速度极快。Vite 在开发模式下使用 esbuild。

```typescript
// esbuild 配置
esbuild.build({
  jsx: 'automatic',
  jsxImportSource: 'react',
});
```

> **深度洞察**：编译器的选择往往不取决于 JSX 转换的正确性（所有主流编译器的输出都是标准的），而取决于**编译速度**和**生态兼容性**。这反映了前端工程的一个趋势：JSX 编译已经成为一个"已解决的问题"，竞争焦点转移到了编译性能上。从 JavaScript 编写的 Babel，到 Go 编写的 esbuild，再到 Rust 编写的 SWC——编译器的进化遵循了一条清晰的路径：**用更底层的语言重写成熟的转换逻辑，换取数量级的速度提升。**

## 11.6 Fragment、key 与编译期优化

### 11.6.1 Fragment 的编译

React Fragment（`<>...</>`）在编译时有特殊处理：

```tsx
// JSX Fragment
<>
  <h1>Title</h1>
  <p>Content</p>
</>

// 编译为
import { Fragment as _Fragment, jsxs as _jsxs } from 'react/jsx-runtime';

_jsxs(_Fragment, {
  children: [
    _jsx('h1', { children: 'Title' }),
    _jsx('p', { children: 'Content' }),
  ],
});
```

Fragment 在编译时被替换为从 `react/jsx-runtime` 导入的 `Fragment` 符号。在运行时，`Fragment` 只是一个 Symbol（`Symbol.for('react.fragment')`），React reconciler 遇到这个类型时不会创建真实 DOM 节点，而是直接渲染其 children。

### 11.6.2 key 的编译时提取

key 在新 Transform 中的处理值得仔细研究。编译器会在编译时将 key 从 props 中"拔出来"：

```tsx
// 有静态 key
<li key="item-1">First</li>
// 编译为
_jsx('li', { children: 'First' }, 'item-1');

// 有动态 key
<li key={item.id}>{item.name}</li>
// 编译为
_jsx('li', { children: item.name }, item.id);

// 没有 key
<li>Item</li>
// 编译为
_jsx('li', { children: 'Item' });
```

但有一个边界情况：当 key 通过展开运算符传入时，编译器无法在编译时提取它：

```tsx
const props = { key: 'item-1', className: 'active' };
<li {...props}>Item</li>

// 编译为——注意 key 没有被提取！
_jsx('li', { ...props, children: 'Item' });

// jsx() 函数内部仍然需要从 config 中检查 key
// 这就是为什么 jsx() 源码中有 hasValidKey(config) 的检查
```

在开发模式下，如果你通过展开运算符传入 key，React 会发出警告：

```
Warning: A props object containing a "key" prop is being spread into JSX:
  let props = {key: someKey, className: ...};
  <li {...props}>Item</li>
React keys must be passed directly to JSX without using spread.
```

这个警告的目的是鼓励开发者显式地传递 key，让编译器能够在编译时提取它，从而获得更好的性能。

### 11.6.3 常量元素提升（Constant Element Hoisting）

Babel 提供了一个优化插件 `@babel/plugin-transform-react-constant-elements`，它可以将**没有动态依赖的 JSX 元素提升为模块级常量**：

```tsx
// 优化前
function Header() {
  return (
    <div>
      <h1>Welcome</h1>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    </div>
  );
}

// 优化后——静态元素被提升到函数外部
const _ref = _jsx('a', { href: '/', children: 'Home' });
const _ref2 = _jsx('a', { href: '/about', children: 'About' });
const _ref3 = _jsxs('nav', { children: [_ref, _ref2] });

function Header() {
  return _jsxs('div', {
    children: [
      _jsx('h1', { children: 'Welcome' }),
      _ref3,
    ],
  });
}
```

被提升的元素只会创建一次 ReactElement 对象，后续的渲染会复用同一个引用。这在 reconciliation 阶段有显著的优化效果——React 会通过引用比较（`oldElement === newElement`）跳过没有变化的子树。

这个优化在 React Compiler（React 19+）时代变得更加自动化。React Compiler 可以自动识别并缓存不需要重新创建的 JSX 元素，无需手动配置 Babel 插件。

## 11.7 实战：调试 JSX 编译问题

### 11.7.1 常见问题一：`React is not defined`

这是迁移到新 JSX Transform 前最常见的错误：

```
ReferenceError: React is not defined
```

**原因**：项目配置仍使用 classic 模式，但文件中没有 `import React`。

**解决方案**：

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx"  // 从 "react" 改为 "react-jsx"
  }
}
```

或者，如果你需要同时支持新旧模式，React 官方提供了一个 codemod 来自动移除不必要的 React 导入：

```bash
npx react-codemod update-react-imports
```

### 11.7.2 常见问题二：key 警告与展开运算符

```
Warning: Each child in a list should have a unique "key" prop.
```

这个警告有时出现在你认为已经传了 key 的场景中：

```tsx
// 你以为 key 传了，但实际上 key 在 JSX 中有特殊处理
function ItemList({ items }) {
  return items.map(item => {
    const props = { key: item.id, className: 'item' };
    return <div {...props}>{item.name}</div>; // ⚠️ key 在展开中可能不生效
  });
}

// 正确写法：显式传递 key
function ItemList({ items }) {
  return items.map(item => (
    <div key={item.id} className="item">{item.name}</div>
  ));
}
```

### 11.7.3 常见问题三：jsxImportSource 配置冲突

当项目同时使用 React 和 Emotion 时，可能遇到全局 `jsxImportSource` 冲突：

```tsx
// 文件级覆盖
/** @jsxImportSource @emotion/react */
import { css } from '@emotion/react';

function StyledButton() {
  return (
    <button css={css`color: red;`}>
      Click me
    </button>
  );
}
```

注意：文件级的 `@jsxImportSource` 注释**必须出现在文件的第一个语句之前**。如果在注释前有 `import` 语句，注释会被忽略。

## 11.8 本章小结

JSX 编译是 React 技术栈中最"隐形"的环节——它发生在你写代码之后、代码运行之前。但正是这个隐形的环节，决定了 React 的运行时性能、开发者体验、和框架兼容性。

关键要点：

1. **从 `createElement` 到 `jsx()` 是一次运行时减负**：key 的独立提取、children 的内联传递、jsx/jsxs 的静态区分，都是将工作从运行时移向编译时的体现
2. **新 JSX Transform 消除了"幽灵导入"**：编译器自动注入导入，开发者不再需要手写 `import React`
3. **`jsxImportSource` 实现了框架无关的 JSX 编译**：任何框架只要暴露 `/jsx-runtime` 入口，就能使用标准的 JSX 编译管线
4. **TypeScript 的 JSX 类型系统基于 `JSX` 命名空间**：`IntrinsicElements` 定义原生元素的类型，组件 props 通过函数签名推导
5. **`$$typeof` 是 JSX 编译链路中的安全锁**：Symbol 不能被 JSON 序列化，防止了注入攻击
6. **JSX 只是语法，编译目标由编译器决定**：同样的 JSX 可以编译为 React 的虚拟 DOM、Solid 的直接 DOM 操作、或任何自定义的数据结构

这一章揭示了 React 编译时策略的起点。在下一章中，我们将看到这个策略的巅峰——React Compiler 如何通过静态分析自动消除 `useMemo` 和 `useCallback`，将"编译时承担更多责任"的理念推向极致。

> **课程关联**：本章内容对应慕课网课程《React 源码深度解析》的扩展部分。课程中详细讲解了 React Element 的创建和 Reconciliation 过程，而本章所涉及的 JSX 编译是这些过程的前置环节，建议配合学习：[https://coding.imooc.com/class/650.html](https://coding.imooc.com/class/650.html)

---

### 思考题

1. **为什么 React 选择在编译时区分 `jsx()` 和 `jsxs()`，而不是在运行时根据 `props.children` 的类型来判断？** 考虑一个场景：一个组件的 children 有时是单个元素，有时是数组——编译器会如何处理？这种编译时区分在 Reconciliation 阶段带来了什么优势？

2. **如果你需要为一个自定义渲染器（比如渲染到 Canvas）实现 JSX runtime，你的 `jsx()` 函数应该返回什么数据结构？** 它需要包含 `$$typeof` 字段吗？如果你的渲染器不使用 React 的 Reconciler，`$$typeof` 的安全意义是否仍然存在？

3. **在 Emotion 的 JSX runtime 实现中，`css` prop 的处理发生在 `jsx()` 函数内部。这意味着每次组件渲染时，CSS 的处理都会执行。** 如果 Emotion 选择在 Babel 插件层面（即编译时）处理 `css` prop，会面临哪些技术限制？动态样式（如依赖 props 的样式）能否在编译时处理？

4. **TypeScript 的 `JSX.IntrinsicElements` 接口为每个 HTML 元素定义了精确的属性类型（例如 `<input>` 有 `type`、`value`、`checked` 等）。** 但在运行时，React 并不阻止你向 `<div>` 传递 `checked` 属性。这种编译时类型检查与运行时行为的差异意味着什么？你能构造一个场景，说明这种差异可能导致的问题吗？

</div>
