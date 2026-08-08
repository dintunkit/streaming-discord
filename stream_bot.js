import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { Streamer, prepareStream, playStream, Utils, Encoders } from '@dank074/discord-video-stream';
import axios from 'axios';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.setFfmpegPath(ffmpegPath);
import path from 'path';
import { fileURLToPath } from 'url';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import fs from 'fs';

let currentDownloadProcess = null;

// Bộ nhớ tạm lưu dữ liệu phim cho menu tương tác (tránh lỗi giới hạn footer Discord)
const sessionStore = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.FFMPEG_PATH = path.join(__dirname, 'node_modules', 'node-av', 'binary', 'ffmpeg.exe');

// ===== CẤU HÌNH =====
// Bot Token (Dùng để nhận lệnh /streamphim)
const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE';

// User Token (Tài khoản phụ - dùng để Go Live stream video vào Voice)
// LƯU Ý: Tuyệt đối không dùng token của tài khoản chính để tránh rủi ro
const USER_TOKEN = 'YOUR_USER_TOKEN_HERE';

// ===== SELFBOT STREAMER (phát video) =====
const SelfClient = (await import('discord.js-selfbot-v13')).default.Client;
const selfClient = new SelfClient();
const streamer = new Streamer(selfClient);

let selfReady = false;
selfClient.on('ready', () => {
  console.log(`✅ Selfbot Streamer đã kết nối: ${selfClient.user.tag}`);
  selfReady = true;
});

// ===== BOT CLIENT (nhận slash command) =====
const botClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ]
});

botClient.on('ready', async () => {
  console.log(`✅ Bot Stream Phim đã online dưới tên: ${botClient.user.tag}`);
  
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName('streamphim')
      .setDescription('Tìm và phát trực tiếp phim vào Voice Channel từ PhimAPI')
      .addStringOption(opt =>
        opt.setName('tenphim')
           .setDescription('Tên phim muốn xem (Ví dụ: avatar)')
           .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('stopphim')
      .setDescription('Dừng phát phim và thoát khỏi phòng thoại')
  ].map(c => c.toJSON());

  try {
    await rest.put(Routes.applicationCommands(botClient.user.id), { body: commands });
    console.log('✅ Đã đăng ký thành công lệnh /streamphim!');
  } catch (error) {
    console.error('❌ Lỗi khi đăng ký lệnh:', error);
  }
});

// ===== HÀM STREAM PHIM (tái sử dụng) =====
async function startStreaming(interaction, movieSlug, movieName, posterUrl, episodeIndex = 0) {
  try {
    const movieRes = await axios.get(`https://phimapi.com/phim/${movieSlug}`);
    const episodes = movieRes.data?.episodes || [];
    if (episodes.length === 0 || !episodes[0].server_data || episodes[0].server_data.length === 0) {
      await interaction.editReply({ content: `❌ Phim **${movieName}** hiện chưa có link xem hợp lệ.`, embeds: [], components: [] });
      return;
    }

    const serverData = episodes[0].server_data;
    const episode = serverData[episodeIndex] || serverData[0];
    const streamUrl = episode.link_m3u8;
    if (!streamUrl) {
      await interaction.editReply({ content: `❌ Phim **${movieName}** chưa cập nhật định dạng m3u8.`, embeds: [], components: [] });
      return;
    }

    const member = interaction.member;
    await interaction.editReply({
      content: `🎬 **Đang khởi tạo [Chuẩn VP8]:** ${movieName} - ${episode.name || `Tập ${episodeIndex + 1}`}\n🔊 **Kênh thoại:** <#${member.voice.channelId}>`,
      embeds: [], components: []
    });

    await streamer.joinVoice(interaction.guildId, member.voice.channelId);

    // Kích hoạt chuẩn nén H264 CBR (Constant Bitrate)
    const encoder = () => ({
      H264: {
        name: 'libx264',
        options: [
          '-preset', 'ultrafast',
          '-tune', 'zerolatency',
          '-profile:v', 'baseline',
          '-b:v', '1500k',
          '-maxrate', '1500k',
          '-minrate', '1500k',
          '-bufsize', '1500k',
          '-g', '48' // Keyframe mỗi 2 giây (24*2)
        ],
        globalOptions: [
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_at_eof', '1',
          '-reconnect_delay_max', '3'
        ],
        outFilters: []
      }
    });

    if (currentDownloadProcess) {
      try { currentDownloadProcess.kill('SIGKILL'); } catch (e) {}
    }

    // Stream trực tiếp không qua RAM buffer để tránh thắt cổ chai
    const { command, output } = prepareStream(streamUrl, {
      encoder,
      height: 720,
      frameRate: 24, // Chuẩn rạp chiếu phim
      bitrateVideo: 1500,
      bitrateAudio: 128,
      hardwareAcceleratedDecoding: false,
      minimizeLatency: true,
      customFfmpegFlags: [
        '-af', 'aresample=async=1',
        '-fps_mode', 'cfr'
      ],
      videoCodec: Utils.normalizeVideoCodec('H264'),
    });

    command.on('error', (err) => {
      console.error('[StreamBot FFmpeg Error]', err.message);
    });

    playStream(output, streamer, {
      type: 'go-live'
    }).then(() => {
      console.log(`[StreamBot] Đã phát xong phim: ${movieName}`);
    }).catch(err => {
      console.error('[StreamBot] Lỗi playStream:', err.message);
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎥 ${movieName} - ${episode.name || `Tập ${episodeIndex + 1}`}`)
      .setDescription(`Đang phát vào <#${member.voice.channelId}>\n\n📌 **Bấm vào "Xem buổi phát sóng" của tài khoản streamer trong Voice Channel để xem!**\n\n🛑 Gõ \`/stopphim\` để dừng.`)
      .setColor(0x00FF00)
      .setThumbnail(posterUrl || '')
      .setFooter({ text: 'Stream qua FFmpeg WebRTC | Chuẩn nén VP8 (Auto)' });

    await interaction.editReply({ content: null, embeds: [embed], components: [] }).catch(() => {});
  } catch (error) {
    console.error('[StreamBot]', error);
    await interaction.editReply({ content: `❌ Có lỗi xảy ra: ${error.message}`, embeds: [], components: [] }).catch(() => {});
  }
}

// ===== XỬ LÝ INTERACTION =====
botClient.on(Events.InteractionCreate, async (interaction) => {
  // ===== XỬ LÝ NÚT BẤM & MENU =====
  if (interaction.isStringSelectMenu()) {
    // --- CHỌN PHIM TỪ KẾT QUẢ TÌM KIẾM ---
    if (interaction.customId === 'movie_select') {
      await interaction.deferUpdate();
      const selectedSlug = interaction.values[0];
      const sessionId = interaction.message.embeds[0]?.footer?.text || '';
      const movieData = sessionStore.get(sessionId) || {};
      const movies = movieData.movies || [];
      const selected = movies.find(m => m.slug === selectedSlug);
      if (!selected) {
        await interaction.editReply({ content: '❌ Không tìm thấy dữ liệu phim.', embeds: [], components: [] });
        return;
      }

      // Lấy danh sách tập phim
      try {
        const movieRes = await axios.get(`https://phimapi.com/phim/${selectedSlug}`);
        const episodes = movieRes.data?.episodes || [];
        const serverData = episodes[0]?.server_data || [];

        if (serverData.length <= 1) {
          // Phim lẻ → chiếu luôn
          await startStreaming(interaction, selected.slug, selected.name, selected.poster, 0);
        } else {
          // Phim bộ → hiện menu chọn tập
          const episodeChunks = [];
          for (let i = 0; i < serverData.length; i += 25) {
            episodeChunks.push(serverData.slice(i, i + 25));
          }

          const embeds = [
            new EmbedBuilder()
              .setTitle(`📺 ${selected.name}`)
              .setDescription(`Phim có **${serverData.length} tập**. Hãy chọn tập muốn xem bên dưới!`)
              .setColor(0xFFA500)
              .setThumbnail(selected.poster || '')
              .setFooter({ text: `ep_${selected.slug}` })
          ];

          // Chỉ hiện 25 tập đầu (giới hạn Discord)
          const firstChunk = episodeChunks[0];
          const episodeSelect = new StringSelectMenuBuilder()
            .setCustomId('episode_select')
            .setPlaceholder('🎬 Chọn tập phim muốn xem...')
            .addOptions(
              firstChunk.map((ep, i) => ({
                label: `${ep.name || `Tập ${i + 1}`}`,
                value: `${i}`,
                emoji: '🎬'
              }))
            );

          const rows = [new ActionRowBuilder().addComponents(episodeSelect)];

          // Nếu có nhiều hơn 25 tập, thêm nút chuyển trang
          if (episodeChunks.length > 1) {
            const pageRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('ep_page_0').setLabel('Tập 1-25').setStyle(ButtonStyle.Primary).setDisabled(true),
              ...episodeChunks.slice(1, 4).map((chunk, i) =>
                new ButtonBuilder()
                  .setCustomId(`ep_page_${i + 1}`)
                  .setLabel(`Tập ${(i + 1) * 25 + 1}-${Math.min((i + 2) * 25, serverData.length)}`)
                  .setStyle(ButtonStyle.Secondary)
              )
            );
            rows.push(pageRow);
          }

          // Lưu dữ liệu tập phim vào sessionStore
          sessionStore.set(`ep_${selected.slug}`, { slug: selected.slug, name: selected.name, poster: selected.poster });

          await interaction.editReply({ content: null, embeds, components: rows });
        }
      } catch (err) {
        await interaction.editReply({ content: `❌ Lỗi khi tải thông tin phim: ${err.message}`, embeds: [], components: [] });
      }
      return;
    }

    // --- CHỌN TẬP PHIM ---
    if (interaction.customId === 'episode_select') {
      await interaction.deferUpdate();
      const episodeIndex = parseInt(interaction.values[0]);
      const sessionId = interaction.message.embeds[0]?.footer?.text || '';
      const movieData = sessionStore.get(sessionId) || {};

      if (!interaction.member.voice?.channel) {
        await interaction.editReply({ content: '❌ Bạn phải tham gia vào một phòng thoại trước!', embeds: [], components: [] });
        return;
      }

      await startStreaming(interaction, movieData.slug, movieData.name, movieData.poster, episodeIndex);
      return;
    }
  }

  // ===== XỬ LÝ NÚT BẤM CHUYỂN TRANG TẬP PHIM =====
  if (interaction.isButton() && interaction.customId.startsWith('ep_page_')) {
    await interaction.deferUpdate();
    const pageIndex = parseInt(interaction.customId.split('_')[2]);
    const sessionId = interaction.message.embeds[0]?.footer?.text || '';
    const movieData = sessionStore.get(sessionId) || {};

    try {
      const movieRes = await axios.get(`https://phimapi.com/phim/${movieData.slug}`);
      const episodes = movieRes.data?.episodes || [];
      const serverData = episodes[0]?.server_data || [];
      const episodeChunks = [];
      for (let i = 0; i < serverData.length; i += 25) {
        episodeChunks.push(serverData.slice(i, i + 25));
      }

      const chunk = episodeChunks[pageIndex] || episodeChunks[0];
      const startIdx = pageIndex * 25;

      const episodeSelect = new StringSelectMenuBuilder()
        .setCustomId('episode_select')
        .setPlaceholder(`🎬 Chọn tập ${startIdx + 1} - ${startIdx + chunk.length}...`)
        .addOptions(
          chunk.map((ep, i) => ({
            label: `${ep.name || `Tập ${startIdx + i + 1}`}`,
            value: `${startIdx + i}`,
            emoji: '🎬'
          }))
        );

      const rows = [new ActionRowBuilder().addComponents(episodeSelect)];

      if (episodeChunks.length > 1) {
        const pageRow = new ActionRowBuilder().addComponents(
          ...episodeChunks.slice(0, 4).map((_, i) =>
            new ButtonBuilder()
              .setCustomId(`ep_page_${i}`)
              .setLabel(`Tập ${i * 25 + 1}-${Math.min((i + 1) * 25, serverData.length)}`)
              .setStyle(i === pageIndex ? ButtonStyle.Primary : ButtonStyle.Secondary)
              .setDisabled(i === pageIndex)
          )
        );
        rows.push(pageRow);
      }

      await interaction.editReply({ components: rows });
    } catch (err) {
      console.error('[EpPage Error]', err);
    }
    return;
  }

  // ===== XỬ LÝ SLASH COMMANDS =====
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'stopphim') {
    if (!selfReady) {
      await interaction.reply({ content: '❌ Streamer chưa sẵn sàng!', ephemeral: true });
      return;
    }
    try {
      if (currentDownloadProcess) {
        currentDownloadProcess.kill('SIGINT');
        currentDownloadProcess = null;
      }
      try {
        if (fs.existsSync('temp_movie.mkv')) fs.unlinkSync('temp_movie.mkv');
      } catch (e) {}

      if (streamer.voiceConnection) {
        streamer.stopStream();
        streamer.leaveVoice();
      }
      const guild = selfClient.guilds.cache.get(interaction.guildId);
      if (guild && guild.members.me.voice.channel) {
        guild.members.me.voice.disconnect();
      }
      await interaction.reply({ content: '🛑 **Đã dừng phát phim và rút lui khỏi phòng thoại thành công!**' });
    } catch (e) {
      await interaction.reply({ content: `❌ Lỗi khi thoát phòng: ${e.message}`, ephemeral: true });
    }
    return;
  }

  if (interaction.commandName !== 'streamphim') return;
  const member = interaction.member;
  if (!member.voice?.channel) {
    await interaction.reply({ content: '❌ Bạn phải tham gia vào một phòng thoại (Voice Channel) trước!', ephemeral: true });
    return;
  }

  if (!selfReady) {
    await interaction.reply({ content: '❌ Selfbot Streamer chưa sẵn sàng, vui lòng thử lại sau vài giây.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: false });
  const keyword = interaction.options.getString('tenphim');

  try {
    // 1. Tìm phim trên PhimAPI - lấy 10 kết quả
    const searchRes = await axios.get(`https://phimapi.com/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=10`);
    const items = searchRes.data?.data?.items || [];
    const cdnBase = searchRes.data?.data?.APP_DOMAIN_CDN_IMAGE || 'https://img.phimapi.com';

    if (items.length === 0) {
      await interaction.editReply(`❌ Không tìm thấy phim nào có tên **"${keyword}"** trên kho PhimAPI.`);
      return;
    }

    // 2. Tạo danh sách phim có poster
    const movieList = items.map((item, i) => {
      const poster = item.poster_url?.startsWith('http') ? item.poster_url : `${cdnBase}/${item.poster_url || ''}`;
      const thumb = item.thumb_url?.startsWith('http') ? item.thumb_url : `${cdnBase}/${item.thumb_url || ''}`;
      return {
        slug: item.slug,
        name: item.name || 'N/A',
        originName: item.origin_name || '',
        year: item.year || '?',
        type: item.type === 'series' ? 'Phim Bộ' : item.type === 'single' ? 'Phim Lẻ' : item.type || '',
        quality: item.quality || '',
        lang: item.lang || '',
        poster,
        thumb
      };
    });

    // 3. Tạo Embed chính với poster phim đầu tiên (to nhất)
    const mainEmbed = new EmbedBuilder()
      .setTitle(`🔍 Kết quả tìm kiếm: "${keyword}"`)
      .setDescription(
        movieList.map((m, i) => {
          const badge = m.type === 'Phim Bộ' ? '📺' : '🎬';
          return `**${i + 1}.** ${badge} **${m.name}** (${m.originName})\n` +
                 `     📅 ${m.year} • ${m.quality} • ${m.lang} • ${m.type}`;
        }).join('\n\n')
      )
      .setColor(0x2B2D31)
      .setImage(movieList[0].thumb)
      .setFooter({ text: `search_${interaction.id}` });

    // Lưu danh sách phim vào sessionStore
    sessionStore.set(`search_${interaction.id}`, { movies: movieList });

    // 4. Tạo Select Menu với emoji cho từng phim
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('movie_select')
      .setPlaceholder('🍿 Chọn phim bạn muốn xem...')
      .addOptions(
        movieList.map((m, i) => ({
          label: `${m.name}`.substring(0, 100),
          description: `${m.year} • ${m.quality} • ${m.type}`.substring(0, 100),
          value: m.slug,
          emoji: m.type === 'Phim Bộ' ? '📺' : '🎬'
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.editReply({
      embeds: [mainEmbed],
      components: [row]
    });

  } catch (error) {
    console.error('[StreamBot]', error);
    try {
      await interaction.editReply(`❌ Có lỗi xảy ra: ${error.message}`);
    } catch (_) {}
  }
});

// ===== KHỞI ĐỘNG =====
botClient.on('error', console.error);
selfClient.on('error', console.error);
process.on('unhandledRejection', console.error);

try {
  await selfClient.login(USER_TOKEN);
} catch (err) {
  console.error('❌ Selfbot login thất bại:', err.message);
}

botClient.login(BOT_TOKEN);
