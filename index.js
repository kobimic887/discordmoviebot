require("dotenv").config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
} = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const IMDB_ID_REGEX = /tt\d{7,10}/i;
const COOLDOWN_MS = 3000;

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const lastRequestByUser = new Map();

function extractImdbId(text) {
  const directMatch = text.match(IMDB_ID_REGEX);
  if (directMatch) {
    return directMatch[0].toLowerCase();
  }

  const looseDigitsMatch = text.match(/\b\d{7,10}\b/);
  if (looseDigitsMatch) {
    return `tt${looseDigitsMatch[0]}`;
  }

  return null;
}

function yearFromReleaseDate(releaseDate) {
  if (!releaseDate || typeof releaseDate !== "string") {
    return "Unknown year";
  }

  const year = releaseDate.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : "Unknown year";
}

async function findByImdbId(imdbId) {
  const url = new URL(`https://db.videasy.net/3/find/${imdbId}`);
  url.searchParams.set("external_source", "imdb_id");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Vidking lookup failed (${response.status})`);
  }

  return response.json();
}

function canRunForUser(userId) {
  const now = Date.now();
  const lastSeen = lastRequestByUser.get(userId) || 0;
  if (now - lastSeen < COOLDOWN_MS) {
    return false;
  }

  lastRequestByUser.set(userId, now);
  return true;
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) {
    return;
  }

  if (!message.mentions.has(client.user)) {
    return;
  }

  if (!canRunForUser(message.author.id)) {
    await message.reply("Hold up a second and try again.");
    return;
  }

  const imdbId = extractImdbId(message.content);
  if (!imdbId) {
    await message.reply(
      "Send an IMDb ID when pinging me, for example: `@bot tt0111161`"
    );
    return;
  }

  try {
    const result = await findByImdbId(imdbId);
    const movie = Array.isArray(result.movie_results)
      ? result.movie_results[0]
      : null;

    if (!movie) {
      if (Array.isArray(result.tv_results) && result.tv_results.length > 0) {
        await message.reply(
          "I found a TV show for that IMDb ID, but this bot currently returns movie links only."
        );
        return;
      }

      await message.reply("I could not find a movie for that IMDb ID.");
      return;
    }

    const vidkingUrl = `https://www.vidking.net/embed/movie/${movie.id}?autoPlay=true`;
    const title = movie.title || "Unknown title";
    const year = yearFromReleaseDate(movie.release_date);

    const embed = new EmbedBuilder()
      .setTitle(`${title} (${year})`)
      .setDescription(`IMDb: \`${imdbId}\`\nTMDB: \`${movie.id}\``)
      .setColor(0x5865f2)
      .setFooter({ text: "Direct Vidking link" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Open in Vidking")
        .setStyle(ButtonStyle.Link)
        .setURL(vidkingUrl)
    );

    await message.reply({
      content: vidkingUrl,
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error(error);
    await message.reply(
      "I ran into an error while looking that up. Try again in a moment."
    );
  }
});

client.login(DISCORD_TOKEN);
