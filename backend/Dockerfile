FROM node:20-slim

WORKDIR /app

# better-sqlite3 and bcrypt compile from source via node-gyp, which needs python3 + a C++ toolchain
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npx", "nodemon", "server.js"]