<script setup lang="ts">
const books = [
  {
    title: 'React18 内核探秘',
    description: '手写 React 高质量源码迈向高阶开发，从原始版到 Fiber 架构，深入理解 React18 源码的每一个细节。',
    link: '/books/react18/',
    icon: 'R',
    tags: ['React', 'Fiber', '源码'],
    chapters: 19,
    color: '#3b82f6',
    bg: 'linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)',
  },
  {
    title: 'Vue3 源码剖析',
    description: '从 monorepo 到响应式系统，从虚拟DOM 到编译优化，全面深入 Vue3 各子系统的源码实现。',
    link: '/books/vue3/',
    icon: 'V',
    tags: ['Vue3', '响应式', '源码'],
    chapters: 25,
    color: '#10b981',
    bg: 'linear-gradient(135deg, #064e3b 0%, #059669 100%)',
  },
  {
    title: '微前端源码剖析',
    description: '深入乾坤、single-spa、import-html-entry 源码，理解微前端框架的核心设计与实现。',
    link: '/books/microfe/',
    icon: 'M',
    tags: ['微前端', '乾坤', 'single-spa'],
    chapters: 18,
    color: '#f59e0b',
    bg: 'linear-gradient(135deg, #78350f 0%, #d97706 100%)',
  },
  {
    title: 'OpenClaw 设计与实现',
    description: '第一本深入 AI Agent 运行时内核的架构专著，逐层拆解 Gateway 引擎、Provider 热切换、Agent 编排等核心子系统。',
    link: '/books/openclaw/',
    icon: 'O',
    tags: ['AI Agent', '架构', '源码'],
    chapters: 18,
    color: '#8b5cf6',
    bg: 'linear-gradient(135deg, #312e81 0%, #6d28d9 100%)',
  },
]
</script>

<template>
  <section id="books" class="books-section">
    <div class="books-container">
      <div class="section-header">
        <h2 class="section-title">技术专著</h2>
        <p class="section-desc">每一本都从源码出发，带你构建对技术底层的完整认知</p>
      </div>

      <div class="books-grid">
        <a
          v-for="book in books"
          :key="book.title"
          :href="book.link"
          class="book-card"
        >
          <div class="card-top" :style="{ background: book.bg }">
            <span class="card-icon" :style="{ color: book.color }">{{ book.icon }}</span>
            <div class="card-top-info">
              <span class="card-chapters">{{ book.chapters }} 章</span>
            </div>
          </div>
          <div class="card-body">
            <h3 class="card-title">{{ book.title }}</h3>
            <p class="card-desc">{{ book.description }}</p>
            <div class="card-footer">
              <div class="card-tags">
                <span v-for="tag in book.tags" :key="tag" class="tag">{{ tag }}</span>
              </div>
              <span class="card-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
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
  max-width: 1000px;
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

.books-grid {
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
  transition: all 0.3s var(--ease-out);
  box-shadow: var(--home-card-shadow);
}

.book-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--home-card-shadow-hover);
}

.card-top {
  position: relative;
  padding: 32px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 900;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  backdrop-filter: blur(8px);
  color: #fff !important;
}

.card-top-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-chapters {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  padding: 4px 14px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(4px);
}

.card-body {
  padding: 24px;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.card-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--home-text-1);
  margin: 0 0 8px;
  letter-spacing: -0.01em;
}

.card-desc {
  font-size: 14px;
  line-height: 1.7;
  color: var(--home-text-2);
  margin: 0 0 20px;
  flex: 1;
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

.tag {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 6px;
  color: var(--home-tag-color);
  background: var(--home-tag-bg);
  border: 1px solid var(--home-tag-border);
}

.card-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--vp-c-brand-1);
  background: var(--home-tag-bg);
  transition: all 0.2s var(--ease-out);
  flex-shrink: 0;
}

.book-card:hover .card-arrow {
  background: var(--vp-c-brand-1);
  color: #fff;
}

@media (max-width: 640px) {
  .books-grid {
    grid-template-columns: 1fr;
  }
  .books-section {
    padding: 64px 16px;
  }
}
</style>
