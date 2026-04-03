<div v-pre>

# 第5章 CSS 隔离与资源加载

> "JavaScript 沙箱防止的是逻辑污染，CSS 隔离防止的是视觉坍塌——后者往往更难调试，因为它不会抛出任何异常，只是默默地让你的页面面目全非。"

> **本章要点**
> - 深入理解 CSS 隔离的三种核心策略：Shadow DOM、Scoped CSS、Dynamic Stylesheet，掌握每种方案的实现原理与边界条件
> - 从源码层面剖析 import-html-entry 如何将一个 HTML 文件解析为 Scripts、Styles、Template 三部分
> - 理解子应用资源预加载策略的设计哲学与实现细节
> - 掌握资源加载失败时的容错与重试机制，构建生产级别的健壮性

---

还记得前言中那个凌晨三点的故事吗？一个 `.container { margin: 0 auto }` 穿透了沙箱，导致全站白屏。那次事故的根因不在 JavaScript 隔离——JS 沙箱工作得很好。问题出在 CSS。

CSS 的全局性是 Web 平台最古老的设计决策之一。在单体应用中，这个问题通过 BEM 命名约定、CSS Modules、CSS-in-JS 等方案已经被充分驯化。但在微前端场景下，情况完全不同——你无法要求所有子应用统一使用同一种样式方案，你甚至无法确保不同团队不会使用相同的 class 名。**CSS 隔离不是锦上添花，它是微前端架构的生存底线。**

上一章我们深入剖析了 JS 沙箱的三种实现（SnapshotSandbox、LegacySandbox、ProxySandbox）。本章的主角是 CSS 隔离——同样重要，但实现路径截然不同。JS 隔离的核心武器是 Proxy，CSS 隔离的核心武器却分裂成了三条路线，每条路线都有自己的优势与致命缺陷。

我们还将深入 import-html-entry 的源码——这是乾坤资源加载的基石。理解它如何解析 HTML、提取样式和脚本，是理解整个乾坤资源管理体系的前提。

让我们开始。

## 5.1 CSS 隔离三策略：Shadow DOM、Scoped CSS、Dynamic Stylesheet

### 5.1.1 问题的本质

CSS 隔离需要解决的核心问题只有一个：**如何让子应用的样式只作用于子应用自身的 DOM，不影响主应用和其他子应用？**

这个问题可以被分解为两个方向：

1. **子应用的样式不泄漏出去**（outward isolation）——子应用定义的 `.container` 不应该影响主应用的 `.container`
2. **外部的样式不渗透进来**（inward isolation）——主应用的全局 reset 样式不应该破坏子应用的内部布局

```typescript
// CSS 隔离的两个方向
interface CSSIsolation {
  outwardIsolation: boolean;  // 子应用样式不泄漏
  inwardIsolation: boolean;   // 外部样式不渗透
}

// 三种策略的隔离能力对比
const strategies: Record<string, CSSIsolation> = {
  shadowDOM:         { outwardIsolation: true,  inwardIsolation: true },
  scopedCSS:         { outwardIsolation: true,  inwardIsolation: false },
  dynamicStylesheet: { outwardIsolation: true,  inwardIsolation: false },
};
// Shadow DOM 是唯一能同时做到双向隔离的方案
// 但它的代价也最大——这就是架构权衡的经典案例
```

乾坤提供了两个配置项来控制 CSS 隔离策略：

```typescript
// 乾坤的 CSS 隔离配置
registerMicroApps([
  {
    name: 'sub-app',
    entry: '//localhost:7100',
    container: '#container',
    activeRule: '/sub-app',
  },
], {
  // 方式一：严格隔离 —— 使用 Shadow DOM
  // 对应源码中的 strictStyleIsolation
  sandbox: {
    strictStyleIsolation: true,
  },

  // 方式二：实验性隔离 —— 使用 Scoped CSS
  // 对应源码中的 experimentalStyleIsolation
  sandbox: {
    experimentalStyleIsolation: true,
  },
});
// 两者不能同时开启
// 如果都不开启，则使用 Dynamic Stylesheet（默认策略）
```

### 5.1.2 策略一：Shadow DOM（strictStyleIsolation）

Shadow DOM 是 Web Components 标准的一部分，它提供了浏览器原生的 DOM 和样式隔离能力。乾坤的 `strictStyleIsolation` 选项正是利用了这个能力。

**原理**：将子应用的整个 DOM 树包裹在一个 Shadow DOM 中。Shadow DOM 内部的样式天然不会泄漏到外部，外部的样式也无法渗透进来（除了可继承的 CSS 属性）。

来看乾坤源码中 `strictStyleIsolation` 的实现：

```typescript
// qiankun/src/loader.ts（简化）
function createElement(
  appContent: string,
  strictStyleIsolation: boolean,
  scopedCSS: boolean,
  appInstanceId: string,
): HTMLElement {
  const containerElement = document.createElement('div');
  containerElement.innerHTML = appContent;
  const appElement = containerElement.firstChild as HTMLElement;

  if (strictStyleIsolation) {
    // 核心：如果开启了严格样式隔离
    if (!supportShadowDOM) {
      console.warn(
        '[qiankun]: strictStyleIsolation is not supported in this browser.'
      );
    } else {
      const { innerHTML } = appElement;
      appElement.innerHTML = '';
      let shadow: ShadowRoot;

      if (appElement.attachShadow) {
        // 创建 Shadow DOM
        shadow = appElement.attachShadow({ mode: 'open' });
      } else {
        // 兼容旧版 API
        shadow = (appElement as any).createShadowRoot();
      }
      // 将子应用的 HTML 内容放入 Shadow DOM 中
      shadow.innerHTML = innerHTML;
    }
  }

  // ... scopedCSS 的处理逻辑（见下一节）

  return appElement;
}
```

这段代码的关键步骤是：

1. 创建一个容器 `div`，将子应用的 HTML 内容放入
2. 调用 `attachShadow({ mode: 'open' })` 创建 Shadow Root
3. 将原本的 innerHTML 移入 Shadow Root

这样，子应用的所有 DOM 节点和样式都运行在 Shadow DOM 内部，与外界天然隔离。

```html
<!-- 隔离后的 DOM 结构 -->
<div id="__qiankun_microapp_wrapper_for_sub_app__">
  #shadow-root (open)
    <div id="sub-app-container">
      <style>
        .container { margin: 0 auto; }
        /* 这个样式被锁在 Shadow DOM 内部 */
        /* 外面的 .container 完全不受影响 */
      </style>
      <div class="container">子应用内容</div>
    </div>
</div>
```

**Shadow DOM 的致命问题**：

虽然 Shadow DOM 提供了最强的隔离能力，但它在微前端场景下有三个严重的实际问题：

```typescript
// 问题一：弹窗类组件无法正常工作
// Ant Design 的 Modal、Dropdown、Tooltip 等组件默认将 DOM 挂载到 document.body
// 在 Shadow DOM 中，这意味着弹窗直接脱离了 Shadow DOM 的样式作用域
const Modal = () => {
  return ReactDOM.createPortal(
    <div className="ant-modal">...</div>,
    document.body  // 挂载到 body —— 逃逸了 Shadow DOM！
  );
};
// 结果：弹窗没有样式，因为样式还锁在 Shadow DOM 里面

// 问题二：事件冒泡被截断
// Shadow DOM 内部触发的事件在冒泡到 Shadow Root 时会被重新 target
// React 的合成事件系统依赖事件冒泡到 document
// 这可能导致 React 事件处理器失效
document.addEventListener('click', (e) => {
  console.log(e.target);
  // 在 Shadow DOM 中，e.target 会被重定向为 Shadow Host
  // 而不是真正被点击的元素
});

// 问题三：CSS 继承属性穿透
// font-family, color, line-height 等可继承属性
// 仍然会从 Shadow Host 的父元素继承进 Shadow DOM
// 这不是完全的"零渗透"
```

> 🔥 **深度洞察：Shadow DOM 的理想与现实**
>
> Shadow DOM 是浏览器原生提供的隔离方案，从理论上看它应该是 CSS 隔离的完美解——零运行时开销、双向隔离、标准化。但微前端场景远比 Web Components 场景复杂。Web Components 是从一开始就为 Shadow DOM 设计的，而微前端中的子应用是**已有的完整应用**，它们从未考虑过在 Shadow DOM 中运行。弹窗组件挂载到 body、样式通过 document.head 插入、事件冒泡到 document——这些都是 Web 应用几十年来形成的"隐含假设"。Shadow DOM 打破了这些假设，所以在生产环境中，`strictStyleIsolation` 的采用率远低于预期。这是一个深刻的教训：**最强的隔离不一定是最好的隔离——适配性才是生产环境的第一优先级。**

### 5.1.3 策略二：Scoped CSS（experimentalStyleIsolation）

乾坤的第二种策略是 `experimentalStyleIsolation`——"实验性样式隔离"。注意名字中的"实验性"——这表明即使乾坤团队自己也认为这个方案还不完美。

**原理**：给子应用的所有 CSS 选择器添加一个特定的属性选择器前缀，使样式只匹配带有该属性的 DOM 元素。子应用的根节点会被添加这个属性，从而实现样式的作用域限定。

```css
/* 原始 CSS */
.container { margin: 0 auto; }
h1 { color: red; }
body { font-size: 14px; }

/* 转换后的 CSS（Scoped） */
div[data-qiankun="sub-app"] .container { margin: 0 auto; }
div[data-qiankun="sub-app"] h1 { color: red; }
div[data-qiankun="sub-app"] body { font-size: 14px; }
```

来看核心源码。乾坤的 Scoped CSS 处理逻辑在 `css.ts` 文件中：

```typescript
// qiankun/src/sandbox/patchers/css.ts（简化）

const ScopedCSS = {
  process(styleNode: HTMLStyleElement, prefix: string) {
    // prefix 例如：div[data-qiankun="sub-app"]
    if (styleNode.textContent !== '') {
      const rewritten = this.rewrite(styleNode.textContent, prefix);
      styleNode.textContent = rewritten;
    }
  },

  rewrite(css: string, prefix: string): string {
    // 使用 CSSStyleSheet API 解析样式规则
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    let result = '';
    for (const rule of Array.from(sheet.cssRules)) {
      result += this.ruleStyle(rule as CSSStyleRule, prefix);
    }
    return result;
  },

  ruleStyle(rule: CSSStyleRule, prefix: string): string {
    // @media / @supports 规则：递归处理内部规则
    if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      let inner = '';
      for (const r of Array.from(rule.cssRules)) {
        inner += this.ruleStyle(r as CSSStyleRule, prefix);
      }
      return `@media ${(rule as CSSMediaRule).conditionText} { ${inner} }`;
    }

    // 普通样式规则：改写选择器
    const newSelector = rule.selectorText
      .split(',')
      .map((sel) => {
        sel = sel.trim();
        // :root → 替换为前缀
        if (/(^|\s+):root/.test(sel)) return sel.replace(/:root/, prefix);
        // body / html → 替换为前缀
        if (sel === 'body' || sel === 'html') return prefix;
        // 一般选择器：添加前缀
        return `${prefix} ${sel}`;
      })
      .join(', ');

    return `${newSelector} { ${rule.style.cssText} }`;
  },
};
```

然后在创建子应用元素时，会为根节点添加对应的属性：

```typescript
// qiankun/src/loader.ts（简化）
function createElement(
  appContent: string,
  strictStyleIsolation: boolean,
  scopedCSS: boolean,
  appInstanceId: string,
): HTMLElement {
  // ...

  if (scopedCSS) {
    // 给子应用根节点添加 data-qiankun 属性
    const attr = appElement.getAttribute(css.QiankunCSSRewriteAttr);
    if (!attr) {
      appElement.setAttribute(css.QiankunCSSRewriteAttr, appInstanceId);
    }

    // 处理已有的 style 标签
    const styleNodes = appElement.querySelectorAll('style') || [];
    styleNodes.forEach((stylesheetElement: HTMLStyleElement) => {
      css.process(appElement!, stylesheetElement, appInstanceId);
    });
  }

  return appElement;
}
```

同时，JS 沙箱还需要拦截子应用动态创建的 `<style>` 标签。乾坤通过 `MutationObserver` 监听新插入的 style 元素，一旦检测到内容变化就自动执行 `ScopedCSS.process` 进行选择器改写——确保运行时动态添加的样式同样受到隔离保护。

**Scoped CSS 的局限性**：

```css
/* 问题一：权重提升 */
/* 原始样式 */
.container { color: red; }
/* 转换后 */
div[data-qiankun="sub-app"] .container { color: red; }
/* 选择器权重从 (0,1,0) 变成了 (0,2,1)
   这可能导致样式覆盖关系发生意外变化 */

/* 问题二：@keyframes 不受作用域影响 */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* 动画名称是全局的，无法被 scoped 处理 */
/* 如果两个子应用都定义了 fadeIn，后加载的会覆盖前者 */

/* 问题三：:root 和 body 的语义丢失 */
/* 原始 */
:root { --primary-color: #1890ff; }
/* 转换后 */
div[data-qiankun="sub-app"] { --primary-color: #1890ff; }
/* CSS 变量定义在子应用的根 div 上而非 :root
   某些依赖 :root 级 CSS 变量的组件库可能受影响 */
```

### 5.1.4 策略三：Dynamic Stylesheet（默认策略）

当 `strictStyleIsolation` 和 `experimentalStyleIsolation` 都不开启时，乾坤使用的是最简单也最"粗暴"的策略：**动态样式表挂载与卸载**。

**原理**：子应用挂载时，将其样式插入到 DOM 中；子应用卸载时，将其样式从 DOM 中移除。这样，同一时刻只有当前活跃的子应用的样式存在于页面中。

```typescript
// 动态样式表的核心逻辑（概念性伪代码）

// 子应用挂载时
function mount(app: MicroApp) {
  // 将子应用的 <style> 和 <link> 标签插入到文档中
  app.styles.forEach((styleElement) => {
    document.head.appendChild(styleElement);
  });
  // 渲染子应用 DOM
  app.container.innerHTML = app.template;
}

// 子应用卸载时
function unmount(app: MicroApp) {
  // 从文档中移除子应用的样式
  app.styles.forEach((styleElement) => {
    document.head.removeChild(styleElement);
  });
  // 清理子应用 DOM
  app.container.innerHTML = '';
}
```

实际的实现比上面的伪代码复杂得多。乾坤通过劫持 `HTMLHeadElement.prototype.appendChild` 来追踪子应用动态添加的样式：

```typescript
// qiankun/src/sandbox/patchers/dynamicAppend/forStrictSandbox.ts（简化）
function patchDocumentCreateElement() {
  const rawHeadAppendChild = HTMLHeadElement.prototype.appendChild;

  HTMLHeadElement.prototype.appendChild = function appendChild<T extends Node>(
    this: HTMLHeadElement, newChild: T,
  ): T {
    const element = newChild as any;
    if (isHijackingTag(element.tagName)) {
      const currentApp = getCurrentRunningApp();
      if (currentApp) {
        // 关键步骤一：将样式标签与当前子应用关联
        dynamicStyleSheetElements.push(element);
        // 关键步骤二：如果开启了 scoped CSS，做选择器改写
        if (scopedCSS) ScopedCSS.process(element, currentApp.name);
        // 关键步骤三：插入到子应用容器中（而非 document.head）
        return rawHeadAppendChild.call(currentApp.container, element) as T;
      }
    }
    return rawHeadAppendChild.call(this, element) as T;
  };
}
// 卸载时：遍历 dynamicStyleSheetElements 批量移除，清空记录，恢复劫持的 API
```

**Dynamic Stylesheet 的核心限制**——**它只能处理路由级别的应用切换，无法处理多个子应用同时激活的场景**：

当两个子应用同时显示（例如左侧订单列表 + 右侧商品详情），两者都有 `.card { padding: 16px; }` 时，Dynamic Stylesheet 完全无能为力——因为两个应用的样式同时存在于文档中。**这就是为什么它只适用于"同一时刻只有一个子应用活跃"的路由切换场景。**

### 5.1.5 三种策略的全面对比

| 维度 | Shadow DOM | Scoped CSS | Dynamic Stylesheet |
|------|-----------|------------|-------------------|
| **向外隔离** | 完美 | 良好 | 良好（仅单应用） |
| **向内隔离** | 完美 | 无 | 无 |
| **多应用并存** | 支持 | 支持 | 不支持 |
| **性能开销** | 无 | 低（选择器改写） | 低（DOM 操作） |
| **第三方 UI 库兼容** | 差（弹窗逃逸） | 中等（权重变化） | 好（完全兼容） |
| **推荐场景** | 纯自研组件、无弹窗 | 多应用并存首选 | 路由级单应用切换 |

> 💡 **最佳实践**：在生产环境中，推荐的组合策略是：默认使用 Dynamic Stylesheet（零成本、高兼容），对于需要多个子应用同时显示的场景开启 `experimentalStyleIsolation`（Scoped CSS），只在子应用完全自研且无弹窗组件时才考虑 `strictStyleIsolation`（Shadow DOM）。很多团队还会在此基础上叠加 CSS Modules 或 CSS-in-JS——这不是"二选一"的关系，而是"框架级隔离 + 应用级隔离"的多层防御。

## 5.2 import-html-entry 源码剖析：HTML → Scripts + Styles + Template

### 5.2.1 import-html-entry 的定位

在第3章的乾坤架构总览中，我们提到乾坤的子应用加载方式是 **HTML Entry**——直接获取子应用的 HTML 文件，从中解析出 JavaScript 脚本、CSS 样式和 HTML 模板。这一切的背后，是一个名为 `import-html-entry` 的独立包。

```typescript
// 乾坤加载子应用的入口
// qiankun/src/loader.ts（极简化）
import { importEntry } from 'import-html-entry';

async function loadApp(
  app: LoadableApp,
  configuration: FrameworkConfiguration,
) {
  // 一行代码完成子应用资源解析
  const {
    template,       // 去除了 script 和 style 的纯 HTML 模板
    execScripts,    // 执行所有脚本并返回子应用导出的函数
    assetPublicPath,// 子应用的资源公共路径
    getExternalStyleSheets, // 获取所有外部样式表的内容
    getExternalScripts,     // 获取所有外部脚本的内容
  } = await importEntry(entry, importEntryOpts);

  // ... 后续的沙箱创建、生命周期调用等
}
```

`importEntry` 是整个资源加载流程的起点。它接收子应用的 URL，返回一个包含模板、脚本执行器、样式获取器的对象。让我们深入它的源码。

### 5.2.2 processTpl：HTML 解析的核心

`import-html-entry` 的核心函数是 `processTpl`。它的任务是将一段 HTML 字符串解析为三部分：scripts（脚本引用列表）、styles（样式引用列表）、template（去除脚本和样式后的纯 HTML）。

```typescript
// import-html-entry/src/process-tpl.ts（简化，保留核心逻辑）

// 关键正则——用于匹配 HTML 中的各类资源标签
const ALL_SCRIPT_REGEX = /(<script[\s\S]*?>)[\s\S]*?<\/script>/gi;
const LINK_TAG_REGEX =
  /<link[^>]*?\brel="stylesheet"\b[^>]*?\bhref="([^"]+)"[^>]*?\/?>/gi;
const STYLE_TAG_REGEX = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const COMMENT_REGEX = /<!--[\s\S]*?-->/g;

export default function processTpl(tpl: string, baseURI: string): TemplateResult {
  const scripts: ScriptObject[] = [];
  const styles: StyleObject[] = [];
  let entry: string | null = null;

  // 步骤一：移除 HTML 注释，避免注释中的标签被误解析
  const cleanedTpl = tpl.replace(COMMENT_REGEX, '');

  // 步骤二：处理 <link rel="stylesheet">
  // 将相对路径转为绝对路径，记录到 styles 数组，替换为注释占位符
  let template = cleanedTpl.replace(LINK_TAG_REGEX, (match, href) => {
    if (isPreloadOrPrefetch(match)) return match; // 跳过 preload/prefetch
    const absoluteHref = getEntirePath(href, baseURI);
    styles.push({ src: absoluteHref, isInline: false });
    return genLinkReplaceSymbol(absoluteHref);
  });

  // 步骤三：处理 <style> 内联标签
  template = template.replace(STYLE_TAG_REGEX, (match, content) => {
    styles.push({ content, isInline: true });
    return match; // 内联样式保留在模板中
  });

  // 步骤四：处理 <script> 标签——最复杂的部分
  template = template.replace(ALL_SCRIPT_REGEX, (match) => {
    const scriptMatch = match.match(SCRIPT_TAG_REGEX);
    if (!scriptMatch) return match;
    const [, attrs, src, restAttrs, inlineContent] = scriptMatch;
    const allAttrs = `${attrs} ${restAttrs}`;

    // 跳过 type="module" 和 nomodule 脚本
    if (isModuleScript(allAttrs) || isNoModuleScript(allAttrs)) {
      return genIgnoreAssetReplaceSymbol('module/nomodule script');
    }

    if (src) {
      // 外部脚本：记录 URL、是否 async、是否为 entry
      const absoluteSrc = getEntirePath(src, baseURI);
      const isEntry = /\bentry\b/.test(allAttrs);
      if (isEntry) entry = absoluteSrc;
      scripts.push({ src: absoluteSrc, isInline: false, async: /\basync\b/.test(allAttrs), isEntry });
      return genScriptReplaceSymbol(absoluteSrc, isEntry);
    }

    if (inlineContent) {
      // 内联脚本：直接记录内容
      const isEntry = /\bentry\b/.test(allAttrs);
      scripts.push({ content: inlineContent, isInline: true, isEntry });
      return genScriptReplaceSymbol('inline', isEntry);
    }
    return match;
  });

  // 步骤五：如果没有标记 entry 的脚本，默认最后一个外部脚本为入口
  if (!entry && scripts.length > 0) {
    const lastExternal = scripts.filter((s) => !s.isInline).pop();
    if (lastExternal) { lastExternal.isEntry = true; entry = lastExternal.src!; }
  }

  return { template, scripts, styles, entry };
}
```

这段代码的精妙之处在于它用**正则替换**完成了 HTML 解析——没有使用 DOM Parser，因为这段代码需要在沙箱环境中运行，而沙箱中的 DOM API 可能被劫持。正则方案虽然不够"优雅"，但更可靠。

> 🔥 **深度洞察：为什么用正则而不是 DOM Parser？**
>
> 你可能会疑惑：用正则解析 HTML 不是一个糟糕的做法吗？确实如此——在一般场景下。但 import-html-entry 有它的特殊考量：1）它运行在主应用的上下文中，如果使用 `DOMParser`，解析过程中 HTML 中的 `<img>` 等标签会触发真实的资源请求——这不是我们想要的，我们只想"解析"而不想"执行"；2）正则方案可以精确控制哪些标签被处理、哪些被跳过，颗粒度更细；3）性能上，对于微前端场景中通常不太复杂的 HTML 模板，正则的性能完全足够。这是一个**在不完美的选择中做出合理权衡**的例子。

### 5.2.3 getExternalStyleSheets：样式资源的获取

`processTpl` 只是解析出了样式的引用列表，真正的样式内容还需要通过网络请求获取。这就是 `getExternalStyleSheets` 的职责。

```typescript
// import-html-entry/src/index.ts（简化）

// 全局样式缓存——同一个 URL 的样式只请求一次
const styleCache: Record<string, string> = {};

export function getExternalStyleSheets(
  styles: StyleObject[],
  fetch: typeof window.fetch = defaultFetch,
): Promise<string[]> {
  return Promise.all(
    styles.map((styleInfo) => {
      if (styleInfo.isInline) {
        // 内联样式直接返回内容
        return Promise.resolve(styleInfo.content!);
      }

      const { src } = styleInfo;

      // 检查缓存
      if (styleCache[src!]) {
        return Promise.resolve(styleCache[src!]);
      }

      // 发起网络请求获取样式内容
      return fetch(src!)
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              `${src} load failed with status ${response.status}`
            );
          }
          return response.text();
        })
        .then((styleText) => {
          // 缓存结果
          styleCache[src!] = styleText;

          // 关键步骤：处理样式中的相对路径
          // url(./images/bg.png) → url(https://sub-app.com/images/bg.png)
          return processRelativeUrl(styleText, src!);
        });
    })
  );
}

// 处理 CSS 中的相对路径引用
function processRelativeUrl(styleText: string, baseUrl: string): string {
  // 匹配 url() 引用
  const urlRE = /url\(\s*['"]?\s*([^'")]+)\s*['"]?\s*\)/g;

  return styleText.replace(urlRE, (match, url) => {
    // 绝对路径不处理
    if (/^(https?:)?\/\//.test(url) || /^data:/.test(url)) {
      return match;
    }
    // 相对路径转绝对路径
    const absoluteUrl = new URL(url, baseUrl).href;
    return `url("${absoluteUrl}")`;
  });
}
```

注意 `processRelativeUrl` 这个函数——它解决了一个微前端特有的问题：子应用的 CSS 中通常包含相对路径的资源引用（如 `background: url(./images/bg.png)`）。当这段 CSS 被提取并注入到主应用的页面时，相对路径的基准已经变了——从子应用的域名变成了主应用的域名。如果不做转换，所有相对路径的背景图、字体文件都会加载失败。

### 5.2.4 getExternalScripts：脚本资源的获取

脚本资源的获取逻辑与样式类似，但多了一些复杂性——脚本有执行顺序的要求，而且入口脚本需要特殊处理。

```typescript
// import-html-entry/src/index.ts（简化）

// 全局脚本缓存
const scriptCache: Record<string, string> = {};

export function getExternalScripts(
  scripts: ScriptObject[],
  fetch: typeof window.fetch = defaultFetch,
): Promise<string[]> {
  // 并行获取所有外部脚本
  const fetchPromises = scripts.map((scriptInfo) => {
    if (scriptInfo.isInline) {
      return Promise.resolve(scriptInfo.content!);
    }

    const { src } = scriptInfo;

    if (scriptCache[src!]) {
      return Promise.resolve(scriptCache[src!]);
    }

    return fetch(src!)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `${src} load failed with status ${response.status}`
          );
        }
        return response.text();
      })
      .then((scriptText) => {
        scriptCache[src!] = scriptText;
        return scriptText;
      });
  });

  return Promise.all(fetchPromises);
}
```

脚本获取完成后，还需要**执行**。执行脚本是 `execScripts` 函数的职责，它会在沙箱的 Proxy window 上下文中运行脚本代码：

```typescript
// import-html-entry/src/index.ts（简化，核心逻辑）
export function execScripts(
  entry: string | null,
  scripts: ScriptObject[],
  proxy: WindowProxy = window,
  opts: ExecScriptsOpts = {},
): Promise<any> {
  return getExternalScripts(scripts, opts.fetch).then((scriptTexts) => {
    // 核心：将脚本包裹在 IIFE 中，绑定 proxy 作为 window
    function exec(scriptSrc: string, inlineScript: string) {
      const codeToRun = opts.strictGlobal
        ? `;(function(window, self, globalThis){;${inlineScript}\n}).bind(window.proxy)(window.proxy, window.proxy, window.proxy);`
        : inlineScript;
      try {
        (0, eval)(codeToRun);
      } catch (e) {
        console.error(`[import-html-entry]: error occurs while executing ${scriptSrc}`);
        throw e;
      }
    }

    // 按顺序执行同步脚本，async 脚本用 requestIdleCallback 并行执行
    // 入口脚本执行后，收集其导出（即子应用的 bootstrap/mount/unmount）
    // ...（调度逻辑省略，核心是保证执行顺序与原始 HTML 中一致）
  });
}
```

### 5.2.5 完整的资源加载流程

现在我们可以串联起整个资源加载流程了：

```typescript
// import-html-entry 的核心流程

// 1. importEntry：入口函数
async function importEntry(url: string, opts?: ImportEntryOpts) {
  // Step 1: 获取 HTML 内容
  const html = await fetch(url).then((res) => res.text());

  // Step 2: 解析 HTML，提取 scripts、styles、template
  const { template, scripts, styles, entry } = processTpl(html, url);

  // Step 3: 返回资源访问接口
  return {
    template,

    // 获取所有外部样式表内容（懒加载，调用时才请求）
    getExternalStyleSheets: () => getExternalStyleSheets(styles),

    // 获取所有外部脚本内容（懒加载）
    getExternalScripts: () => getExternalScripts(scripts),

    // 在指定 proxy 上下文中执行所有脚本
    execScripts: (proxy?: WindowProxy, strictGlobal?: boolean) =>
      execScripts(entry, scripts, proxy, { strictGlobal }),

    // 子应用的资源基路径
    assetPublicPath: getPublicPath(url),
  };
}
```

整个流程可以概括为五步：**fetch HTML → processTpl 解析 → 并行获取 JS/CSS → execScripts 在沙箱中执行 → 注入样式并渲染模板**。

> 🔥 **深度洞察：HTML Entry vs JS Entry 的架构抉择**
>
> import-html-entry 实现的 HTML Entry 模式是乾坤区别于 single-spa 的核心设计决策之一。single-spa 使用 JS Entry——子应用暴露一个 JS 入口文件，框架只管执行这个文件。HTML Entry 的优势在于：1）子应用无需关心资源如何被加载，保持与独立部署时完全一致的 HTML 结构；2）框架可以自动发现并处理所有资源依赖；3）子应用的接入成本极低。但代价也很明显：HTML 解析依赖正则（如上所述），无法处理所有 HTML 变体；资源加载多了一跳（先请求 HTML，再从中提取并请求 JS/CSS）。这再一次证明了微前端设计中一个反复出现的主题：**没有完美的方案，只有适合特定约束的权衡。**

## 5.3 子应用资源的预加载策略

### 5.3.1 为什么需要预加载

在默认流程中，子应用的资源（HTML、JS、CSS）在用户导航到对应路由时才开始加载。这意味着用户每次首次访问一个子应用，都需要经历：

```
路由切换 → 请求 HTML → 解析 HTML → 请求 JS/CSS → 执行 JS → 渲染
```

整个链路可能耗时 1-3 秒（取决于网络条件和资源大小），这段时间用户看到的是一片空白——这在追求极致体验的 C 端应用中是不可接受的。

预加载（Prefetch）的策略是：**在主应用空闲时，提前加载其他子应用的资源，将它们缓存起来**。当用户真正导航时，资源已经在缓存中，加载时间趋近于零。

### 5.3.2 乾坤的预加载实现

乾坤提供了 `prefetchApps` 配置来控制预加载行为：

```typescript
// 乾坤的预加载配置
import { registerMicroApps, start } from 'qiankun';

registerMicroApps([...]);

start({
  prefetch: true,           // 默认开启：在第一个子应用挂载后预加载其他子应用
  // prefetch: 'all',       // 主应用 start 后立即预加载所有子应用
  // prefetch: ['app1'],    // 只预加载指定的子应用
  // prefetch: (apps) => {  // 自定义预加载策略
  //   return { criticalAppNames: ['app1'], minorAppsName: ['app2'] };
  // },
});
```

来看预加载的源码实现：

```typescript
// qiankun/src/prefetch.ts（简化）
import { importEntry } from 'import-html-entry';

// 利用浏览器空闲时间执行预加载
function prefetch(
  entry: string,
  opts?: ImportEntryOpts,
): void {
  // 关键：使用 requestIdleCallback 确保预加载不影响主线程
  if (navigator.connection) {
    // 如果用户处于弱网环境（2G/3G），跳过预加载
    const { effectiveType, saveData } = (navigator as any).connection;
    if (effectiveType === '2g' || effectiveType === 'slow-2g' || saveData) {
      return;
    }
  }

  requestIdleCallback(async () => {
    // 第一阶段：获取并解析 HTML，提取资源列表
    const { getExternalStyleSheets, getExternalScripts } =
      await importEntry(entry, opts);

    // 第二阶段：在下一个空闲时段加载样式
    requestIdleCallback(() => getExternalStyleSheets());

    // 第三阶段：在再下一个空闲时段加载脚本
    requestIdleCallback(() => getExternalScripts());
  });
}

// 预加载策略调度器
export function doPrefetchStrategy(
  apps: RegistrableApp[],
  prefetchStrategy: PrefetchStrategy,
  importEntryOpts?: ImportEntryOpts,
): void {
  if (prefetchStrategy === true) {
    // 策略一：监听 single-spa:first-mount 事件
    // 第一个子应用挂载后，预加载所有未加载的其他子应用
    window.addEventListener('single-spa:first-mount', () => {
      const notLoadedApps = apps.filter(
        (app) => getAppsLoadingStatus()[app.name] === 'NOT_LOADED'
      );
      notLoadedApps.forEach(({ entry }) => prefetch(entry, importEntryOpts));
    }, { once: true });
  }

  if (prefetchStrategy === 'all') {
    // 策略二：立即预加载所有子应用
    apps.forEach(({ entry }) => prefetch(entry, importEntryOpts));
  }

  if (typeof prefetchStrategy === 'function') {
    // 策略三：自定义——区分关键应用（立即加载）和非关键应用（空闲加载）
    const { criticalAppNames = [], minorAppsName = [] } = prefetchStrategy(apps);
    criticalAppNames.forEach((name) => {
      const app = apps.find((a) => a.name === name);
      if (app) prefetch(app.entry, importEntryOpts);
    });
    requestIdleCallback(() => {
      minorAppsName.forEach((name) => {
        const app = apps.find((a) => a.name === name);
        if (app) prefetch(app.entry, importEntryOpts);
      });
    });
  }
}
```

### 5.3.3 三级预加载的设计哲学

注意 `prefetch` 函数中使用了三次 `requestIdleCallback`，将预加载分为三个阶段。这不是随意为之，而是精心设计的渐进式策略：

设计意图很清晰：**idle1 获取 HTML 并解析**（最轻量）→ **idle2 加载 CSS 文件**（中等开销）→ **idle3 加载 JS 文件**（体积最大，放最后）。每一阶段都在浏览器空闲时才执行，如果主线程突然繁忙（用户操作），预加载会自动让步。

### 5.3.4 弱网感知：被忽视的细节

上面源码中有一段容易被忽视的代码：

```typescript
if (navigator.connection) {
  const { effectiveType, saveData } = (navigator as any).connection;
  if (effectiveType === '2g' || effectiveType === 'slow-2g' || saveData) {
    return; // 弱网环境下跳过预加载
  }
}
```

这是一个非常贴心的设计——在 2G/慢速网络或者用户开启了"节省流量"模式时，跳过预加载。因为在这种条件下，预加载反而会与当前页面的资源加载竞争本就有限的带宽，适得其反。在实际生产中，还可以进一步增强弱网检测，利用 `navigator.connection.downlink`（带宽）和 `navigator.connection.rtt`（延迟）做更精细的判断。

> 💡 **最佳实践**：在实际项目中，建议对乾坤默认的预加载策略进行增强。1）对高频访问的子应用使用 `criticalAppNames` 立即预加载；2）对低频子应用使用 `minorAppsName` 延迟预加载；3）结合用户的历史访问数据动态调整预加载优先级——用户最常使用的子应用优先加载。这比简单地"预加载所有子应用"更高效。

## 5.4 资源加载失败的容错与重试机制

### 5.4.1 生产环境的残酷现实

在理想环境中，资源加载总是成功的。但生产环境远非理想——CDN 节点可能临时故障、子应用的部署可能还没完成、网络可能短暂抖动。如果子应用的任何一个 JS 文件加载失败，整个子应用就无法启动，用户看到的是一片空白。

```typescript
// 没有容错机制时的脆弱链路
try {
  const { execScripts } = await importEntry('//cdn.example.com/sub-app/');
  await execScripts(sandbox.proxy);
} catch (error) {
  // 资源加载失败 → 子应用完全不可用 → 用户看到白屏
  // 默认情况下，乾坤只会在控制台打印错误
  // 用户体验：灾难性
  console.error('[qiankun] 子应用加载失败', error);
}
```

### 5.4.2 import-html-entry 的内置容错

import-html-entry 本身提供了一定程度的容错能力：

```typescript
// import-html-entry 的 fetch 配置
importEntry('//cdn.example.com/sub-app/', {
  fetch: customFetch, // 可以传入自定义的 fetch 函数
});

// 利用自定义 fetch 实现重试
function createFetchWithRetry(
  maxRetries: number = 3,
  retryDelay: number = 1000,
): typeof window.fetch {
  return async function fetchWithRetry(
    url: RequestInfo,
    init?: RequestInit,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await window.fetch(url, init);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[Fetch Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed for ${url}: ${lastError.message}`
        );

        if (attempt < maxRetries) {
          // 指数退避：每次重试等待时间翻倍
          const delay = retryDelay * Math.pow(2, attempt);
          // 加入随机抖动，避免多个请求同时重试造成"惊群效应"
          const jitter = delay * 0.5 * Math.random();
          await new Promise((r) => setTimeout(r, delay + jitter));
        }
      }
    }

    throw lastError;
  };
}

// 使用
start({
  fetch: createFetchWithRetry(3, 1000),
  // 第一次失败：等 ~1s 后重试
  // 第二次失败：等 ~2s 后重试
  // 第三次失败：等 ~4s 后重试
  // 第四次失败：抛出错误
});
```

### 5.4.3 构建完整的容错体系

仅仅重试是不够的。一个生产级别的容错体系需要多层防御：

**第二层：CDN 故障转移**——自定义 fetch 函数依次尝试多个 CDN 源（`cdn1.example.com` → `cdn2.example.com` → `cdn-backup.example.com`），每个源重试 2 次，配合 `AbortSignal.timeout(10000)` 避免长时间等待。

**第三层：优雅降级 UI**——通过 `addGlobalUncaughtErrorHandler` 捕获加载错误，在子应用容器中渲染友好的降级页面（包含"刷新"和"返回"按钮），而非让用户面对白屏：

```typescript
import { addGlobalUncaughtErrorHandler } from 'qiankun';

addGlobalUncaughtErrorHandler((event: Event | string) => {
  if (isLoadError(event)) {
    const container = document.querySelector('#sub-app-container');
    if (container) {
      container.innerHTML = `
        <div class="loading-error">
          <h2>页面加载遇到问题</h2>
          <p>请检查网络连接后重试</p>
          <button onclick="window.location.reload()">刷新页面</button>
        </div>
      `;
    }
  }
});
```

```typescript
// 第四层：监控与告警——将监控集成到自定义 fetch 中
function createMonitoredFetch(
  appName: string,
  baseFetch: typeof window.fetch,
): typeof window.fetch {
  return async function monitoredFetch(
    url: RequestInfo,
    init?: RequestInit,
  ): Promise<Response> {
    const startTime = performance.now();

    try {
      const response = await baseFetch(url, init);
      return response;
    } catch (error) {
      // 失败：上报错误信息到监控平台
      navigator.sendBeacon?.('/api/monitor/load-error', JSON.stringify({
        appName,
        resourceUrl: typeof url === 'string' ? url : url.url,
        duration: performance.now() - startTime,
        networkType: (navigator as any).connection?.effectiveType,
        timestamp: Date.now(),
      }));
      throw error;
    }
  };
}
```

### 5.4.4 资源缓存策略

除了容错和重试，合理的缓存策略可以从根本上减少加载失败的概率——已经缓存的资源不需要网络请求，自然不会失败。import-html-entry 内置了内存级缓存（`styleCache` 和 `scriptCache`），但内存缓存只在页面不刷新时有效。生产环境建议构建多级缓存：Level 1 为 import-html-entry 内存缓存（自动），Level 2 为 Service Worker 缓存（Stale-While-Revalidate 策略），Level 3 为 HTTP/CDN 缓存。

> 🔥 **深度洞察：资源加载的"冰山模型"**
>
> 大多数微前端文章只讲"如何加载子应用"，很少有人深入讨论加载失败的处理。但在生产环境中，你需要为资源加载构建一个完整的"冰山模型"：水面上是用户看到的流畅体验，水面下是多层容错机制在默默工作。重试策略处理短暂的网络抖动，CDN 故障转移处理单点故障，优雅降级 UI 处理完全不可恢复的场景，监控告警确保团队能快速发现和定位问题。这四层防御缺一不可——少了任何一层，都意味着某种故障场景下用户会看到白屏。**生产环境的可靠性不是来自代码永远正确，而是来自代码在出错时仍能优雅地处理。**

### 5.4.5 资源版本一致性保障

还有一个容易被忽视的问题：子应用在部署更新期间，HTML 文件和 JS/CSS 文件可能暂时不一致——HTML 已经指向了新版本的 JS，但新版本的 JS 文件还没有部署完成。

典型场景：T0 用户请求 HTML 获取到新版（指向 `main.abc123.js`），T1 请求该 JS 返回 404（文件还在部署中），T2 部署完成但用户已经看到加载失败。

解决方案是**版本校验 + 延迟重试**：加载失败时用 `cache: 'no-cache'` 重新请求 HTML，如果内容发生了变化说明正在部署中，等待数秒后重试整个加载流程。如果 HTML 未变化则说明是真正的资源错误，交给上层错误处理。

---

CSS 隔离和资源加载，是微前端架构中两个"不够性感但极其重要"的主题。CSS 隔离没有 JS 沙箱那种令人兴奋的 Proxy 黑魔法，资源加载也没有路由拦截那种巧妙的设计。但它们是微前端在生产环境中稳定运行的基石——一个 CSS 样式穿透就能导致全站白屏，一个资源加载失败就能让子应用完全不可用。

回顾本章的核心脉络：CSS 隔离的三种策略（Shadow DOM、Scoped CSS、Dynamic Stylesheet）各有边界，没有银弹；import-html-entry 用正则解析 HTML 是一个"不完美但合理"的工程决策；预加载的三级空闲策略体现了对用户体验和系统负载的精细平衡；资源容错的"冰山模型"是生产环境可靠性的底层保障。

下一章，我们将进入乾坤的最后一个核心主题——应用间通信。子应用不是孤岛，它们需要共享数据、协调行为、响应全局事件。乾坤是如何在保持隔离性的同时，为子应用之间搭建安全的通信桥梁的？

## 本章小结

- **CSS 隔离三策略各有适用场景**：Shadow DOM 提供最强隔离但兼容性最差（弹窗逃逸、事件冒泡问题），Scoped CSS 通过选择器改写实现中等隔离（权重变化、@keyframes 问题），Dynamic Stylesheet 通过动态挂载/卸载实现最弱但兼容性最好的隔离（不支持多应用并存）
- **import-html-entry 是乾坤资源加载的核心**：`processTpl` 用正则将 HTML 解析为 scripts + styles + template 三部分，`getExternalStyleSheets` 和 `getExternalScripts` 并行获取外部资源并处理相对路径
- **预加载采用三级 requestIdleCallback 设计**：HTML 解析 → CSS 加载 → JS 加载，渐进式完成，确保不影响当前应用的交互性能，同时具备弱网感知能力
- **生产级容错需要四层防御**：资源重试（指数退避 + 随机抖动）→ CDN 故障转移 → 优雅降级 UI → 监控告警，缺一不可

## 思考题

1. **源码理解**：`processTpl` 使用正则而非 DOM Parser 解析 HTML。请分析这两种方案各自的优缺点，并思考在什么场景下正则方案会解析失败（提示：考虑 HTML 模板字符串中包含 `<script>` 字面量的情况）。

2. **方案对比**：Shadow DOM 的 `strictStyleIsolation` 和 Scoped CSS 的 `experimentalStyleIsolation` 都号称能实现 CSS 隔离，但它们的隔离边界完全不同。请从"弹窗类组件"和"CSS 变量"两个角度，详细分析两种方案在使用 Ant Design 组件库时分别会遇到什么问题。

3. **架构设计**：本章提到预加载使用了 `requestIdleCallback` 的三级策略。如果让你重新设计这个预加载系统，你会如何利用用户的历史行为数据来智能化预加载优先级？请设计一个算法并给出伪代码。

4. **生产实践**：假设你的微前端应用部署在全球多个地区，子应用的 CDN 资源偶尔出现区域性故障。请设计一套完整的资源加载容错方案，考虑以下约束：a）故障检测延迟不超过 5 秒；b）切换到备用 CDN 后，后续请求也应该自动使用备用 CDN；c）原始 CDN 恢复后能自动回切。

5. **延伸思考**：CSS 隔离的三种策略都有明显的局限性。如果浏览器标准层面要设计一种"完美的"CSS 作用域方案（类似于 `@scope` 提案），它应该具备哪些能力？现有的 CSS `@scope` 规范是否已经解决了微前端的 CSS 隔离问题？


</div>
