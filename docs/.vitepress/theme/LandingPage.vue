<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const isDark = ref(false)
const scrolled = ref(false)
const mobileMenuOpen = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 20
}

function toggleDark() {
  const el = document.documentElement
  el.classList.toggle('dark')
  isDark.value = el.classList.contains('dark')
  try {
    localStorage.setItem('vitepress-theme-appearance', isDark.value ? 'dark' : 'light')
  } catch {}
}

/* ---- Scroll-triggered reveal ---- */
let observer: IntersectionObserver | null = null

function initReveal() {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible')
          observer?.unobserve(e.target)
        }
      })
    },
    { threshold: 0.12 }
  )
  document.querySelectorAll('.reveal').forEach((el) => observer?.observe(el))
}

onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  nextTick(initReveal)
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  observer?.disconnect()
})

const books = [
  {
    title: 'React18 内核探秘',
    desc: '手写 React 高质量源码迈向高阶开发，从原始版到 Fiber 架构，深入理解 React18 源码的每一个细节。',
    link: '/books/react18/',
    chapters: 19,
    icon: 'R',
    gradient: 'linear-gradient(135deg, #1e3a5f, #2563eb)',
    tags: ['React', 'Fiber', '并发模式'],
  },
  {
    title: 'Vue3 源码剖析',
    desc: '从 monorepo 到响应式系统，从虚拟DOM 到编译优化，全面深入 Vue3 各子系统的源码实现。',
    link: '/books/vue3/',
    chapters: 25,
    icon: 'V',
    gradient: 'linear-gradient(135deg, #064e3b, #059669)',
    tags: ['Vue3', '响应式', '编译器'],
  },
  {
    title: '微前端源码剖析',
    desc: '深入乾坤、single-spa、import-html-entry 源码，理解微前端框架的核心设计与实现。',
    link: '/books/microfe/',
    chapters: 18,
    icon: 'M',
    gradient: 'linear-gradient(135deg, #78350f, #d97706)',
    tags: ['微前端', '乾坤', 'JS沙箱'],
  },
  {
    title: 'OpenClaw 设计与实现',
    desc: '第一本深入 AI Agent 运行时内核的架构专著，逐层拆解 Gateway 引擎、Provider 热切换等核心子系统。',
    link: '/books/openclaw/',
    chapters: 18,
    icon: 'O',
    gradient: 'linear-gradient(135deg, #312e81, #7c3aed)',
    tags: ['AI Agent', '架构', 'Gateway'],
  },
]

const featuresMain = [
  { title: '源码级深度', desc: '每一章都从源码切入，逐行分析核心实现，不止于 API 用法。带你看到框架作者的设计意图与工程权衡。', icon: 'depth' },
  { title: '架构思维', desc: '从整体设计到模块拆分，帮你建立系统化的架构认知。读完后能独立分析任何框架的内部结构。', icon: 'arch' },
]

const featuresSub = [
  { title: '手写实践', desc: '配套手写实现，从零构建简化版框架。', icon: 'code' },
  { title: '完全免费', desc: '所有内容开源免费，无任何付费门槛。', icon: 'free' },
  { title: '极致体验', desc: '暗色模式、全文搜索，任何设备舒适阅读。', icon: 'mobile' },
  { title: '持续更新', desc: '紧跟技术前沿，内容定期迭代更新。', icon: 'update' },
]
</script>

<template>
  <div class="landing" :class="{ 'is-dark': isDark }">
    <!-- ========== NAV ========== -->
    <nav class="nav" :class="{ scrolled }">
      <div class="nav-inner">
        <a href="/" class="nav-brand">
          <svg class="nav-logo" viewBox="0 0 200 200" aria-label="logo">
            <path d="M54 60 L64 24" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
            <path d="M146 60 L136 24" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
            <rect x="30" y="52" width="140" height="128" rx="52" fill="none" stroke="currentColor" stroke-width="8"/>
            <circle cx="74" cy="108" r="28" fill="#3b82f6"/>
            <circle cx="126" cy="108" r="28" fill="#3b82f6"/>
            <circle cx="82" cy="100" r="9" fill="#fff"/>
            <circle cx="134" cy="100" r="9" fill="#fff"/>
            <path d="M100 130 L108 146 L92 146Z" fill="#F4845F"/>
          </svg>
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
          <span class="hero-title-main">专注于原理源码</span>
          <span class="hero-title-accent">深入技术本质</span>
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
      <!-- Curved divider -->
      <div class="hero-divider">
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none">
          <path d="M0,80 C360,0 1080,0 1440,80 L1440,80 L0,80 Z" fill="var(--home-bg)"/>
        </svg>
      </div>
    </section>

    <!-- ========== BOOKS ========== -->
    <section id="books" class="section books">
      <div class="container">
        <div class="section-head reveal">
          <span class="section-tag">BOOKS</span>
          <h2 class="section-title">四本深度技术专著</h2>
          <p class="section-subtitle">每一本都从源码出发，带你构建对技术底层的完整认知</p>
        </div>
        <div class="book-grid">
          <a v-for="(b, i) in books" :key="b.title" :href="b.link" class="book-card reveal" :style="{ transitionDelay: i * 80 + 'ms' }">
            <div class="book-visual" :style="{ background: b.gradient }">
              <!-- Decorative pattern -->
              <svg class="book-pattern" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice">
                <circle cx="160" cy="20" r="40" fill="rgba(255,255,255,0.04)"/>
                <circle cx="180" cy="90" r="60" fill="rgba(255,255,255,0.03)"/>
                <circle cx="30" cy="100" r="30" fill="rgba(255,255,255,0.03)"/>
                <line x1="20" y1="10" x2="80" y2="40" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>
                <line x1="120" y1="15" x2="170" y2="60" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>
                <line x1="60" y1="80" x2="140" y2="50" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
              </svg>
              <div class="book-visual-content">
                <span class="book-icon">{{ b.icon }}</span>
                <div class="book-visual-meta">
                  <span class="book-visual-title">{{ b.title }}</span>
                  <span class="book-badge">{{ b.chapters }} 章</span>
                </div>
              </div>
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
        <div class="section-head reveal">
          <span class="section-tag">WHY US</span>
          <h2 class="section-title">为什么选择这里</h2>
          <p class="section-subtitle">我们追求技术内容的深度与品质</p>
        </div>

        <!-- Main features — large cards -->
        <div class="feature-main-grid">
          <div v-for="(f, i) in featuresMain" :key="f.title" class="feature-card feature-card--lg reveal" :style="{ transitionDelay: i * 100 + 'ms' }">
            <div class="feature-icon" :class="'fi-' + f.icon">
              <svg v-if="f.icon === 'depth'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>
              <svg v-if="f.icon === 'arch'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            </div>
            <h3 class="feature-title">{{ f.title }}</h3>
            <p class="feature-desc">{{ f.desc }}</p>
          </div>
        </div>

        <!-- Sub features — smaller cards -->
        <div class="feature-sub-grid">
          <div v-for="(f, i) in featuresSub" :key="f.title" class="feature-card feature-card--sm reveal" :style="{ transitionDelay: (i * 80 + 200) + 'ms' }">
            <div class="feature-icon" :class="'fi-' + f.icon">
              <svg v-if="f.icon === 'code'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              <svg v-if="f.icon === 'free'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
              <svg v-if="f.icon === 'mobile'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
              <svg v-if="f.icon === 'update'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
            </div>
            <div>
              <h3 class="feature-title">{{ f.title }}</h3>
              <p class="feature-desc">{{ f.desc }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== AUTHOR ========== -->
    <section id="author" class="section author-section">
      <div class="container">
        <div class="author-card reveal">
          <img
            src="https://github.com/yangyitao100.png"
            alt="杨艺韬"
            class="author-avatar"
            loading="lazy"
          />
          <div class="author-info">
            <h2 class="author-name">杨艺韬</h2>
            <p class="author-role">软件源码研究者 · 开源作者</p>
            <p class="author-bio">
              我相信理解源码是通往技术自由的必经之路——这些作品是我将复杂的底层原理用清晰的语言和代码传递给每一位开发者的尝试。
            </p>
            <div class="author-links">
              <a href="https://github.com/yangyitao100" target="_blank" class="author-link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                GitHub
              </a>
              <a href="https://space.bilibili.com/613231762" target="_blank" class="author-link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z"/></svg>
                B站
              </a>
            </div>
          </div>
          <div class="author-wechat">
            <img src="/wechat-qr.jpg" alt="微信公众号" class="author-qr" loading="lazy" />
            <span class="author-qr-label">微信公众号</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ========== FOOTER ========== -->
    <footer class="footer">
      <div class="footer-inner">
        <div class="footer-left">
          <div class="footer-brand">
            <svg class="footer-logo" viewBox="0 0 200 200" aria-label="logo">
              <path d="M54 60 L64 24" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
              <path d="M146 60 L136 24" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
              <rect x="30" y="52" width="140" height="128" rx="52" fill="none" stroke="currentColor" stroke-width="8"/>
              <circle cx="74" cy="108" r="28" fill="#3b82f6"/>
              <circle cx="126" cy="108" r="28" fill="#3b82f6"/>
              <circle cx="82" cy="100" r="9" fill="#fff"/>
              <circle cx="134" cy="100" r="9" fill="#fff"/>
              <path d="M100 130 L108 146 L92 146Z" fill="#F4845F"/>
            </svg>
            <span>杨艺韬讲堂</span>
          </div>
          <div class="footer-copy">
            Copyright &copy; 2024–present 杨艺韬
          </div>
          <div class="footer-filing">
            <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener" class="filing-link">蜀ICP备2023033985号-3</a>
            <a href="https://beian.mps.gov.cn/#/query/webSearch?code=51019002007300" target="_blank" rel="noopener" class="filing-link">川公网安备51019002007300</a>
          </div>
        </div>
        <div class="footer-books">
          <span class="footer-heading">书籍</span>
          <a v-for="b in books" :key="b.title" :href="b.link" class="footer-book-link">{{ b.title }}</a>
        </div>
        <div class="footer-links-col">
          <span class="footer-heading">链接</span>
          <a href="https://github.com/yangyitao100" target="_blank" class="footer-book-link">GitHub</a>
          <a href="https://space.bilibili.com/613231762" target="_blank" class="footer-book-link">B站</a>
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

/* ===== Scroll reveal ===== */
.reveal {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1), transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.reveal.visible {
  opacity: 1;
  transform: translateY(0);
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
  width: 36px;
  height: 36px;
}

.nav-name {
  letter-spacing: -0.02em;
}

.nav.scrolled .nav-brand {
  color: var(--home-text-1);
}

.nav:not(.scrolled) .nav-brand {
  color: var(--hero-nav-brand);
}

.nav:not(.scrolled) .nav-link {
  color: var(--hero-nav-link);
}

.nav:not(.scrolled) .nav-link:hover {
  color: var(--hero-nav-link-hover);
}

.nav:not(.scrolled) .theme-toggle {
  color: var(--hero-nav-icon);
}

.nav:not(.scrolled) .mobile-menu-btn {
  color: var(--hero-nav-icon);
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
  background: var(--hero-bg);
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--hero-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--hero-grid-line) 1px, transparent 1px);
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
  background: var(--hero-orb-1);
  top: -250px;
  right: -150px;
  animation: float 8s ease-in-out infinite;
}

.hero-orb-2 {
  width: 500px;
  height: 500px;
  background: var(--hero-orb-2);
  bottom: -200px;
  left: -100px;
  animation: float 10s ease-in-out infinite reverse;
}

.hero-orb-3 {
  width: 300px;
  height: 300px;
  background: var(--hero-orb-3);
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

/* Curved divider */
.hero-divider {
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  z-index: 2;
  line-height: 0;
}

.hero-divider svg {
  width: 100%;
  height: 60px;
  display: block;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 7px 18px;
  border-radius: 100px;
  font-size: 13px;
  font-weight: 500;
  color: var(--hero-badge-color);
  border: 1px solid var(--hero-badge-border);
  background: var(--hero-badge-bg);
  margin-bottom: 40px;
}

.badge-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--hero-pulse);
  box-shadow: 0 0 10px var(--hero-pulse-shadow);
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
  background: linear-gradient(135deg, var(--hero-title-main-from) 0%, var(--hero-title-main-to) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-title-accent {
  background: linear-gradient(135deg, var(--hero-title-accent-from) 0%, var(--hero-title-accent-mid) 60%, var(--hero-title-accent-to) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-desc {
  font-size: clamp(15px, 2vw, 18px);
  color: var(--hero-desc);
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
  color: var(--hero-stat-num);
  font-variant-numeric: tabular-nums;
}

.hero-stat-label {
  font-size: 13px;
  color: var(--hero-stat-label);
}

.hero-stat-sep {
  width: 1px;
  height: 40px;
  background: var(--hero-stat-sep);
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
  color: var(--hero-ghost-color);
  border: 1px solid var(--hero-ghost-border);
  background: var(--hero-ghost-bg);
  transition: all 0.25s ease;
}

.cta-ghost:hover {
  border-color: var(--hero-ghost-hover-border);
  background: var(--hero-ghost-hover-bg);
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
  padding: 40px 28px;
  overflow: hidden;
}

.book-pattern {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.book-visual-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.book-icon {
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 900;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.book-visual-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.book-visual-title {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.02em;
}

.book-badge {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  padding: 3px 12px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.08);
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

.feature-main-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  margin-bottom: 20px;
}

.feature-sub-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.feature-card {
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 14px;
  transition: all 0.25s ease;
}

.feature-card:hover {
  box-shadow: var(--home-card-shadow-hover);
  transform: translateY(-2px);
}

.feature-card--lg {
  padding: 36px 32px;
}

.feature-card--lg .feature-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  margin-bottom: 20px;
}

.feature-card--lg .feature-title {
  font-size: 18px;
  margin-bottom: 10px;
}

.feature-card--lg .feature-desc {
  font-size: 15px;
  line-height: 1.75;
}

.feature-card--sm {
  padding: 24px 20px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.feature-card--sm .feature-icon {
  flex-shrink: 0;
  margin-bottom: 0;
}

.feature-card--sm .feature-title {
  margin-bottom: 4px;
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

/* ===== AUTHOR ===== */
.author-section {
  background: var(--home-bg);
}

.author-card {
  display: flex;
  align-items: center;
  gap: 40px;
  max-width: 900px;
  margin: 0 auto;
}

.author-avatar {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 3px solid var(--home-card-border);
  box-shadow: var(--home-card-shadow-hover);
}

.author-info {
  flex: 1;
}

.author-name {
  font-size: 28px;
  font-weight: 800;
  color: var(--home-text-1);
  margin: 0 0 6px;
  letter-spacing: -0.02em;
}

.author-role {
  font-size: 14px;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  margin: 0 0 16px;
}

.author-bio {
  font-size: 15px;
  line-height: 1.8;
  color: var(--home-text-2);
  margin: 0 0 24px;
}

.author-links {
  display: flex;
  gap: 12px;
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

.author-wechat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.author-qr {
  width: 110px;
  height: 110px;
  border-radius: 12px;
  border: 1px solid var(--home-card-border);
  box-shadow: var(--home-card-shadow);
}

.author-qr-label {
  font-size: 12px;
  color: var(--home-text-3);
}

/* ===== FOOTER ===== */
.footer {
  padding: 48px 24px 36px;
  border-top: 1px solid var(--home-card-border);
  background: var(--home-bg-alt);
}

.footer-inner {
  max-width: 1080px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 48px;
  align-items: start;
}

.footer-left {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  width: 24px;
  height: 24px;
}

.footer-copy {
  font-size: 13px;
  color: var(--home-text-3);
}

.footer-heading {
  display: block;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--home-text-3);
  margin-bottom: 14px;
  text-transform: uppercase;
}

.footer-books,
.footer-links-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.footer-book-link {
  font-size: 14px;
  color: var(--home-text-2);
  text-decoration: none;
  transition: color 0.2s ease;
}

.footer-book-link:hover {
  color: var(--vp-c-brand-1);
}

.footer-filing {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.filing-link {
  font-size: 12px;
  color: var(--home-text-3);
  text-decoration: none;
  transition: color 0.2s ease;
}

.filing-link:hover {
  color: var(--home-text-2);
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

  .is-dark .nav:not(.scrolled) .nav-links {
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
  .feature-main-grid { grid-template-columns: 1fr; }
  .feature-sub-grid { grid-template-columns: 1fr; }
  .feature-card--sm { flex-direction: row; }

  .author-card {
    flex-direction: column;
    text-align: center;
    gap: 24px;
  }

  .author-avatar {
    width: 100px;
    height: 100px;
    border-radius: 50%;
  }

  .author-links {
    justify-content: center;
  }

  .hide-mobile { display: none; }

  .footer-inner {
    grid-template-columns: 1fr;
    gap: 32px;
    text-align: center;
  }

  .footer-left { align-items: center; }

  .footer-books,
  .footer-links-col {
    align-items: center;
  }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .feature-main-grid { grid-template-columns: repeat(2, 1fr); }
  .feature-sub-grid { grid-template-columns: repeat(2, 1fr); }
}

/* ===== Smooth scroll ===== */
:global(html) {
  scroll-behavior: smooth;
}
</style>
