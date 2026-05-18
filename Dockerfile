FROM node:20-alpine
RUN apk add --no-cache bash
RUN mkdir -p /opt/omni-ob-vault /opt/deepseek-workspace
WORKDIR /app
COPY server-proxy.js .
CMD ["node", "server-proxy.js"]
