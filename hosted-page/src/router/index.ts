import { createRouter, createWebHistory } from 'vue-router';
import NotFoundPage from '../pages/NotFoundPage.vue';
import SessionPage from '../pages/SessionPage.vue';

/**
 * The server only serves the page under /s/:token. The flow keeps one URL and tracks its step in
 * the session store, so the address (and the handoff QR code) always points at the same link.
 */
export const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    { path: '/s/:token', name: 'session', component: SessionPage, props: true },
    { path: '/s/:token/:rest(.*)*', redirect: (to) => `/s/${String(to.params.token)}` },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundPage },
  ],
});
