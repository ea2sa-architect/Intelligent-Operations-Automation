FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3301
CMD ["node", "index.js"]
