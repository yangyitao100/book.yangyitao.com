<script setup lang="ts">
const testimonials = [
  {
    content: '读完 React18 源码解析后，面试中的源码题再也不怕了。手写 Fiber 那部分让我对调度算法有了全新的理解。',
    author: '前端工程师',
    role: '大厂 P7',
  },
  {
    content: 'Vue3 源码剖析写得非常清晰，从 reactivity 到 compiler 每个模块都讲透了。是我读过最好的 Vue 源码教程。',
    author: '全栈开发者',
    role: '创业公司 CTO',
  },
  {
    content: '微前端那本帮我在公司成功落地了乾坤方案。能看到源码级的实现细节，比官方文档深入太多了。',
    author: '架构师',
    role: '互联网公司',
  },
]
</script>

<template>
  <section class="author-section">
    <div class="author-container">
      <!-- Author intro -->
      <div class="author-card">
        <div class="author-info">
          <div class="author-avatar">杨</div>
          <div>
            <h3 class="author-name">杨艺韬</h3>
            <p class="author-role">资深前端工程师 · 技术作者</p>
          </div>
        </div>
        <p class="author-bio">
          多年大厂前端开发经验，深耕 React、Vue、微前端等技术栈的源码研究。
          坚信「理解源码是通往技术自由的必经之路」，致力于将复杂的底层原理用清晰的语言和代码传递给每一位开发者。
        </p>
        <div class="author-links">
          <a href="https://www.yangyitao.com" target="_blank" class="author-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            个人网站
          </a>
          <a href="https://github.com/yangyitao100" target="_blank" class="author-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </div>

      <!-- Testimonials -->
      <div class="section-header">
        <span class="section-label">读者评价</span>
        <h2 class="section-title">来自读者的声音</h2>
      </div>
      <div class="testimonials-grid">
        <div v-for="t in testimonials" :key="t.author" class="testimonial-card">
          <div class="quote-mark">"</div>
          <p class="testimonial-content">{{ t.content }}</p>
          <div class="testimonial-author">
            <span class="testimonial-name">{{ t.author }}</span>
            <span class="testimonial-role">{{ t.role }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.author-section {
  padding: 100px 24px;
  background: var(--home-bg);
}

.author-container {
  max-width: 1100px;
  margin: 0 auto;
}

.author-card {
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 20px;
  padding: 40px;
  margin-bottom: 80px;
  box-shadow: var(--home-card-shadow);
}

.author-info {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.author-avatar {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--vp-c-brand-1), var(--vp-c-brand-3));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 700;
  color: #fff;
}

.author-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--home-text-1);
  margin: 0;
}

.author-role {
  font-size: 14px;
  color: var(--home-text-3);
  margin: 4px 0 0;
}

.author-bio {
  font-size: 15px;
  line-height: 1.7;
  color: var(--home-text-2);
  margin: 0 0 24px;
  max-width: 640px;
}

.author-links {
  display: flex;
  gap: 12px;
}

.author-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  padding: 6px 14px;
  border-radius: 8px;
  background: var(--home-feature-icon-bg);
  transition: all 0.2s ease;
}

.author-link:hover {
  background: var(--vp-c-brand-1);
  color: #fff;
}

.section-header {
  text-align: center;
  margin-bottom: 48px;
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
  font-size: clamp(28px, 4vw, 36px);
  font-weight: 800;
  color: var(--home-text-1);
  margin: 0;
  letter-spacing: -0.02em;
}

.testimonials-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.testimonial-card {
  background: var(--home-testimonial-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 16px;
  padding: 28px;
  position: relative;
  transition: all 0.3s ease;
}

.testimonial-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--home-card-shadow);
}

.quote-mark {
  font-size: 48px;
  font-weight: 800;
  line-height: 1;
  color: var(--vp-c-brand-soft);
  margin-bottom: 8px;
  font-family: Georgia, serif;
}

.testimonial-content {
  font-size: 14px;
  line-height: 1.7;
  color: var(--home-text-2);
  margin: 0 0 20px;
}

.testimonial-author {
  display: flex;
  align-items: center;
  gap: 8px;
}

.testimonial-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--home-text-1);
}

.testimonial-role {
  font-size: 13px;
  color: var(--home-text-3);
}

.testimonial-role::before {
  content: '·';
  margin-right: 8px;
}

@media (max-width: 768px) {
  .testimonials-grid {
    grid-template-columns: 1fr;
  }
  .author-section {
    padding: 64px 16px;
  }
  .author-card {
    padding: 24px;
  }
}
</style>
