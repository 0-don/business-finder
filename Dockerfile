FROM imbios/bun-node AS deps
WORKDIR /app

COPY package.json ./
RUN bun install

#############################################

FROM imbios/bun-node AS business-finder-server

WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

CMD ["bun", "run", "serve"]

############################################

FROM imbios/bun-node AS business-finder-worker

WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

CMD ["bun", "start"]