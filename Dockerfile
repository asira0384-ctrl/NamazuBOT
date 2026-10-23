FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY index.js detector.js rolepanels.js voiceguard.js storage.js mccontrol.js ./
ENV NODE_ENV=production DATA_DIR=/data
CMD ["node", "index.js"]
