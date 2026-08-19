import { 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  StringSelectMenuOptionBuilder 
} from 'discord.js';

/**
 * Generates the priority alteration staff button row layout
 */
export function buildPriorityButtonRow() {
  const button = new ButtonBuilder()
    .setCustomId('ticket_action_trigger_priority')
    .setLabel('Change Priority')
    .setEmoji('🚨')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(button);
}

/**
 * Builds the interactive dropdown select selection panel for administrators
 */
export function buildPrioritySelectMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_action_select_priority')
    .setPlaceholder('Modify the ticket urgency level...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('Low Priority')
        .setValue('low')
        .setEmoji('🟢')
        .setDescription('Minor requests or general casual queries.'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Medium Priority')
        .setValue('medium')
        .setEmoji('🟡')
        .setDescription('Standard issues requiring normal review timelines.'),
      new StringSelectMenuOptionBuilder()
        .setLabel('High Priority')
        .setValue('high')
        .setEmoji('🟠')
        .setDescription('Important problems requiring expedited attention.'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Urgent Priority')
        .setValue('urgent')
        .setEmoji('🚨')
        .setDescription('Critical operations requiring immediate staff escalation.')
    ]);

  return new ActionRowBuilder().addComponents(menu);
}
