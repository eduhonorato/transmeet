const { joinVoiceChannel } = require("@discordjs/voice");

async function joinChannel(userVoiceChannel, isMuted) {
    const connection = joinVoiceChannel({
        channelId: userVoiceChannel.id,
        guildId: userVoiceChannel.guild.id,
        adapterCreator: userVoiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: isMuted ? true : false,
    });

    return connection;
}

module.exports = { joinChannel }