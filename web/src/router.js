import { createRouter, createWebHashHistory } from 'vue-router'
import { getToken } from './lib/api'

const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/insights', name: 'insights', component: () => import('./views/InsightsView.vue'), meta: { fullscreen: true } },
  { path: '/item/:id', name: 'item', component: () => import('./views/ItemDetailView.vue') },
  { path: '/hot', name: 'hot', component: () => import('./views/HotView.vue') },
  { path: '/material', name: 'material', component: () => import('./views/MaterialView.vue') },
  { path: '/mine', name: 'mine', component: () => import('./views/MineView.vue') },
  { path: '/keywords', name: 'keywords', component: () => import('./views/KeywordsView.vue'), meta: { admin: true } },
  { path: '/crawl', name: 'crawl', component: () => import('./views/CrawlView.vue'), meta: { admin: true } },
  { path: '/members', name: 'members', component: () => import('./views/MembersView.vue'), meta: { admin: true } }
]

const router = createRouter({
  // hash 模式：GitHub Pages 是纯静态托管，history 模式的深链接会 404
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.meta.public) return true
  if (!getToken()) return { name: 'login' }
  return true
})

export default router
