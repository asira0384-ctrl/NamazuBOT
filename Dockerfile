FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY index.js detector.js rolepanels.js voiceguard.js tickets.js ./
ENV NODE_ENV=production
CMD ["node", "index.js"]
