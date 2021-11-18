import Vue from "vue";
import App from "./App.vue";

Vue.config.productionTip = false;

import { Button, Divider, CellGroup, Field, Radio, RadioGroup } from "vant";

Vue.use(Button);
Vue.use(Divider);
Vue.use(CellGroup);
Vue.use(Field);
Vue.use(Radio);
Vue.use(RadioGroup);

new Vue({
  render: h => h(App)
}).$mount("#app");
