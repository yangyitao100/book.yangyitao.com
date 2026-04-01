<script setup lang="ts">
const features = [
  {
    icon: '🔬',
    title: '源码级深度',
    desc: '不止于 API 用法，每一章都从源码切入，逐行分析核心实现逻辑。',
  },
  {
    icon: '🏗️',
    title: '架构思维',
    desc: '从整体设计到模块拆分，帮你建立系统化的架构认知框架。',
  },
  {
    icon: '✍️',
    title: '手写实践',
    desc: '配套手写实现，从零构建简化版框架，真正掌握核心原理。',
  },
  {
    icon: '🆓',
    title: '完全免费',
    desc: '所有书籍内容开源免费，持续更新迭代，无任何付费门槛。',
  },
  {
    icon: '📱',
    title: '极致阅读体验',
    desc: '基于 VitePress 构建，支持暗色模式、全文搜索、移动端适配。',
  },
  {
    icon: '🔄',
    title: '持续更新',
    desc: '紧跟技术前沿，内容定期更新，确保知识不过时。',
  },
]
</script>

<template>
  <section class="features-section">
    <div class="features-container">
      <div class="section-header">
        <span class="section-label">特色</span>
        <h2 class="section-title">为什么选择这里</h2>
        <p class="section-desc">我们追求技术内容的深度与品质</p>
      </div>
      <div class="features-grid">
        <div v-for="f in features" :key="f.title" class="feature-card">
          <div class="feature-icon">{{ f.icon }}</div>
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
  background: var(--home-section-bg);
}

.features-container {
  max-width: 1100px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 64px;
}

.section-label {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-brand-1);
  margin-bottom: 12px;
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
  gap: 24px;
}

.feature-card {
  padding: 32px;
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 16px;
  transition: all 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--home-card-shadow);
}

.feature-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--home-feature-icon-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  margin-bottom: 20px;
}

.feature-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--home-text-1);
  margin: 0 0 8px;
}

.feature-desc {
  font-size: 14px;
  line-height: 1.65;
  color: var(--home-text-2);
  margin: 0;
}

@media (max-width: 768px) {
  .features-grid {
    grid-template-columns: 1fr;
  }
  .features-section {
    padding: 64px 16px;
  }
}
</style>
