# Figurine app — a STATEFUL, long-running-job Node server.
# Run as a SINGLE instance with a persistent volume mounted at /app/data.
# Do NOT horizontally scale: jobs + uploads live on local disk and each
# generation polls Hi3D in-process for up to an hour.
FROM node:20-bookworm-slim

WORKDIR /app

# Install prod deps first for better layer caching. sharp ships a prebuilt
# linux binary, so no system libvips is required.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App code. data/ is a mounted volume (see .dockerignore) and is created at
# runtime by the store, so it is intentionally NOT baked into the image.
COPY . .
RUN mkdir -p data/jobs data/uploads

ENV NODE_ENV=production
# The host provides $PORT; server.js already reads process.env.PORT.
EXPOSE 3000
CMD ["node", "server.js"]
