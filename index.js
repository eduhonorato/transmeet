require('dotenv').config();
const { client } = require('./lib/discord.js');

const token = process.env.BOT_TOKEN;

client.on("ready", () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  require("./commands/join.js");
  require("./commands/chatbot.js");
  require("./commands/voicebot.js");
  require("./commands/ask.js");
});

client.login(token);