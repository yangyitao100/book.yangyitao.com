import DefaultTheme from 'vitepress/theme'
import BookList from './BookList.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('BookList', BookList)
  },
}
