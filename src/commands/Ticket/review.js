import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';

import reviewDashboard from './modules/review_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName("review")
        .setDescription("View and manage ticket reviews from customers.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Open the ticket review dashboard to view customer feedback and ratings"),
        ),
    category: "ticket",

    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) {
            return;
        }

        const guildId = interaction.guild.id;
        const guildConfig = await getGuildConfig(client, guildId);

        // Check if user has staff role or manage permissions
        const staffRole = guildConfig.ticketStaffRoleId;
        if (!interaction.member.roles.cache.has(staffRole) && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            logger.warn('Review dashboard permission denied', {
                userId: interaction.user.id,
                guildId: guildId,
                commandName: 'review_dashboard'
            });
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'You need the staff role or `Manage Channels` permission to access the review dashboard.'
            });
        }

        if (!guildConfig.ticketPanelChannelId) {
            throw new TitanBotError(
                'Ticket system not configured',
                ErrorTypes.CONFIGURATION,
                'The ticket system has not been set up yet. Run `/ticket setup` first to configure it.',
            );
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "dashboard") {
            return reviewDashboard.execute(interaction, config, client);
        }
    }
};
