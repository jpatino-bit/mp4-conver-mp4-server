FROM node:18-alpine

# Metadata
LABEL maintainer="jpatino@bit.lat"
LABEL description="API para convertir MP4 a MP3 usando ffmpeg"

# Instalar ffmpeg y limpiar cache
RUN apk add --no-cache ffmpeg

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production

# Copiar código fuente
COPY server.js .

# Crear directorio para uploads
RUN mkdir -p uploads

# Exponer puerto
EXPOSE 3000

# Variable de entorno
ENV NODE_ENV=production
ENV PORT=3000

# Comando de inicio
CMD ["node", "server.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"