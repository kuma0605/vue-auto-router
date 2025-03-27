import './assets/main.css'
import { createApp } from 'vue'
import { createAutoRouter } from './router'
import { createPinia } from 'pinia'
import App from './App.vue'

async function initApp() {
  const app = createApp(App)
  const router = await createAutoRouter()

  app.use(createPinia())
  app.use(router)

  app.mount('#app')
}

initApp().catch((error) => {
  console.error('Application initialization failed:', error)
})
