# nodejs-demo-app — Dockerized, with MongoDB, Nginx & CI/CD

A small Node.js + Express app that inserts/fetches records from MongoDB and
reports host/IP info. This fork adds:

- A production **Dockerfile** (multi-stage, non-root user, healthcheck)
- **Docker Compose** wiring the app to its own **MongoDB** container
- **Nginx** as a reverse proxy in front of the app (single public entry point on port 80)
- A **GitHub Actions** CI/CD pipeline that builds the image, pushes it to Docker Hub, and deploys it to a server over SSH

![Screenshot](nodejs-app-demo.jpg)

## Architecture
┌────────────┐
             Internet :80 → │ Nginx │ reverse proxy / only exposed port
└─────┬──────┘
│ proxy_pass → app:5000
┌─────▼──────┐
│ Node app │ express, no public port
└─────┬──────┘
│ MONGO_URL
┌─────▼──────┐
│ MongoDB │ named volume, no public port
└────────────┘
all three connected on the "app-network" bridge network

Only Nginx publishes a port to the host (`80:80`). The app and database talk
to each other over Docker's internal network and are not reachable directly
from outside the host — Nginx is the single entry point.

## Repository layout
.
├── Dockerfile # builds the Node.js app image
├── docker-compose.yml # app + mongo + nginx
├── .dockerignore
├── .env.example # copy to .env and fill in real values
├── index.js # app source (now reads Mongo URL from env)
├── index.html
├── package.json
├── nginx/
│ └── default.conf # reverse proxy config
└── .github/workflows/
└── deploy.yml # CI/CD pipeline

## 1. Run it locally

```bash
git clone https://github.com/<your-username>/nodejs-demo-app.git
cd nodejs-demo-app
cp .env.example .env
# edit .env and set a real MONGO_INITDB_ROOT_PASSWORD, then update
# MONGO_URL to match the same password

docker compose up -d --build
```

Check it:

```bash
curl http://localhost/health          # -> {"status":"ok"}   (via Nginx)
curl http://localhost/hostinfo        # host/IP info
curl http://localhost/nginx-health    # -> healthy
```

Open `http://localhost/` in a browser for the demo UI (insert/fetch data).

Stop it:

```bash
docker compose down          # keep the mongo-data volume (data persists)
docker compose down -v       # also delete the volume (wipes DB data)
```

### Why the app has no exposed port

`docker-compose.yml` intentionally does **not** publish a host port for
`app` or `mongo`. Nginx is the only container with a `ports:` mapping. This
is the same pattern you'd use in production: the reverse proxy is the sole
public entry point, so TLS termination, rate limiting, and access logs all
live in one place.

## 2. Environment variables (`.env`)

| Variable                       | Used by | Purpose                                              |
|---------------------------------|---------|-------------------------------------------------------|
| `PORT`                          | app     | Port the Express server listens on inside the container (default 5000) |
| `MONGO_INITDB_ROOT_USERNAME`    | mongo   | Root user Mongo creates on first boot                |
| `MONGO_INITDB_ROOT_PASSWORD`    | mongo   | Root password — change this before deploying anywhere real |
| `MONGO_DB_NAME`                 | app, mongo | Database name the app uses                        |
| `MONGO_URL`                     | app     | Full connection string, must match the root user/password above |

`.env` is git-ignored. `.env.example` documents the shape without secrets.

## 3. How the pieces fit together

**Dockerfile**
- Multi-stage build: a `deps` stage installs only production dependencies,
  then the `runner` stage copies just `node_modules` + source files, keeping
  the final image small.
- Runs as a non-root `appuser`, not root.
- Ships a `HEALTHCHECK` that hits `/health` so `docker ps` / orchestrators
  can tell if the container is actually serving traffic, not just running.

**MongoDB**
- Official `mongo:7` image, data persisted in the named volume `mongo-data`
  so it survives `docker compose down` / container recreation.
- `depends_on: condition: service_healthy` on the app service means the app
  container only starts once Mongo's own healthcheck (a `mongosh` ping)
  passes — avoiding the classic "app starts before DB is ready" race. As a
  second line of defense, `index.js` also retries the initial connection a
  few times.

**Nginx**
- `nginx/default.conf` proxies all traffic on port 80 to the app service on
  its internal port 5000, forwarding `Host`, `X-Real-IP`, and
  `X-Forwarded-For`/`-Proto` headers so the app can see the real client
  info if it ever needs it.
- Adding HTTPS later is a matter of mounting a cert (e.g. via Certbot) and
  adding a `listen 443 ssl;` server block — the app/Mongo containers don't
  need to change.

## 4. CI/CD (`.github/workflows/deploy.yml`)

Triggered on every push to `main` (or manually via **Run workflow**).

**Job 1 — `build-and-push`**
1. Checks out the code, installs dependencies, runs a basic sanity check
   (swap in `npm test` once real tests exist).
2. Builds the Docker image with Buildx (with GitHub Actions layer caching).
3. Pushes it to Docker Hub tagged both `:latest` and `:<short-sha>`.

**Job 2 — `deploy`** (runs after the build succeeds)
1. Copies the current `docker-compose.yml` and `nginx/default.conf` to the
   target server over SCP.
2. SSHes in, writes the `IMAGE_NAME`/`IMAGE_TAG` for the image just built
   into the server's `.env` (the DB credentials already living in that
   `.env` are left untouched), then runs:
```bash
   docker compose pull app
   docker compose up -d
```
   This pulls the exact image built in CI rather than rebuilding on the
   server, so what you tested in CI is what actually ships.
3. Prunes dangling images to keep the server's disk usage in check.

### Required GitHub Secrets

Set these under **Repo → Settings → Secrets and variables → Actions**:

| Secret                 | Value                                              |
|-------------------------|----------------------------------------------------|
| `DOCKERHUB_USERNAME`    | Your Docker Hub username                            |
| `DOCKERHUB_TOKEN`       | Docker Hub access token (Account Settings → Security) |
| `SERVER_HOST`           | Server's public IP or hostname                      |
| `SERVER_USER`           | SSH user (e.g. `ubuntu`)                             |
| `SERVER_SSH_KEY`        | Private key that matches a public key already in the server's `~/.ssh/authorized_keys` |

### One-time server setup

On the target server, before the first deploy:

```bash
mkdir -p ~/nodejs-demo-app/nginx
cd ~/nodejs-demo-app
# create the real .env with production Mongo credentials
nano .env
```

The workflow only ships `docker-compose.yml` and `nginx/default.conf` — it
never overwrites `.env`, so production secrets stay on the server and out
of git and CI logs.

## 5. Useful commands

```bash
docker compose logs -f app        # tail app logs
docker compose logs -f mongo      # tail Mongo logs
docker compose ps                 # container status/health
docker compose exec mongo mongosh -u admin -p   # open a Mongo shell
docker compose restart app        # restart just the app after a config change
```