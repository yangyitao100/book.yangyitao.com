import DefaultTheme from 'vitepress/theme'
import { h, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'
import BookList from './BookList.vue'
import HomePage from './HomePage.vue'
import Comment from './Comment.vue'
import BilibiliPlayer from './BilibiliPlayer.vue'
import './custom.css'

function applyBookPageClass() {
  const route = useRoute()

  const update = () => {
    if (typeof document === 'undefined') return
    const isBookPage = route.path.startsWith('/books/')
    document.documentElement.classList.toggle('book-page', isBookPage)
  }

  onMounted(update)
  watch(() => route.path, () => nextTick(update))
}

function trackPageView() {
  const route = useRoute()

  watch(() => route.path, () => {
    nextTick(() => {
      if (typeof window !== 'undefined' && (window as any)._hmt) {
        ;(window as any)._hmt.push(['_trackPageview', route.path])
      }
    })
  })
}

export default {
  extends: DefaultTheme,
  Layout() {
    applyBookPageClass()
    trackPageView()
    return h(DefaultTheme.Layout, null, {
      'doc-after': () => h(Comment),
    })
  },
  enhanceApp({ app }) {
    app.component('BookList', BookList)
    app.component('HomePage', HomePage)
    app.component('BilibiliPlayer', BilibiliPlayer)
  },
}
