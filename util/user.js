const { client } = require('../lib/discord');

async function getUsername(userId) {
    try {
        const user = await client.users.fetch(userId);
        return user.username || userId;
    } catch (error) {
        console.error(`Erro ao buscar username para ${userId}:`, error);
        return userId;
    }
}

module.exports = { getUsername }