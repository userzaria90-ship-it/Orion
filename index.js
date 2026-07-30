require('dotenv').config();
const express = require("express");
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionsBitField,
    WebhookClient
} = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot online ✅"));
app.listen(PORT, () => console.log(`🌐 Serveur lancé sur le port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: ['CHANNEL']
});

const categories = {
    product:       '1514965065458253834',
    remboursement: '1514965203253592136',
    question:      '1514965769124053082',
};

const ROLE_MODERATEUR = '1514955553674362941';
const ROLE_SUPPORT    = '1514964251754889347';

const ticketByChannel = new Map();
const ticketByUser    = new Map();

client.once('ready', () => {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // ── Relay DM joueur → salon ticket ──
    if (!message.guild) {
        const channelId = ticketByUser.get(message.author.id);
        if (!channelId) return;

        const ticketChannel = client.channels.cache.get(channelId);
        if (!ticketChannel) return;

        const files = message.attachments.map(a => a.url);
        await ticketChannel.send({
            content: `**${message.author.username}** : ${message.content}`,
            files
        });
        return;
    }

    // ── Commande panel ──
    if (message.content === '!panel') {
        const embed = new EmbedBuilder()
            .setTitle('🛒 Support Product')
            .setDescription('Choisissez une catégorie ci-dessous.')
            .setColor('Blue');

        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket_select')
            .setPlaceholder('Choisir une catégorie')
            .addOptions([
                { label: 'product',                value: 'product',       emoji: '🛒' },
                { label: 'Remboursement',          value: 'remboursement', emoji: '🔄' },
                { label: 'Question / Autre',       value: 'question',      emoji: '❓' },
            ]);

        const row = new ActionRowBuilder().addComponents(menu);
        await message.channel.send({ embeds: [embed], components: [row] });
        return;
    }

    // ── Relay staff salon ticket → DM joueur ──
    // Le bot envoie avec son propre avatar, username = "Rôle - Pseudo"
    if (message.guild) {
        const ticketData = ticketByChannel.get(message.channel.id);
        if (!ticketData) return;

        let owner;
        try {
            owner = await client.users.fetch(ticketData.userId);
        } catch {
            return;
        }

        const topRole = message.member?.roles.cache
            .filter(r => r.id !== message.guild.id)
            .sort((a, b) => b.position - a.position)
            .first()?.name ?? 'Staff';

        const files = message.attachments.map(a => a.url);

        try {
            await owner.send({
                content: `**${topRole} - ${message.member.displayName}** : ${message.content}`,
                files
            });
        } catch {}
    }
});

client.on('interactionCreate', async interaction => {

    // ── Création ticket ──
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId !== 'ticket_select') return;

        await interaction.deferReply({ ephemeral: true });

        const category = interaction.values[0];

        if (ticketByUser.has(interaction.user.id)) {
            const existingId = ticketByUser.get(interaction.user.id);
            const existing = interaction.guild.channels.cache.get(existingId);
            return interaction.editReply({
                content: `❌ Vous avez déjà un ticket ouvert : ${existing ?? 'salon introuvable'}`
            });
        }

        const channel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            parent: categories[category],
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: ROLE_MODERATEUR,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                },
                {
                    id: ROLE_SUPPORT,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ]
        });

        ticketByChannel.set(channel.id, { userId: interaction.user.id, category });
        ticketByUser.set(interaction.user.id, channel.id);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Fermer')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger)
        );

        const staffEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🎫 Nouveau ticket')
            .setDescription(
                `**Ouvreur :** ${interaction.user} (${interaction.user.tag})\n**Catégorie :** ${category}\n\nLes messages du joueur arrivent ici en relay.\nRépondez directement dans ce salon pour qu'il reçoive votre réponse en DM.`
            )
            .setFooter({ text: 'Support 🔥', iconURL: interaction.guild.iconURL() ?? undefined })
            .setTimestamp();

        await channel.send({ embeds: [staffEmbed], components: [buttons] });

        const dmEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🎫 Votre ticket est ouvert !')
            .setDescription(
                `Bonjour **${interaction.user.username}** !\n\nVotre ticket a bien été créé — **écrivez vos messages ici directement**, le staff vous répondra via ce DM.\n\n> Catégorie : **${category}**`
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() ?? undefined })
            .setTimestamp();

        try {
            await interaction.user.send({ embeds: [dmEmbed] });
        } catch {
            await channel.send({
                content: `⚠️ Impossible d'envoyer un DM à ${interaction.user} — ses messages privés sont fermés.`
            });
        }

        await interaction.editReply({ content: `✅ Ticket créé : ${channel}` });
    }

    // ── Fermeture ticket ──
    if (interaction.isButton() && interaction.customId === 'close_ticket') {

        const ticketNumber = Math.floor(10000 + Math.random() * 90000);
        const ticketData = ticketByChannel.get(interaction.channel.id);

        const logEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('🔒 Ticket fermé')
            .setDescription(
                `Le ticket **#${ticketNumber}** a été supprimé par le staff : ${interaction.user} !`
            )
            .setFooter({ text: 'Support 🔥', iconURL: interaction.guild.iconURL() ?? undefined })
            .setTimestamp();

        await interaction.channel.send({ content: `${interaction.user}`, embeds: [logEmbed] });

        await interaction.reply({
            content: '🔒 Fermeture du ticket dans 5 secondes...',
            ephemeral: true
        });

        if (ticketData) {
            try {
                const owner = await client.users.fetch(ticketData.userId);
                const dmCloseEmbed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('🔒 Votre ticket a été fermé')
                    .setDescription(
                        `Bonjour **${owner.username}** !\n\nVotre ticket **#${ticketNumber}** a été fermé par un membre du staff.\n\n> Si vous avez d'autres questions, ouvrez un nouveau ticket depuis le serveur.`
                    )
                    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() ?? undefined })
                    .setTimestamp();

                await owner.send({ embeds: [dmCloseEmbed] });
            } catch {}

            ticketByUser.delete(ticketData.userId);
            ticketByChannel.delete(interaction.channel.id);
        }

        setTimeout(async () => {
            try {
                await interaction.channel.delete();
            } catch (err) {
                console.error('Erreur suppression ticket :', err);
            }
        }, 5000);
    }
});

client.login(process.env.TOKEN);
