const readline = require('readline');
const { client } = require('../lib/discord');
const { spawn } = require('child_process');
const { getConversationHistory, saveToConversationHistory } = require('../util/message');

const processingUsers = new Set();

client.on("messageCreate", async (message) => {
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
        let finalAnswerMessage = null;
        let creatingFinalMessage = false;
        let finalAnswerText = "";
        let errorOutput = "";
        let lastUpdateTime = 0;
        const UPDATE_INTERVAL = 1500;

        let isEditing = false;
        let streamClosed = false;

        try {
            processingUsers.add(userId);
            thinkingMessage = await message.reply("🤖 Processando...").catch(console.error);

            const history = getConversationHistory(userId);
            const historyString = history.map(h => `${h.role}: ${h.content}`).join('\n');
            const python = spawn("python", ["-u", "scripts/ask.py", question]);

            python.stdin.write(historyString);
            python.stdin.end();

            const rl = readline.createInterface({
                input: python.stdout,
                crlfDelay: Infinity
            });

            rl.on('line', async (line) => {
                if (!line.trim()) return;
                try {
                    const event = JSON.parse(line);
                    if (event.type === 'ANSWER_STREAM_CHUNK') {
                        finalAnswerText += event.payload;

                        if (!finalAnswerMessage && !creatingFinalMessage) {
                            creatingFinalMessage = true;
                            try {
                                finalAnswerMessage = await message.channel.send("✍️ ...");
                            } catch (error) {
                                console.error("Erro ao criar mensagem de resposta:", error);
                                finalAnswerMessage = null;
                            }
                            creatingFinalMessage = false;
                        }

                        const now = Date.now();
                        if (!isEditing && !streamClosed && finalAnswerMessage && (now - lastUpdateTime > UPDATE_INTERVAL)) {
                            isEditing = true;
                            lastUpdateTime = now;
                            
                            const textToEdit = finalAnswerText.length > 1950 
                                ? finalAnswerText.slice(0, 1950) + "..." 
                                : finalAnswerText;
                            
                            try {
                                if (finalAnswerMessage.editable) {
                                    await finalAnswerMessage.edit(textToEdit || "✍️ ...");
                                }
                            } catch (editError) {
                                console.error("Erro ao editar mensagem durante stream:", editError);
                                finalAnswerMessage = null; 
                            } finally {
                                isEditing = false;
                            }
                        }
                    }
                } catch (e) { 
                    console.error("Erro ao parsear JSON:", e, "Linha:", line);
                }
            });

            python.stderr.on("data", (data) => {
                const errorData = data.toString();
                console.error(`[PYTHON STDERR]: ${errorData}`);
                errorOutput += errorData;
            });

            python.on("close", async (code) => {
                streamClosed = true;

                await new Promise(resolve => setTimeout(resolve, 250));
                const finalFullText = finalAnswerText.trim();

                if (finalAnswerMessage && finalFullText) {
                    const finalText = finalFullText.length > 1900 
                        ? finalFullText.slice(0, 1900) + "..." 
                        : finalFullText;
                    
                    try {
                        if (finalAnswerMessage.editable) {
                            await finalAnswerMessage.edit(finalText);
                        }
                    } catch (finalEditError) {
                        console.error("Erro na edição final da resposta:", finalEditError);
                        await message.channel.send(`**Resposta final:**\n${finalText}`).catch(console.error);
                    }
                }

                if (thinkingMessage && thinkingMessage.deletable) {
                    await thinkingMessage.delete().catch(e => console.error("Erro ao deletar msg de processamento:", e));
                }

                if (code === 0 && finalAnswerText.trim()) {
                    const finalFullTextTrimmed = finalAnswerText.trim();
                    saveToConversationHistory(userId, 'user', question);
                    saveToConversationHistory(userId, 'assistant', finalFullTextTrimmed);
                } else if (code !== 0) {
                    let errorMessage = "❌ Ocorreu um erro no backend.";
                    if (errorOutput) {
                        errorMessage += `\n\n**Detalhes do Erro:**\n\`\`\`\n${errorOutput.substring(0, 1500)}\n\`\`\``;
                    }
                    await message.channel.send(errorMessage).catch(console.error);
                }
                
                processingUsers.delete(userId);
            });

        } catch (err) {
            console.error("Erro catastrófico no handler do ;ask:", err);
            if (thinkingMessage && thinkingMessage.editable) {
                await thinkingMessage.edit("❌ Ocorreu um erro catastrófico.").catch(console.error);
            }
            processingUsers.delete(userId);
        }
    }
});