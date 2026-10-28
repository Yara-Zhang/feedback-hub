import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from './lib/api'

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/item/:id', name: 'item', component: () => import('./views/ItemDetailView.vue') },
  { path: '/mine', name: 'mine', component: () => import('./views/MineView.vue') },
  { path: '/keywords', name: 'keywords', component: () => import('./views/KeywordsView.vue'), meta: { admin: true } },
  { path: '/crawl', name: 'crawl', component: () => import('./views/CrawlView.vue'), meta: { admin: true } },
  { path: '/members', name: 'members', component: () => import('./views/MembersView.vue'), meta: { admin: true } }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach((to) => {
  if (to.meta.public) return true
  if (!getToken()) return { name: 'login' }
  return true
})

export default router
