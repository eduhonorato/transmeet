const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel } = require("@discordjs/voice");
const prism = require("prism-media");
const fs = require('fs');
const path = require('path');
const { PassThrough } = require("stream");
const { spawn, spawnSync } = require("child_process");

require('dotenv').config();

const client = new Client();
const token = process.env.BOT_TOKEN;
const CHANNEL_ID_TO_SEND_ATA = process.env.CHANNEL_ID_TO_SEND_ATA;

const conversationCache = new Map();
const CONVERSATION_TTL = 10 * 60 * 1000;
const processingUsers = new Set();

let connection = null;
let outStream, logStream, bufferStream, filename, logFilename, pcmDir, logDir;
let userStreams = new Map();
let decoder;

/**
 * Divide um texto longo em partes menores que 2000 caracteres, ideal para o Discord.
 * @param {string} text O texto a ser dividido.
 * @param {object} [options] Opções de customização.
 * @param {number} [options.limit=2000] O limite de caracteres por mensagem.
 * @param {string} [options.firstPartPrefix=''] O prefixo a ser adicionado na primeira parte.
 * @param {string} [options.continuationPrefix=''] O prefixo a ser adicionado nas partes seguintes.
 * @returns {string[]} Um array com as partes da mensagem.
 */
function splitMessage(text, { limit = 2000, firstPartPrefix = '', continuationPrefix = '' } = {}) {
    const parts = [];
    let remainder = text;

    while (remainder.length > 0) {
        const prefix = parts.length === 0 ? firstPartPrefix : continuationPrefix;
        const maxContentLength = limit - prefix.length;

        if (remainder.length <= maxContentLength) {
            parts.push(prefix + remainder);
            break;
        }

        let cut = remainder.lastIndexOf("\n", maxContentLength);
        if (cut === -1) {
            cut = remainder.lastIndexOf(" ", maxContentLength);
        }
        if (cut === -1) {
            cut = maxContentLength;
        }
        
        const chunk = remainder.slice(0, cut).trim();
        parts.push(prefix + chunk);
        remainder = remainder.slice(cut).trim();
    }
    
    return parts;
}

async function getUsername(userId) {
    try {
        const user = await client.users.fetch(userId);
        return user.username || userId;
    } catch (error) {
        console.error(`Erro ao buscar username para ${userId}:`, error);
        return userId;
    }
}

function getConversationHistory(userId) {
    const userData = conversationCache.get(userId);
    if (userData) {
        clearTimeout(userData.timer);
        userData.timer = setTimeout(() => {
            console.log(`INFO: Limpando histórico de conversa do usuário ${userId} por inatividade.`);
            conversationCache.delete(userId);
        }, CONVERSATION_TTL);
        return userData.history;
    }
    return [];
}

function saveToConversationHistory(userId, role, content) {
    if (!conversationCache.has(userId)) {
        conversationCache.set(userId, { history: [], timer: null });
    }
    const userData = conversationCache.get(userId);
    
    userData.history.push({ role, content });
    if (userData.history.length > 20) {
        userData.history.shift(); 
    }

    clearTimeout(userData.timer);
    userData.timer = setTimeout(() => {
        console.log(`INFO: Limpando histórico de conversa do usuário ${userId} por inatividade.`);
        conversationCache.delete(userId);
    }, CONVERSATION_TTL);
}

client.on("ready", () => {
    console.log(`✅ Logado como ${client.user.tag}`);
});

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
        logDir = path.join(__dirname, "files", "logs");
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
        
        if (connection) {
            connection.destroy();
            connection = null;
        }

        bufferStream.end();
        outStream.on("finish", () => {
            console.log(`✅ Arquivo de áudio salvo: ${filename}`);

            logStream.end();
            logStream.on("finish", () => console.log(`✅ Log salvo: ${logFilename}`));

            console.log("🔄 Convertendo para M4A...");
            const m4aDir = path.join(__dirname, "files", "m4aAudios");
            if (!fs.existsSync(m4aDir)) fs.mkdirSync(m4aDir, { recursive: true });
            const m4aFilename = path.join(m4aDir, path.basename(filename).replace(".pcm", ".m4a"));
            const convertProcess = spawnSync("python", ["./scripts/convert.py", filename, m4aFilename], { stdio: "inherit" });

            if (convertProcess.status !== 0) return console.error("❌ Erro ao converter o áudio.");
            console.log("✅ Conversão concluída!");

            console.log("✍️ Transcrevendo áudio...");
            const transcribeProcess = spawnSync("python", ["./scripts/transcribe.py", m4aFilename], { stdio: "inherit" });

            if (transcribeProcess.status !== 0) return console.error("❌ Erro ao transcrever áudio.");
            console.log("✅ Transcrição concluída!");
            
            console.log("🔄 Associando transcrição com logs...");
            const associateProcess = spawnSync("python", ["./scripts/associate.py"], { stdio: "inherit" });
            
            if (associateProcess.status !== 0) return console.error("❌ Erro ao associar transcrição.");
            console.log("✅ Transcrição associada!");
            
            console.log("🧠 Gerando ATA...");
            const generateProcess = spawnSync("python", ["./scripts/generate_ata.py"], { stdio: "inherit" });

            if (generateProcess.status !== 0) return console.error("❌ Erro ao gerar ATA.");
            console.log("✅ ATA gerada com sucesso!");

            (async () => {
                const ataDir = path.join(__dirname, "files", "ata");
                const ataFiles = fs.existsSync(ataDir) ? fs.readdirSync(ataDir).filter(file => file.endsWith(".txt")) : [];
                if (!ataFiles.length) return console.error("❌ Nenhum arquivo de ata encontrado!");
                
                const latestAta = ataFiles.sort().reverse()[0];
                const ataContent = fs.readFileSync(path.join(ataDir, latestAta), "utf-8");
                
                try {
                    const targetChannel = await client.channels.fetch(CHANNEL_ID_TO_SEND_ATA);
                    if (targetChannel && targetChannel.send) {
                        const parts = splitMessage(ataContent, {
                            firstPartPrefix: "📄 **ATA DA REUNIÃO**\n\n",
                            continuationPrefix: "**CONTINUAÇÃO**\n\n"
                        });
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
        });
    }

    if (message.content === ";gerar_ata" && message.author.id !== client.user.id) {
        console.log("🎬 Iniciando geração da ATA a partir de um arquivo .m4a...");
    
        const m4aAudios = path.join(__dirname, "files", "m4aAudios");
        if (!fs.existsSync(m4aAudios)) return console.error("❌ Diretório 'm4aAudios' não encontrado.");

        const files = fs.readdirSync(m4aAudios).filter(file => file.endsWith(".m4a"));
        if (!files.length) return console.error("❌ Nenhum arquivo .m4a encontrado.");
    
        const latest = files.sort().reverse()[0];
        const inputPath = path.join(m4aAudios, latest);
        console.log("🎧 Arquivo encontrado:", inputPath);
    
        console.log("✍️ Transcrevendo áudio...");
        const transcribeProcess = spawnSync("python", ["./scripts/transcribe.py", inputPath], { stdio: "inherit" });
        if (transcribeProcess.status !== 0) return console.error("❌ Erro ao transcrever.");
        console.log("✅ Transcrição concluída!");
    
        console.log("🔄 Associando transcrição com logs...");
        const associateProcess = spawnSync("python", ["./scripts/associate.py"], { stdio: "inherit" });
        if (associateProcess.status !== 0) return console.error("❌ Erro ao associar.");
        console.log("✅ Transcrição associada!");
    
        console.log("🧠 Gerando ATA...");
        const generateProcess = spawnSync("python", ["./scripts/generate_ata.py"], { stdio: "inherit" });
        if (generateProcess.status !== 0) return console.error("❌ Erro ao gerar ATA.");
        console.log("✅ ATA gerada com sucesso!");
    
        const ataDir = path.join(__dirname, "files", "ata");
        if (!fs.existsSync(ataDir)) return console.error("❌ Diretório de atas não encontrado!");
    
        const ataFiles = fs.readdirSync(ataDir).filter(file => file.endsWith(".txt"));
        if (!ataFiles.length) return console.error("❌ Nenhum arquivo de ata encontrado!");
    
        const latestAta = ataFiles.sort().reverse()[0];
        const ataContent = fs.readFileSync(path.join(ataDir, latestAta), "utf-8");
      
        try {
            const targetChannel = await client.channels.fetch(CHANNEL_ID_TO_SEND_ATA);
            if (targetChannel && targetChannel.send) {
                const parts = splitMessage(ataContent, {
                    firstPartPrefix: "📄 **ATA DA REUNIÃO**\n\n",
                    continuationPrefix: "**CONTINUAÇÃO**\n\n"
                });
                for (const part of parts) {
                    await targetChannel.send(part);
                }
            } else {
                console.error("❌ Canal de texto inválido para envio da ATA!");
            }
        } catch (err) {
            console.error("❌ Erro ao enviar ATA:", err);
        }
    }
    
    if (message.content === ";enviar_ata") {
        if (message.author.bot) return;

        const ATA_DIR = path.join(__dirname, "files", "ata");

        const getLatestAtaPath = () => {
            if (!fs.existsSync(ATA_DIR)) return null;
            const files = fs.readdirSync(ATA_DIR)
                .filter(f => f.endsWith(".txt"))
                .sort((a, b) => fs.statSync(path.join(ATA_DIR, b)).mtime - fs.statSync(path.join(ATA_DIR, a)).mtime);
            return files.length ? path.join(ATA_DIR, files[0]) : null;
        };

        const latestAta = getLatestAtaPath();

        if (!latestAta) {
            await message.channel.send("❌ Nenhuma ata encontrada.");
            return;
        }

        const ataContent = fs.readFileSync(latestAta, "utf-8");
        
        try {
            const targetChannel = await client.channels.fetch(CHANNEL_ID_TO_SEND_ATA);
            if (targetChannel && targetChannel.send) {
                const parts = splitMessage(ataContent, {
                    firstPartPrefix: "📄 **ATA DA REUNIÃO**\n\n",
                    continuationPrefix: "**CONTINUAÇÃO**\n\n"
                });
                for (const part of parts) {
                    await targetChannel.send(part);
                }
            } else {
                console.error("❌ Canal de texto inválido para envio da ATA!");
            }
        } catch (err) {
            console.error("❌ Erro ao enviar ATA:", err);
        }
    }
    
    if (message.content.startsWith(';ask')) {
      const userId = message.author.id;

      if (processingUsers.has(userId)) {
          return message.reply("Aguarde, sua pergunta anterior ainda está sendo processada.").catch(console.error);
      }
      
      const question = message.content.slice(5).trim();
  
      if (!question) {
          return message.reply("❌ Por favor, escreva sua pergunta após `;ask`.").catch(console.error);
      }

      let thinkingMessage;
      try {
          processingUsers.add(userId);
          
          thinkingMessage = await message.channel.send("🤖 Analisando sua pergunta e todo o contexto (isso pode levar um momento)...");
  
          const history = getConversationHistory(userId);
          const historyString = history.map(h => `${h.role}: ${h.content}`).join('\n');

          const python = spawn("python", ["scripts/ask.py", question]);
  
          python.stdin.write(historyString);
          python.stdin.end();

          let result = "";
          let errorOutput = "";
          python.stdout.on("data", (data) => {
              result += data.toString();
          });
  
          python.stderr.on("data", (data) => {
              console.error(`[PYTHON LOG]: ${data}`);
              errorOutput += data.toString();
          });
  
          python.on("close", async (code) => {
              await thinkingMessage.delete().catch(() => {});

              if (code === 0 && result.trim()) {
                  const trimmedResult = result.trim();
                  saveToConversationHistory(userId, 'user', question);
                  saveToConversationHistory(userId, 'assistant', trimmedResult);

                  const messageParts = splitMessage(trimmedResult, {
                      continuationPrefix: "*(continuação...)*\n\n"
                  });
                  
                  await message.reply(messageParts[0]).catch(console.error);

                  for (let i = 1; i < messageParts.length; i++) {
                      await message.channel.send(messageParts[i]).catch(console.error);
                  }
              } else {
                  message.channel.send("❌ Ocorreu um erro ao processar sua pergunta. Verifique os logs do console do bot.").catch(console.error);
                  console.error(`Script Python finalizado com código ${code}. Stderr: ${errorOutput}`);
              }

              processingUsers.delete(userId);
          });
      } catch (err) {
          console.error("Erro catastrófico no handler do ;ask:", err);
          if(thinkingMessage) await thinkingMessage.delete().catch(()=>{});
          processingUsers.delete(userId);
      }
    }
});

client.login(token);

// const { Client } = require('discord.js-selfbot-v13');
// const { joinVoiceChannel } = require("@discordjs/voice");
// const prism = require("prism-media");
// const fs = require('fs');
// const path = require('path');
// const { PassThrough } = require("stream");
// const { spawn, spawnSync } = require("child_process");

// require('dotenv').config();

// const client = new Client();
// const token = process.env.BOT_TOKEN;
// const CHANNEL_ID_TO_SEND_ATA = process.env.CHANNEL_ID_TO_SEND_ATA;

// const conversationCache = new Map();
// const CONVERSATION_TTL = 10 * 60 * 1000;

// let connection = null;
// let outStream, logStream, bufferStream, filename, logFilename, pcmDir, logDir;
// let userStreams = new Map();
// let decoder;

// client.on("ready", () => {
//   console.log(`✅ Logado como ${client.user.tag}`);
// });

// async function getUsername(userId) {
//   try {
//     const user = await client.users.fetch(userId);
//     return user.username || userId;
//   } catch (error) {
//     console.error(`Erro ao buscar username para ${userId}:`, error);
//     return userId;
//   }
// }

// function getConversationHistory(userId) {
//     const userData = conversationCache.get(userId);
//     if (userData) {
//         clearTimeout(userData.timer);
//         userData.timer = setTimeout(() => {
//             console.log(`INFO: Clearing conversation history for user ${userId} due to inactivity.`);
//             conversationCache.delete(userId);
//         }, CONVERSATION_TTL);
//         return userData.history;
//     }
//     return [];
// }

// function saveToConversationHistory(userId, role, content) {
//     if (!conversationCache.has(userId)) {
//         conversationCache.set(userId, { history: [], timer: null });
//     }
//     const userData = conversationCache.get(userId);
    
//     userData.history.push({ role, content });
//     if (userData.history.length > 20) {
//         userData.history.shift(); 
//     }

//     clearTimeout(userData.timer);
//     userData.timer = setTimeout(() => {
//         console.log(`INFO: Clearing conversation history for user ${userId} due to inactivity.`);
//         conversationCache.delete(userId);
//     }, CONVERSATION_TTL);
// }


// client.on("messageCreate", async (message) => {
//   if (message.content === "!join" && message.author.id !== client.user.id) {
//     const userVoiceChannel = message.member?.voice?.channel;
//     if (!userVoiceChannel) return console.log("❌ Você precisa estar em um canal de voz.");

//     connection = joinVoiceChannel({
//       channelId: userVoiceChannel.id,
//       guildId: userVoiceChannel.guild.id,
//       adapterCreator: userVoiceChannel.guild.voiceAdapterCreator,
//       selfDeaf: false,
//       selfMute: true,
//     });

//     console.log("🎤 Conectado ao canal de voz!");

//     const timestamp = Date.now();
//     pcmDir = path.join(__dirname, "files", "pcmAudios");
//     logDir = path.join(__dirname, "files", "logs")
//     if (!fs.existsSync(pcmDir)) fs.mkdirSync(pcmDir, { recursive: true });
//     if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

//     filename = path.join(pcmDir, `audio_${timestamp}.pcm`);
//     logFilename = path.join(logDir, `log_${timestamp}.txt`);
//     outStream = fs.createWriteStream(filename);
//     logStream = fs.createWriteStream(logFilename);
//     bufferStream = new PassThrough();
//     userStreams = new Map();

//     decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
//     decoder.on("error", (err) => console.error("Erro no decoder:", err));
//     decoder.pipe(bufferStream).pipe(outStream);

//     connection.receiver.speaking.on("start", async (userId) => {
//       const username = await getUsername(userId);
//       const timestamp = new Date().toISOString();
//       console.log(`▶ ${username} começou a falar em ${timestamp}`);
//       logStream.write(`[START] ${timestamp} - ${username}\n`);

//       if (!userStreams.has(userId)) {
//         const opusStream = connection.receiver.subscribe(userId, { end: "manual" });
//         userStreams.set(userId, opusStream);
//         opusStream.pipe(decoder, { end: false });
//       }
//     });

//     connection.receiver.speaking.on("end", async (userId) => {
//       const username = await getUsername(userId);
//       const timestamp = new Date().toISOString();
//       console.log(`⏹ ${username} parou de falar em ${timestamp}`);
//       logStream.write(`[END] ${timestamp} - ${username}\n`);
//     });
//   }

//   if (message.content === "!stop" && message.author.id !== client.user.id) {
//     if (!connection) return console.log("❌ O bot não está em um canal de voz.");

//     console.log("⏹ Parando a gravação...");
//     userStreams.forEach((stream) => stream.destroy());
//     userStreams.clear();

//     bufferStream.end();
//     outStream.on("finish", () => {
//       console.log(`✅ Arquivo de áudio salvo: ${filename}`);

//       console.log("🔄 Convertendo para M4A...");
//       const m4aDir = path.join(__dirname, "files", "m4aAudios");
//       if (!fs.existsSync(m4aDir)) fs.mkdirSync(m4aDir, { recursive: true });

//       const m4aFilename = path.join(m4aDir, path.basename(filename).replace(".pcm", ".m4a"));

//       const convertProcess = spawnSync("python", ["./scripts/convert.py", filename, m4aFilename], {
//         stdio: "inherit",
//       });

//       if (convertProcess.error) {
//         console.error("❌ Erro ao converter o áudio:", convertProcess.error);
//       } else {
//         console.log("✅ Conversão concluída!");

//         console.log("✍️ Transcrevendo áudio...");
//         const transcribeProcess = spawnSync("python", ["./scripts/transcribe.py", m4aFilename], {
//           stdio: "inherit",
//         });

//         if (transcribeProcess.error) {
//           console.error("❌ Erro ao transcrever áudio:", transcribeProcess.error);
//         } else {
//           console.log("✅ Transcrição concluída!");
          
//           console.log("🔄 Associando transcrição com logs...");
//           const associateProcess = spawnSync("python", ["./scripts/associate.py"], {
//             stdio: "inherit",
//           });
          
//           if (associateProcess.error) {
//             console.error("❌ Erro ao associar transcrição:", associateProcess.error);
//           } else {
//             console.log("✅ Transcrição associada!");
            
//             console.log("🧠 Gerando ATA...");
//             const generateProcess = spawnSync("python", ["./scripts/generate_ata.py"], {
//               stdio: "inherit",
//             });

//             if (generateProcess.error) {
//               console.error("❌ Erro ao gerar ATA:", generateProcess.error);
//             } else {
//               console.log("✅ ATA gerada com sucesso!");

//               (async () => {
//                 const ataDir = path.join(__dirname, "files", "ata");
//                 if (!fs.existsSync(ataDir)) {
//                   console.error("❌ Diretório de atas não encontrado!");
//                   return;
//                 }
                
//                 const ataFiles = fs.readdirSync(ataDir).filter(file => file.endsWith(".txt"));
              
//                 if (!ataFiles.length) {
//                   console.error("❌ Nenhum arquivo de ata encontrado!");
//                   return;
//                 }
              
//                 const latestAta = ataFiles.sort().reverse()[0];
//                 const ataContent = fs.readFileSync(path.join(ataDir, latestAta), "utf-8");
                
//                 function splitMessage(text, limit = 2000) {
//                   const parts = [];
//                   let remainder = text;
                
//                   while (remainder.length > 0) {
//                     const prefix = parts.length === 0 ? "📄 **ATA DA REUNIÃO**\n\n" : "**CONTINUAÇÃO**\n\n";
//                     const maxContentLength = limit - prefix.length;
                
//                     if (remainder.length <= maxContentLength) {
//                       parts.push(prefix + remainder);
//                       break;
//                     }
                
//                     let cut = remainder.lastIndexOf(" ", maxContentLength);
//                     if (cut === -1) cut = maxContentLength;
                
//                     const chunk = remainder.slice(0, cut).trim();
//                     parts.push(prefix + chunk);
//                     remainder = remainder.slice(cut).trim();
//                   }
                
//                   return parts;
//                 }
              
//                 try {
//                   const targetChannel = await client.channels.fetch(CHANNEL_ID_TO_SEND_ATA);
//                   if (targetChannel && targetChannel.send) {
//                     const parts = splitMessage(ataContent);
//                     for (const part of parts) {
//                       await targetChannel.send(part);
//                     }
//                   } else {
//                     console.error("❌ Canal de texto inválido para envio da ATA!");
//                   }
//                 } catch (err) {
//                   console.error("❌ Erro ao enviar ATA:", err);
//                 }
//               })();
//             }
//           }
//         }
//       }
//     });

//     logStream.end();
//     logStream.on("finish", () => console.log(`✅ Log salvo: ${logFilename}`));

//     connection.destroy();
//     connection = null;
//   }

//   if (message.content === ";gerar_ata" && message.author.id !== client.user.id) {
//     console.log("🎬 Iniciando geração da ATA a partir de um arquivo .m4a...");
  
//     const m4aAudios = path.join(__dirname, "files", "m4aAudios");
//     const files = fs.readdirSync(m4aAudios).filter(file => file.endsWith(".m4a"));
//     if (!files.length) return console.error("❌ Nenhum arquivo .m4a encontrado em wavAudios.");
  
//     const latest = files.sort().reverse()[0];
//     const inputPath = path.join(m4aAudios, latest);
//     console.log("🎧 Arquivo encontrado:", inputPath);
  
//     console.log("✍️ Transcrevendo áudio...");
//     const transcribeProcess = spawnSync("python", ["./scripts/transcribe.py", inputPath], { stdio: "inherit" });
//     if (transcribeProcess.error) return console.error("❌ Erro ao transcrever:", transcribeProcess.error);
  
//     console.log("✅ Transcrição concluída!");
  
//     console.log("🔄 Associando transcrição com logs...");
//     const associateProcess = spawnSync("python", ["./scripts/associate.py"], { stdio: "inherit" });
//     if (associateProcess.error) return console.error("❌ Erro ao associar:", associateProcess.error);
  
//     console.log("✅ Transcrição associada!");
  
//     console.log("🧠 Gerando ATA...");
//     const generateProcess = spawnSync("python", ["./scripts/generate_ata.py"], { stdio: "inherit" });
//     if (generateProcess.error) return console.error("❌ Erro ao gerar ATA:", generateProcess.error);
  
//     console.log("✅ ATA gerada com sucesso!");
  
//     const ataDir = path.join(__dirname, "files", "ata");
//     if (!fs.existsSync(ataDir)) return console.error("❌ Diretório de atas não encontrado!");
  
//     const ataFiles = fs.readdirSync(ataDir).filter(file => file.endsWith(".txt"));
//     if (!ataFiles.length) return console.error("❌ Nenhum arquivo de ata encontrado!");
  
//     const latestAta = ataFiles.sort().reverse()[0];
//     const ataContent = fs.readFileSync(path.join(ataDir, latestAta), "utf-8");
  
//     function splitMessage(text, limit = 2000) {
//       const parts = [];
//       let remainder = text;
    
//       while (remainder.length > 0) {
//         const prefix = parts.length === 0 ? "📄 **ATA DA REUNIÃO**\n\n" : "**CONTINUAÇÃO**\n\n";
//         const maxContentLength = limit - prefix.length;
    
//         if (remainder.length <= maxContentLength) {
//           parts.push(prefix + remainder);
//           break;
//         }
    
//         let cut = remainder.lastIndexOf(" ", maxContentLength);
//         if (cut === -1) cut = maxContentLength;
    
//         const chunk = remainder.slice(0, cut).trim();
//         parts.push(prefix + chunk);
//         remainder = remainder.slice(cut).trim();
//       }
    
//       return parts;
//     }    
  
//     try {
//       const targetChannel = await client.channels.fetch(CHANNEL_ID_TO_SEND_ATA);
//       if (targetChannel && targetChannel.send) {
//         const parts = splitMessage(ataContent);
//         for (const part of parts) {
//           await targetChannel.send(part);
//         }
//       } else {
//         console.error("❌ Canal de texto inválido para envio da ATA!");
//       }
//     } catch (err) {
//       console.error("❌ Erro ao enviar ATA:", err);
//     }
//   }

//   if (message.content === ";enviar_ata") {
//     if (message.author.bot) return;

//     const ATA_DIR = path.join(__dirname, "files", "ata");
//     const latestAta = getLatestAtaPath();

//     if (!latestAta) {
//       await message.channel.send("❌ Nenhuma ata encontrada.");
//       return;
//     }

//     const ataContent = fs.readFileSync(latestAta, "utf-8");
//     function getLatestAtaPath() {
//       const files = fs.readdirSync(ATA_DIR)
//         .filter(f => f.endsWith(".txt"))
//         .sort((a, b) => fs.statSync(path.join(ATA_DIR, b)).mtime - fs.statSync(path.join(ATA_DIR, a)).mtime);
    
//       return files.length ? path.join(ATA_DIR, files[0]) : null;
//     }

//     function splitMessage(text, limit = 2000) {
//       const parts = [];
//       let remainder = text;

//       while (remainder.length > 0) {
//         const prefix = parts.length === 0 ? "📄 **ATA DA REUNIÃO**\n\n" : "**CONTINUAÇÃO**\n\n";
//         const maxContentLength = limit - prefix.length;

//         if (remainder.length <= maxContentLength) {
//           parts.push(prefix + remainder);
//           break;
//         }

//         let cut = remainder.lastIndexOf(" ", maxContentLength);
//         if (cut === -1) cut = maxContentLength;

//         const chunk = remainder.slice(0, cut).trim();
//         parts.push(prefix + chunk);
//         remainder = remainder.slice(cut).trim();
//       }

//       return parts;
//     }

//     try {
//       const targetChannel = await client.channels.fetch(CHANNEL_ID_TO_SEND_ATA);
//       if (targetChannel && targetChannel.send) {
//         const parts = splitMessage(ataContent);
//         for (const part of parts) {
//           await targetChannel.send(part);
//         }
//       } else {
//         console.error("❌ Canal de texto inválido para envio da ATA!");
//       }
//     } catch (err) {
//       console.error("❌ Erro ao enviar ATA:", err);
//     }
//   }
  
//   if (message.content.startsWith(';ask')) {
//     function splitAnswer(text, limit = 2000) {
//       const parts = [];
//       let remainder = text;

//       const createChunk = (content, prefix = "") => {
//         const fullContent = prefix + content;
//         if (fullContent.length <= limit) {
//           parts.push(fullContent);
//           remainder = "";
//           return;
//         }

//         let cut = content.lastIndexOf("\n", limit - prefix.length);
//         if (cut === -1) {
//           cut = content.lastIndexOf(" ", limit - prefix.length);
//         }
//         if (cut === -1) {
//           cut = limit - prefix.length;
//         }

//         parts.push(prefix + content.slice(0, cut).trim());
//         remainder = content.slice(cut).trim();
//       };

//       createChunk(remainder);

//       while (remainder.length > 0) {
//         createChunk(remainder, "*(continuação...)*\n\n");
//       }

//       return parts;
//     }

//     const question = message.content.slice(4).trim();
//     const userId = message.author.id;
  
//     if (!question) {
//       message.reply("❌ Por favor, escreva sua pergunta após `;ask`.");
//       return;
//     }
  
//     const thinkingMessage = await message.channel.send("🤖 Analisando sua pergunta e todo o contexto (isso pode levar um momento)...");
  
//     const history = getConversationHistory(userId);
//     const historyString = history.map(h => `${h.role}: ${h.content}`).join('\n');

//     const python = spawn("python", ["scripts/ask.py", question]);
  
//     python.stdin.write(historyString);
//     python.stdin.end();

//     let result = "";
//     let errorOutput = "";
//     python.stdout.on("data", (data) => {
//       result += data.toString();
//     });
  
//     python.stderr.on("data", (data) => {
//       console.error(`Erro no script Python: ${data}`);
//       errorOutput += data.toString();
//     });
  
//     python.on("close", async (code) => {
//       if (code === 0) {
//         const trimmedResult = result.trim();
//         thinkingMessage.delete();
        
//         saveToConversationHistory(userId, 'user', question);
//         saveToConversationHistory(userId, 'assistant', trimmedResult);

//         const messageParts = splitAnswer(trimmedResult);
        
//         await message.reply(messageParts[0]);

//         for (let i = 1; i < messageParts.length; i++) {
//           await message.channel.send(messageParts[i]);
//         }

//       } else {
//         thinkingMessage.edit("❌ Ocorreu um erro ao processar sua pergunta. Verifique os logs.");
//         console.error(`Python script exited with code ${code}. Stderr: ${errorOutput}`);
//       }
//     });
//   }
// });

// client.login(token);