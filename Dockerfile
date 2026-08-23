FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY server ./server
COPY server.js ./
ENV NODE_ENV=production
EXPOSE 10000
CMD ["npm", "start"]
