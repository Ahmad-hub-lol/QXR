import { PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, updateGuildConfig } from '../services/config/guildConfig.js';
import { logTicketEvent } from './logging/ticketLogging.js';
import { logger } from './logger.js';

// Configuration definitions for our priority levels
export const PRIORITY_LEVELS = {
  low: { emoji: '🟢', name: 'Low' },
  medium: { emoji: '🟡', name: 'Medium' },
  high: { emoji: '🟠', name: 'High' },
  urgent: { emoji: '🚨', name: 'Urgent' }
};

/**
 * Handles processing when a staff member changes a ticket's priority via select menu
 */
export async function handlePrioritySelectMenu(interaction, client) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ 
      content: '❌ You need the `Manage Channels` permission to modify ticket priority tiers.', 
      ephemeral: true 
    });
  }

  const selectedPriority = interaction.values[0]; // low, medium, high, urgent
  const priorityConfig = PRIORITY_LEVELS[selectedPriority];

  if (!priorityConfig) {
    return interaction.reply({ content: '❌ Invalid priority selection mapping.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const guildId = interaction.guildId;
    const channel = interaction.channel;
    const config = await getGuildConfig(client, guildId);

    // 1. Determine target category from server database setup configurations
    let targetCategoryId = null;
    switch (selectedPriority) {
      case 'low': targetCategoryId = config.ticketCategoryLowId; break;
      case 'medium': targetCategoryId = config.ticketCategoryMediumId; break;
      case 'high': targetCategoryId = config.ticketCategoryHighId; break;
      case 'urgent': targetCategoryId = config.ticketCategoryUrgentId; break;
    }

    // Fallback to standard ticket category if specific tier category isn't set up yet
    if (!targetCategoryId) {
      targetCategoryId = config.ticketCategoryId;
    }

    // 2. Clear old prefixes and assign the new requested emoji
    let cleanName = channel.name;
    const allEmojis = Object.values(PRIORITY_LEVELS).map(p => p.emoji);
    
    // Scrub existing tier emojis from channel name
    allEmojis.forEach(emoji => {
      cleanName = cleanName.replace(emoji, '').trim();
    });
    if (cleanName.startsWith('-')) cleanName = cleanName.substring(1);

    const newChannelName = `${priorityConfig.emoji}-${cleanName}`;

    // 3. Apply variations to Discord Channel Structure
    await channel.setName(newChannelName);
    
    if (targetCategoryId) {
      await channel.setParent(targetCategoryId, { lockPermissions: false });
    }

    // 4. Fire the updated ticket log event
    await logTicketEvent({
      client,
      guildId,
      event: {
        type: 'priority',
        ticketId: channel.id,
        ticketNumber: cleanName,
        executorId: interaction.user.id,
        priority: selectedPriority
      }
    });

    return interaction.editReply({ 
      content: `✅ Ticket priority updated to **${priorityConfig.name}** (${priorityConfig.emoji}). Channel updated and repositioned successfully.` 
    });

  } catch (error) {
    logger.error('Failed processing ticket priority migration action block:', error);
    return interaction.editReply({ content: '❌ An operational error occurred while moving the channel or updating names.' });
  }
}
