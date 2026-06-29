<div align="center">

# NoteBit

**A clean, self-hostable workspace for docs, boards, and team knowledge.**

Pages, real-time collaboration, Kanban boards, a knowledge graph, per-page permissions, publishing — your data, your server, no seat limits.

[Website](https://notebit.org) · [Self-host](#self-host) · [Cloud](https://notebit.org#cloud) · AGPL-3.0

</div>

---

## Why NoteBit

- **Truly self-hostable** — one container, one SQLite file. No external services required.
- **No seat tax** — invite your whole team; the free, self-hosted version is never seat-capped.
- **Everything is a connected page** — docs, board columns, and cards are all pages, visualised in an interactive **knowledge graph**.
- **Real-time collaboration** — Google-Docs-style multiplayer cursors out of the box.
- **Kanban that fits** — columns and cards are first-class pages with per-column permissions and an approval workflow.
- **Publish to the web** — share any page or board publicly, read-only.
- **Own your data** — it's all in one SQLite database you control.

## Self-host

You need [Docker](https://docs.docker.com/get-docker/). Then:

```bash
git clone https://github.com/notebit/notebit.git
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

You can see the version you're running on the sign-in screen and at `GET /api/version`. Releases are tagged [here](https://github.com/notebit/notebit/releases) — `main` is always the latest stable.

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

[AGPL-3.0-or-later](LICENSE). You can self-host and modify NoteBit freely; if you offer it as a network service, you must make your source available under the same license. A managed, fully-hosted option is available at [notebit.org](https://notebit.org).
