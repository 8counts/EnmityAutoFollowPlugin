# --- index.js ---
// VC Shadow — Passive voice-state movement tracker for Enmity.
// manifest.json MUST be in the same directory for the Enmity loader to register this plugin.

const { createPlugin } = window.Enmity;
const { React } = window.Enmity;
const { Toast } = window.Enmity.common;
const { FormSection, FormInput, FormSwitch, FormButton } = window.Enmity.components;

const TRACK_STATE = Symbol.for("__vc_shadow_v1__");
if (!global[TRACK_STATE]) global[TRACK_STATE] = { active: false, targetId: "", webhookUrl: "", followEnabled: false };
const state = global[TRACK_STATE];

async function sendWebhook(url, payload) {
    try {
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error("[VC-Shadow] Webhook failed:", e.message);
    }
}

function buildEmbed(title, description, color = 0x5865F2, fields = []) {
    return {
        username: "VC Shadow",
        avatar_url: "https://i.imgur.com/UdZ9x6Q.png",
        embeds: [{
            title,
            description,
            color,
            timestamp: new Date().toISOString(),
            footer: { text: "VC Shadow | SentinelCore Audit" },
            fields
        }]
    };
}

async function logVoiceMove(client, oldState, newState) {
    const targetId = state.targetId;
    if (!targetId || !state.active) return;

    const userId = newState.id || newState.userId;
    if (userId !== targetId) return;

    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;

    if (oldChannel === newChannel) return;

    const guild = client.guilds.cache.get(newState.guildId);
    const oldName = guild?.channels?.cache?.get(oldChannel)?.name || "Disconnected";
    const newName = guild?.channels?.cache?.get(newChannel)?.name || "Disconnected";
    const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;

    const fields = [
        { name: "From", value: oldName || "None", inline: true },
        { name: "To", value: newName || "None", inline: true },
        { name: "Guild", value: guild?.name || "Unknown", inline: true },
        { name: "Timestamp", value: timestamp, inline: false }
    ];

    if (newChannel) {
        try {
            const channel = guild.channels.cache.get(newChannel);
            if (channel && channel.members) {
                const occupants = Array.from(channel.members.values()).map(m => m.user.tag || m.user.username).join("\n") || "Empty";
                fields.push({ name: "Current Occupants", value: occupants.substring(0, 1024), inline: false });
            }
        } catch (_) { }
    }

    const embed = buildEmbed(
        "Target Voice Movement",
        `User <@${targetId}> moved voice channels.`,
        newChannel ? 0x57F287 : 0xED4245,
        fields
    );

    await sendWebhook(state.webhookUrl, embed);

    if (state.followEnabled && newChannel) {
        const selfVoice = client.voice?.states?.cache?.get(client.user.id);
        if (selfVoice) {
            try {
                const channel = await client.channels.fetch(newChannel);
                if (channel && channel.isVoice()) {
                    await channel.join();
                    const followEmbed = buildEmbed("Auto-Follow Executed", `Joined ${newName}.`, 0xFEE75C);
                    await sendWebhook(state.webhookUrl, followEmbed);
                }
            } catch (e) {
                const errEmbed = buildEmbed("Auto-Follow Failed", `Could not join ${newName}: ${e.message}`, 0xED4245);
                await sendWebhook(state.webhookUrl, errEmbed);
            }
        }
    }
}

async function captureVCMessages(client, channelId) {
    if (!channelId) return [];
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isText()) return [];
        const messages = await channel.messages.fetch({ limit: 15 });
        return Array.from(messages.values()).reverse().map(m => ({
            author: m.author.username,
            content: m.content,
            time: m.createdAt.toISOString()
        }));
    } catch (_) {
        return [];
    }
}

const VcShadow = {
    name: "VC Shadow",
    description: "Passive voice-state movement tracker with webhook logging.",
    color: 0x5865F2,

    onStart() {
        this._onVoiceUpdate = async (oldState, newState) => {
            const client = window.Enmity?.native?.client || window.DiscordNative?.client;
            if (!client) return;
            await logVoiceMove(client, oldState, newState);
        };

        const client = window.Enmity?.native?.client || window.DiscordNative?.client;
        if (client) {
            client.on("voiceStateUpdate", this._onVoiceUpdate);
        }
    },

    onStop() {
        const client = window.Enmity?.native?.client || window.DiscordNative?.client;
        if (client && this._onVoiceUpdate) {
            client.off("voiceStateUpdate", this._onVoiceUpdate);
        }
        state.active = false;
        state.followEnabled = false;
    },

    getSettingsPanel() {
        const panels = window.Enmity.components;

        return React.createElement(React.Fragment, null,
            React.createElement(panels.FormSection, { title: "Target Configuration" },
                React.createElement(panels.FormInput, {
                    title: "Target User ID",
                    value: state.targetId,
                    onChange: (v) => { state.targetId = v; },
                    placeholder: "123456789012345678"
                }),
                React.createElement(panels.FormInput, {
                    title: "Webhook URL",
                    value: state.webhookUrl,
                    onChange: (v) => { state.webhookUrl = v; },
                    placeholder: "https://discord.com/api/webhooks/..."
                })
            ),
            React.createElement(panels.FormSection, { title: "Tracking Controls" },
                React.createElement(panels.FormSwitch, {
                    title: "Enable Tracking",
                    value: state.active,
                    onChange: (v) => {
                        state.active = v;
                        Toast.open({ content: v ? "VC Shadow Active" : "VC Shadow Deactivated", source: 1 });
                    }
                }),
                React.createElement(panels.FormSwitch, {
                    title: "Auto-Follow Target (Requires you to be in a VC)",
                    value: state.followEnabled,
                    onChange: (v) => {
                        state.followEnabled = v;
                        Toast.open({ content: v ? "Auto-Follow Enabled" : "Auto-Follow Disabled", source: 1 });
                    }
                })
            ),
            React.createElement(panels.FormSection, { title: "Diagnostics" },
                React.createElement(panels.FormButton, {
                    text: "Test Webhook",
                    onPress: async () => {
                        if (!state.webhookUrl) {
                            Toast.open({ content: "Set a webhook URL first.", source: 1 });
                            return;
                        }
                        const testEmbed = buildEmbed(
                            "Webhook Test Successful",
                            "VC Shadow pipeline is operational. Passive capture only.",
                            0x57F287,
                            [
                                { name: "Target ID", value: state.targetId || "Not Set", inline: true },
                                { name: "Auto-Follow", value: state.followEnabled ? "Active" : "Inactive", inline: true }
                            ]
                        );
                        await sendWebhook(state.webhookUrl, testEmbed);
                        Toast.open({ content: "Test sent.", source: 1 });
                    }
                }),
                React.createElement(panels.FormButton, {
                    text: "Fetch Target's Current VC Chat",
                    onPress: async () => {
                        if (!state.targetId) {
                            Toast.open({ content: "Set a target ID first.", source: 1 });
                            return;
                        }
                        const client = window.Enmity?.native?.client || window.DiscordNative?.client;
                        if (!client) return;

                        const targetVoice = client.voice?.states?.cache?.get(state.targetId);
                        if (!targetVoice || !targetVoice.channelId) {
                            Toast.open({ content: "Target is not in a VC.", source: 1 });
                            return;
                        }

                        const messages = await captureVCMessages(client, targetVoice.channelId);
                        if (messages.length === 0) {
                            Toast.open({ content: "No messages found or channel is not text-capable.", source: 1 });
                            return;
                        }

                        const chatLog = messages.map(m => `[${new Date(m.time).toLocaleTimeString()}] ${m.author}: ${m.content}`).join("\n");
                        const chatEmbed = buildEmbed(
                            "VC Chat Capture",
                            `Last ${messages.length} messages in target's VC.`,
                            0xFEE75C,
                            [{ name: "Log", value: chatLog.substring(0, 1024), inline: false }]
                        );
                        await sendWebhook(state.webhookUrl, chatEmbed);
                        Toast.open({ content: "VC Chat sent to webhook.", source: 1 });
                    }
                })
            )
        );
    }
};

module.exports = createPlugin(VcShadow);
