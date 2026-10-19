FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV WHATSAPP_AUTH_DIR=/data/whatsapp-auth
VOLUME /data
EXPOSE 8080
CMD ["node", "server.mjs"]
