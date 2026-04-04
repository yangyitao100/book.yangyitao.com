<script setup lang="ts">
const features = [
  {
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>`,
    title: '源码级深度',
    desc: '不止于 API 用法，每一章都从源码切入，逐行分析核心实现。',
    color: '#3b82f6',
  },
  {
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
    title: '架构思维',
    desc: '从整体设计到模块拆分，帮你建立系统化的架构认知。',
    color: '#8b5cf6',
  },
  {
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    title: '手写实践',
    desc: '配套手写实现，从零构建简化版框架，真正掌握核心原理。',
    color: '#10b981',
  },
  {
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>`,
    title: '完全免费',
    desc: '所有书籍内容开源免费，持续更新迭代，无任何付费门槛。',
    color: '#f59e0b',
  },
  {
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>`,
    title: '极致阅读体验',
    desc: '支持暗色模式、全文搜索、移动端完美适配。',
    color: '#ec4899',
  },
  {
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,
    title: '持续更新',
    desc: '紧跟技术前沿，内容定期更新，确保知识不过时。',
    color: '#06b6d4',
  },
]
</script>

<template>
  <section class="features-section">
    <div class="features-container">
      <div class="section-header">
        <h2 class="section-title">为什么选择这里</h2>
        <p class="section-desc">我们追求技术内容的深度与品质</p>
      </div>
      <div class="features-grid">
        <div v-for="f in features" :key="f.title" class="feature-card">
          <div class="feature-icon" :style="{ color: f.color, background: f.color + '12' }">
            <span v-html="f.icon" />
          </div>
          <h3 class="feature-title">{{ f.title }}</h3>
          <p class="feature-desc">{{ f.desc }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.features-section {
  padding: 100px 24px;
  background: var(--home-bg-alt);
}

.features-container {
  max-width: 960px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 56px;
}

.section-title {
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 800;
  color: var(--home-text-1);
  margin: 0 0 12px;
  letter-spacing: -0.02em;
}

.section-desc {
  font-size: 16px;
  color: var(--home-text-3);
  margin: 0;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.feature-card {
  padding: 28px 24px;
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 14px;
  transition: all 0.25s var(--ease-out);
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

@media (max-width: 768px) {
  .features-grid { grid-template-columns: 1fr; }
  .features-section { padding: 64px 16px; }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .features-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
