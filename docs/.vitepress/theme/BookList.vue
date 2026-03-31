<script setup lang="ts">
const books = [
  {
    title: 'OpenClaw设计与实现',
    description: '第一本深入AI Agent运行时内核的架构专著，逐层拆解Gateway引擎、Provider热切换、Agent编排等核心子系统。',
    link: '/books/openclaw/',
    cover: '🤖',
    tags: ['AI Agent', '架构', '源码'],
  },
  {
    title: 'React18内核探秘',
    description: '手写React高质量源码迈向高阶开发，从原始版到Fiber架构，深入理解React18源码的每一个细节。',
    link: '/books/react18/',
    cover: '⚛️',
    tags: ['React', '源码', 'Fiber'],
  },
  {
    title: 'Vue3源码剖析',
    description: '从monorepo到响应式系统，从虚拟DOM到编译优化，全面深入Vue3各子系统的源码实现。',
    link: '/books/vue3/',
    cover: '💚',
    tags: ['Vue3', '源码', '响应式'],
  },
  {
    title: '微前端源码剖析',
    description: '深入乾坤、single-spa、import-html-entry源码，理解微前端框架的核心设计与实现。',
    link: '/books/microfe/',
    cover: '🧩',
    tags: ['微前端', '乾坤', 'single-spa'],
  },
]
</script>

<template>
  <div class="book-list">
    <a v-for="book in books" :key="book.title" :href="book.link" class="book-card">
      <div class="book-cover">{{ book.cover }}</div>
      <div class="book-info">
        <h3>{{ book.title }}</h3>
        <p>{{ book.description }}</p>
        <div class="book-tags">
          <span v-for="tag in book.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>
    </a>
  </div>
</template>

<style scoped>
.book-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  padding: 24px 0;
}

.book-card {
  display: flex;
  gap: 20px;
  padding: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: all 0.3s ease;
  background: var(--vp-c-bg-soft);
}

.book-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.book-cover {
  font-size: 48px;
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vp-c-bg);
  border-radius: 8px;
}

.book-info h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.book-info p {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.book-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
</style>
