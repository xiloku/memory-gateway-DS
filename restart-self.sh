#!/bin/sh
node -e "
const h = require('http');
h.request({socketPath:'/var/run/docker.sock',path:'/v1.41/containers/deepseek-mcp/restart',method:'POST'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))}).end();
"
