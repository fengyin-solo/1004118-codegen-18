import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { syncCargoLedger } from './api/maintenance-service'
import './styles/global.css'

// 货物装卸台账由装卸设备清单同步替代，启动时先整体替换一次。
syncCargoLedger()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
