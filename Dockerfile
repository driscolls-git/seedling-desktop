FROM node:20-slim

WORKDIR /app

# Install only the external runtime deps (workspace deps are bundled by esbuild)
RUN npm init -y > /dev/null 2>&1 && npm install --save mssql compression

# Copy built API server
COPY artifacts/api-server/dist/ dist/

# Copy built frontend
COPY artifacts/seedling-desktop/dist/public/ dist/public/

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "dist/index.cjs"]
