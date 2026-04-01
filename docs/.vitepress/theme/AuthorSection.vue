<script setup lang="ts">
const testimonials = [
  {
    content: '\u8BFB\u5B8C React18 \u6E90\u7801\u89E3\u6790\u540E\uFF0C\u9762\u8BD5\u4E2D\u7684\u6E90\u7801\u9898\u518D\u4E5F\u4E0D\u6015\u4E86\u3002\u624B\u5199 Fiber \u90A3\u90E8\u5206\u8BA9\u6211\u5BF9\u8C03\u5EA6\u7B97\u6CD5\u6709\u4E86\u5168\u65B0\u7684\u7406\u89E3\u3002',
    author: '\u524D\u7AEF\u5DE5\u7A0B\u5E08',
    role: '\u5927\u5382 P7',
  },
  {
    content: 'Vue3 \u6E90\u7801\u5256\u6790\u5199\u5F97\u975E\u5E38\u6E05\u6670\uFF0C\u4ECE reactivity \u5230 compiler \u6BCF\u4E2A\u6A21\u5757\u90FD\u8BB2\u900F\u4E86\u3002\u662F\u6211\u8BFB\u8FC7\u6700\u597D\u7684 Vue \u6E90\u7801\u6559\u7A0B\u3002',
    author: '\u5168\u6808\u5F00\u53D1\u8005',
    role: '\u521B\u4E1A\u516C\u53F8 CTO',
  },
  {
    content: '\u5FAE\u524D\u7AEF\u90A3\u672C\u5E2E\u6211\u5728\u516C\u53F8\u6210\u529F\u843D\u5730\u4E86\u4E7E\u5764\u65B9\u6848\u3002\u80FD\u770B\u5230\u6E90\u7801\u7EA7\u7684\u5B9E\u73B0\u7EC6\u8282\uFF0C\u6BD4\u5B98\u65B9\u6587\u6863\u6DF1\u5165\u592A\u591A\u4E86\u3002',
    author: '\u67B6\u6784\u5E08',
    role: '\u4E92\u8054\u7F51\u516C\u53F8',
  },
]
</script>

<template>
  <section class="author-section">
    <div class="author-container">
      <!-- Author -->
      <div class="author-block">
        <span class="section-label">ABOUT</span>
        <h2 class="section-title">\u5173\u4E8E\u4F5C\u8005</h2>
        <p class="author-bio">
          \u6211\u662F\u6768\u827A\u97EC\uFF0C\u591A\u5E74\u6DF1\u8015\u524D\u7AEF\u6280\u672F\u6808\u6E90\u7801\u7814\u7A76\u3002\u6211\u76F8\u4FE1\u7406\u89E3\u6E90\u7801\u662F\u901A\u5F80\u6280\u672F\u81EA\u7531\u7684\u5FC5\u7ECF\u4E4B\u8DEF\u2014\u2014\u8FD9\u4E9B\u4E66\u7C4D\u662F\u6211\u5C06\u590D\u6742\u7684\u5E95\u5C42\u539F\u7406\u7528\u6E05\u6670\u7684\u8BED\u8A00\u548C\u4EE3\u7801\u4F20\u9012\u7ED9\u6BCF\u4E00\u4F4D\u5F00\u53D1\u8005\u7684\u5C1D\u8BD5\u3002
        </p>
        <div class="author-links">
          <a href="https://github.com/yangyitao100" target="_blank" class="author-link">GitHub</a>
          <a href="https://www.yangyitao.com" target="_blank" class="author-link">\u4E2A\u4EBA\u7F51\u7AD9</a>
        </div>
      </div>

      <!-- Testimonials -->
      <div class="testimonials">
        <div v-for="t in testimonials" :key="t.author" class="testimonial">
          <div class="quote-icon">\u201C</div>
          <p class="testimonial-text">{{ t.content }}</p>
          <div class="testimonial-meta">
            <span class="meta-author">{{ t.author }}</span>
            <span class="meta-sep">\u00B7</span>
            <span class="meta-role">{{ t.role }}</span>
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
  max-width: 800px;
  margin: 0 auto;
}

/* Author block — centered, minimal */
.author-block {
  text-align: center;
  margin-bottom: 72px;
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
  font-size: clamp(26px, 4vw, 36px);
  font-weight: 800;
  color: var(--home-text-1);
  margin: 0 0 20px;
  letter-spacing: -0.02em;
}

.author-bio {
  font-size: 16px;
  line-height: 1.8;
  color: var(--home-text-2);
  margin: 0 0 24px;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.author-links {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.author-link {
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid var(--home-tag-border);
  background: var(--home-tag-bg);
  transition: all 0.2s var(--ease-out);
}

.author-link:hover {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
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
  padding: 24px;
  transition: all 0.25s var(--ease-out);
}

.testimonial:hover {
  box-shadow: var(--home-card-shadow-hover);
}

.quote-icon {
  font-size: 36px;
  font-weight: 800;
  line-height: 1;
  color: var(--vp-c-brand-soft);
  font-family: Georgia, 'Times New Roman', serif;
  margin-bottom: 8px;
  user-select: none;
}

.testimonial-text {
  font-size: 14px;
  line-height: 1.7;
  color: var(--home-text-2);
  margin: 0 0 16px;
}

.testimonial-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.meta-author {
  font-weight: 600;
  color: var(--home-text-1);
}

.meta-sep {
  color: var(--home-text-3);
}

.meta-role {
  color: var(--home-text-3);
}

@media (max-width: 768px) {
  .testimonials {
    grid-template-columns: 1fr;
  }
  .author-section {
    padding: 64px 16px;
  }
}
</style>
