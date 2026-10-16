FROM mcr.microsoft.com/playwright:v1.48.2-jammy
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Riyadh
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc fluxbox novnc websockify fonts-noto-core fonts-noto-color-emoji tzdata poppler-utils zip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
CMD ["bash","/app/start.sh"]
