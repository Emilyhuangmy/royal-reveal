# royal-reveal
A small browser card shuffle game. Can you beat the final level?

## Deploy to Cloudflare

Deploy target: **Cloudflare Workers** with static assets and a **D1** database for the leaderboard.

### Prerequisites

- Node.js (for `npx wrangler`)
- [Cloudflare account](https://dash.cloudflare.com); log in once:

  ```bash
  npx wrangler login
  ```

### 1. Create and initialize the database

Create a **new** D1 database:

```bash
npx wrangler d1 create royal-reveal-leaderboard
```

Copy the printed `database_id` (a UUID) into `wrangler.jsonc`: replace `REPLACE_AFTER_D1_CREATE` under `d1_databases[0].database_id` with that value.

Apply the schema to the new remote database:

```bash
npx wrangler d1 execute royal-reveal-leaderboard --remote --file=./schema.sql
```

To run the same schema against a **local** D1 (for `wrangler dev`):

```bash
npx wrangler d1 execute royal-reveal-leaderboard --local --file=./schema.sql
```

### 2. Deploy

```bash
npx wrangler deploy
```

After deploy, the game and `/api/scores`, `/api/leaderboard` will be live at your Worker URL.
