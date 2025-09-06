require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHANNEL_ID_TO_SEND_ATA = process.env.CHANNEL_ID_TO_SEND_ATA;

if (!BOT_TOKEN || !OPENAI_API_KEY || !CHANNEL_ID_TO_SEND_ATA) {
    console.warn('Faltam permissões específicas para o funcionamento do bot');
}

module.exports = {
    config: {
        BOT_TOKEN,
        OPENAI_API_KEY,
        CHANNEL_ID_TO_SEND_ATA
    }
}