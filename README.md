# DiscordMovieBot

A Discord bot that listens for a bot mention plus an IMDb ID, then returns a direct Vidking movie link.

## Features

- Mention-based trigger (`@Bot tt0111161`)
- IMDb parsing from full ID, plain digits, or IMDb URL text
- IMDb -> TMDB resolution through `db.videasy.net`
- Reply with direct Vidking embed URL + button + details embed
- Basic per-user cooldown to reduce spam

## Requirements

- Node.js 18+
- A Discord bot token
- Message Content Intent enabled for your bot

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` and add your token:

   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   ```

3. Start the bot:

   ```bash
   npm start
   ```

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

If a movie is found, the bot replies with:

- Direct link: `https://www.vidking.net/embed/movie/{tmdbId}?autoPlay=true`
- Movie title/year
- IMDb and TMDB IDs

## Notes

- Current behavior is movie-only.
- If IMDb resolves to TV, the bot replies with a clear message.
- `.env` is ignored by git to protect your token.
