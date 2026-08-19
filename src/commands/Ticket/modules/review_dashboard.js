import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, infoEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { getGuildConfig } from '../../../services/config/guildConfig.js';
import { startDashboardSession } from '../../../utils/dashboardSession.js';

export default {
    prefixOnly: false,
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);

            if (!guildConfig.ticketPanelChannelId) {
                throw new TitanBotError(
                    'Ticket system not configured',
                    ErrorTypes.CONFIGURATION,
                    'The ticket system has not been set up yet. Run `/ticket setup` first to configure it.',
                );
            }

            const staffRole = guildConfig.ticketStaffRoleId;
            if (!interaction.member.roles.cache.has(staffRole) && !interaction.member.permissions.has('ManageGuild')) {
                throw new TitanBotError(
                    'Insufficient Permissions',
                    ErrorTypes.PERMISSION,
                    'Only staff members can access the review dashboard.',
                );
            }

            const selectRow = new ActionRowBuilder().addComponents(buildReviewSelectMenu(guildId));

            await startDashboardSession({
                interaction,
                embeds: [buildReviewDashboardEmbed()],
                components: [selectRow],
                selectMenuId: `ticket_review_${guildId}`,
                buttonMatcher: () => false,
                onSelect: async (selectInteraction) => {
                    const selectedOption = selectInteraction.values[0];
                    switch (selectedOption) {
                        case 'all_reviews':
                            await handleAllReviews(selectInteraction, interaction, guildId, client);
                            break;
                        case 'staff_reviews':
                            await handleStaffReviews(selectInteraction, interaction, guildId, client);
                            break;
                        case 'pending_reviews':
                            await handlePendingReviews(selectInteraction, interaction, guildId, client);
                            break;
                    }
                },
                onButton: async () => {},
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in review_dashboard:', error);
            throw new TitanBotError(
                `Review dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the review dashboard.',
            );
        }
    },
};

function buildReviewSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`ticket_review_${guildId}`)
        .setPlaceholder('Select a review option...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('All Reviews')
                .setDescription('View all ticket reviews and ratings')
                .setValue('all_reviews')
                .setEmoji('📊'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Filter by Staff')
                .setDescription('View reviews for a specific staff member')
                .setValue('staff_reviews')
                .setEmoji('👤'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Pending Reviews')
                .setDescription('View tickets awaiting feedback from users')
                .setValue('pending_reviews')
                .setEmoji('⏳'),
        );
}

function buildReviewDashboardEmbed() {
    return new EmbedBuilder()
        .setTitle('⭐ Ticket Review Dashboard')
        .setDescription('View and manage ticket reviews from customers.')
        .setColor(getColor('info'))
        .addFields(
            { name: '📊 All Reviews', value: 'View every ticket review and rating across the server.', inline: false },
            { name: '👤 Filter by Staff', value: 'View reviews for a specific staff member who handled tickets.', inline: false },
            { name: '⏳ Pending Reviews', value: 'See tickets that are awaiting customer feedback.', inline: false },
        )
        .setFooter({ text: 'Select an option below • Dashboard closes after 10 minutes of inactivity' })
        .setTimestamp();
}

async function handleAllReviews(selectInteraction, rootInteraction, guildId, client) {
    await selectInteraction.deferUpdate();

    try {
        const { pgConfig } = await import('../../../config/database/postgres.js');
        if (!client.db?.db?.pool || typeof client.db.db.isAvailable !== 'function' || !client.db.db.isAvailable()) {
            throw new Error('Database not available');
        }

        const result = await client.db.db.pool.query(
            `SELECT * FROM ${pgConfig.tables.ticketReviews} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [guildId]
        );

        const reviews = result.rows;

        if (reviews.length === 0) {
            await selectInteraction.followUp({
                embeds: [infoEmbed('No Reviews', 'There are no reviews yet.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const embeds = [];
        for (let i = 0; i < Math.min(reviews.length, 5); i++) {
            const review = reviews[i];
            const user = await client.users.fetch(review.user_id).catch(() => null);
            const closedBy = await client.users.fetch(review.closed_by).catch(() => null);
            const claimedBy = await client.users.fetch(review.claimed_by).catch(() => null);

            embeds.push(
                new EmbedBuilder()
                    .setTitle(`Ticket #${review.ticket_id}`)
                    .setColor(getColor('info'))
                    .addFields(
                        { name: 'Opened By', value: user ? `${user.username}` : 'Unknown User', inline: true },
                        { name: 'Rating', value: `${review.rating}/5 ⭐`, inline: true },
                        { name: 'Claimed By', value: claimedBy ? `${claimedBy.username}` : 'Unclaimed', inline: true },
                        { name: 'Closed By', value: closedBy ? `${closedBy.username}` : 'Unknown', inline: true },
                        { name: 'Comment', value: review.comment || 'No comment provided', inline: false },
                    )
            );
        }

        await selectInteraction.followUp({
            embeds: embeds.length > 0 ? embeds : [infoEmbed('No Reviews', 'There are no reviews yet.')],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.error('Error fetching all reviews:', error);
        await replyUserError(selectInteraction, {
            type: ErrorTypes.UNKNOWN,
            message: 'Failed to fetch reviews.',
        });
    }
}

async function handleStaffReviews(selectInteraction, rootInteraction, guildId, client) {
    await selectInteraction.deferUpdate();

    const userSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('ticket_staff_filter')
            .setPlaceholder('Select a staff member...')
    );

    try {
        const { pgConfig } = await import('../../../config/database/postgres.js');
        if (!client.db?.db?.pool || typeof client.db.db.isAvailable !== 'function' || !client.db.db.isAvailable()) {
            throw new Error('Database not available');
        }

        const result = await client.db.db.pool.query(
            `SELECT DISTINCT closed_by FROM ${pgConfig.tables.ticketReviews} WHERE guild_id = $1 AND closed_by IS NOT NULL`,
            [guildId]
        );

        const staffMembers = result.rows;

        if (staffMembers.length === 0) {
            await selectInteraction.followUp({
                embeds: [infoEmbed('No Reviews', 'No staff members have closed tickets yet.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const options = [];
        for (const staff of staffMembers.slice(0, 25)) {
            const user = await client.users.fetch(staff.closed_by).catch(() => null);
            if (user) {
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(user.username)
                        .setValue(staff.closed_by)
                );
            }
        }

        if (options.length === 0) {
            await selectInteraction.followUp({
                embeds: [infoEmbed('No Reviews', 'Could not fetch staff members.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        userSelect.components[0].addOptions(...options);

        await selectInteraction.followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle('👤 Filter Reviews by Staff')
                    .setDescription('Select a staff member to view their reviews.')
                    .setColor(getColor('info')),
            ],
            components: [userSelect],
            flags: MessageFlags.Ephemeral,
        });

        const collector = rootInteraction.channel.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: i =>
                i.user.id === selectInteraction.user.id && i.customId === 'ticket_staff_filter',
            time: 60_000,
            max: 1,
        });

        collector.on('collect', async staffInteraction => {
            await staffInteraction.deferUpdate();
            const staffId = staffInteraction.values[0];

            const staffResult = await client.db.db.pool.query(
                `SELECT * FROM ${pgConfig.tables.ticketReviews} WHERE guild_id = $1 AND closed_by = $2 ORDER BY created_at DESC LIMIT 50`,
                [guildId, staffId]
            );

            const reviews = staffResult.rows;
            const staffUser = await client.users.fetch(staffId).catch(() => null);

            if (reviews.length === 0) {
                await staffInteraction.followUp({
                    embeds: [infoEmbed('No Reviews', `${staffUser?.username || 'This staff member'} has no reviews yet.`)],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const embeds = [];
            for (let i = 0; i < Math.min(reviews.length, 5); i++) {
                const review = reviews[i];
                const user = await client.users.fetch(review.user_id).catch(() => null);
                const claimedBy = await client.users.fetch(review.claimed_by).catch(() => null);

                embeds.push(
                    new EmbedBuilder()
                        .setTitle(`Ticket #${review.ticket_id}`)
                        .setColor(getColor('info'))
                        .addFields(
                            { name: 'Opened By', value: user ? `${user.username}` : 'Unknown User', inline: true },
                            { name: 'Rating', value: `${review.rating}/5 ⭐`, inline: true },
                            { name: 'Claimed By', value: claimedBy ? `${claimedBy.username}` : 'Unclaimed', inline: true },
                            { name: 'Comment', value: review.comment || 'No comment provided', inline: false },
                        )
                );
            }

            await staffInteraction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`⭐ Reviews for ${staffUser?.username || 'Unknown'}`)
                        .setColor(getColor('success'))
                        .setDescription(`Total reviews: ${reviews.length}`),
                    ...embeds,
                ],
                flags: MessageFlags.Ephemeral,
            });
        });

        collector.on('end', (collected) => {
            if (collected.size === 0) {
                selectInteraction.followUp({
                    embeds: [infoEmbed('Cancelled', 'No staff member was selected.')],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
        });
    } catch (error) {
        logger.error('Error fetching staff reviews:', error);
        await replyUserError(selectInteraction, {
            type: ErrorTypes.UNKNOWN,
            message: 'Failed to fetch staff members.',
        });
    }
}

async function handlePendingReviews(selectInteraction, rootInteraction, guildId, client) {
    await selectInteraction.deferUpdate();

    try {
        const { pgConfig } = await import('../../../config/database/postgres.js');
        if (!client.db?.db?.pool || typeof client.db.db.isAvailable !== 'function' || !client.db.db.isAvailable()) {
            throw new Error('Database not available');
        }

        const result = await client.db.db.pool.query(
            `SELECT * FROM ${pgConfig.tables.tickets} WHERE guild_id = $1 AND status = 'closed' AND reviewed = false ORDER BY closed_at DESC LIMIT 50`,
            [guildId]
        );

        const pendingTickets = result.rows;

        if (pendingTickets.length === 0) {
            await selectInteraction.followUp({
                embeds: [infoEmbed('All Reviewed', 'All closed tickets have been reviewed.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const embeds = [];
        for (let i = 0; i < Math.min(pendingTickets.length, 5); i++) {
            const ticket = pendingTickets[i];
            const user = await client.users.fetch(ticket.user_id).catch(() => null);
            const closedBy = await client.users.fetch(ticket.closed_by).catch(() => null);
            const claimedBy = await client.users.fetch(ticket.claimed_by).catch(() => null);

            embeds.push(
                new EmbedBuilder()
                    .setTitle(`Ticket #${ticket.ticket_id}`)
                    .setColor(getColor('warning'))
                    .addFields(
                        { name: 'Opened By', value: user ? `${user.username}` : 'Unknown User', inline: true },
                        { name: 'Status', value: '⏳ Awaiting Review', inline: true },
                        { name: 'Claimed By', value: claimedBy ? `${claimedBy.username}` : 'Unclaimed', inline: true },
                        { name: 'Closed By', value: closedBy ? `${closedBy.username}` : 'Unknown', inline: true },
                    )
            );
        }

        await selectInteraction.followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⏳ Pending Reviews')
                    .setColor(getColor('warning'))
                    .setDescription(`${pendingTickets.length} ticket(s) awaiting customer feedback`),
                ...embeds,
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.error('Error fetching pending reviews:', error);
        await replyUserError(selectInteraction, {
            type: ErrorTypes.UNKNOWN,
            message: 'Failed to fetch pending reviews.',
        });
    }
}

// Function to send review DM to user after ticket closes
export async function sendReviewDM(client, userId, ticketId, closedByUser, claimedByUser) {
    try {
        const user = await client.users.fetch(userId);

        const ratingButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_review_rate_1_${ticketId}`)
                .setLabel('1')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`ticket_review_rate_2_${ticketId}`)
                .setLabel('2')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`ticket_review_rate_3_${ticketId}`)
                .setLabel('3')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`ticket_review_rate_4_${ticketId}`)
                .setLabel('4')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`ticket_review_rate_5_${ticketId}`)
                .setLabel('5')
                .setStyle(ButtonStyle.Success),
        );

        const commentButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_review_comment_${ticketId}`)
                .setLabel('Add Comment')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('💬'),
        );

        await user.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⭐ Please Rate Your Support Experience')
                    .setDescription(
                        `Thank you for using our support system! We'd love to hear about your experience.\n\n` +
                        `**Ticket:** #${ticketId}\n` +
                        `**Handled By:** ${closedByUser || 'Unknown'}\n` +
                        `**Claimed By:** ${claimedByUser || 'Unassigned'}\n\n` +
                        `Click a rating below (1-5 stars), and optionally add a comment.`
                    )
                    .setColor(getColor('info')),
            ],
            components: [ratingButtons, commentButton],
        });

        return true;
    } catch (error) {
        logger.error(`Failed to send review DM to user ${userId}:`, error);
        return false;
    }
}

// Function to handle rating button
export async function handleRatingButton(interaction, ticketId, rating, client, guildId) {
    await interaction.deferUpdate();

    try {
        const { pgConfig } = await import('../../../config/database/postgres.js');

        // Store the rating temporarily in user state or database
        await client.db.db.pool.query(
            `INSERT INTO ${pgConfig.tables.ticketReviews} (guild_id, ticket_id, user_id, rating, closed_by, claimed_by, created_at)
             SELECT $1, $2, $3, $4, closed_by, claimed_by, NOW()
             FROM ${pgConfig.tables.tickets}
             WHERE ticket_id = $5
             ON CONFLICT (ticket_id) DO UPDATE SET rating = $4`,
            [guildId, ticketId, interaction.user.id, rating, ticketId]
        );

        const commentButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_review_comment_${ticketId}`)
                .setLabel('Add Comment (Optional)')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('💬'),
            new ButtonBuilder()
                .setCustomId(`ticket_review_submit_${ticketId}`)
                .setLabel('Submit Review')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
        );

        await interaction.followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⭐ Rating Received')
                    .setDescription(`You rated this experience **${rating}/5 stars** ⭐\n\nYou can now add a comment if you'd like.`)
                    .setColor(getColor('success')),
            ],
            components: [commentButton],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.error('Error handling rating:', error);
    }
}

// Function to handle comment modal
export async function handleCommentModal(interaction, ticketId, client, guildId) {
    const modal = new ModalBuilder()
        .setCustomId(`ticket_review_comment_modal_${ticketId}`)
        .setTitle('💬 Add a Comment')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('review_comment_input')
                    .setLabel('Your Feedback')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1000)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('Tell us about your experience...'),
            ),
        );

    await interaction.showModal(modal);

    const submitted = await interaction
        .awaitModalSubmit({
            filter: i =>
                i.customId === `ticket_review_comment_modal_${ticketId}` &&
                i.user.id === interaction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const comment = submitted.fields.getTextInputValue('review_comment_input').trim();

    try {
        const { pgConfig } = await import('../../../config/database/postgres.js');

        await client.db.db.pool.query(
            `UPDATE ${pgConfig.tables.ticketReviews} SET comment = $1 WHERE ticket_id = $2`,
            [comment, ticketId]
        );

        const submitButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_review_submit_${ticketId}`)
                .setLabel('Submit Review')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
        );

        await submitted.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Comment Recorded')
                    .setDescription('Your comment has been saved. Click the button below to submit your review.')
                    .setColor(getColor('success')),
            ],
            components: [submitButton],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.error('Error handling comment:', error);
    }
}

// Function to handle review submission
export async function handleReviewSubmit(interaction, ticketId, client, guildId) {
    await interaction.deferUpdate();

    try {
        const { pgConfig } = await import('../../../config/database/postgres.js');

        await client.db.db.pool.query(
            `UPDATE ${pgConfig.tables.tickets} SET reviewed = true WHERE ticket_id = $1`,
            [ticketId]
        );

        await interaction.followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🎉 Thank You!')
                    .setDescription('Your review has been submitted successfully. We appreciate your feedback!')
                    .setColor(getColor('success')),
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.error('Error submitting review:', error);
    }
}
