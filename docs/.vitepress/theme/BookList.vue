<script setup lang="ts">
const books = [
  {
    title: 'OpenClaw设计与实现',
    description: '第一本深入AI Agent运行时内核的架构专著，逐层拆解Gateway引擎、Provider热切换、Agent编排等核心子系统。',
    link: '/books/openclaw/',
    cover: '🤖',
    tags: ['AI Agent', '架构', '源码'],
    accent: '#6366f1',
    chapters: 18,
  },
  {
    title: 'React18内核探秘',
    description: '手写React高质量源码迈向高阶开发，从原始版到Fiber架构，深入理解React18源码的每一个细节。',
    link: '/books/react18/',
    cover: '⚛️',
    tags: ['React', '源码', 'Fiber'],
    accent: '#0ea5e9',
    chapters: 30,
  },
  {
    title: 'Vue3源码剖析',
    description: '从monorepo到响应式系统，从虚拟DOM到编译优化，全面深入Vue3各子系统的源码实现。',
    link: '/books/vue3/',
    cover: '💚',
    tags: ['Vue3', '源码', '响应式'],
    accent: '#22c55e',
    chapters: 25,
  },
  {
    title: '微前端源码剖析',
    description: '深入乾坤、single-spa、import-html-entry源码，理解微前端框架的核心设计与实现。',
    link: '/books/microfe/',
    cover: '🧩',
    tags: ['微前端', '乾坤', 'single-spa'],
    accent: '#f59e0b',
    chapters: 20,
  },
]
</script>

<template>
  <section id="books" class="books-section">
    <div class="books-container">
      <div class="section-header">
        <span class="section-label">书籍</span>
        <h2 class="section-title">四本深度技术专著</h2>
        <p class="section-desc">每一本都从源码出发，带你构建对技术底层的完整认知</p>
      </div>
      <div class="books-grid">
        <a
          v-for="book in books"
          :key="book.title"
          :href="book.link"
          class="book-card"
        >
          <div class="card-accent" :style="{ background: book.accent }" />
          <div class="card-body">
            <div class="card-top">
              <div class="card-cover" :style="{ '--accent': book.accent }">
                {{ book.cover }}
              </div>
              <div class="card-meta">
                <span class="chapter-count">{{ book.chapters }} 章</span>
              </div>
            </div>
            <h3 class="card-title">{{ book.title }}</h3>
            <p class="card-desc">{{ book.description }}</p>
            <div class="card-footer">
              <div class="card-tags">
                <span v-for="tag in book.tags" :key="tag" class="card-tag">{{ tag }}</span>
              </div>
              <span class="card-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </span>
            </div>
          </div>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.books-section {
  padding: 100px 24px;
  background: var(--home-bg);
}

.books-container {
  max-width: 1100px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 64px;
  animation: fadeInUp 0.6s ease-out;
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
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}

.books-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.book-card {
  position: relative;
  display: block;
  text-decoration: none;
  color: inherit;
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--home-card-shadow);
}

.book-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--home-card-shadow-hover);
  border-color: transparent;
}

.card-accent {
  height: 3px;
  width: 100%;
  opacity: 0.7;
  transition: opacity 0.3s;
}

.book-card:hover .card-accent {
  opacity: 1;
}

.card-body {
  padding: 28px;
}

.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}

.card-cover {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  background: var(--home-feature-icon-bg);
  transition: transform 0.3s ease;
}

.book-card:hover .card-cover {
  transform: scale(1.08);
  animation: float 3s ease-in-out infinite;
}

.card-meta {
  display: flex;
  align-items: center;
}

.chapter-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--home-text-3);
  padding: 4px 10px;
  border-radius: 100px;
  background: var(--home-section-bg);
}

.card-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--home-text-1);
  margin: 0 0 10px;
  letter-spacing: -0.01em;
}

.card-desc {
  font-size: 14px;
  line-height: 1.65;
  color: var(--home-text-2);
  margin: 0 0 20px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.card-tag {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 6px;
  background: var(--home-tag-bg);
  color: var(--home-tag-color);
}

.card-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--home-section-bg);
  color: var(--home-text-3);
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.book-card:hover .card-arrow {
  background: var(--vp-c-brand-1);
  color: #fff;
  transform: translateX(2px);
}

@media (max-width: 768px) {
  .books-grid {
    grid-template-columns: 1fr;
  }
  .books-section {
    padding: 64px 16px;
  }
}
</style>
