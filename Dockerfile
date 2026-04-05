FROM node:20-slim

WORKDIR /app

# Instalar dependências do sistema para o Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libxss1 \
    libxrandr2 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Configurar Puppeteer para usar Chromium do sistema
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm install

COPY . .

# Criar diretório para dados persistentes
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]