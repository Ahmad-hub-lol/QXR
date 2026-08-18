import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

async function processRoleRemoval(context, targetMember, role, executorMember, botMember) {
    if (!targetMember) {
        return { title: 'Error', description: 'That user is not in this server. Make sure to tag them or use their ID.', color: 'error' };
    }
    if (!role) {
        return { title: 'Error', description: 'Please provide a valid server role. Make sure to tag the role or use its ID.', color: 'error' };
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

    async execute(context, args = []) {
        try {
            const isInteraction = typeof context.getMember !== 'function' && context.options !== undefined;

            if (isInteraction) {
                await InteractionHelper.safeDefer(context);
                const targetMember = context.options.getMember('target');
                const role = context.options.getRole('role');
                
                const resultData = await processRoleRemoval(context, targetMember, role, context.member, context.guild.members.me);
                return await InteractionHelper.safeEditReply(context, { embeds: [createEmbed(resultData)] });
            } else {
                if (!context.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return context.reply({ embeds: [createEmbed({ title: 'Permission Denied', description: 'You need the `Manage Roles` permission to use this command.', color: 'error' })] });
                }

                let targetMember = context.mentions.members.first();
                let role = context.mentions.roles.first();

                if (!targetMember || !role) {
                    const cleanArgs = args.filter(arg => !['from', 'off', 'remove'].includes(arg.toLowerCase()));
                    for (const arg of cleanArgs) {
                        const cleanId = arg.replace(/[<@&>]/g, '');
                        if (!targetMember) {
                            const foundMember = context.guild.members.cache.get(cleanId);
                            if (foundMember) targetMember = foundMember;
                        }
                        if (!role) {
                            const foundRole = context.guild.roles.cache.get(cleanId);
                            if (foundRole) role = foundRole;
                        }
                    }
                }

                const resultData = await processRoleRemoval(context, targetMember, role, context.member, context.guild.members.me);
                return context.reply({ embeds: [createEmbed(resultData)] });
            }
        } catch (error) {
            logger.error('Removerole execution failure:', error);
            if (context.reply) {
                return context.reply({ embeds: [createEmbed({ title: 'System Error', description: 'Failed to complete execution run.', color: 'error' })] });
            }
        }
    }
};


