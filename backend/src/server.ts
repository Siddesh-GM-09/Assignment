import {app} from './app.js';import {config} from './config/env.js';
app.listen(config.port,()=>console.info(JSON.stringify({event:'server_started',port:config.port})));
