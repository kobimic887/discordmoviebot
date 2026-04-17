require("dotenv").config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const API_BASE_URL = "https://db.videasy.net/3";
const VIDKING_BASE_URL = "https://www.vidking.net/embed";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

const IMDB_ID_REGEX = /tt\d{7,10}/i;
const IMDB_URL_REGEX = /imdb\.com\/title\/(tt\d{7,10})/i;

const DEFAULT_TV_SEASON = 1;
const DEFAULT_TV_EPISODE = 1;
const DEFAULT_POPULAR_LIMIT = 5;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_RANDOM_POOL_LIMIT = 10;
const MAX_RANDOM_PAGE = 20;

const COOLDOWN_MS = 3000;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const EXTERNAL_ID_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

const userCooldowns = new Map();
const cacheStore = new Map();

const slashCommands = [
  new SlashCommandBuilder()
    .setName("stream")
    .setDescription("Get a Vidking stream link from an IMDb ID")
    .addStringOption((option) =>
      option
        .setName("imdb")
        .setDescription("IMDb ID or URL, for example tt0111161")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Prefer movie, TV, or auto")
        .addChoices(
          { name: "Auto", value: "auto" },
          { name: "Movie", value: "movie" },
          { name: "TV", value: "tv" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("season")
        .setDescription("TV season (default: 1)")
        .setMinValue(1)
    )
    .addIntegerOption((option) =>
      option
        .setName("episode")
        .setDescription("TV episode (default: 1)")
        .setMinValue(1)
    )
    .addBooleanOption((option) =>
      option
        .setName("autoplay")
        .setDescription("Append autoPlay=true to generated links")
    ),
  new SlashCommandBuilder()
    .setName("popular")
    .setDescription("Show popular movie/TV/trending picks with IMDb + Vidking links")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("List source")
        .setRequired(true)
        .addChoices(
          { name: "Movies", value: "movie" },
          { name: "TV Shows", value: "tv" },
          { name: "Trending", value: "trending" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("How many results to show (1-10, default 5)")
        .setMinValue(1)
        .setMaxValue(10)
    )
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Result page (default 1)")
        .setMinValue(1)
        .setMaxValue(500)
    ),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search movies or TV shows and get stream links")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Movie or TV title")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Search scope")
        .addChoices(
          { name: "Movies", value: "movie" },
          { name: "TV Shows", value: "tv" },
          { name: "Mixed", value: "multi" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("How many results to show (1-10, default 5)")
        .setMinValue(1)
        .setMaxValue(10)
    )
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Result page (default 1)")
        .setMinValue(1)
        .setMaxValue(500)
    )
    .addBooleanOption((option) =>
      option
        .setName("autoplay")
        .setDescription("Append autoPlay=true to generated links")
    ),
  new SlashCommandBuilder()
    .setName("random")
    .setDescription("Pick a random movie/TV stream link")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Pick source")
        .addChoices(
          { name: "Movies", value: "movie" },
          { name: "TV Shows", value: "tv" },
          { name: "Trending", value: "trending" }
        )
    )
    .addBooleanOption((option) =>
      option
        .setName("autoplay")
        .setDescription("Append autoPlay=true to generated links")
    ),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show command examples and tips"),
];

function cacheGet(key) {
  const entry = cacheStore.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt < Date.now()) {
    cacheStore.delete(key);
    return null;
  }

  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function consumeCooldown(userId) {
  const now = Date.now();
  const nextAllowedAt = userCooldowns.get(userId) || 0;

  if (nextAllowedAt > now) {
    return nextAllowedAt - now;
  }

  userCooldowns.set(userId, now + COOLDOWN_MS);
  return 0;
}

function yearFromDate(dateText) {
  if (!dateText || typeof dateText !== "string") {
    return "Unknown year";
  }

  const year = dateText.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : "Unknown year";
}

function extractImdbId(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const urlMatch = text.match(IMDB_URL_REGEX);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }

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

function extractSeasonEpisode(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const patterns = [
    /\bs(\d{1,2})e(\d{1,3})\b/i,
    /\b(\d{1,2})x(\d{1,3})\b/i,
    /\bseason\D{0,6}(\d{1,2})\D{1,10}episode\D{0,6}(\d{1,3})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const season = Number.parseInt(match[1], 10);
    const episode = Number.parseInt(match[2], 10);
    if (season >= 1 && episode >= 1) {
      return { season, episode };
    }
  }

  return null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON response from upstream API");
      }
    }

    if (!response.ok) {
      const upstreamMessage =
        data && typeof data.status_message === "string"
          ? data.status_message
          : response.statusText;
      throw new Error(`Request failed (${response.status}): ${upstreamMessage}`);
    }

    return data;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("Request timed out");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function findByImdbId(imdbId) {
  const cacheKey = `find:${imdbId}`;
  const cachedValue = cacheGet(cacheKey);
  if (cachedValue) {
    return cachedValue;
  }

  const url = new URL(`${API_BASE_URL}/find/${imdbId}`);
  url.searchParams.set("external_source", "imdb_id");

  const result = await fetchJson(url.toString());
  cacheSet(cacheKey, result, CACHE_TTL_MS);
  return result;
}

function getPopularEndpoint(type, page) {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;

  if (type === "movie") {
    return `${API_BASE_URL}/movie/popular?language=en-US&page=${safePage}`;
  }

  if (type === "tv") {
    return `${API_BASE_URL}/tv/popular?language=en-US&page=${safePage}`;
  }

  return `${API_BASE_URL}/trending/all/day?language=en-US&page=${safePage}`;
}

function getSearchEndpoint(type, page, query) {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const encodedQuery = encodeURIComponent(query);
  const safeType = type === "movie" || type === "tv" ? type : "multi";

  return `${API_BASE_URL}/search/${safeType}?query=${encodedQuery}&language=en-US&page=${safePage}&include_adult=false`;
}

async function fetchPopular(type, page) {
  const cacheKey = `popular:${type}:${page}`;
  const cachedValue = cacheGet(cacheKey);
  if (cachedValue) {
    return cachedValue;
  }

  const result = await fetchJson(getPopularEndpoint(type, page));
  cacheSet(cacheKey, result, CACHE_TTL_MS);
  return result;
}

async function fetchSearch(type, query, page) {
  const cacheKey = `search:${type}:${page}:${query.toLowerCase()}`;
  const cachedValue = cacheGet(cacheKey);
  if (cachedValue) {
    return cachedValue;
  }

  const endpoint = getSearchEndpoint(type, page, query);
  const result = await fetchJson(endpoint);
  cacheSet(cacheKey, result, CACHE_TTL_MS);
  return result;
}

async function fetchImdbForTmdb(mediaType, tmdbId) {
  const cacheKey = `imdb:${mediaType}:${tmdbId}`;
  const cachedValue = cacheGet(cacheKey);
  if (cachedValue !== null) {
    return cachedValue;
  }

  const detailsUrl = new URL(`${API_BASE_URL}/${mediaType}/${tmdbId}`);
  detailsUrl.searchParams.set("language", "en-US");
  detailsUrl.searchParams.set("append_to_response", "external_ids");

  try {
    const result = await fetchJson(detailsUrl.toString());
    const imdbId = result?.external_ids?.imdb_id || null;
    cacheSet(cacheKey, imdbId, EXTERNAL_ID_CACHE_TTL_MS);
    return imdbId;
  } catch (error) {
    console.warn(
      `Failed to resolve IMDb ID for ${mediaType} ${tmdbId}: ${error.message}`
    );
    cacheSet(cacheKey, null, 5 * 60 * 1000);
    return null;
  }
}

function buildVidkingUrl({
  mediaType,
  tmdbId,
  season = DEFAULT_TV_SEASON,
  episode = DEFAULT_TV_EPISODE,
  autoPlay = true,
}) {
  const query = new URLSearchParams();
  if (autoPlay) {
    query.set("autoPlay", "true");
  }
  const queryString = query.toString();

  if (mediaType === "tv") {
    const path = `${VIDKING_BASE_URL}/tv/${tmdbId}/${season}/${episode}`;
    return queryString ? `${path}?${queryString}` : path;
  }

  const path = `${VIDKING_BASE_URL}/movie/${tmdbId}`;
  return queryString ? `${path}?${queryString}` : path;
}

function firstItem(list) {
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

function pickStreamItem(findResult, preference, preferTvHint) {
  const movie = firstItem(findResult.movie_results);
  const tv = firstItem(findResult.tv_results);

  if (preference === "movie") {
    return movie ? { mediaType: "movie", item: movie } : null;
  }

  if (preference === "tv") {
    return tv ? { mediaType: "tv", item: tv } : null;
  }

  if (preferTvHint && tv) {
    return { mediaType: "tv", item: tv };
  }

  if (movie) {
    return { mediaType: "movie", item: movie };
  }

  if (tv) {
    return { mediaType: "tv", item: tv };
  }

  return null;
}

async function resolveStreamRequest({
  imdbId,
  preference = "auto",
  season = DEFAULT_TV_SEASON,
  episode = DEFAULT_TV_EPISODE,
  autoPlay = true,
  preferTvHint = false,
}) {
  const findResult = await findByImdbId(imdbId);
  const hasMovie = Array.isArray(findResult.movie_results)
    ? findResult.movie_results.length > 0
    : false;
  const hasTv = Array.isArray(findResult.tv_results)
    ? findResult.tv_results.length > 0
    : false;

  const picked = pickStreamItem(findResult, preference, preferTvHint);
  if (!picked) {
    return {
      ok: false,
      hasMovie,
      hasTv,
      preference,
    };
  }

  const { mediaType, item } = picked;
  const title =
    mediaType === "movie"
      ? item.title || item.original_title || "Unknown title"
      : item.name || item.original_name || "Unknown show";

  const date = mediaType === "movie" ? item.release_date : item.first_air_date;

  const resolvedSeason = mediaType === "tv" ? season : null;
  const resolvedEpisode = mediaType === "tv" ? episode : null;

  return {
    ok: true,
    imdbId,
    mediaType,
    tmdbId: item.id,
    title,
    year: yearFromDate(date),
    voteAverage:
      typeof item.vote_average === "number" && Number.isFinite(item.vote_average)
        ? item.vote_average
        : null,
    posterPath: item.poster_path || null,
    season: resolvedSeason || DEFAULT_TV_SEASON,
    episode: resolvedEpisode || DEFAULT_TV_EPISODE,
    url: buildVidkingUrl({
      mediaType,
      tmdbId: item.id,
      season: resolvedSeason || DEFAULT_TV_SEASON,
      episode: resolvedEpisode || DEFAULT_TV_EPISODE,
      autoPlay,
    }),
  };
}

function getNotFoundMessage(result) {
  if (result.preference === "movie" && result.hasTv) {
    return "No movie found for that IMDb ID. Try `/stream` with `type: TV`.";
  }

  if (result.preference === "tv" && result.hasMovie) {
    return "No TV show found for that IMDb ID. Try `/stream` with `type: Movie`.";
  }

  return "I could not find anything for that IMDb ID.";
}

function buildStreamPayload(streamResult) {
  const typeLabel = streamResult.mediaType === "tv" ? "TV" : "Movie";

  const details = [
    `Type: **${typeLabel}**`,
    `IMDb: \`${streamResult.imdbId}\``,
    `TMDB: \`${streamResult.tmdbId}\``,
  ];

  if (streamResult.mediaType === "tv") {
    details.push(`Episode: **S${streamResult.season}E${streamResult.episode}**`);
  }

  if (typeof streamResult.voteAverage === "number") {
    details.push(`Rating: **${streamResult.voteAverage.toFixed(1)}**`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`${streamResult.title} (${streamResult.year})`)
    .setDescription(details.join("\n"))
    .setColor(streamResult.mediaType === "tv" ? 0x2ecc71 : 0x5865f2)
    .setFooter({ text: "Direct Vidking link" });

  if (streamResult.posterPath) {
    embed.setThumbnail(`${TMDB_IMAGE_BASE_URL}${streamResult.posterPath}`);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Open in Vidking")
      .setStyle(ButtonStyle.Link)
      .setURL(streamResult.url)
  );

  return {
    content: streamResult.url,
    embeds: [embed],
    components: [row],
  };
}

function normalizePopularItem(item, fallbackType) {
  const mediaType = item.media_type || fallbackType;
  if (mediaType !== "movie" && mediaType !== "tv") {
    return null;
  }

  const title =
    mediaType === "movie"
      ? item.title || item.original_title
      : item.name || item.original_name;

  if (!title || !item.id) {
    return null;
  }

  const date = mediaType === "movie" ? item.release_date : item.first_air_date;
  const rating =
    typeof item.vote_average === "number" && Number.isFinite(item.vote_average)
      ? item.vote_average
      : null;

  return {
    mediaType,
    tmdbId: item.id,
    title,
    year: yearFromDate(date),
    voteAverage: rating,
    posterPath: item.poster_path || null,
  };
}

function normalizeSearchItem(item, fallbackType) {
  const mediaType = item.media_type || fallbackType;
  if (mediaType !== "movie" && mediaType !== "tv") {
    return null;
  }

  if (!item.id) {
    return null;
  }

  const title =
    mediaType === "movie"
      ? item.title || item.original_title
      : item.name || item.original_name;

  if (!title) {
    return null;
  }

  const date = mediaType === "movie" ? item.release_date : item.first_air_date;
  const rating =
    typeof item.vote_average === "number" && Number.isFinite(item.vote_average)
      ? item.vote_average
      : null;

  return {
    mediaType,
    tmdbId: item.id,
    title,
    year: yearFromDate(date),
    voteAverage: rating,
    posterPath: item.poster_path || null,
  };
}

async function buildPopularEntries(type, limit, page) {
  const raw = await fetchPopular(type, page);
  const rawResults = Array.isArray(raw.results) ? raw.results : [];
  const fallbackType = type === "movie" || type === "tv" ? type : null;

  const normalized = rawResults
    .map((item) => normalizePopularItem(item, fallbackType))
    .filter(Boolean)
    .slice(0, limit);

  return Promise.all(
    normalized.map(async (item) => {
      const imdbId = await fetchImdbForTmdb(item.mediaType, item.tmdbId);
      return {
        ...item,
        imdbId,
        streamUrl: buildVidkingUrl({
          mediaType: item.mediaType,
          tmdbId: item.tmdbId,
          season: DEFAULT_TV_SEASON,
          episode: DEFAULT_TV_EPISODE,
          autoPlay: true,
        }),
      };
    })
  );
}

async function buildSearchEntries(type, query, limit, page, autoPlay) {
  const raw = await fetchSearch(type, query, page);
  const rawResults = Array.isArray(raw.results) ? raw.results : [];
  const fallbackType = type === "movie" || type === "tv" ? type : null;

  const normalized = rawResults
    .map((item) => normalizeSearchItem(item, fallbackType))
    .filter(Boolean)
    .slice(0, limit);

  return Promise.all(
    normalized.map(async (item) => {
      const imdbId = await fetchImdbForTmdb(item.mediaType, item.tmdbId);
      return {
        ...item,
        imdbId,
        streamUrl: buildVidkingUrl({
          mediaType: item.mediaType,
          tmdbId: item.tmdbId,
          season: DEFAULT_TV_SEASON,
          episode: DEFAULT_TV_EPISODE,
          autoPlay,
        }),
      };
    })
  );
}

function getPopularTitle(type) {
  if (type === "movie") {
    return "Popular Movies";
  }
  if (type === "tv") {
    return "Popular TV Shows";
  }
  return "Trending Picks";
}

function getSearchTitle(type, query) {
  if (type === "movie") {
    return `Movie Search: ${query}`;
  }
  if (type === "tv") {
    return `TV Search: ${query}`;
  }
  return `Search: ${query}`;
}

function buildPopularEmbed(type, page, entries) {
  const lines = entries.map((entry, index) => {
    const typeLabel = entry.mediaType === "tv" ? "TV" : "Movie";
    const imdbPart = entry.imdbId ? `IMDb: \`${entry.imdbId}\`` : "IMDb: `N/A`";
    const ratingPart =
      typeof entry.voteAverage === "number"
        ? ` | Rating: ${entry.voteAverage.toFixed(1)}`
        : "";
    const tvHint = entry.mediaType === "tv" ? " (defaults to S1E1)" : "";

    return `${index + 1}. **${entry.title} (${entry.year})** - ${typeLabel}${ratingPart}\n${imdbPart} | [Open](${entry.streamUrl})${tvHint}`;
  });

  let description = "";
  for (const line of lines) {
    if ((description + line).length > 3900) {
      break;
    }
    description += description ? `\n\n${line}` : line;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${getPopularTitle(type)} - Page ${page}`)
    .setDescription(description || "No displayable results.")
    .setColor(0xf1c40f)
    .setFooter({ text: "Use /stream for a specific IMDb ID" });

  if (entries[0] && entries[0].posterPath) {
    embed.setThumbnail(`${TMDB_IMAGE_BASE_URL}${entries[0].posterPath}`);
  }

  return embed;
}

function buildSearchEmbed(type, query, page, entries) {
  const lines = entries.map((entry, index) => {
    const typeLabel = entry.mediaType === "tv" ? "TV" : "Movie";
    const imdbPart = entry.imdbId ? `IMDb: \`${entry.imdbId}\`` : "IMDb: `N/A`";
    const ratingPart =
      typeof entry.voteAverage === "number"
        ? ` | Rating: ${entry.voteAverage.toFixed(1)}`
        : "";
    const tvHint = entry.mediaType === "tv" ? " (S1E1 default)" : "";

    return `${index + 1}. **${entry.title} (${entry.year})** - ${typeLabel}${ratingPart}\n${imdbPart} | [Open](${entry.streamUrl})${tvHint}`;
  });

  let description = "";
  for (const line of lines) {
    if ((description + line).length > 3900) {
      break;
    }
    description += description ? `\n\n${line}` : line;
  }

  return new EmbedBuilder()
    .setTitle(`${getSearchTitle(type, query)} - Page ${page}`)
    .setDescription(description || "No displayable results.")
    .setColor(0x9b59b6)
    .setFooter({ text: "Use /stream for exact IMDb targeting" });
}

function getUsageText() {
  return [
    "Use one of these:",
    "- Mention: `@bot tt0111161`",
    "- Mention TV: `@bot tt0944947 s1e1`",
    "- Slash: `/stream imdb:tt0111161`",
    "- Slash TV: `/stream imdb:tt0944947 type:tv season:1 episode:1`",
    "- Popular: `/popular type:movie`",
    "- Search: `/search query:inception type:movie`",
    "- Random: `/random type:trending`",
  ].join("\n");
}

async function registerSlashCommands() {
  const app = await client.application.fetch();
  const applicationId = app.id;
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const body = slashCommands.map((command) => command.toJSON());

  if (DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(applicationId, DISCORD_GUILD_ID),
      { body }
    );
    console.log(
      `Registered ${body.length} guild slash commands in ${DISCORD_GUILD_ID}`
    );
    return;
  }

  await rest.put(Routes.applicationCommands(applicationId), { body });
  console.log(`Registered ${body.length} global slash commands`);
}

async function handleMentionMessage(message) {
  if (message.author.bot) {
    return;
  }

  if (!message.mentions.has(client.user)) {
    return;
  }

  const cooldownRemainingMs = consumeCooldown(message.author.id);
  if (cooldownRemainingMs > 0) {
    await message.reply("Hold up a second and try again.");
    return;
  }

  const imdbId = extractImdbId(message.content);
  if (!imdbId) {
    await message.reply(getUsageText());
    return;
  }

  const seasonEpisode = extractSeasonEpisode(message.content);
  const season = seasonEpisode ? seasonEpisode.season : DEFAULT_TV_SEASON;
  const episode = seasonEpisode ? seasonEpisode.episode : DEFAULT_TV_EPISODE;

  try {
    const streamResult = await resolveStreamRequest({
      imdbId,
      preference: "auto",
      season,
      episode,
      autoPlay: true,
      preferTvHint: Boolean(seasonEpisode),
    });

    if (!streamResult.ok) {
      await message.reply(getNotFoundMessage(streamResult));
      return;
    }

    await message.reply(buildStreamPayload(streamResult));
  } catch (error) {
    console.error(error);
    await message.reply(
      "I ran into an error while looking that up. Try again in a moment."
    );
  }
}

async function handleStreamSlash(interaction) {
  const cooldownRemainingMs = consumeCooldown(interaction.user.id);
  if (cooldownRemainingMs > 0) {
    await interaction.reply({
      content: "Hold up a second and try again.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const imdbInput = interaction.options.getString("imdb", true);
  const imdbId = extractImdbId(imdbInput);

  if (!imdbId) {
    await interaction.editReply(
      "That is not a valid IMDb ID. Example: `tt0111161`"
    );
    return;
  }

  const preference = interaction.options.getString("type") || "auto";
  const seasonInput = interaction.options.getInteger("season");
  const episodeInput = interaction.options.getInteger("episode");
  const autoPlayInput = interaction.options.getBoolean("autoplay");

  const season = seasonInput || DEFAULT_TV_SEASON;
  const episode = episodeInput || DEFAULT_TV_EPISODE;

  try {
    const streamResult = await resolveStreamRequest({
      imdbId,
      preference,
      season,
      episode,
      autoPlay: autoPlayInput !== false,
      preferTvHint: seasonInput !== null || episodeInput !== null,
    });

    if (!streamResult.ok) {
      await interaction.editReply(getNotFoundMessage(streamResult));
      return;
    }

    await interaction.editReply(buildStreamPayload(streamResult));
  } catch (error) {
    console.error(error);
    await interaction.editReply(
      "I ran into an error while looking that up. Try again in a moment."
    );
  }
}

async function handlePopularSlash(interaction) {
  const cooldownRemainingMs = consumeCooldown(interaction.user.id);
  if (cooldownRemainingMs > 0) {
    await interaction.reply({
      content: "Hold up a second and try again.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const type = interaction.options.getString("type", true);
  const limit = interaction.options.getInteger("limit") || DEFAULT_POPULAR_LIMIT;
  const page = interaction.options.getInteger("page") || 1;

  try {
    const entries = await buildPopularEntries(type, limit, page);

    if (entries.length === 0) {
      await interaction.editReply("No results found for that request.");
      return;
    }

    const embed = buildPopularEmbed(type, page, entries);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error(error);
    await interaction.editReply(
      "I could not fetch popular results right now. Try again in a moment."
    );
  }
}

async function handleSearchSlash(interaction) {
  const cooldownRemainingMs = consumeCooldown(interaction.user.id);
  if (cooldownRemainingMs > 0) {
    await interaction.reply({
      content: "Hold up a second and try again.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const query = interaction.options.getString("query", true).trim();
  if (!query) {
    await interaction.editReply("Search query cannot be empty.");
    return;
  }

  const type = interaction.options.getString("type") || "multi";
  const limit = interaction.options.getInteger("limit") || DEFAULT_SEARCH_LIMIT;
  const page = interaction.options.getInteger("page") || 1;
  const autoPlayInput = interaction.options.getBoolean("autoplay");
  const autoPlay = autoPlayInput !== false;

  try {
    const entries = await buildSearchEntries(type, query, limit, page, autoPlay);
    if (entries.length === 0) {
      await interaction.editReply("No results found for that search.");
      return;
    }

    const embed = buildSearchEmbed(type, query, page, entries);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error(error);
    await interaction.editReply(
      "I could not fetch search results right now. Try again in a moment."
    );
  }
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function pickRandomEntry(type, autoPlay) {
  const selectedType = type || "trending";

  if (selectedType === "movie" || selectedType === "tv") {
    const randomPage = randomInteger(1, MAX_RANDOM_PAGE);
    const entries = await buildPopularEntries(
      selectedType,
      DEFAULT_RANDOM_POOL_LIMIT,
      randomPage
    );

    if (entries.length === 0) {
      return null;
    }

    const picked = entries[randomInteger(0, entries.length - 1)];
    return {
      ...picked,
      streamUrl: buildVidkingUrl({
        mediaType: picked.mediaType,
        tmdbId: picked.tmdbId,
        season: DEFAULT_TV_SEASON,
        episode: DEFAULT_TV_EPISODE,
        autoPlay,
      }),
      sourceType: selectedType,
      sourcePage: randomPage,
    };
  }

  const randomPage = randomInteger(1, MAX_RANDOM_PAGE);
  const entries = await buildPopularEntries(
    "trending",
    DEFAULT_RANDOM_POOL_LIMIT,
    randomPage
  );

  if (entries.length === 0) {
    return null;
  }

  const picked = entries[randomInteger(0, entries.length - 1)];
  return {
    ...picked,
    streamUrl: buildVidkingUrl({
      mediaType: picked.mediaType,
      tmdbId: picked.tmdbId,
      season: DEFAULT_TV_SEASON,
      episode: DEFAULT_TV_EPISODE,
      autoPlay,
    }),
    sourceType: "trending",
    sourcePage: randomPage,
  };
}

function buildRandomEmbed(entry) {
  const typeLabel = entry.mediaType === "tv" ? "TV" : "Movie";
  const imdbPart = entry.imdbId ? `IMDb: \`${entry.imdbId}\`` : "IMDb: `N/A`";
  const ratingPart =
    typeof entry.voteAverage === "number"
      ? `Rating: **${entry.voteAverage.toFixed(1)}**`
      : "Rating: **N/A**";
  const tvHint = entry.mediaType === "tv" ? "\nEpisode: **S1E1 (default)**" : "";

  const embed = new EmbedBuilder()
    .setTitle(`Random Pick: ${entry.title} (${entry.year})`)
    .setDescription(
      [
        `Type: **${typeLabel}**`,
        ratingPart,
        imdbPart,
        `TMDB: \`${entry.tmdbId}\``,
        `Source: **${entry.sourceType} page ${entry.sourcePage}**${tvHint}`,
      ].join("\n")
    )
    .setColor(0xe67e22)
    .setFooter({ text: "Use /search or /stream for specific picks" });

  if (entry.posterPath) {
    embed.setThumbnail(`${TMDB_IMAGE_BASE_URL}${entry.posterPath}`);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Open in Vidking")
      .setStyle(ButtonStyle.Link)
      .setURL(entry.streamUrl)
  );

  return {
    content: entry.streamUrl,
    embeds: [embed],
    components: [row],
  };
}

async function handleRandomSlash(interaction) {
  const cooldownRemainingMs = consumeCooldown(interaction.user.id);
  if (cooldownRemainingMs > 0) {
    await interaction.reply({
      content: "Hold up a second and try again.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const type = interaction.options.getString("type") || "trending";
  const autoPlayInput = interaction.options.getBoolean("autoplay");
  const autoPlay = autoPlayInput !== false;

  try {
    const entry = await pickRandomEntry(type, autoPlay);
    if (!entry) {
      await interaction.editReply("Could not pick a random title right now.");
      return;
    }

    await interaction.editReply(buildRandomEmbed(entry));
  } catch (error) {
    console.error(error);
    await interaction.editReply(
      "I could not fetch a random title right now. Try again in a moment."
    );
  }
}

async function handleHelpSlash(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("DiscordMovieBot Help")
    .setColor(0x3498db)
    .setDescription(
      [
        "**/stream** - Get a Vidking link from IMDb",
        "`/stream imdb:tt0111161`",
        "`/stream imdb:tt0944947 type:tv season:1 episode:1`",
        "",
        "**/popular** - Show popular movies/TV/trending",
        "`/popular type:movie limit:5`",
        "`/popular type:trending limit:10`",
        "",
        "**/search** - Search by title and get playable links",
        "`/search query:inception type:movie limit:5`",
        "",
        "**/random** - Grab a random pick",
        "`/random type:trending`",
        "",
        "Mention command still works: `@bot tt0111161`",
      ].join("\n")
    )
    .setFooter({ text: "TV links default to S1E1 unless specified" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await registerSlashCommands();
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
});

client.on("messageCreate", async (message) => {
  await handleMentionMessage(message);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "stream") {
    await handleStreamSlash(interaction);
    return;
  }

  if (interaction.commandName === "popular") {
    await handlePopularSlash(interaction);
    return;
  }

  if (interaction.commandName === "search") {
    await handleSearchSlash(interaction);
    return;
  }

  if (interaction.commandName === "random") {
    await handleRandomSlash(interaction);
    return;
  }

  if (interaction.commandName === "help") {
    await handleHelpSlash(interaction);
  }
});

client.login(DISCORD_TOKEN);
