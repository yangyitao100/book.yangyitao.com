<script setup lang="ts">
const books = [
  {
    title: 'React18 内核探秘',
    description: '手写 React 高质量源码迈向高阶开发，从原始版到 Fiber 架构，深入理解 React18 源码的每一个细节。',
    link: '/books/react18/',
    emoji: '\u269B\uFE0F',
    tags: ['React', 'Fiber', '\u6E90\u7801'],
    chapters: 30,
    gradient: 'linear-gradient(135deg, #1e3a5f 0%, #3b82f6 50%, #7c3aed 100%)',
  },
  {
    title: 'Vue3 \u6E90\u7801\u5256\u6790',
    description: '\u4ECE monorepo \u5230\u54CD\u5E94\u5F0F\u7CFB\u7EDF\uFF0C\u4ECE\u865A\u62DFDOM \u5230\u7F16\u8BD1\u4F18\u5316\uFF0C\u5168\u9762\u6DF1\u5165 Vue3 \u5404\u5B50\u7CFB\u7EDF\u7684\u6E90\u7801\u5B9E\u73B0\u3002',
    link: '/books/vue3/',
    emoji: '\uD83D\uDC9A',
    tags: ['Vue3', '\u54CD\u5E94\u5F0F', '\u6E90\u7801'],
    chapters: 25,
    gradient: 'linear-gradient(135deg, #064e3b 0%, #10b981 50%, #34d399 100%)',
  },
  {
    title: '\u5FAE\u524D\u7AEF\u6E90\u7801\u5256\u6790',
    description: '\u6DF1\u5165\u4E7E\u5764\u3001single-spa\u3001import-html-entry \u6E90\u7801\uFF0C\u7406\u89E3\u5FAE\u524D\u7AEF\u6846\u67B6\u7684\u6838\u5FC3\u8BBE\u8BA1\u4E0E\u5B9E\u73B0\u3002',
    link: '/books/microfe/',
    emoji: '\uD83E\uDDE9',
    tags: ['\u5FAE\u524D\u7AEF', '\u4E7E\u5764', 'single-spa'],
    chapters: 20,
    gradient: 'linear-gradient(135deg, #78350f 0%, #f59e0b 50%, #fbbf24 100%)',
  },
  {
    title: 'OpenClaw \u8BBE\u8BA1\u4E0E\u5B9E\u73B0',
    description: '\u7B2C\u4E00\u672C\u6DF1\u5165 AI Agent \u8FD0\u884C\u65F6\u5185\u6838\u7684\u67B6\u6784\u4E13\u8457\uFF0C\u9010\u5C42\u62C6\u89E3 Gateway \u5F15\u64CE\u3001Provider \u70ED\u5207\u6362\u3001Agent \u7F16\u6392\u7B49\u6838\u5FC3\u5B50\u7CFB\u7EDF\u3002',
    link: '/books/openclaw/',
    emoji: '\uD83E\uDD16',
    tags: ['AI Agent', '\u67B6\u6784', '\u6E90\u7801'],
    chapters: 18,
    gradient: 'linear-gradient(135deg, #312e81 0%, #6366f1 50%, #818cf8 100%)',
  },
]
</script>

<template>
  <section id="books" class="books-section">
    <div class="books-container">
      <div class="section-header">
        <span class="section-label">BOOKS</span>
        <h2 class="section-title">四本深度技术专著</h2>
        <p class="section-desc">每一本都从源码出发，带你构建对技术底层的完整认知</p>
      </div>

      <div class="books-list">
        <a
          v-for="book in books"
          :key="book.title"
          :href="book.link"
          class="book-card"
        >
          <div class="card-visual" :style="{ background: book.gradient }">
            <span class="card-emoji">{{ book.emoji }}</span>
            <span class="card-chapters">{{ book.chapters }} 章</span>
          </div>
          <div class="card-info">
            <h3 class="card-title">{{ book.title }}</h3>
            <p class="card-desc">{{ book.description }}</p>
            <div class="card-tags">
              <span v-for="tag in book.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
            <span class="card-link">
              立即阅读
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </span>
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
  max-width: 900px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 64px;
}

.section-label {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--vp-c-brand-1);
  margin-bottom: 12px;
}

.section-title {
  font-size: clamp(26px, 4vw, 38px);
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

.books-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.book-card {
  display: flex;
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
  transform: scale(1.01);
  box-shadow: var(--home-card-shadow-hover);
}

/* Left visual area */
.card-visual {
  flex-shrink: 0;
  width: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  position: relative;
}

.card-emoji {
  font-size: 48px;
  line-height: 1;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.2));
}

.card-chapters {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  padding: 3px 12px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(4px);
}

/* Right info area */
.card-info {
  flex: 1;
  padding: 28px 28px 28px 24px;
  display: flex;
  flex-direction: column;
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
  margin: 0 0 16px;
  flex: 1;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 16px;
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

.card-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  transition: gap 0.2s var(--ease-out);
}

.book-card:hover .card-link {
  gap: 8px;
}

@media (max-width: 640px) {
  .book-card {
    flex-direction: column;
  }
  .card-visual {
    width: 100%;
    height: 140px;
  }
  .card-info {
    padding: 20px;
  }
  .books-section {
    padding: 64px 16px;
  }
}
</style>
