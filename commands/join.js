const fs = require('fs');
const path = require('path');
const prism = require('prism-media');
const { config } = require('../config');
const { PassThrough } = require('stream');
const { client } = require('../lib/discord');
const { spawnSync } = require("child_process");
const { getUsername } = require('../util/user');
const { joinChannel } = require('../util/voice');
const { splitMessage } = require('../util/message');

const CHANNEL_ID_TO_SEND_ATA = config.CHANNEL_ID_TO_SEND_ATA;

let decoder;
let connection = null;
let userStreams = new Map();
let outStream, logStream, bufferStream, filename, logFilename, pcmDir, logDir;

client.on("messageCreate", async (message) => {
  if (message.content === "!join".toLowerCase().trim() && message.author.id !== client.user.id) {
    const userVoiceChannel = message.member?.voice?.channel;
    if (!userVoiceChannel) return await message.channel.send("❌ Você precisa estar em um canal de voz.");

    connection = await joinChannel(userVoiceChannel, true);

    console.log("🎤 Conectado ao canal de voz!");

    const timestamp = Date.now();
    pcmDir = path.join(__dirname, "..", "files", "pcmAudios");
    logDir = path.join(__dirname, "..", "files", "logs")
    if (!fs.existsSync(pcmDir)) fs.mkdirSync(pcmDir, { recursive: true });
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    filename = path.join(pcmDir, `audio_${timestamp}.pcm`);
    logFilename = path.join(logDir, `log_${timestamp}.txt`);
    outStream = fs.createWriteStream(filename);
    logStream = fs.createWriteStream(logFilename);
    bufferStream = new PassThrough();

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
});

client.on("messageCreate", async (message) => {
    if (message.content === "!stop".toLowerCase().trim() && message.author.id !== client.user.id) {
        if (!connection) return console.log("❌ O bot não está em um canal de voz.");

        console.log("⏹ Parando a gravação...");
        userStreams.forEach((stream) => stream.destroy());
        userStreams.clear();

        bufferStream.end();
        outStream.on("finish", () => {
        console.log(`✅ Arquivo de áudio salvo: ${filename}`);

        console.log("🔄 Convertendo para M4A...");
        const m4aDir = path.join(__dirname, "..", "files", "m4aAudios");
        if (!fs.existsSync(m4aDir)) fs.mkdirSync(m4aDir, { recursive: true });

        const m4aFilename = path.join(m4aDir, path.basename(filename).replace(".pcm", ".m4a"));

        const convertProcess = spawnSync("python", ["./scripts/convert.py", filename, m4aFilename], {
            stdio: "inherit",
        });

        if (convertProcess.error) {
            console.error("❌ Erro ao converter o áudio:", convertProcess.error);
        } else {
            console.log("✅ Conversão concluída!");

            console.log("✍️ Transcrevendo áudio...");
            const transcribeProcess = spawnSync("python", ["./scripts/transcribe.py", m4aFilename], {
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
                    const ataDir = path.join(__dirname, "..", "files", "ata");
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
                        const parts = splitMessage(ataContent);
                        for (const part of parts) {
                            await targetChannel.send(part);
                        }
                    } else {
                        console.error("❌ Canal de texto inválido para envio da ATA!");
                    }
                    } catch (err) {
                        console.error("❌ Erro ao enviar ATA:", err);
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