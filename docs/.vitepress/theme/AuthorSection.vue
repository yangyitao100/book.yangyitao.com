<template>
  <section class="author-section">
    <div class="author-container">
      <div class="author-block">
        <h2 class="section-title">关于作者</h2>
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

      <div class="testimonials">
        <div class="testimonial">
          <p class="testimonial-text">读完 React18 源码解析后，面试中的源码题再也不怕了。手写 Fiber 那部分让我对调度算法有了全新的理解。</p>
          <div class="testimonial-meta">
            <span class="meta-author">前端工程师</span>
            <span class="meta-dot" />
            <span class="meta-role">大厂 P7</span>
          </div>
        </div>
        <div class="testimonial">
          <p class="testimonial-text">Vue3 源码剖析写得非常清晰，从 reactivity 到 compiler 每个模块都讲透了。是我读过最好的 Vue 源码教程。</p>
          <div class="testimonial-meta">
            <span class="meta-author">全栈开发者</span>
            <span class="meta-dot" />
            <span class="meta-role">创业公司 CTO</span>
          </div>
        </div>
        <div class="testimonial">
          <p class="testimonial-text">微前端那本帮我在公司成功落地了乾坤方案。能看到源码级的实现细节，比官方文档深入太多了。</p>
          <div class="testimonial-meta">
            <span class="meta-author">架构师</span>
            <span class="meta-dot" />
            <span class="meta-role">互联网公司</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.author-section {
  padding: 100px 24px 120px;
  background: var(--home-bg);
}

.author-container {
  max-width: 880px;
  margin: 0 auto;
}

.author-block {
  text-align: center;
  margin-bottom: 64px;
}

.section-title {
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 800;
  color: var(--home-text-1);
  margin: 0 0 20px;
  letter-spacing: -0.02em;
}

.author-bio {
  font-size: 16px;
  line-height: 1.8;
  color: var(--home-text-2);
  margin: 0 auto 28px;
  max-width: 560px;
}

.author-links {
  display: flex;
  gap: 10px;
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
  padding: 8px 20px;
  border-radius: 10px;
  border: 1px solid var(--home-tag-border);
  background: var(--home-tag-bg);
  transition: all 0.2s var(--ease-out);
}

.author-link:hover {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
}

.author-link:hover svg {
  fill: #fff;
  stroke: #fff;
}

/* Testimonials */
.testimonials {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.testimonial {
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 14px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: all 0.25s var(--ease-out);
}

.testimonial:hover {
  box-shadow: var(--home-card-shadow-hover);
  transform: translateY(-2px);
}

.testimonial-text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--home-text-2);
  margin: 0 0 20px;
  flex: 1;
}

.testimonial-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.meta-author {
  font-weight: 600;
  color: var(--home-text-1);
}

.meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--home-text-3);
}

.meta-role {
  color: var(--home-text-3);
}

@media (max-width: 768px) {
  .testimonials { grid-template-columns: 1fr; }
  .author-section { padding: 64px 16px 80px; }
}
</style>
