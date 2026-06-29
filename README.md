<div align="center">

![NoteBit](docs/banner.png)

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-a78bdb.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-a78bdb.svg)](https://github.com/GroyalCodes/notebit/releases)
[![Self-hostable](https://img.shields.io/badge/self--hostable-yes-5fc18a.svg)](#self-host)
[![Stars](https://img.shields.io/github/stars/GroyalCodes/notebit?color=a78bdb)](https://github.com/GroyalCodes/notebit/stargazers)

**A clean, self-hostable workspace for docs, boards, and team knowledge.**

Real-time collaboration, Kanban boards, a knowledge graph, per-page permissions, and web publishing. Your data, your server, no seat limits.

[Website](https://notebit.org) · [Self-host](#self-host) · [Cloud](https://notebit.org#pricing) · [Releases](https://github.com/GroyalCodes/notebit/releases)

</div>

---

## Why NoteBit

Notes apps got bloated and pricey. NoteBit is neither.

- **Truly self-hostable** — one container, one SQLite file. No external services required.
- **No seat tax** — invite your whole team; the self-hosted version is never seat-capped.
- **Everything is a connected page** — docs, board columns, and cards are all pages, visualised in an interactive **knowledge graph**.
- **Real-time collaboration** — Google-Docs-style multiplayer cursors out of the box.
- **Kanban that fits** — columns and cards are first-class pages with per-column permissions and an approval workflow.
- **Multiple workspaces** — one per team or project, each with its own members and settings.
- **Publish to the web** — share any page or board publicly, read-only.
- **Own your data** — it all lives in one SQLite database you control.

## Screenshots

> Drop a couple of real captures from your instance here, e.g. `docs/editor.png`, `docs/board.png`, `docs/graph.png`:
>
> ```md
> ![Editor](docs/editor.png)
> ![Boards](docs/board.png)
> ![Knowledge graph](docs/graph.png)
> ```

## Self-host

You need [Docker](https://docs.docker.com/get-docker/). Then:

```bash
git clone https://github.com/GroyalCodes/notebit.git
cd notebit
docker compose up -d
```

Open **http://localhost:8200** and create your account — the first account is the admin.

Your data lives in a Docker volume (`notebit-data`) as a single SQLite database. Back it up by copying that volume.

### Configuration

All optional except where noted — set via environment in `docker-compose.yml` or a `.env` file (see `.env.example`):

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8200` | Port the server listens on |
| `APP_URL` | `http://localhost:8200` | Public URL, used in invite emails |
| `WIKI_DB` | `/data/notebit.db` | Database location |
| `RESEND_API_KEY` | — | Enables email invites ([resend.com](https://resend.com)) |
| `MAIL_FROM` | — | From address for invite emails |
| `ALLOW_SIGNUP` | `true` | Set `false` for invite-only |

### Updating

```bash
git pull
docker compose up -d --build
```

You can see the version you're running on the sign-in screen and at `GET /api/version`. Releases are tagged [here](https://github.com/GroyalCodes/notebit/releases); `main` is always the latest stable.

### Deploy to Fly.io

NoteBit ships with a `fly.toml`. With [flyctl](https://fly.io/docs/flyctl/install/) installed:

```bash
fly launch --copy-config --no-deploy   # creates your app + a volume for /data
fly deploy
```

Your SQLite database persists on the Fly volume, separate from the image, so deploys keep your data. Schema migrations run automatically on boot.

## Don't want to host it?

[**NoteBit Cloud**](https://notebit.org#pricing) is the managed option — we host, back up, and update it for one flat price per workspace, with unlimited members. No per-seat bill.

## Run without Docker (development)

```bash
# server
cd server && npm install && npm start      # http://127.0.0.1:8200
# web (in another terminal)
cd web && npm install && npm run dev        # http://localhost:5173
```

## Stack

Node 22 · Fastify 5 · better-sqlite3 · React 18 · Vite 6 · BlockNote · Yjs (real-time). No external database, queue, or cache.

## License

[AGPL-3.0-or-later](LICENSE). Self-host and modify NoteBit freely; if you offer it as a network service, make your source available under the same license. A managed, fully-hosted option is available at [notebit.org](https://notebit.org).
