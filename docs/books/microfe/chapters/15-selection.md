<div v-pre>

# 第15章 微前端选型决策框架

> "技术选型的终极答案不是'哪个框架最好'，而是'在你的约束条件下，哪个决策的后悔概率最低'。"

> **本章要点**
> - 建立三维选型矩阵：团队规模 × 技术债务 × 部署频率，系统化评估微前端方案
> - 深入对比乾坤、Module Federation、Wujie、iframe 四大方案的优劣与边界
> - 掌握从单体到微前端的三阶段渐进式迁移策略，规避"大爆炸重写"的致命风险
> - 理解何时应该放弃微前端、回归单体——以及做出这个决策所需要的勇气与判断力
> - 获得一套可直接落地的决策流程图和评估清单

---

每一个前端架构师的职业生涯中，都会遇到那个时刻。

产品经理拍着桌子说"为什么一个按钮改不了"，运维同事反复追问"这次上线到底要不要回滚其他团队的代码"，CTO 在技术评审会上问"你们有没有考虑过微前端"。你打开浏览器，搜索"微前端选型"，出来的文章要么是某个框架的布道文（"乾坤天下第一"），要么是过于抽象的架构哲学（"没有银弹"），要么是 2021 年的过期内容。

你需要的不是又一篇框架介绍。你需要的是一个**决策框架**——一套能够根据你的团队规模、技术债务现状和部署频率，输出具体方案建议的系统化方法。

这就是本章要给你的东西。

## 15.1 团队规模 × 技术债 × 部署频率：三维选型矩阵

选型的第一个误区，是把它当成一个一维问题——"哪个框架性能好"或者"哪个社区活跃"。真正的选型至少是一个三维问题。这三个维度分别对应组织、代码和流程三个层面的约束。

### 15.1.1 维度一：团队规模

团队规模不只是"有几个人"，而是一个复合指标：

```typescript
interface TeamDimension {
  headcount: number;            // 前端工程师数量
  teamCount: number;            // 独立团队数量
  codeOwnership: 'shared' | 'module' | 'service'; // 代码所有权模型
  communicationCost: number;    // 跨团队沟通成本（1-10）
  autonomyRequirement: number;  // 团队自治需求（1-10）
}

// 三个典型画像
const profiles = {
  small: {
    headcount: 5,
    teamCount: 1,
    codeOwnership: 'shared',
    communicationCost: 2,
    autonomyRequirement: 3,
  },
  medium: {
    headcount: 15,
    teamCount: 3,
    codeOwnership: 'module',
    communicationCost: 6,
    autonomyRequirement: 6,
  },
  large: {
    headcount: 40,
    teamCount: 8,
    codeOwnership: 'service',
    communicationCost: 9,
    autonomyRequirement: 9,
  },
};
```

**关键阈值**：当团队数量超过 3 个，且每个团队有明确的业务领域划分时，微前端的价值开始显现。这不是一个精确的数字，而是一个经验性的拐点——3 个团队意味着代码合并冲突概率从"偶尔"变成"每天"，跨团队沟通成本从"走过去问一句"变成"要约会议"。

| 团队规模 | 微前端必要性 | 推荐方案倾向 |
|----------|-------------|-------------|
| 1 个团队（< 8 人） | 低：单体 + 模块化通常够用 | 不建议微前端，优先 Monorepo |
| 2-3 个团队（8-20 人） | 中：取决于部署耦合程度 | Module Federation（轻量接入） |
| 4+ 个团队（20+ 人） | 高：独立部署成为刚需 | 乾坤 / Wujie（完整隔离） |
| 跨 BU / 跨公司 | 极高：技术栈可能不统一 | iframe / Wujie（最强隔离） |

> 🔥 **深度洞察**
>
> 团队规模的影响不是线性的。根据 Brooks 定律，n 个人的团队沟通路径为 n(n-1)/2。但微前端引入后，沟通路径变成团队间的 m(m-1)/2（m 为团队数），加上团队内部的通信。当 n=20、m=4 时，沟通路径从 190 条降至 6 + 4×(5×4/2) = 46 条。**微前端的本质收益不在技术层面，而在大幅降低组织的沟通复杂度。**

### 15.1.2 维度二：技术债务

技术债务决定了你"能"选择什么方案，而不只是"想"选择什么方案。

```typescript
interface TechDebtDimension {
  frameworkAge: number;           // 主框架的年龄（年）
  frameworkVersion: string;       // 当前框架版本
  isLatestMajor: boolean;        // 是否为最新大版本
  mixedFrameworks: boolean;       // 是否存在多框架混用
  globalStateLeaks: number;      // 全局状态泄漏点数量（估算）
  cssStrategy: 'global' | 'modules' | 'css-in-js' | 'mixed';
  testCoverage: number;          // 测试覆盖率（%）
  buildToolChain: string;        // 构建工具
}
```

技术债务的四个关键判断标准：

**1. 框架异构性**

如果所有代码都在同一个框架同一个大版本上——恭喜，你的选项最多。Module Federation 在同构场景下效果最佳。如果存在 React 15 和 React 18 混用、或者 Vue 2 和 Vue 3 共存、甚至 jQuery 遗留页面——你需要更强的运行时隔离，乾坤或 Wujie 更适合。

**2. 全局状态污染程度**

翻开代码看看有多少地方直接操作 `window` 对象：

```typescript
// 技术债的"气味检测"
// 以下模式出现越多，对沙箱的需求越强

// 气味 1：直接挂载全局变量
window.APP_CONFIG = { apiBase: '/api/v2' };
window.__STORE__ = createStore(rootReducer);

// 气味 2：全局事件通信
window.addEventListener('message', handleLegacyEvent);
document.addEventListener('custom-nav', handleNavigation);

// 气味 3：动态修改全局样式
document.body.style.overflow = 'hidden';
document.querySelector('html').classList.add('dark-theme');

// 气味 4：第三方脚本的副作用
// 某个老旧的统计 SDK 会向 window 注入 20+ 个全局变量
// 而且你无法修改它的代码
```

**3. CSS 架构混乱度**

全局 CSS 是微前端落地最容易被低估的障碍。如果你的项目还在用全局样式表，迁移到微前端时每一个 `.container`、`.header`、`.btn` 都可能成为样式冲突的导火索。

**4. 构建工具链的现代化程度**

如果项目还在用 Webpack 4 甚至 Webpack 3，Module Federation 直接出局（它需要 Webpack 5+）。如果连 ES Module 都没有——iframe 可能是唯一现实的选项。

| 技术债等级 | 特征 | 可选方案 |
|-----------|------|---------|
| 低（绿色） | 单一现代框架、CSS Modules/CSS-in-JS、Webpack 5+/Vite | 全部方案可选 |
| 中（黄色） | 框架版本跨代、部分全局 CSS、一些全局状态泄漏 | 乾坤、Wujie、Module Federation |
| 高（橙色） | 多框架混用、大量全局 CSS、重度 window 依赖 | 乾坤、Wujie |
| 极高（红色） | 远古框架、jQuery 遗留、无法改造构建工具 | Wujie、iframe |

### 15.1.3 维度三：部署频率

部署频率决定了微前端的**投资回报率**。

```typescript
interface DeployDimension {
  deployFrequency: 'weekly' | 'biweekly' | 'daily' | 'multiple-daily';
  deployWindow: 'anytime' | 'off-hours' | 'weekly-slot';
  rollbackGranularity: 'all-or-nothing' | 'module-level' | 'feature-flag';
  canaryCapability: boolean;
  ciCdMaturity: 'manual' | 'basic' | 'advanced';
}
```

如果你的团队每两周部署一次，且只有一个部署窗口——微前端的独立部署优势几乎可以忽略。反过来，如果 4 个团队每天都需要多次部署，部署耦合的痛苦是每天都在发生的。

| 部署频率 | 部署耦合痛感 | 微前端 ROI |
|----------|-------------|-----------|
| 每月 / 双周一次 | 低：排期协调尚可接受 | 低——其他收益可能不足以覆盖成本 |
| 每周一次 | 中：开始出现排队和冲突 | 中——值得评估 |
| 每日一次 | 高：部署窗口成为瓶颈 | 高——独立部署价值明显 |
| 每日多次 | 极高：不独立部署几乎不可能 | 极高——微前端几乎是必选项 |

### 15.1.4 三维矩阵的综合评分

把三个维度组合在一起，形成一个决策公式：

```typescript
interface SelectionInput {
  team: TeamDimension;
  techDebt: 'low' | 'medium' | 'high' | 'extreme';
  deployFrequency: 'monthly' | 'weekly' | 'daily' | 'multiple-daily';
}

function evaluateMicroFrontendNeed(input: SelectionInput): {
  score: number;        // 0-100
  recommendation: string;
  suggestedApproach: string;
} {
  let score = 0;

  // 团队维度（最高 40 分）
  if (input.team.teamCount >= 4) score += 40;
  else if (input.team.teamCount >= 2) score += 20;
  else score += 5;

  // 部署维度（最高 35 分）
  const deployScores = {
    'monthly': 5,
    'weekly': 15,
    'daily': 25,
    'multiple-daily': 35,
  };
  score += deployScores[input.deployFrequency];

  // 技术债维度（最高 25 分——反向计分，债务越高越需要微前端做隔离）
  const debtScores = { 'low': 10, 'medium': 15, 'high': 20, 'extreme': 25 };
  score += debtScores[input.techDebt];

  // 输出建议
  if (score < 30) {
    return {
      score,
      recommendation: '不建议引入微前端',
      suggestedApproach: 'Monorepo + 模块化 + Rspack 加速构建',
    };
  } else if (score < 55) {
    return {
      score,
      recommendation: '可选择性引入，建议从 Module Federation 开始',
      suggestedApproach: 'Module Federation 做依赖共享 + 独立部署',
    };
  } else if (score < 80) {
    return {
      score,
      recommendation: '建议引入微前端',
      suggestedApproach: '乾坤或 Wujie，根据隔离需求选择',
    };
  } else {
    return {
      score,
      recommendation: '强烈建议引入微前端',
      suggestedApproach: 'Wujie（异构场景）或乾坤（生态成熟度）',
    };
  }
}
```

让我们用三个真实场景来验证这个矩阵：

**场景 A：初创公司的成长型产品**

```
团队：8 人，2 个团队，模块化代码所有权
技术债：低（Vue 3 + Vite，CSS Modules）
部署频率：每日一次
评分：20 + 25 + 10 = 55 → "可选择性引入"
建议：Module Federation
```

合理。这个阶段引入完整的运行时沙箱是过度工程化，但 Module Federation 的低接入成本让独立部署成为可能。

**场景 B：大型企业的中台系统**

```
团队：35 人，6 个团队，服务化代码所有权
技术债：高（React 16 + React 18 混用，大量全局 CSS）
部署频率：每日多次
评分：40 + 35 + 20 = 95 → "强烈建议引入微前端"
建议：Wujie（因为异构 + 高隔离需求）
```

合理。在这种复杂度下，没有微前端的独立部署和隔离能力，团队几乎无法高效协作。

**场景 C：传统企业的内部管理系统**

```
团队：4 人，1 个团队
技术债：中（Vue 2，Element UI，全局 CSS）
部署频率：双周一次
评分：5 + 5 + 15 = 25 → "不建议引入微前端"
建议：Monorepo + 模块化 + 升级到 Vue 3
```

合理。4 个人完全可以通过代码规范和模块化解决协作问题。微前端在这里是纯粹的过度工程。

> 🔥 **深度洞察**
>
> 三维矩阵的核心洞见是：**微前端的价值是组织收益和技术收益的乘积，而不是加和。** 团队规模大但部署频率低（比如每月一次），独立部署的收益大打折扣。部署频率高但只有一个团队，独立部署没有意义。技术债严重但团队只有 3 个人，花半年搞微前端不如花两个月还技术债。只有当三个维度的得分都达到一定阈值时，微前端的投入才能获得正向回报。

## 15.2 乾坤 vs Module Federation vs Wujie vs iframe：终极对比

在前面的章节中，我们分别深入剖析了每一种方案的内部实现。本节将这些知识整合为一张可直接指导决策的全景对比图。

### 15.2.1 架构范式对比

首先需要理解：这四种方案的本质差异不在"功能"，而在**架构范式**。

```
                    隔离强度
                      ↑
                      │
         iframe ●     │     ● Wujie
       (原生隔离)     │   (iframe + WebComponent)
                      │
     ─────────────────┼──────────────────→ 集成度
                      │
                      │
        乾坤 ●        │        ● Module Federation
     (运行时沙箱)     │      (编译时共享)
                      │
```

- **iframe**：浏览器原生的隔离机制，隔离性最强，但集成度最低
- **乾坤**：通过 JS Proxy 沙箱和 CSS 作用域在运行时模拟隔离
- **Wujie**：用 iframe 做 JS 沙箱 + Web Components 做 DOM 渲染，取两者之长
- **Module Federation**：在编译时解决模块共享，不提供运行时隔离，集成度最高

| 方案 | 隔离层 | 集成点 | 共享机制 |
|------|--------|--------|---------|
| iframe | 浏览器进程级隔离 | `<iframe>` 标签 | postMessage / URL params |
| 乾坤 | Proxy 沙箱 + Style Scope | DOM 容器节点 | props 传递 + GlobalState |
| Wujie | iframe（JS）+ Shadow DOM（CSS）| Web Component 自定义元素 | props + EventBus + window.parent |
| Module Federation | 无（共享运行时上下文）| 模块导入（import）| 编译时共享声明 + 运行时版本协商 |

### 15.2.2 九维度对比表

以下是基于源码分析和生产实践总结的九维度对比。每个维度的评分从 1-5 星，5 星代表该维度表现最优。

| 维度 | iframe | 乾坤 (qiankun) | Wujie | Module Federation |
|------|--------|----------------|-------|-------------------|
| **JS 隔离** | ★★★★★ 原生进程隔离 | ★★★★☆ Proxy 沙箱 | ★★★★★ iframe 沙箱 | ★★☆☆☆ 无隔离 |
| **CSS 隔离** | ★★★★★ 完全隔离 | ★★★☆☆ 工程化方案 | ★★★★★ Shadow DOM | ★★☆☆☆ 需自行处理 |
| **性能** | ★★☆☆☆ 多进程开销大 | ★★★★☆ 单进程，沙箱有开销 | ★★★☆☆ iframe + 代理有开销 | ★★★★★ 零额外运行时开销 |
| **通信效率** | ★★☆☆☆ 仅 postMessage | ★★★★☆ 同进程直接通信 | ★★★★☆ 代理 + 事件总线 | ★★★★★ 直接模块引用 |
| **开发体验** | ★★☆☆☆ 调试困难 | ★★★☆☆ 接入成本中等 | ★★★★☆ 接入简单 | ★★★★★ 像引入 npm 包 |
| **异构支持** | ★★★★★ 无框架限制 | ★★★★☆ 支持主流框架 | ★★★★★ 无框架限制 | ★★★☆☆ 需统一构建工具 |
| **维护成本** | ★★★★★ 无需维护沙箱 | ★★★☆☆ 沙箱维护成本中 | ★★★★☆ 框架维护 | ★★★★☆ 版本协商配置 |
| **学习曲线** | ★★★★★ 几乎为零 | ★★★☆☆ 需理解生命周期 | ★★★★☆ API 简洁 | ★★★☆☆ 配置有心智负担 |
| **社区生态** | ★★★★★ 浏览器原生 | ★★★★★ 最成熟的社区 | ★★★☆☆ 较年轻 | ★★★★☆ Webpack 生态 |

### 15.2.3 逐维度深入分析

**JS 隔离：运行时 vs 原生**

这是四种方案差异最大的维度。我们在第 3 章和第 10 章中深入分析了乾坤 Proxy 沙箱和 Wujie iframe 沙箱的实现原理。这里聚焦于它们在决策时的关键区别：

```typescript
// 乾坤 Proxy 沙箱的核心限制
// 1. 无法拦截某些原生 API 的副作用
document.createElement('style'); // 沙箱可以拦截
new Worker('worker.js');          // 沙箱无法完全代理 Worker 内部的 window 引用
eval('window.x = 1');            // eval 内部代码在严格模式下的行为可能不一致

// 2. with + Proxy 的性能开销
// 每次全局变量访问都经过 Proxy.get，高频场景下有可观测的性能差异
// 在一个包含 10000 次 window 属性访问的组件中：
// - 无沙箱：约 2ms
// - Proxy 沙箱：约 8ms
// - 差距 4 倍，但绝对值仍然很小

// Wujie iframe 沙箱的核心限制
// 1. URL 同步是间接的——iframe 的 location 和主应用的 URL 需要手动同步
// 2. Cookie / Storage 在不同域的 iframe 中默认不共享
// 3. 某些浏览器（Safari）对 iframe 的存储有额外限制
```

**关键判断**：如果你的子应用有大量全局副作用且无法改造（典型场景：接入第三方遗留系统），选 Wujie 或 iframe。如果子应用代码质量可控，乾坤的 Proxy 沙箱够用。如果子应用都是自己团队开发的现代应用，Module Federation 直接跳过隔离——因为你可以通过代码规范避免冲突。

**CSS 隔离：Shadow DOM vs Scoped vs 无**

| 方案 | CSS 隔离机制 | 隔离强度 | 核心限制 |
|------|-------------|---------|---------|
| iframe | 独立 document，天然隔离 | 完美 | 子应用弹窗无法突破 iframe 边界 |
| 乾坤 | experimentalStyleIsolation（选择器前缀）或 strictStyleIsolation（Shadow DOM） | 中等 | 动态样式可能逃逸；Shadow DOM 内 antd 弹层渲染异常 |
| Wujie | Web Component + Shadow DOM | 强 | 同样面临 Shadow DOM 弹层兼容问题，但提供 degrade 降级模式 |
| Module Federation | 无内置机制 | 无 | 需依赖 CSS Modules / CSS-in-JS / Tailwind 等工程化方案 |
```

**性能：零开销 vs 可接受开销 vs 显著开销**

Module Federation 的性能优势来源于它的架构本质——它根本没有运行时沙箱，模块加载后直接在同一个 JS 上下文中运行。这意味着：

```
                    初始加载性能            运行时性能
Module Federation   ★★★★★ (按需加载)      ★★★★★ (零代理开销)
乾坤                ★★★☆☆ (HTML 解析)      ★★★★☆ (Proxy 开销可忽略)
Wujie               ★★★☆☆ (iframe 创建)    ★★★☆☆ (DOM 代理开销)
iframe              ★★☆☆☆ (完整页面加载)    ★★★★★ (独立进程, 但无法共享资源)
```

> 🔥 **深度洞察**
>
> 性能对比中最容易被忽视的一个事实是：**初始加载性能差异远大于运行时性能差异。** 乾坤需要 fetch HTML → parse → fetch JS/CSS → eval 执行，这个链路通常需要 500ms-2s。Module Federation 的 remote entry 加载通常在 100ms 以内。但一旦子应用加载完成，运行时的性能差异很小——Proxy 沙箱的额外开销在大多数场景下不构成瓶颈。**所以，如果你的子应用切换频繁（如 Tab 切换场景），初始加载性能的权重要大幅提高。如果子应用一旦加载就长时间使用（如独立的管理后台），运行时性能更重要。**

### 15.2.4 决策流程图

把上述分析转化为一个可操作的决策流程：

```
开始选型
  │
  ├─ 子应用是否包含无法改造的遗留代码（jQuery / 远古框架）？
  │    │
  │    ├─ 是 → 子应用是否需要与主应用深度交互（共享状态、联动 UI）？
  │    │         │
  │    │         ├─ 是 → ✅ Wujie
  │    │         └─ 否 → ✅ iframe
  │    │
  │    └─ 否 ↓
  │
  ├─ 所有子应用是否使用统一的构建工具（Webpack 5+ / Rspack）？
  │    │
  │    ├─ 是 → 是否需要 JS/CSS 运行时隔离？
  │    │         │
  │    │         ├─ 是 → ✅ 乾坤 或 Wujie
  │    │         └─ 否 → ✅ Module Federation
  │    │
  │    └─ 否 ↓
  │
  ├─ 子应用是否需要跨框架支持（React + Vue + Angular 混用）？
  │    │
  │    ├─ 是 → ✅ Wujie（首选）或 乾坤
  │    └─ 否 → ✅ Module Federation 或 乾坤
  │
  └─ 以上都不确定？→ ✅ 乾坤（最安全的默认选择：社区成熟、文档完善、坑已被踩遍）
```

### 15.2.5 四大方案的"致命缺陷"

每个方案都有自己的"死穴"——那些在选型时必须直面的根本性限制。忽略它们，就是在埋定时炸弹。

**iframe 的致命缺陷：体验割裂**

```typescript
// iframe 的三大体验问题，无法从根本上解决

// 1. 路由不同步——用户刷新页面，iframe 内的路由状态丢失
// 用户在 iframe 内导航到 /order/detail/123
// 主应用 URL 仍然是 /app/order
// 用户按 F5 刷新 → iframe 回到默认页面 → 用户困惑

// 2. 弹窗无法突破 iframe 边界
// iframe 内的 Modal 只能在 iframe 区域内居中
// 如果 iframe 高度只有 400px，而 Modal 高度 500px → 被截断

// 3. 性能开销不可优化
// 每个 iframe 是一个独立的浏览器上下文
// 10 个 iframe = 10 份 React 运行时 + 10 份公共库
// 内存占用线性增长，无法共享任何 JS 资源
```

**乾坤的致命缺陷：沙箱不完美**

乾坤的 Proxy 沙箱是"尽力模拟"而非"原生隔离"。我们在第 3 章中详细分析了它的边界情况。在选型阶段需要特别注意：

1. **多实例场景下的共享引用**：`document` 只有一个，多个子应用操作 DOM 时存在冲突风险
2. **Shadow DOM 兼容性**：`strictStyleIsolation` 开启后，Ant Design 等组件库的弹层、Tooltip 渲染位置异常
3. **微妙的内存泄漏**：子应用卸载后，如果有未清理的事件监听器或定时器，Proxy 沙箱无法自动 GC 它们

**Wujie 的致命缺陷：社区年轻**

Wujie 的技术方案是四者中最优雅的，但它面临一个非技术的挑战：

1. **社区规模**：GitHub Stars 和 npm 下载量约为乾坤的 1/3
2. **生产案例**：大规模生产验证的公开案例较少（主要集中在腾讯内部）
3. **插件生态**：缺乏丰富的社区插件和工具链支持
4. **长期维护风险**：开源项目的活跃度依赖核心贡献者

**Module Federation 的致命缺陷：无隔离**

Module Federation 本质上不是一个"微前端框架"——它是一个"模块共享机制"。它不提供任何运行时隔离：

```typescript
// Module Federation 的隔离盲区

// Remote 应用可以直接污染 Host 的全局状态
// remote-app/src/bootstrap.js
window.globalConfig = { theme: 'dark' }; // 直接写入 host 的 window

// Remote 应用的 CSS 会直接影响 Host
// remote-app/src/styles.css
.header { color: red; } // 如果 host 也有 .header，直接被覆盖

// Remote 应用的副作用无法被回收
// 当 Remote 模块被卸载时，它注册的 setInterval、addEventListener 不会自动清除
```

这意味着 Module Federation 只适合**高度可控**的场景——所有子应用都是自己团队开发、代码规范统一、有代码审查流程。

### 15.2.6 成本模型

最终决策往往还要考虑一个现实因素：成本。

| 成本维度 | iframe | 乾坤 | Wujie | Module Federation |
|---------|--------|------|-------|-------------------|
| 初始搭建 | 0.5 周 | 2 周 | 1.5 周 | 2 周 |
| 单应用接入 | 0.5 天 | 3 天 | 1.5 天 | 2 天 |
| 月维护成本 | 2 小时 | 8 小时 | 5 小时 | 6 小时 |
| 团队学习 | 0 天 | 5 天 | 3 天 | 5 天 |
| **1年总成本（5个子应用）** | **~30 人天** | **~85 人天** | **~55 人天** | **~70 人天** |

> 💡 **最佳实践**：成本模型中最容易被低估的是"持续维护成本"。框架升级、子应用兼容性问题排查、沙箱边界 case 处理——这些长期成本往往超过初始搭建成本的 3-5 倍。选型时不要只看"搭起来要多久"，更要看"维护三年要多少精力"。

## 15.3 渐进式迁移策略：从单体到微前端的三个阶段

技术选型做出来了，下一个问题是：怎么迁移？

"大爆炸重写"（Big Bang Rewrite）——停下业务开发，花三个月把整个系统重构为微前端——是最常见的失败模式。它失败的原因不在技术层面，而在**风险管理**层面：三个月的重写意味着三个月没有新功能上线，而重写完成后的第一天就可能暴露出在 Demo 中从未出现的生产问题。

正确的做法是**渐进式迁移**：把迁移过程分为三个明确的阶段，每个阶段都有独立的价值产出和可回退的安全网。

### 15.3.1 第一阶段：基座搭建 + 第一个子应用（4-6 周）

**目标**：验证微前端方案在你的技术环境中是可行的，并建立基础设施。

```
第一阶段架构图：

┌─────────────────────────────────────────┐
│              主应用（基座）                │
│  ┌────────────────┐  ┌────────────────┐ │
│  │  原有单体代码   │  │  子应用容器     │ │
│  │  (90% 页面)    │  │  (1个子应用)    │ │
│  │  保持不动      │  │  新抽出的模块   │ │
│  └────────────────┘  └────────────────┘ │
└─────────────────────────────────────────┘
```

**关键步骤**：

```typescript
// 步骤 1：选择"最适合"第一个迁出的模块
// 不是最重要的，不是最复杂的，而是：
interface FirstAppCriteria {
  businessCriticality: 'low' | 'medium';  // 低-中重要性（出问题影响面小）
  couplingDegree: 'low';                   // 与其他模块耦合度低
  teamOwnership: 'clear';                  // 有明确的团队负责
  userTraffic: 'low-medium';               // 流量不是最高的
  techDebt: 'low';                         // 技术债不严重
}

// 典型的好选择：
// ✅ 帮助中心 / 文档中心
// ✅ 用户设置页面
// ✅ 数据报表 / 看板
// ✅ 独立的营销活动页

// 典型的坏选择：
// ❌ 首页（流量最大，出问题影响最广）
// ❌ 购物车/订单流程（核心业务流程）
// ❌ 与多个模块深度耦合的页面
```

```typescript
// 步骤 2：搭建基座应用
// 以乾坤为例的最小化基座

import { registerMicroApps, start } from 'qiankun';

// 基座的核心职责：路由分发 + 子应用加载 + 全局布局
registerMicroApps([
  {
    name: 'report-app',               // 第一个子应用：报表模块
    entry: '//report.myapp.com',       // 独立部署的入口
    container: '#micro-app-container', // 挂载的 DOM 节点
    activeRule: '/report',             // 激活路由
    props: {                           // 传递给子应用的数据
      authToken: getAuthToken(),
      userInfo: getCurrentUser(),
    },
  },
]);

// 关键配置：为后续扩展预留空间
start({
  prefetch: false,           // 第一阶段不开预加载，减少复杂度
  sandbox: {
    strictStyleIsolation: false,  // 第一阶段用 experimentalStyleIsolation
    experimentalStyleIsolation: true,
  },
});
```

```typescript
// 步骤 3：建立"共享契约"
// 在第一阶段就定义好主子应用之间的通信协议，避免后续每接入一个子应用都要重新谈判

interface MicroAppContract {
  // 认证：主应用提供 token，子应用不自行管理登录态
  auth: {
    getToken: () => string;
    onTokenRefresh: (callback: (newToken: string) => void) => void;
  };

  // 路由：子应用通过约定的 API 与主应用路由协调
  navigation: {
    navigateTo: (path: string) => void;
    getCurrentBasePath: () => string;
  };

  // 全局状态：只共享最小必要的状态
  globalState: {
    getUserInfo: () => UserInfo;
    getTheme: () => 'light' | 'dark';
    onStateChange: (key: string, callback: (value: any) => void) => void;
  };
}
```

**第一阶段的退出标准**：

1. ✅ 第一个子应用在生产环境稳定运行 2 周以上
2. ✅ 子应用可以独立构建、独立部署
3. ✅ 主子应用之间的通信协议经过验证
4. ✅ CI/CD 流水线支持子应用的独立发布
5. ✅ 回滚机制经过测试（子应用出问题可以快速回退到旧版本或降级为 iframe）

> 🔥 **深度洞察**
>
> 第一阶段最重要的产出不是"一个子应用上线了"，而是**团队对微前端的认知校准**。在 Demo 中一切顺利的东西，在生产环境中会暴露出各种意想不到的问题——CSS 样式穿透、Cookie 共享策略、移动端 WebView 的兼容性、CDN 缓存策略与子应用版本更新的冲突。这些问题必须在第一阶段被发现和解决，否则它们会在第二阶段扩大 N 倍。

### 15.3.2 第二阶段：核心模块迁移（2-4 个月）

**目标**：将 3-5 个核心业务模块迁出为独立子应用，实现真正的独立部署。

```
第二阶段架构图：

┌──────────────────────────────────────────────────────┐
│                    主应用（基座）                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────────┐ │
│  │ 子应用A  │ │ 子应用B  │ │ 子应用C  │ │ 剩余单体   │ │
│  │ 订单模块 │ │ 商品模块 │ │ 用户模块 │ │ (待迁移)   │ │
│  │ 团队 A   │ │ 团队 B   │ │ 团队 C   │ │            │ │
│  └─────────┘ └─────────┘ └─────────┘ └────────────┘ │
│                                                      │
│  ┌──────────────────────────────────────────────────┐│
│  │              共享服务层                            ││
│  │  认证 │ 路由 │ 状态 │ 监控 │ 公共组件库           ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

**此阶段的核心挑战与应对**：

**挑战一：公共依赖的版本管理**

```typescript
// 问题场景：
// 子应用 A 使用 antd@5.2.0
// 子应用 B 使用 antd@5.8.0
// 子应用 C 使用 antd@4.24.0（还没升级）

// 乾坤方案：每个子应用独立打包，各自包含自己版本的 antd
// 代价：用户加载 3 个子应用 = 下载 3 份 antd（即使版本只差小版本号）

// Module Federation 方案：声明 antd 为 shared 模块
// webpack.config.js (Host)
module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      shared: {
        antd: {
          singleton: false,        // 不强制单例——因为 v4 和 v5 不兼容
          requiredVersion: '^5.0.0',
        },
        react: {
          singleton: true,         // React 必须单例
          requiredVersion: '^18.0.0',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.0.0',
        },
      },
    }),
  ],
};
// 结果：v5.2.0 和 v5.8.0 的子应用共享 v5.8.0（向下兼容）
//       v4.24.0 的子应用单独加载自己的版本
```

**挑战二：跨子应用的路由协调**

```typescript
// 问题场景：
// 用户在"订单详情"页面点击"查看关联商品"
// 需要从子应用 A（订单）跳转到子应用 B（商品）
// 同时保留浏览器后退的能力

// 错误做法：子应用直接操作 window.location
window.location.href = '/product/detail/456'; // 会导致整页刷新

// 正确做法：通过基座的路由 API 导航
// 子应用内部
const microAppNav = props.navigation; // 基座传入的导航接口
microAppNav.navigateTo('/product/detail/456');

// 基座内部实现
function navigateTo(path: string) {
  // 使用 history.pushState 而非 location.href
  history.pushState(null, '', path);
  // 触发乾坤的路由监听，自动切换子应用
  window.dispatchEvent(new PopStateEvent('popstate'));
}
```

**挑战三：公共组件库的管理策略**

这个问题没有完美解答，但有三种可行策略：

| 策略 | 描述 | 适用场景 |
|------|------|---------|
| **独立 npm 包** | 公共组件发布为 npm 包，每个子应用 install 使用 | 组件变更频率低、版本稳定 |
| **Module Federation 共享** | 公共组件作为一个 Remote 模块，运行时加载 | 组件频繁更新、需要实时同步 |
| **Git Submodule** | 公共组件作为 Git Submodule 引入各子应用 | 需要源码级定制、构建时内联 |

```typescript
// 推荐模式：独立 npm 包 + Module Federation 混合
// 稳定的基础组件（Button、Input、Layout）→ npm 包，各子应用 install
// 业务公共组件（UserAvatar、GlobalSearch）→ Module Federation Remote

// shared-ui/webpack.config.js
module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'shared_ui',
      filename: 'remoteEntry.js',
      exposes: {
        './UserAvatar': './src/components/UserAvatar',
        './GlobalSearch': './src/components/GlobalSearch',
        './NotificationCenter': './src/components/NotificationCenter',
      },
    }),
  ],
};
```

**第二阶段的退出标准**：

1. ✅ 3-5 个子应用在生产环境独立运行
2. ✅ 各团队可以独立发布，无需协调部署窗口
3. ✅ 公共依赖的共享策略稳定
4. ✅ 监控系统能够区分各子应用的错误和性能指标
5. ✅ 新人入职可以在 1 天内完成子应用的开发环境搭建

### 15.3.3 第三阶段：全面微前端化 + 平台化（持续演进）

**目标**：将微前端从"一个技术方案"升级为"一个开发平台"。

```
第三阶段架构图：

┌──────────────────────────────────────────────────────────┐
│                     微前端平台层                           │
│  ┌──────────────────────────────────────────────────────┐│
│  │  应用注册中心 │ 灰度发布 │ 监控大盘 │ 子应用脚手架   ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │ App │ │ App │ │ App │ │ App │ │ App │ │ App │ ...   │
│  │  A  │ │  B  │ │  C  │ │  D  │ │  E  │ │  F  │      │
│  │React│ │React│ │ Vue │ │React│ │Solid│ │React│      │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘      │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │              基础设施层                                ││
│  │  认证SDK │ 请求库 │ 埋点SDK │ 主题系统 │ 国际化       ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

第三阶段的标志性能力：

**1. 应用注册中心**

```typescript
// 子应用不再硬编码在基座代码中
// 而是通过注册中心动态获取

interface AppRegistry {
  getApps(): Promise<MicroApp[]>;
  registerApp(app: MicroApp): Promise<void>;
  updateApp(name: string, config: Partial<MicroApp>): Promise<void>;
  deactivateApp(name: string): Promise<void>;
}

interface MicroApp {
  name: string;
  entry: string;
  activeRule: string | ((location: Location) => boolean);
  version: string;
  status: 'active' | 'inactive' | 'canary';
  canaryPercentage?: number;     // 灰度百分比
  team: string;                  // 负责团队
  healthCheckUrl?: string;       // 健康检查地址
}

// 基座启动时动态注册
async function bootstrap() {
  const registry = new AppRegistryClient('https://registry.internal.com');
  const apps = await registry.getApps();

  registerMicroApps(
    apps
      .filter(app => app.status !== 'inactive')
      .map(app => ({
        name: app.name,
        entry: app.entry,
        container: '#micro-app-container',
        activeRule: app.activeRule,
      }))
  );

  start();
}
```

**2. 灰度发布能力**

```typescript
// 子应用的灰度发布——这是单体前端很难实现的能力

interface CanaryConfig {
  appName: string;
  stableEntry: string;          // 稳定版入口
  canaryEntry: string;          // 灰度版入口
  percentage: number;           // 灰度比例 0-100
  rules: CanaryRule[];          // 精细化灰度规则
}

interface CanaryRule {
  type: 'userId' | 'region' | 'deviceType' | 'random';
  value: string;
  target: 'canary' | 'stable';
}

function resolveAppEntry(config: CanaryConfig, context: UserContext): string {
  // 1. 检查精细化规则
  for (const rule of config.rules) {
    if (matchRule(rule, context)) {
      return rule.target === 'canary' ? config.canaryEntry : config.stableEntry;
    }
  }

  // 2. 按百分比灰度
  const hash = hashUserId(context.userId);
  if (hash % 100 < config.percentage) {
    return config.canaryEntry;
  }

  return config.stableEntry;
}
```

**3. 统一监控大盘**

```typescript
// 每个子应用的性能指标独立采集、统一展示
interface SubAppMetrics {
  appName: string;
  loadTime: number;           // 子应用加载时间
  mountTime: number;          // 子应用挂载时间
  firstPaintTime: number;     // 首次绘制时间
  jsErrorCount: number;       // JS 错误数
  apiErrorRate: number;       // API 错误率
  memoryUsage: number;        // 内存占用
}

// 基座统一采集
function instrumentSubApp(appName: string) {
  const startTime = performance.now();

  return {
    onLoad() {
      report({ appName, loadTime: performance.now() - startTime });
    },
    onMount() {
      report({ appName, mountTime: performance.now() - startTime });
    },
    onError(error: Error) {
      report({ appName, error: error.message, stack: error.stack });
    },
  };
}
```

> 🔥 **深度洞察**
>
> 三个阶段的迁移本质上对应三种不同的能力建设：
> - 第一阶段建设的是**技术可行性**——证明微前端在你的环境中能跑通
> - 第二阶段建设的是**团队协作模式**——证明多个团队能通过微前端高效协作
> - 第三阶段建设的是**平台化能力**——让微前端从"一种架构方案"变成"一种基础设施"
>
> 大多数团队永远不会走到第三阶段。这没有问题。第一阶段和第二阶段的价值已经足够大。不要为了"架构的完美"而追求不必要的平台化——那是另一种形式的过度工程。

### 15.3.4 迁移中的反模式

记录五个在渐进式迁移中最常见的反模式，每一个都是从真实项目的惨痛教训中提炼出来的：

**反模式一：先迁最复杂的模块**

```
❌ "既然要搞微前端，就从订单模块开始——它最痛"
✅ "从帮助中心开始——它最简单，出问题影响最小"
```

第一个子应用是用来**验证基础设施**的，不是用来解决业务问题的。如果第一个子应用就选了最复杂的核心业务模块，一旦出问题你面对的不只是技术风险，还有业务风险。

**反模式二：基座承担过多业务逻辑**

```typescript
// ❌ 反模式：基座变成了"超级应用"
// 基座里放了全局搜索、消息通知、用户中心、主题切换...
// 结果：基座的代码量比任何一个子应用都大，改基座 = 全站风险

// ✅ 正确做法：基座只负责三件事
// 1. 路由分发
// 2. 子应用生命周期管理
// 3. 最小化的全局布局（导航栏、侧边栏骨架）
// 其余一切，包括全局搜索和消息通知，都应该是独立的子应用
```

**反模式三：忽略本地开发体验**

```typescript
// ❌ 开发一个子应用需要同时启动基座 + 3 个依赖的子应用
// 工程师的电脑同时跑 4 个 dev server，16GB 内存直接满

// ✅ 子应用必须能独立启动和开发
// 通过 mock 基座提供的 API，子应用可以完全脱离基座运行
// package.json
{
  "scripts": {
    "dev": "vite",                           // 独立开发模式
    "dev:micro": "vite --mode micro",        // 微前端模式（嵌入基座）
  }
}
```

**反模式四：缺乏版本回退机制**

```typescript
// ❌ 子应用上线后发现严重 bug，但无法快速回退
// 因为子应用的旧版本产物已经被 CDN 覆盖了

// ✅ 版本化部署：每次部署生成带版本号的产物
// CDN 结构：
// /micro-apps/order/v1.2.3/index.html
// /micro-apps/order/v1.2.4/index.html  ← 当前版本
// /micro-apps/order/v1.2.5/index.html  ← 新版本（有 bug）
//
// 回退只需要把注册中心的 entry 从 v1.2.5 改回 v1.2.4
// 零代码变更，零构建，秒级回退
```

**反模式五：过早追求统一**

```
❌ "所有子应用必须用相同的技术栈、相同的 UI 库、相同的状态管理"
✅ "定义清晰的接口契约，允许子应用内部技术选型自治"
```

微前端的价值之一就是让不同团队可以选择最适合自己业务场景的技术栈。如果你要求所有子应用技术栈完全统一——你可能不需要微前端，Monorepo 就够了。

## 15.4 何时放弃微前端（回归单体的勇气）

这是本章最重要的一节——也是大多数微前端文章永远不会告诉你的真相。

### 15.4.1 微前端不是单向门

Jeff Bezos 有一个著名的决策框架：**单向门（Type 1）决策** vs **双向门（Type 2）决策**。单向门决策不可逆转，必须极度慎重。双向门决策可以回退，应该快速做出。

微前端是一个**双向门**。你可以迁移到微前端，也可以从微前端迁回单体。这不是一个"一旦选了就回不了头"的决策。理解这一点至关重要——它意味着你不需要在第一天就做出"完美"的选型，你需要的是建立"如果走错了能回来"的能力。

### 15.4.2 六个信号：你可能不需要微前端

以下六个信号中，如果你的团队命中了 3 个以上，强烈建议重新评估微前端的必要性：

**信号一：团队规模缩小了**

```
初始状态：30 人，5 个团队 → 选择了乾坤
两年后：业务收缩，变成 12 人，2 个团队

此时微前端的维护成本（5 个子应用的 CI/CD 流水线、版本管理、
沙箱问题排查）可能超过了它带来的收益
```

**信号二：微前端的维护成本超过了它解决的问题**

```typescript
// 一个粗略的 ROI 计算
interface MicroFEROI {
  // 收益
  deploymentTimeSaved: number;         // 独立部署节省的时间（小时/月）
  conflictResolutionTimeSaved: number; // 减少的合并冲突处理时间
  teamAutonomyValue: number;           // 团队自治带来的效率提升

  // 成本
  frameworkMaintenanceTime: number;    // 框架维护时间（小时/月）
  debuggingOverhead: number;           // 微前端特有问题的调试时间
  ciCdComplexity: number;              // CI/CD 额外复杂度的成本
  newHireOnboarding: number;           // 新人额外学习成本
}

function isWorthIt(roi: MicroFEROI): boolean {
  const benefit = roi.deploymentTimeSaved
    + roi.conflictResolutionTimeSaved
    + roi.teamAutonomyValue;

  const cost = roi.frameworkMaintenanceTime
    + roi.debuggingOverhead
    + roi.ciCdComplexity
    + roi.newHireOnboarding;

  return benefit > cost * 1.5; // 收益需要 1.5 倍于成本才值得
  // 为什么是 1.5 倍而非 1 倍？因为成本的估算通常偏乐观
}
```

**信号三：子应用之间的耦合度越来越高**

```
如果 80% 的需求都涉及 2 个以上子应用的联动修改，
那么微前端的"独立部署"优势就名存实亡了。

极端情况：
需求 A → 改子应用 1、2、3
需求 B → 改子应用 2、3、4
需求 C → 改子应用 1、3、5

每次上线都需要协调多个子应用的版本——
这不就是用更复杂的方式重新发明了单体吗？
```

**信号四：团队的工程能力无法支撑微前端的复杂度**

微前端需要团队具备一定的工程化能力：独立的 CI/CD 管道、版本化部署、监控告警、故障排查能力。如果团队的工程化水平还停留在"手动部署"或"FTP 上传"阶段，微前端会放大而非减少问题。

**信号五：构建工具升级解决了原本的痛点**

```
2023 年：Webpack 4 构建 8 分钟 → 决定引入微前端
2025 年：升级到 Rspack，构建时间降到 15 秒

如果微前端的主要动机是"构建慢"，而构建工具升级已经解决了这个问题，
那么维持微前端架构的唯一理由就消失了。
```

**信号六：微前端成了"简历驱动开发"的产物**

这个信号最难自我诊断，但最常见。如果引入微前端的真实动因不是"解决实际问题"，而是"架构师想在简历上写一笔"或"技术负责人想做一次技术分享"——那么当这些人离开之后，留下的就是一个没有人理解、没有人愿意维护的系统。

### 15.4.3 从微前端回归单体的迁移路径

如果你决定放弃微前端，这里有一个安全的回退路径：

```
阶段 1：冻结（2 周）
  - 停止创建新子应用
  - 所有新功能在现有子应用内开发
  - 评估每个子应用的代码量和复杂度

阶段 2：合并（4-8 周）
  - 从最简单的子应用开始，逐个合并回主应用
  - 每合并一个子应用，运行完整的回归测试
  - 保留子应用的模块边界（目录结构、CSS 命名空间）

阶段 3：清理（2-4 周）
  - 移除微前端框架的依赖
  - 统一构建配置
  - 清理子应用的生命周期代码（bootstrap、mount、unmount）
  - 简化 CI/CD 流水线
```

```typescript
// 合并子应用时的关键步骤
// 以将乾坤子应用合并回单体为例

// 步骤 1：移除生命周期导出
// 之前（子应用入口）
export async function bootstrap() { /* ... */ }
export async function mount(props) {
  ReactDOM.render(<App {...props} />, document.getElementById('root'));
}
export async function unmount() {
  ReactDOM.unmountComponentAtNode(document.getElementById('root'));
}

// 之后（作为路由模块）
// 子应用的 <App /> 组件保持不变
// 只是挂载方式从"乾坤生命周期"变回"路由懒加载"
const OrderModule = React.lazy(() => import('./modules/order/App'));

// 步骤 2：处理全局状态依赖
// 之前：通过 props 从基座获取
const token = props.authToken;

// 之后：通过统一的状态管理获取
const token = useAuthStore().token;

// 步骤 3：处理 CSS 隔离回退
// 之前：依赖乾坤的 experimentalStyleIsolation
// 之后：确保所有 CSS 使用 CSS Modules 或约定的命名空间
// 这一步可能是最痛苦的——如果子应用大量使用全局 CSS，合并后样式冲突会立即暴露
```

### 15.4.4 一个真实的回归案例

让我分享一个真实的案例（细节已脱敏）。

某在线教育公司在 2022 年引入乾坤微前端架构，将其平台拆分为 7 个子应用（课程管理、学生管理、直播教室、作业系统、数据分析、营销活动、帮助中心）。当时的团队有 25 人，4 个业务组。

两年后的 2024 年：
- 公司业务调整，前端团队从 25 人缩减到 10 人
- 7 个子应用的 CI/CD 管道和部署流程需要 1 个人全职维护
- 每次跨子应用的需求（约 40% 的需求）都需要协调多个子应用的发版
- 新入职的工程师平均需要 2 周才能理解微前端架构并正常开发
- 乾坤的一个沙箱兼容性问题导致直播教室在 Safari 上频繁白屏，排查用了 3 周

**决策**：2024 年 Q3，技术负责人做出了"回归单体"的决定。

**执行过程**：
1. 用 Rspack 替换 Webpack（构建时间从 6 分钟降至 20 秒——原来"构建慢"的痛点消失了）
2. 逐个将子应用合并回 Monorepo 下的独立目录
3. 用 Module Federation 保留了"独立开发、按需加载"的能力，但不再使用运行时沙箱
4. 全过程花了 6 周，零线上事故

**结果**：
- CI/CD 管道从 7 条减为 1 条，维护成本下降 80%
- 新人上手时间从 2 周降至 3 天
- Safari 白屏问题自动消失（因为不再有沙箱了）
- 跨模块协作从"协调多个子应用版本"变回"同一个 PR 改多个目录"

这不是微前端的失败——微前端在那个公司的 25 人阶段是正确的选择。但当约束条件改变（团队缩小、业务简化），架构决策也应该随之调整。**死守一个不再适合当前约束的架构，才是真正的失败。**

> 🔥 **深度洞察**
>
> "回归单体"需要勇气，因为它意味着承认之前的决策"不再适用"。在很多组织中，这会被错误地解读为"之前的决策是错误的"。这是一种认知偏差——**一个决策在做出时是正确的，不代表它在未来的所有时间点都是正确的。** 约束条件变了，最优解就会变。有能力识别并主动调整架构方向，是架构师成熟度的标志，而非失败的证明。

### 15.4.5 决策清单：去 or 留

最后，提供一个简洁的决策清单。如果"留"的理由少于 3 个，认真考虑回归单体。

```
[ ] 团队数量 ≥ 3，且各有明确的业务领域
[ ] 部署频率 ≥ 每周，且受部署耦合困扰
[ ] 存在不可避免的技术栈异构需求
[ ] 微前端的 ROI > 1.5（收益明显超过成本）
[ ] 团队有足够的工程化能力支撑微前端
[ ] 子应用之间的耦合度 < 30%（多数需求只涉及单个子应用）
[ ] 有专人（至少 0.5 人力）持续维护微前端基础设施
```

## 本章小结

- **选型不是一维问题**：团队规模、技术债务、部署频率三个维度共同决定微前端的必要性和方案选择
- **没有最好的框架，只有最适合的框架**：iframe 适合极端隔离场景，乾坤适合需要成熟生态的运行时隔离场景，Wujie 适合需要强隔离又要好体验的场景，Module Federation 适合技术栈统一的高性能场景
- **渐进式迁移是唯一正确的迁移策略**：第一阶段验证可行性，第二阶段迁移核心模块，第三阶段平台化——大多数团队在第二阶段就能获得足够的收益
- **架构决策必须随约束条件的变化而调整**：当团队规模缩小、业务复杂度降低、或构建工具升级解决了原有痛点时，从微前端回归单体不是失败，是成熟
- **最好的架构是"刚好够用"的架构**——不多一分复杂度，也不少一分能力

## 思考题

1. **决策应用**：你所在的团队有 12 名前端工程师，分为 3 个小组，维护一个 Vue 2 + Vue 3 混合的电商系统，每周部署一次。请使用本章的三维选型矩阵评估是否需要微前端，以及如果需要，应该选择哪种方案。

2. **方案对比**：假设你的业务场景同时存在"React 18 新模块"和"jQuery 遗留模块"，需要在同一个页面中展示。请分析在这种场景下，乾坤、Wujie 和 iframe 各自的优劣，并给出你的推荐方案和理由。

3. **迁移策略**：你被指派负责将一个 50 万行的 Angular 单体应用迁移到微前端架构。请设计三个阶段的迁移计划，包括每个阶段的目标、时间估算、风险点和退出标准。

4. **逆向思考**：本章提出"当命中 3 个以上信号时应考虑放弃微前端"。请设计一个场景，其中只命中了 2 个信号但仍然应该放弃微前端。这说明什么问题？

5. **开放讨论**：随着 Web 标准的演进（Import Maps、Shadow DOM、Web Components 原生支持越来越好），你认为五年后微前端框架还有存在的必要吗？浏览器原生能力是否最终会取代乾坤和 Module Federation 这类框架？


</div>