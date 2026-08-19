// src/utils/ticketLogging.js — PART 1 OF 2

import { ChannelType, AttachmentBuilder } from 'discord.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { logger } from '../logger.js';
import {
  buildStandardLogEmbed,
  formatRatingStars,
  resolveUserAuthor,
} from '../logging/logEmbeds.js';

/**
 * Generates a non-coder friendly plaintext transcript from channel messages.
 * Integrates direct database metadata parameters if available.
 */
export function generateCleanTranscript(ticketData, messages) {
  const { 
    ticketNumber, 
    creatorTag, 
    creatorId, 
    claimerTag, 
    closerTag, 
    rating, 
    comment 
  } = ticketData;

  let content = `==================================================\n`;
  content += `                TICKET TRANSCRIPT                 \n`;
  content += `==================================================\n\n`;
  
  content += `[TICKET INFORMATION]\n`;
  content += `• Ticket Identifier: #${ticketNumber || 'Unknown'}\n`;
  content += `• Opened By:         ${creatorTag ? `${creatorTag} (${creatorId || 'N/A'})` : 'Unknown User'}\n`;
  content += `• Handled/Claimed By: ${claimerTag || 'Not Claimed / Shared Queue'}\n`;
  content += `• Closed By:         ${closerTag || 'System / Automated'}\n\n`;

  content += `[USER REVIEW & FEEDBACK]\n`;
  if (rating) {
    const starTotal = Number(rating) || 0;
    content += `• Rating Given:      ${'★'.repeat(starTotal)}${'☆'.repeat(Math.max(0, 5 - starTotal))} (${starTotal}/5)\n`;
    content += `• Feedback Comment:  "${comment || 'No written response left.'}"\n\n`;
  } else {
    content += `• Rating Status:     No evaluation or review form was filled for this ticket.\n\n`;
  }

  content += `==================================================\n`;
  content += `                 MESSAGE HISTORY                  \n`;
  content += `==================================================\n\n`;

  const sortedMessages = Array.from(messages.values()).reverse();

  for (const msg of sortedMessages) {
    if (msg.system && !msg.content) continue;

    const timestamp = msg.createdAt.toLocaleString('en-US', {
      dateStyle: 'short',
      timeStyle: 'medium'
    });

    const authorDisplay = msg.author.bot ? `[BOT] ${msg.author.tag}` : msg.author.tag;
    
    content += `[${timestamp}] ${authorDisplay}:\n`;
    
    if (msg.content) {
      content += `  ${msg.content}\n`;
    }

    if (msg.attachments && msg.attachments.size > 0) {
      msg.attachments.forEach(file => {
        content += `  [ATTACHED FILE OR MEDIA URL: ${file.url}]\n`;
      });
    }

    content += `\n`; 
  }

  content += `==================================================\n`;
  content += `                END OF TRANSCRIPT                 \n`;
  content += `==================================================\n`;

  const fileBuffer = Buffer.from(content, 'utf-8');
  return new AttachmentBuilder(fileBuffer, { name: `transcript-ticket-${ticketNumber || 'log'}.txt` });
}

export async function logTicketEvent({ client, guildId, event }) {
  try {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      logger.warn(`logTicketEvent invoked without valid guild: ${guildId}`);
      return;
    }

    // -------------------------------------------------------------
    // DATABASE TRACKING SYNC
    // -------------------------------------------------------------
    if (client.db && event.ticketId) {
      const ticketRef = event.ticketNumber || event.ticketId;
      
      if (event.type === 'open') {
        await client.db.query(
          'INSERT INTO ticket_reviews (guild_id, ticket_name, opened_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [guildId, `ticket-${ticketRef}`, event.userId]
        ).catch(err => logger.error('DB Error tracking ticket open:', err));
      } 
      else if (event.type === 'claim') {
        await client.db.query(
          'UPDATE ticket_reviews SET claimed_by = $1 WHERE guild_id = $2 AND ticket_name = $3',
          [event.executorId, guildId, `ticket-${ticketRef}`]
        ).catch(err => logger.error('DB Error tracking ticket claim:', err));
      } 
      else if (event.type === 'close') {
        await client.db.query(
          'UPDATE ticket_reviews SET closed_by = $1 WHERE guild_id = $2 AND ticket_name = $3',
          [event.executorId, guildId, `ticket-${ticketRef}`]
        ).catch(err => logger.error('DB Error tracking ticket close:', err));
      }
    }

    const config = await getGuildConfig(client, guildId);

    const logChannelId = getLogChannelForEventType(config, event.type);
    if (!logChannelId) {
      return;
    }

    const channel = guild.channels.cache.get(logChannelId) || await guild.channels.fetch(logChannelId).catch(() => null);
    if (!channel) {
      logger.warn(`Ticket log channel not found: ${logChannelId} for event type: ${event.type}`);
      return;
    }

    const permissions = channel.permissionsFor(guild.members.me);
    if (!permissions.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn(`Missing permissions in ticket log channel: ${logChannelId}`);
      return;
    }

    let activeAttachments = event.attachments || [];
    let updatedMetadata = { ...event.metadata };

    if (event.type === 'transcript' && event.ticketId) {
      const targetChannel = guild.channels.cache.get(event.ticketId) || await guild.channels.fetch(event.ticketId).catch(() => null);
      
      if (targetChannel && targetChannel.isTextBased()) {
        const structuralMessages = await targetChannel.messages.fetch({ limit: 100 }).catch(() => null);
        
        if (structuralMessages && structuralMessages.size > 0) {
          updatedMetadata.messageCount = structuralMessages.size;
          
          let creatorUser = event.userId ? await client.users.fetch(event.userId).catch(() => null) : null;
          let executorUser = event.executorId ? await client.users.fetch(event.executorId).catch(() => null) : null;
          
          let dbRating = event.metadata?.rating;
          let dbComment = event.metadata?.comment;
          let dbClaimedBy = event.metadata?.claimerId;

          if (client.db) {
            const dbResult = await client.db.query(
              'SELECT claimed_by, rating, comment FROM ticket_reviews WHERE guild_id = $1 AND ticket_name = $2',
              [guildId, `ticket-${event.ticketNumber || targetChannel.name}`]
            ).catch(() => null);

            if (dbResult && dbResult.rows.length > 0) {
              const row = dbResult.rows[0];
              if (dbRating === undefined) dbRating = row.rating;
              if (dbComment === undefined) dbComment = row.comment;
              if (dbClaimedBy === undefined) dbClaimedBy = row.claimed_by;
            }
          }

          let claimerUser = dbClaimedBy ? await client.users.fetch(dbClaimedBy).catch(() => null) : null;

          const contextData = {
            ticketNumber: event.ticketNumber || targetChannel.name,
            creatorTag: creatorUser?.tag,
            creatorId: creatorUser?.id,
            claimerTag: claimerUser?.tag,
            closerTag: executorUser?.tag,
            rating: dbRating,
            comment: dbComment
          };

          const textFileAttachment = generateCleanTranscript(contextData, structuralMessages);
          activeAttachments.push(textFileAttachment);
        }
      }
    }

    const embed = await createTicketLogEmbed(guild, { ...event, metadata: updatedMetadata });
    const messageOptions = { embeds: [embed] };

    if (activeAttachments.length > 0) {
      messageOptions.files = activeAttachments;
    }

    await channel.send(messageOptions);
    logger.info(`Ticket event logged: ${event.type} in guild ${guildId}`);
  } catch (error) {
    logger.error('Error logging ticket event:', error);
  }
}

export async function logTicketFeedback({
  client,
  guildId,
  ticketNumber,
  ticketChannelId,
  userId,
  rating = null,
  comment = null,
  skipped = false
}) {
  if (client.db) {
    const ticketLabel = `ticket-${ticketNumber || ticketChannelId}`;
    try {
      await client.db.query(
        'UPDATE ticket_reviews SET rating = $1, comment = $2, skipped = $3 WHERE guild_id = $4 AND ticket_name = $5',
        [rating, comment, skipped, guildId, ticketLabel]
      );
    } catch (dbErr) {
      logger.error('Database adjustment error during prompt close tracking transaction:', dbErr);
    }
  }

  if (!skipped) {
    await logTicketEvent({
      client,
      guildId,
      event: {
        type: 'feedback',
        ticketId: ticketChannelId,
        ticketNumber,
        userId,
        metadata: { rating, comment },
      },
    });
  }
}
Here is Part 2 of 2 of the updated code.
Paste this block directly below Part 1 to complete your file:

// src/utils/ticketLogging.js — PART 2 OF 2
function getLogChannelForEventType(config, eventType) {
  switch (eventType) {
    case 'transcript':
      return config.ticketTranscriptChannelId || null;
    case 'open':
    case 'close':
    case 'delete':
    case 'claim':
    case 'unclaim':
    case 'priority':
    case 'pin':
    case 'unpin':
    case 'feedback':
      return config.ticketLogsChannelId || null;
    default:
      return null;
  }
}
const TICKET_EVENT_STYLES = {
  open: { color: 0x5865F2, title: 'Ticket Created' },
  close: { color: 0xED4245, title: 'Ticket Closed' },
  delete: { color: 0x8b0000, title: 'Ticket Deleted' },
  claim: { color: 0x5865F2, title: 'Ticket Claimed' },
  unclaim: { color: 0xFAA61A, title: 'Ticket Unclaimed' },
  priority: { color: 0x9b59b6, title: 'Priority Updated' },
  transcript: { color: 0x57F287, title: 'Transcript Generated' },
  feedback: { color: 0x57F287, title: 'Feedback Received' },
};
async function createTicketLogEmbed(guild, event) {
  const style = TICKET_EVENT_STYLES[event.type] || { color: 0x95a5a6, title: 'Ticket Event' };
  const ticketNumber = event.ticketNumber || event.ticketId;
  const ticketRef = ticketNumber ? `#${ticketNumber}` : 'Unknown';
  const channelMention = event.ticketId ? `<#${event.ticketId}>` : null;
  const executorMention = event.executorId ? `<@${event.executorId}>` : null;
  const userMention = event.userId ? `<@${event.userId}>` : null;

  let inlineFields = [];
  let fields = [];
  let author = null;
  let footer = null; // Branding completely removed

  switch (event.type) {
    case 'open':
      author = await resolveUserAuthor(guild.client, event.userId);
      inlineFields = [
        { name: 'Ticket', value: ticketRef, inline: true },
        { name: 'Creator', value: userMention || 'Unknown', inline: true },
      ];
      if (channelMention) inlineFields.push({ name: 'Channel', value: channelMention, inline: true });
      if (event.reason) fields.push({ name: 'Reason', value: String(event.reason).slice(0, 1024), inline: false });
      break;

    case 'close':
      author = await resolveUserAuthor(guild.client, event.executorId);
      inlineFields = [
        { name: 'Ticket', value: ticketRef, inline: true },
        { name: 'Closed by', value: executorMention || 'Unknown', inline: true },
      ];
      if (channelMention) inlineFields.push({ name: 'Channel', value: channelMention, inline: true });
      if (event.reason) fields.push({ name: 'Reason', value: String(event.reason).slice(0, 1024), inline: false });
      break;

    case 'delete':
      author = await resolveUserAuthor(guild.client, event.executorId);
      inlineFields = [
        { name: 'Ticket', value: ticketRef, inline: true },
        { name: 'Deleted by', value: executorMention || 'Unknown', inline: true },
      ];
      break;

    case 'claim':
    case 'unclaim':
      author = await resolveUserAuthor(guild.client, event.executorId);
      inlineFields = [
        { name: 'Ticket', value: ticketRef, inline: true },
        { name: event.type === 'claim' ? 'Claimed by' : 'Unclaimed by', value: executorMention || 'Unknown', inline: true },
      ];
      break;

    case 'priority': {
      // Updated layout mapping requirements
      const priorityEmojis = { urgent: '🚨', high: '🔴', medium: '🟡', low: '🟢' };
      const priorityLabel = event.priority
        ? `${priorityEmojis[event.priority] || '⚪'} ${event.priority.charAt(0).toUpperCase()}${event.priority.slice(1)}`
        : 'Unknown';
      author = await resolveUserAuthor(guild.client, event.executorId);
      inlineFields = [
        { name: 'Ticket', value: ticketRef, inline: true },
        { name: 'Priority', value: priorityLabel, inline: true },
        { name: 'Updated by', value: executorMention || 'Unknown', inline: true },
      ];
      break;
    }

    case 'transcript':
      inlineFields = [
        { name: 'Ticket', value: ticketRef, inline: true },
        { name: 'Creator', value: userMention || 'Unknown', inline: true },
      ];
      if (event.metadata?.messageCount) inlineFields.push({ name: 'Messages', value: String(event.metadata.messageCount), inline: true });
      if (event.metadata?.duration) fields.push({ name: 'Duration', value: String(event.metadata.duration), inline: false });
      if (event.metadata?.subject || event.reason) {
        fields.push({ name: 'Subject', value: String(event.metadata?.subject || event.reason).slice(0, 1024), inline: false });
      }
      break;

    case 'feedback': {
      const rating = event.metadata?.rating ?? event.rating;
      const comment = event.metadata?.comment;
      const ratingDisplay = formatRatingStars(rating) || 'No rating';
      author = await resolveUserAuthor(guild.client, event.userId);
      inlineFields = [
        { name: 'Ticket', value: ticketRef, inline: true },
        { name: 'Rating', value: ratingDisplay, inline: true },
      ];
      if (comment) fields.push({ name: 'Comment', value: String(comment).slice(0, 1024), inline: false });
      break;
    }

    default:
      inlineFields = [{ name: 'Ticket', value: ticketRef, inline: true }];
      if (event.reason) fields.push({ name: 'Details', value: String(event.reason).slice(0, 1024), inline: false });
  }

  const titlePrefix = event.type === 'feedback' ? '⭐ ' : '';
  return buildStandardLogEmbed({
    color: style.color,
    title: `${titlePrefix}${style.title}`,
    inlineFields,
    fields,
    author,
    footer,
  });
}
export async function getTicketLoggingConfig(client, guildId) {
  const config = await getGuildConfig(client, guildId);
  return {
    enabled: !!(config.ticketLogsChannelId || config.ticketTranscriptChannelId),
    lifecycleChannelId: config.ticketLogsChannelId || null,
    transcriptChannelId: config.ticketTranscriptChannelId || null,
  };
}
export function validateLogChannel(channel, botMember) {
  if (!channel || channel.type !== ChannelType.GuildText) {
    return { valid: false, error: 'Channel must be a text channel.' };
  }
  const permissions = channel.permissionsFor(botMember);
  const requiredPermissions = ['SendMessages', 'EmbedLinks'];
  const missing = requiredPermissions.filter((perm) => !permissions.has(perm));
  if (missing.length > 0) {
    return { valid: false, error: `Missing permissions: ${missing.join(', ')}` };
  }
  return { valid: true };
}


