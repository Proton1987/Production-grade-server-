FROM node:20-alpine

# Install FFmpeg + fonts for text watermark
RUN apk add --no-cache ffmpeg fontconfig ttf-dejavu

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p uploads outputs temp

ENV NODE_ENV=production
# PORT is intentionally NOT set here — Railway injects it at runtime

EXPOSE 3000

CMD ["node", "src/server.js"]
