# DiscordMovieBot

A Discord bot that resolves IMDb IDs and returns direct Vidking links for movies and TV shows.

## Features

- Mention-based trigger (`@Bot tt0111161`)
- Slash commands: `/stream`, `/popular`, `/help`
- IMDb parsing from full ID, plain digits, or IMDb URL text
- IMDb -> TMDB resolution through `db.videasy.net`
- Reply with direct Vidking embed URL + button + details embed
- TV support (defaults to `S1E1`, or custom season/episode)
- Popular feeds for movies, TV, and trending with IMDb enrichment
- Basic per-user cooldown to reduce spam
- In-memory caching for faster responses and fewer upstream API calls

## Requirements

- Bun 1.0+
- A Discord bot token
- Message Content Intent enabled for your bot

Optional:

- `DISCORD_GUILD_ID` for fast guild-only slash command registration during development

## Quick Start

1. Install dependencies:

   ```bash
   bun install
   ```

2. Create `.env` and add your token:

   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   DISCORD_GUILD_ID=your_test_guild_id_here
   ```

3. Start the bot:

   ```bash
   bun run start
   ```

Development mode (auto-restart):

```bash
bun run dev
```

Optional fallback runtime:

```bash
npm run start:node
```

If you are migrating from npm, you can remove `package-lock.json` after running `bun install` and committing Bun's lockfile.

When the bot starts, it auto-registers slash commands.

## Discord Setup

In the Discord Developer Portal for your application:

1. Go to `Bot`.
2. Enable **Message Content Intent**.
3. Invite the bot with permissions:
   - View Channels
   - Send Messages
   - Embed Links
   - Read Message History

## Usage

Send any message that mentions the bot and contains an IMDb ID:

- `@YourBot tt0111161`
- `@YourBot 0111161`
- `@YourBot https://www.imdb.com/title/tt0111161/`
- `@YourBot tt0944947 s1e1`

Slash commands:

- `/stream imdb:tt0111161`
- `/stream imdb:tt0944947 type:tv season:1 episode:1`
- `/popular type:movie limit:5`
- `/popular type:tv limit:5`
- `/popular type:trending limit:10`
- `/help`

The bot replies with direct links like:

- Movie: `https://www.vidking.net/embed/movie/{tmdbId}?autoPlay=true`
- TV: `https://www.vidking.net/embed/tv/{tmdbId}/{season}/{episode}?autoPlay=true`

## Notes

- Discord bots cannot programmatically start camera/Go Live streams in VC.
- TV popular links default to `S1E1` when no episode is specified.
- `.env` is ignored by git to protect your token.

## Docker

### Build and run with Docker

1. Create `.env` from `.env.example` and set `DISCORD_TOKEN`.
2. Build the image:

   ```bash
   docker build -t discordmoviebot .
   ```

3. Run the container:

   ```bash
   docker run -d --name discordmoviebot --restart unless-stopped --env-file .env discordmoviebot
   ```

This image uses the official Bun runtime base image.

### Run with Docker Compose

```bash
docker compose up -d --build
```

### Logs

```bash
docker logs -f discordmoviebot
```
