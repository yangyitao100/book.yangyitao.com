import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import BookList from './BookList.vue'
import HomePage from './HomePage.vue'
import Comment from './Comment.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-after': () => h(Comment),
    })
  },
  enhanceApp({ app }) {
    app.component('BookList', BookList)
    app.component('HomePage', HomePage)
  },
}
