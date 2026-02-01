# Self-Hosting Guide

Deploy Promptly for your team with Docker Compose.

## Prerequisites

- Docker and Docker Compose
- A domain or IP for your server

## Docker Compose Setup

Create a `docker-compose.yml`:

```yaml
version: "3.8"

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: promptly
      POSTGRES_USER: promptly
      POSTGRES_PASSWORD: changeme
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U promptly"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    environment:
      DATABASE_URL: postgresql://promptly:changeme@db:5432/promptly
      PORT: "3001"
    ports:
      - "3001:3001"
    depends_on:
      db:
        condition: service_healthy

  web:
    build:
      context: .
      dockerfile: packages/web/Dockerfile
    environment:
      NEXT_PUBLIC_API_URL: http://api:3001
    ports:
      - "3000:3000"
    depends_on:
      - api

volumes:
  pgdata:
```

## Environment Variables

### API

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Server port (default: 3001) |
| `CLERK_SECRET_KEY` | No | Clerk auth key (if using Clerk) |

### Web

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | URL of the API service |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | No | Clerk frontend key |
| `CLERK_SECRET_KEY` | No | Clerk backend key |

## Deployment

```bash
# Start services
docker compose up -d

# Run database migrations
docker compose exec api npx prisma migrate deploy

# Verify
curl http://localhost:3001/health
```

## Connect CLI

On each engineer's machine:

```bash
npm i -g @promptly/cli
promptly login --api-url https://your-server.example.com:3001
promptly init
```

## Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name promptly.yourteam.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Backups

### PostgreSQL

```bash
# Automated daily backup
docker compose exec db pg_dump -U promptly promptly > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20250101.sql | docker compose exec -T db psql -U promptly promptly
```

## Scaling

- **API**: Stateless -- scale horizontally behind a load balancer.
- **PostgreSQL**: Single instance is sufficient for most teams. For high availability, use a managed service (Neon, RDS, Cloud SQL).
- **Web**: Stateless -- deploy to any CDN/edge platform (Vercel, Cloudflare Pages).
