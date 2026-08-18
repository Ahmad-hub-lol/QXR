import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

async function processRoleRemoval(context, targetMember, role, executorMember, botMember) {
    if (!targetMember) {
        return { title: 'Error', description: 'That user is not in this server.', color: 'error' };
    }
    if (!role) {
        return { title: 'Error', description: 'Please provide a valid server role.', color: 'error' };
    }
    if (role.position >= botMember.roles.highest.position) {
        return { title: 'Permission Denied', description: `I cannot remove **${role.name}** because it is positioned higher than my highest role. Move my bot role above it in Server Settings.`, color: 'error' };
    }
    if (role.position >= executorMember.roles.highest.position && context.guild.ownerId !== executorMember.id) {
        return { title: 'Permission Denied', description: `You cannot manage **${role.name}** because it is higher than or equal to your own highest role.`, color: 'error' };
    }
    if (!targetMember.roles.cache.has(role.id)) {
        return { title: 'Info', description: `${targetMember} does not have the **${role.name}** role.`, color: 'warning' };
    }

    await targetMember.roles.remove(role);
    return { title: 'Role Removed Successfully', description: `Successfully stripped the **${role.name}** role from ${targetMember}.`, color: 'success' };
}

export default {
    data: new SlashCommandBuilder()
        .setName('removerole')
        .setDescription('Remove a server role from a member')
        .addUserOption(option => option.setName('target').setDescription('The member to lose the role').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The role to remove').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        try {
            await InteractionHelper.safeDefer(interaction);
            const targetMember = interaction.options.getMember('target');
            const role = interaction.options.getRole('role');
            
            const resultData = await processRoleRemoval(
                interaction, 
                targetMember, 
                role, 
                interaction.member, 
                interaction.guild.members.me
            );

            return await InteractionHelper.safeEditReply(interaction, { embeds: [createEmbed(resultData)] });
        } catch (error) {
            logger.error('Slash removerole command error:', error);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ title: 'System Error', description: 'Failed to remove role.', color: 'error' })]
            });
        }
    },

    async executeMessage(message, args) {
        try {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return message.reply({ embeds: [createEmbed({ title: 'Permission Denied', description: 'You need the `Manage Roles` permission to use this command.', color: 'error' })] });
            }

            const targetMember = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
            const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);

            const resultData = await processRoleRemoval(
                message, 
                targetMember, 
                role, 
                message.member, 
                message.guild.members.me
            );

            return message.reply({ embeds: [createEmbed(resultData)] });
        } catch (error) {
            logger.error('Prefix removerole command error:', error);
            return message.reply({ embeds: [createEmbed({ title: 'System Error', description: 'Failed to remove role.', color: 'error' })] });
        }
    }
};

