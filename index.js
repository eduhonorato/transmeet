const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel } = require("@discordjs/voice");
const prism = require("prism-media");
const fs = require('fs');
const path = require('path');
const { PassThrough } = require("stream");
const { spawnSync } = require("child_process");

require('dotenv').config();

const client = new Client();
const token = process.env.BOT_TOKEN;
const CHANNEL_ID_TO_SEND_ATA = process.env.CHANNEL_ID_TO_SEND_ATA;

let connection = null;
let outStream, logStream, bufferStream, filename, logFilename, pcmDir, logDir;
let userStreams = new Map();
let decoder;

client.on("ready", () => {
  console.log(`✅ Logado como ${client.user.tag}`);
});

async function getUsername(userId) {
  try {
    const user = await client.users.fetch(userId);
    return user.username || userId;
  } catch (error) {
    console.error(`Erro ao buscar username para ${userId}:`, error);
    return userId;
  }
}

client.on("messageCreate", async (message) => {
  if (message.content === "!join" && message.author.id !== client.user.id) {
    const userVoiceChannel = message.member?.voice?.channel;
    if (!userVoiceChannel) return console.log("❌ Você precisa estar em um canal de voz.");

    connection = joinVoiceChannel({
      channelId: userVoiceChannel.id,
      guildId: userVoiceChannel.guild.id,
      adapterCreator: userVoiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    console.log("🎤 Conectado ao canal de voz!");

    const timestamp = Date.now();
    pcmDir = path.join(__dirname, "files", "pcmAudios");
    logDir = path.join(__dirname, "files", "logs")
    if (!fs.existsSync(pcmDir)) fs.mkdirSync(pcmDir, { recursive: true });
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    filename = path.join(pcmDir, `audio_${timestamp}.pcm`);
    logFilename = path.join(logDir, `log_${timestamp}.txt`);
    outStream = fs.createWriteStream(filename);
    logStream = fs.createWriteStream(logFilename);
    bufferStream = new PassThrough();
    userStreams = new Map();

    decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    decoder.on("error", (err) => console.error("Erro no decoder:", err));
    decoder.pipe(bufferStream).pipe(outStream);

    connection.receiver.speaking.on("start", async (userId) => {
      const username = await getUsername(userId);
      const timestamp = new Date().toISOString();
      console.log(`▶ ${username} começou a falar em ${timestamp}`);
      logStream.write(`[START] ${timestamp} - ${username}\n`);

      if (!userStreams.has(userId)) {
        const opusStream = connection.receiver.subscribe(userId, { end: "manual" });
        userStreams.set(userId, opusStream);
        opusStream.pipe(decoder, { end: false });
      }
    });

    connection.receiver.speaking.on("end", async (userId) => {
      const username = await getUsername(userId);
      const timestamp = new Date().toISOString();
      console.log(`⏹ ${username} parou de falar em ${timestamp}`);
      logStream.write(`[END] ${timestamp} - ${username}\n`);
    });
  }

  if (message.content === "!stop" && message.author.id !== client.user.id) {
    if (!connection) return console.log("❌ O bot não está em um canal de voz.");

    console.log("⏹ Parando a gravação...");
    userStreams.forEach((stream) => stream.destroy());
    userStreams.clear();

    bufferStream.end();
    outStream.on("finish", () => {
      console.log(`✅ Arquivo de áudio salvo: ${filename}`);

      console.log("🔄 Convertendo para WAV...");
      const wavDir = path.join(__dirname, "files", "wavAudios");
      if (!fs.existsSync(wavDir)) fs.mkdirSync(wavDir, { recursive: true });

      const wavFilename = path.join(wavDir, path.basename(filename).replace(".pcm", ".wav"));

      const convertProcess = spawnSync("python", ["./scripts/convert.py", filename, wavFilename], {
        stdio: "inherit",
      });

      if (convertProcess.error) {
        console.error("❌ Erro ao converter o áudio:", convertProcess.error);
      } else {
        console.log("✅ Conversão concluída!");

        console.log("✍️ Transcrevendo áudio...");
        const transcribeProcess = spawnSync("python", ["./scripts/transcribe.py", wavFilename], {
          stdio: "inherit",
        });

        if (transcribeProcess.error) {
          console.error("❌ Erro ao transcrever áudio:", transcribeProcess.error);
        } else {
          console.log("✅ Transcrição concluída!");
          
          console.log("🔄 Associando transcrição com logs...");
          const associateProcess = spawnSync("python", ["./scripts/associate.py"], {
            stdio: "inherit",
          });
          
          if (associateProcess.error) {
            console.error("❌ Erro ao associar transcrição:", associateProcess.error);
          } else {
            console.log("✅ Transcrição associada!");
            
            console.log("🧠 Gerando ATA...");
            const generateProcess = spawnSync("python", ["./scripts/generate_ata.py"], {
              stdio: "inherit",
            });

            if (generateProcess.error) {
              console.error("❌ Erro ao gerar ATA:", generateProcess.error);
            } else {
              console.log("✅ ATA gerada com sucesso!");

              (async () => {
                const ataDir = path.join(__dirname, "files", "ata");
                if (!fs.existsSync(ataDir)) {
                  console.error("❌ Diretório de atas não encontrado!");
                  return;
                }
                
                const ataFiles = fs.readdirSync(ataDir).filter(file => file.endsWith(".txt"));
              
                if (!ataFiles.length) {
                  console.error("❌ Nenhum arquivo de ata encontrado!");
                  return;
                }
              
                const latestAta = ataFiles.sort().reverse()[0];
                const ataContent = fs.readFileSync(path.join(ataDir, latestAta), "utf-8");
              
                try {
                  const targetChannel = await client.channels.fetch(CHANNEL_ID_TO_SEND_ATA);
                  if (targetChannel && targetChannel.send) {
                    await targetChannel.send(`📄 **ATA DA REUNIÃO**\n\n${ataContent}`);
                    console.log("📤 ATA enviada para o canal do Discord!");
                  } else {
                    console.error("❌ Canal de texto inválido para envio da ATA!");
                  }
                } catch (error) {
                  console.error("❌ Erro ao enviar ATA:", error);
                }
              })();
            }
          }
        }
      }
    });

    logStream.end();
    logStream.on("finish", () => console.log(`✅ Log salvo: ${logFilename}`));

    connection.destroy();
    connection = null;
  }
});

client.login(token);