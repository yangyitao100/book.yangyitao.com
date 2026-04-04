<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useData } from 'vitepress'

const { isDark } = useData()

const scrolled = ref(false)
const mobileMenuOpen = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 20
}

function toggleDark() {
  isDark.value = !isDark.value
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})

const books = [
  {
    title: 'React18 内核探秘',
    desc: '手写 React 高质量源码迈向高阶开发，从原始版到 Fiber 架构，深入理解 React18 源码的每一个细节。',
    link: '/books/react18/',
    chapters: 19,
    icon: 'R',
    color: '#3b82f6',
    gradient: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
    tags: ['React', 'Fiber', '并发模式'],
  },
  {
    title: 'Vue3 源码剖析',
    desc: '从 monorepo 到响应式系统，从虚拟DOM 到编译优化，全面深入 Vue3 各子系统的源码实现。',
    link: '/books/vue3/',
    chapters: 25,
    icon: 'V',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #064e3b, #059669)',
    tags: ['Vue3', '响应式', '编译器'],
  },
  {
    title: '微前端源码剖析',
    desc: '深入乾坤、single-spa、import-html-entry 源码，理解微前端框架的核心设计与实现。',
    link: '/books/microfe/',
    chapters: 18,
    icon: 'M',
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #78350f, #d97706)',
    tags: ['微前端', '乾坤', 'JS沙箱'],
  },
  {
    title: 'OpenClaw 设计与实现',
    desc: '第一本深入 AI Agent 运行时内核的架构专著，逐层拆解 Gateway 引擎、Provider 热切换等核心子系统。',
    link: '/books/openclaw/',
    chapters: 18,
    icon: 'O',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #312e81, #7c3aed)',
    tags: ['AI Agent', '架构', 'Gateway'],
  },
]

const features = [
  { title: '源码级深度', desc: '每一章都从源码切入，逐行分析核心实现，不止于 API 用法。', icon: 'depth' },
  { title: '架构思维', desc: '从整体设计到模块拆分，帮你建立系统化的架构认知。', icon: 'arch' },
  { title: '手写实践', desc: '配套手写实现，从零构建简化版框架，真正掌握核心原理。', icon: 'code' },
  { title: '完全免费', desc: '所有内容开源免费，持续更新迭代，无任何付费门槛。', icon: 'free' },
  { title: '移动适配', desc: '响应式设计，暗色模式，全文搜索，任何设备舒适阅读。', icon: 'mobile' },
  { title: '持续更新', desc: '紧跟技术前沿，内容定期迭代，确保知识不过时。', icon: 'update' },
]

const testimonials = [
  {
    text: '读完 React18 源码解析后，面试中的源码题再也不怕了。手写 Fiber 那部分让我对调度算法有了全新的理解。',
    name: '前端工程师',
    role: '大厂 P7',
  },
  {
    text: 'Vue3 源码剖析写得非常清晰，从 reactivity 到 compiler 每个模块都讲透了。是我读过最好的 Vue 源码教程。',
    name: '全栈开发者',
    role: '创业公司 CTO',
  },
  {
    text: '微前端那本帮我在公司成功落地了乾坤方案。能看到源码级的实现细节，比官方文档深入太多了。',
    name: '架构师',
    role: '互联网公司',
  },
]
</script>

<template>
  <div class="landing" :class="{ 'is-dark': isDark }">
    <!-- ========== NAV ========== -->
    <nav class="nav" :class="{ scrolled }">
      <div class="nav-inner">
        <a href="/" class="nav-brand">
          <img src="/logo.svg" alt="logo" class="nav-logo" />
          <span class="nav-name">杨艺韬讲堂</span>
        </a>

        <div class="nav-links" :class="{ open: mobileMenuOpen }">
          <a href="#books" class="nav-link" @click="mobileMenuOpen = false">书籍</a>
          <a href="#features" class="nav-link" @click="mobileMenuOpen = false">特色</a>
          <a href="#author" class="nav-link" @click="mobileMenuOpen = false">作者</a>
          <a href="https://github.com/yangyitao100" target="_blank" class="nav-link">GitHub</a>
        </div>

        <div class="nav-actions">
          <button class="theme-toggle" @click="toggleDark" :title="isDark ? '切换浅色' : '切换暗色'">
            <svg v-if="isDark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
          </button>
          <button class="mobile-menu-btn" @click="mobileMenuOpen = !mobileMenuOpen">
            <svg v-if="!mobileMenuOpen" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>
            <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>
    </nav>

    <!-- ========== HERO ========== -->
    <section class="hero">
      <div class="hero-bg">
        <div class="hero-grid" />
        <div class="hero-orb hero-orb-1" />
        <div class="hero-orb hero-orb-2" />
        <div class="hero-orb hero-orb-3" />
      </div>
      <div class="hero-content">
        <div class="hero-badge">
          <span class="badge-pulse" />
          开源免费 · 持续更新中
        </div>
        <h1 class="hero-title">
          <span class="hero-title-main">深入源码内核</span>
          <span class="hero-title-accent">构建底层认知</span>
        </h1>
        <p class="hero-desc">
          四本技术专著，从 React、Vue、微前端到 AI Agent<br class="hide-mobile" />
          逐行拆解源码实现，帮你真正理解框架本质
        </p>
        <div class="hero-stats">
          <div class="hero-stat">
            <span class="hero-stat-num">4</span>
            <span class="hero-stat-label">本书籍</span>
          </div>
          <span class="hero-stat-sep" />
          <div class="hero-stat">
            <span class="hero-stat-num">90+</span>
            <span class="hero-stat-label">章节</span>
          </div>
          <span class="hero-stat-sep" />
          <div class="hero-stat">
            <span class="hero-stat-num">100%</span>
            <span class="hero-stat-label">免费</span>
          </div>
        </div>
        <div class="hero-cta">
          <a href="#books" class="cta-primary">
            开始阅读
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>
          </a>
          <a href="https://github.com/yangyitao100" target="_blank" class="cta-ghost">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </div>
    </section>

    <!-- ========== BOOKS ========== -->
    <section id="books" class="section books">
      <div class="container">
        <div class="section-head">
          <span class="section-tag">BOOKS</span>
          <h2 class="section-title">四本深度技术专著</h2>
          <p class="section-subtitle">每一本都从源码出发，带你构建对技术底层的完整认知</p>
        </div>
        <div class="book-grid">
          <a v-for="b in books" :key="b.title" :href="b.link" class="book-card">
            <div class="book-visual" :style="{ background: b.gradient }">
              <span class="book-icon">{{ b.icon }}</span>
              <span class="book-badge">{{ b.chapters }} 章</span>
            </div>
            <div class="book-body">
              <h3 class="book-title">{{ b.title }}</h3>
              <p class="book-desc">{{ b.desc }}</p>
              <div class="book-meta">
                <div class="book-tags">
                  <span v-for="t in b.tags" :key="t" class="book-tag">{{ t }}</span>
                </div>
                <span class="book-arrow">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </span>
              </div>
            </div>
          </a>
        </div>
      </div>
    </section>

    <!-- ========== FEATURES ========== -->
    <section id="features" class="section features">
      <div class="container">
        <div class="section-head">
          <span class="section-tag">WHY US</span>
          <h2 class="section-title">为什么选择这里</h2>
          <p class="section-subtitle">我们追求技术内容的深度与品质</p>
        </div>
        <div class="feature-grid">
          <div v-for="f in features" :key="f.title" class="feature-card">
            <div class="feature-icon" :class="'fi-' + f.icon">
              <svg v-if="f.icon === 'depth'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>
              <svg v-if="f.icon === 'arch'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
              <svg v-if="f.icon === 'code'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              <svg v-if="f.icon === 'free'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
              <svg v-if="f.icon === 'mobile'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
              <svg v-if="f.icon === 'update'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
            </div>
            <h3 class="feature-title">{{ f.title }}</h3>
            <p class="feature-desc">{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== TESTIMONIALS ========== -->
    <section class="section testimonials-section">
      <div class="container">
        <div class="section-head">
          <span class="section-tag">REVIEWS</span>
          <h2 class="section-title">读者评价</h2>
        </div>
        <div class="testimonial-grid">
          <div v-for="t in testimonials" :key="t.name" class="testimonial-card">
            <div class="tq">"</div>
            <p class="t-text">{{ t.text }}</p>
            <div class="t-author">
              <div class="t-avatar">{{ t.name[0] }}</div>
              <div>
                <div class="t-name">{{ t.name }}</div>
                <div class="t-role">{{ t.role }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== AUTHOR ========== -->
    <section id="author" class="section author">
      <div class="container">
        <div class="author-card">
          <div class="author-info">
            <h2 class="author-title">关于作者</h2>
            <p class="author-bio">
              我是杨艺韬，多年深耕前端技术栈源码研究。我相信理解源码是通往技术自由的必经之路——这些书籍是我将复杂的底层原理用清晰的语言和代码传递给每一位开发者的尝试。
            </p>
            <div class="author-links">
              <a href="https://github.com/yangyitao100" target="_blank" class="author-link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                GitHub
              </a>
              <a href="https://www.yangyitao.com" target="_blank" class="author-link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                个人网站
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== CTA ========== -->
    <section class="section cta-section">
      <div class="container">
        <div class="cta-card">
          <h2 class="cta-title">准备好深入源码了吗？</h2>
          <p class="cta-desc">选择一本感兴趣的书，开始你的源码探索之旅</p>
          <a href="#books" class="cta-primary">
            开始阅读
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>
          </a>
        </div>
      </div>
    </section>

    <!-- ========== FOOTER ========== -->
    <footer class="footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <img src="/logo.svg" alt="logo" class="footer-logo" />
          <span>杨艺韬讲堂</span>
        </div>
        <div class="footer-copy">
          Copyright &copy; 2024–present 杨艺韬
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ===== Reset & base ===== */
.landing {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif;
  color: var(--home-text-1);
  background: var(--home-bg);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 24px;
}

/* ===== NAV ===== */
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 0 24px;
  transition: all 0.3s ease;
  background: transparent;
}

.nav.scrolled {
  background: color-mix(in srgb, var(--home-bg) 85%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--home-card-border);
}

.nav-inner {
  max-width: 1080px;
  margin: 0 auto;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--home-text-1);
  font-weight: 700;
  font-size: 16px;
}

.nav-logo {
  width: 28px;
  height: 28px;
}

.nav-name {
  letter-spacing: -0.02em;
}

.nav.scrolled .nav-brand {
  color: var(--home-text-1);
}

/* nav not scrolled on dark hero background */
.nav:not(.scrolled) .nav-brand {
  color: #e2e8f0;
}

.nav:not(.scrolled) .nav-link {
  color: rgba(203, 213, 225, 0.8);
}

.nav:not(.scrolled) .nav-link:hover {
  color: #fff;
}

.nav:not(.scrolled) .theme-toggle {
  color: rgba(203, 213, 225, 0.8);
}

.nav-links {
  display: flex;
  gap: 4px;
}

.nav-link {
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--home-text-2);
  padding: 6px 14px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.nav-link:hover {
  color: var(--home-text-1);
  background: var(--home-card-border);
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--home-text-2);
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.theme-toggle:hover {
  background: var(--home-card-border);
}

.mobile-menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 8px;
}

/* ===== HERO ===== */
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.hero-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(160deg, #070a14 0%, #0f172a 40%, #0c1220 100%);
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.04) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 20%, transparent 100%);
}

.hero-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  pointer-events: none;
}

.hero-orb-1 {
  width: 700px;
  height: 700px;
  background: rgba(59, 130, 246, 0.08);
  top: -250px;
  right: -150px;
  animation: float 8s ease-in-out infinite;
}

.hero-orb-2 {
  width: 500px;
  height: 500px;
  background: rgba(139, 92, 246, 0.06);
  bottom: -200px;
  left: -100px;
  animation: float 10s ease-in-out infinite reverse;
}

.hero-orb-3 {
  width: 300px;
  height: 300px;
  background: rgba(16, 185, 129, 0.05);
  top: 40%;
  left: 50%;
  animation: float 12s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-30px); }
}

.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  padding: 0 24px;
  max-width: 760px;
  animation: fadeInUp 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 7px 18px;
  border-radius: 100px;
  font-size: 13px;
  font-weight: 500;
  color: rgba(203, 213, 225, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(148, 163, 184, 0.04);
  margin-bottom: 40px;
}

.badge-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.5);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.hero-title {
  margin: 0 0 24px;
}

.hero-title-main,
.hero-title-accent {
  display: block;
  font-size: clamp(40px, 7vw, 72px);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.1;
}

.hero-title-main {
  background: linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-title-accent {
  background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 60%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-desc {
  font-size: clamp(15px, 2vw, 18px);
  color: rgba(148, 163, 184, 0.65);
  line-height: 1.75;
  margin: 0 0 40px;
}

.hero-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 36px;
  margin-bottom: 48px;
}

.hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.hero-stat-num {
  font-size: 30px;
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.hero-stat-label {
  font-size: 13px;
  color: rgba(148, 163, 184, 0.5);
}

.hero-stat-sep {
  width: 1px;
  height: 40px;
  background: rgba(148, 163, 184, 0.1);
}

.hero-cta {
  display: flex;
  justify-content: center;
  gap: 14px;
}

.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 36px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  color: #fff;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.3);
  transition: all 0.25s ease;
}

.cta-primary:hover {
  box-shadow: 0 8px 32px rgba(99, 102, 241, 0.45);
  transform: translateY(-2px);
}

.cta-ghost {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 28px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  color: rgba(203, 213, 225, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.15);
  background: rgba(148, 163, 184, 0.04);
  transition: all 0.25s ease;
}

.cta-ghost:hover {
  border-color: rgba(148, 163, 184, 0.3);
  background: rgba(148, 163, 184, 0.08);
}

/* ===== SECTIONS ===== */
.section {
  padding: 100px 0;
}

.section-head {
  text-align: center;
  margin-bottom: 56px;
}

.section-tag {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--vp-c-brand-1);
  margin-bottom: 14px;
}

.section-title {
  font-size: clamp(28px, 4vw, 42px);
  font-weight: 800;
  color: var(--home-text-1);
  margin: 0 0 12px;
  letter-spacing: -0.03em;
}

.section-subtitle {
  font-size: 16px;
  color: var(--home-text-3);
  margin: 0;
}

/* ===== BOOKS ===== */
.books {
  background: var(--home-bg);
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.book-card {
  display: flex;
  flex-direction: column;
  text-decoration: none;
  color: inherit;
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: var(--home-card-shadow);
}

.book-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--home-card-shadow-hover);
}

.book-visual {
  position: relative;
  padding: 32px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.book-icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 900;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  backdrop-filter: blur(8px);
}

.book-badge {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  padding: 4px 14px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(4px);
}

.book-body {
  padding: 24px;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.book-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--home-text-1);
  margin: 0 0 8px;
}

.book-desc {
  font-size: 14px;
  line-height: 1.7;
  color: var(--home-text-2);
  margin: 0 0 20px;
  flex: 1;
}

.book-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.book-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.book-tag {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 6px;
  color: var(--home-tag-color);
  background: var(--home-tag-bg);
  border: 1px solid var(--home-tag-border);
}

.book-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  color: var(--vp-c-brand-1);
  background: var(--home-tag-bg);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.book-card:hover .book-arrow {
  background: var(--vp-c-brand-1);
  color: #fff;
}

/* ===== FEATURES ===== */
.features {
  background: var(--home-bg-alt);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.feature-card {
  padding: 28px 24px;
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 14px;
  transition: all 0.25s ease;
}

.feature-card:hover {
  box-shadow: var(--home-card-shadow-hover);
  transform: translateY(-2px);
}

.feature-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.fi-depth { color: #3b82f6; background: rgba(59, 130, 246, 0.08); }
.fi-arch  { color: #8b5cf6; background: rgba(139, 92, 246, 0.08); }
.fi-code  { color: #10b981; background: rgba(16, 185, 129, 0.08); }
.fi-free  { color: #f59e0b; background: rgba(245, 158, 11, 0.08); }
.fi-mobile { color: #ec4899; background: rgba(236, 72, 153, 0.08); }
.fi-update { color: #06b6d4; background: rgba(6, 182, 212, 0.08); }

.feature-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--home-text-1);
  margin: 0 0 8px;
}

.feature-desc {
  font-size: 14px;
  line-height: 1.7;
  color: var(--home-text-2);
  margin: 0;
}

/* ===== TESTIMONIALS ===== */
.testimonials-section {
  background: var(--home-bg);
}

.testimonial-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.testimonial-card {
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 16px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  transition: all 0.25s ease;
}

.testimonial-card:hover {
  box-shadow: var(--home-card-shadow-hover);
  transform: translateY(-2px);
}

.tq {
  font-size: 40px;
  font-weight: 800;
  line-height: 1;
  background: linear-gradient(135deg, var(--vp-c-brand-1), var(--vp-c-brand-3));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-family: Georgia, serif;
  margin-bottom: 12px;
  user-select: none;
}

.t-text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--home-text-2);
  margin: 0 0 20px;
  flex: 1;
}

.t-author {
  display: flex;
  align-items: center;
  gap: 12px;
}

.t-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--vp-c-brand-1), var(--vp-c-brand-3));
  flex-shrink: 0;
}

.t-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--home-text-1);
}

.t-role {
  font-size: 12px;
  color: var(--home-text-3);
  margin-top: 1px;
}

/* ===== AUTHOR ===== */
.author {
  background: var(--home-bg-alt);
}

.author-card {
  max-width: 640px;
  margin: 0 auto;
  text-align: center;
}

.author-title {
  font-size: clamp(28px, 4vw, 38px);
  font-weight: 800;
  color: var(--home-text-1);
  margin: 0 0 20px;
  letter-spacing: -0.02em;
}

.author-bio {
  font-size: 16px;
  line-height: 1.85;
  color: var(--home-text-2);
  margin: 0 0 28px;
}

.author-links {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.author-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  padding: 10px 22px;
  border-radius: 10px;
  border: 1px solid var(--home-tag-border);
  background: var(--home-tag-bg);
  transition: all 0.2s ease;
}

.author-link:hover {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
}

/* ===== CTA ===== */
.cta-section {
  background: var(--home-bg);
  padding: 80px 0 100px;
}

.cta-card {
  text-align: center;
  padding: 64px 40px;
  border-radius: 24px;
  background: linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
  border: 1px solid rgba(148, 163, 184, 0.08);
  position: relative;
  overflow: hidden;
}

.cta-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 30% 50%, rgba(59, 130, 246, 0.08) 0%, transparent 60%),
              radial-gradient(circle at 70% 50%, rgba(139, 92, 246, 0.06) 0%, transparent 60%);
  pointer-events: none;
}

.cta-title {
  font-size: clamp(24px, 3.5vw, 34px);
  font-weight: 800;
  color: #f1f5f9;
  margin: 0 0 12px;
  position: relative;
  letter-spacing: -0.02em;
}

.cta-desc {
  font-size: 16px;
  color: rgba(148, 163, 184, 0.7);
  margin: 0 0 32px;
  position: relative;
}

.cta-section .cta-primary {
  position: relative;
}

/* ===== FOOTER ===== */
.footer {
  padding: 32px 24px;
  border-top: 1px solid var(--home-card-border);
  background: var(--home-bg);
}

.footer-inner {
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--home-text-2);
}

.footer-logo {
  width: 20px;
  height: 20px;
}

.footer-copy {
  font-size: 13px;
  color: var(--home-text-3);
}

/* ===== MOBILE ===== */
@media (max-width: 768px) {
  .mobile-menu-btn {
    display: flex;
  }

  .nav-links {
    display: none;
    position: absolute;
    top: 64px;
    left: 0;
    right: 0;
    flex-direction: column;
    padding: 12px 16px;
    background: color-mix(in srgb, var(--home-bg) 95%, transparent);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--home-card-border);
  }

  .nav:not(.scrolled) .nav-links {
    background: rgba(15, 23, 42, 0.95);
  }

  .nav-links.open {
    display: flex;
  }

  .nav-link {
    padding: 12px 16px;
  }

  .hero { min-height: 90vh; }
  .hero-stats { gap: 20px; }
  .hero-stat-num { font-size: 24px; }
  .hero-cta { flex-direction: column; align-items: center; }
  .cta-primary, .cta-ghost { width: 100%; max-width: 280px; justify-content: center; }

  .section { padding: 64px 0; }

  .book-grid { grid-template-columns: 1fr; }
  .feature-grid { grid-template-columns: 1fr; }
  .testimonial-grid { grid-template-columns: 1fr; }

  .hide-mobile { display: none; }

  .footer-inner { flex-direction: column; gap: 12px; text-align: center; }

  .cta-card { padding: 48px 24px; }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .feature-grid { grid-template-columns: repeat(2, 1fr); }
}

/* ===== Smooth scroll ===== */
.landing {
  scroll-behavior: smooth;
}
</style>
