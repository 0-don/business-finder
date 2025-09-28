FROM imbios/bun-node  AS deps
WORKDIR /app

COPY package.json ./

RUN bun install
#############################################

FROM imbios/bun-node AS business-finder-view

WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

CMD ["bun", "view"]

############################################
FROM imbios/bun-node AS  business-finder

WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

CMD ["bun", "dev"]