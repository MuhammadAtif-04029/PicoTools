FROM node:22-slim
RUN apt-get update && apt-get install -y ffmpeg python3 curl && curl -L https://github.com -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
EXPOSE 10000
CMD ["node", "server.js"]
