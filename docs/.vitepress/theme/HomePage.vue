<script setup>
import HeroSection from './HeroSection.vue'
import BookList from './BookList.vue'
import FeaturesSection from './FeaturesSection.vue'
import AuthorSection from './AuthorSection.vue'
</script>

<template>
  <div class="home-page">
    <HeroSection />
    <BookList />
    <FeaturesSection />
    <AuthorSection />
  </div>
</template>

<style scoped>
.home-page {
  width: 100%;
}
</style>
