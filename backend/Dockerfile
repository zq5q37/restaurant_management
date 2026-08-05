# better-sqlite3 v13 requires Node >= 22; on Node 20 it compiles but segfaults on first query.
FROM node:22-slim

WORKDIR /app

# better-sqlite3 and bcrypt compile from source via node-gyp, which needs python3 + a C++ toolchain
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# -L (legacy watch = polling): file change events don't cross a Windows bind mount,
# so without this nodemon never sees edits. Same reason vite.config.js sets usePolling.
CMD ["npx", "nodemon", "-L", "server.js"]