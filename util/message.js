const conversationCache = new Map();
const CONVERSATION_TTL = 10 * 60 * 1000;

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

module.exports = { splitMessage, getConversationHistory, saveToConversationHistory }