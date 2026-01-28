import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { getCredentials, getSessionString, setSessionString, isConfigured } from './config.js';
import bigInt from 'big-integer';

let clientInstance: TelegramClient | null = null;

export async function getClient(): Promise<TelegramClient> {
  if (clientInstance?.connected) {
    return clientInstance;
  }

  if (!isConfigured()) {
    throw new Error('Not configured. Run "tg auth" first to set up your API credentials.');
  }

  const { apiId, apiHash } = getCredentials();
  const sessionString = getSessionString() || '';
  const session = new StringSession(sessionString);

  clientInstance = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await clientInstance.connect();

  if (!await clientInstance.isUserAuthorized()) {
    throw new Error('Not authenticated. Run "tg auth" to log in.');
  }

  return clientInstance;
}

export async function createClient(apiId: number, apiHash: string): Promise<TelegramClient> {
  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  return client;
}

export async function saveSession(client: TelegramClient): Promise<void> {
  const sessionString = (client.session as StringSession).save();
  setSessionString(sessionString);
}

export async function disconnectClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.disconnect();
    clientInstance = null;
  }
}

export async function getMe(client: TelegramClient): Promise<Api.User> {
  const me = await client.getMe();
  if (!me || !(me instanceof Api.User)) {
    throw new Error('Failed to get user info');
  }
  return me;
}

export interface ChatInfo {
  id: string;
  title: string;
  type: 'user' | 'group' | 'supergroup' | 'channel';
  username?: string;
  unreadCount: number;
  lastMessage?: string;
  lastMessageDate?: Date;
}

export async function getDialogs(client: TelegramClient, limit = 100): Promise<ChatInfo[]> {
  const dialogs = await client.getDialogs({ limit });
  const chats: ChatInfo[] = [];

  for (const dialog of dialogs) {
    let type: ChatInfo['type'] = 'user';
    let title = dialog.title || 'Unknown';
    let username: string | undefined;

    if (dialog.isUser) {
      type = 'user';
      const entity = dialog.entity as Api.User;
      username = entity.username ?? undefined;
    } else if (dialog.isGroup) {
      type = 'group';
    } else if (dialog.isChannel) {
      const entity = dialog.entity as Api.Channel;
      type = entity.megagroup ? 'supergroup' : 'channel';
      username = entity.username ?? undefined;
    }

    chats.push({
      id: dialog.id?.toString() || '',
      title,
      type,
      username,
      unreadCount: dialog.unreadCount,
      lastMessage: dialog.message?.message,
      lastMessageDate: dialog.message?.date ? new Date(dialog.message.date * 1000) : undefined,
    });
  }

  return chats;
}

export interface MessageInfo {
  id: number;
  date: Date;
  sender: string;
  senderId?: string;
  text: string;
  replyToMsgId?: number;
  isOutgoing: boolean;
}

export async function getMessages(
  client: TelegramClient,
  chatIdentifier: string,
  options: { limit?: number; offsetId?: number; minDate?: Date; maxDate?: Date } = {}
): Promise<{ messages: MessageInfo[]; chatTitle: string }> {
  const { limit = 50, offsetId, minDate, maxDate } = options;

  // Find the chat by name or username
  const entity = await resolveChat(client, chatIdentifier);
  const chatTitle = getChatTitle(entity);

  const messages: MessageInfo[] = [];

  // Use iterMessages for better control over parameters
  const iterParams: { limit: number; offsetId?: number; reverse?: boolean } = {
    limit: limit * 2, // Get more to filter by date
  };

  if (offsetId) {
    iterParams.offsetId = offsetId;
  }

  const result = await client.getMessages(entity, iterParams);

  for (const msg of result) {
    if (msg instanceof Api.Message) {
      const msgDate = new Date(msg.date * 1000);

      // Filter by date if specified
      if (minDate && msgDate < minDate) continue;
      if (maxDate && msgDate > maxDate) continue;
      if (messages.length >= limit) break;

      let sender = 'Unknown';
      let senderId: string | undefined;

      if (msg.fromId) {
        try {
          const senderEntity = await client.getEntity(msg.fromId);
          if (senderEntity instanceof Api.User) {
            sender = senderEntity.firstName || senderEntity.username || 'Unknown';
            senderId = senderEntity.id.toString();
          } else if (senderEntity instanceof Api.Channel || senderEntity instanceof Api.Chat) {
            sender = (senderEntity as Api.Channel | Api.Chat).title || 'Unknown';
            senderId = senderEntity.id.toString();
          }
        } catch {
          // Ignore entity resolution errors
        }
      }

      messages.push({
        id: msg.id,
        date: msgDate,
        sender,
        senderId,
        text: msg.message || '',
        replyToMsgId: msg.replyTo?.replyToMsgId,
        isOutgoing: msg.out ?? false,
      });
    }
  }

  return { messages, chatTitle };
}

export async function searchMessages(
  client: TelegramClient,
  query: string,
  options: { chat?: string; limit?: number } = {}
): Promise<{ messages: MessageInfo[]; chatTitle?: string }[]> {
  const { chat, limit = 50 } = options;
  const results: { messages: MessageInfo[]; chatTitle?: string }[] = [];

  if (chat) {
    const entity = await resolveChat(client, chat);
    const chatTitle = getChatTitle(entity);

    const searchResult = await client.invoke(
      new Api.messages.Search({
        peer: entity,
        q: query,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetId: 0,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: bigInt(0),
      })
    );

    const messages: MessageInfo[] = [];
    if ('messages' in searchResult) {
      for (const msg of searchResult.messages) {
        if (msg instanceof Api.Message) {
          let sender = 'Unknown';
          if ('users' in searchResult) {
            const user = searchResult.users.find(
              (u): u is Api.User => u instanceof Api.User && u.id.equals(msg.fromId instanceof Api.PeerUser ? msg.fromId.userId : bigInt(0))
            );
            if (user) {
              sender = user.firstName || user.username || 'Unknown';
            }
          }

          messages.push({
            id: msg.id,
            date: new Date(msg.date * 1000),
            sender,
            text: msg.message || '',
            replyToMsgId: msg.replyTo?.replyToMsgId,
            isOutgoing: msg.out ?? false,
          });
        }
      }
    }

    results.push({ messages, chatTitle });
  } else {
    // Global search
    const searchResult = await client.invoke(
      new Api.messages.SearchGlobal({
        q: query,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit,
      })
    );

    const messages: MessageInfo[] = [];
    if ('messages' in searchResult) {
      for (const msg of searchResult.messages) {
        if (msg instanceof Api.Message) {
          messages.push({
            id: msg.id,
            date: new Date(msg.date * 1000),
            sender: 'Unknown',
            text: msg.message || '',
            replyToMsgId: msg.replyTo?.replyToMsgId,
            isOutgoing: msg.out ?? false,
          });
        }
      }
    }

    results.push({ messages });
  }

  return results;
}

export async function sendMessage(
  client: TelegramClient,
  chatIdentifier: string,
  text: string,
  replyToMsgId?: number
): Promise<Api.Message> {
  const entity = await resolveChat(client, chatIdentifier);

  const result = await client.sendMessage(entity, {
    message: text,
    replyTo: replyToMsgId,
  });

  return result;
}

export async function getContactInfo(
  client: TelegramClient,
  identifier: string
): Promise<{
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  bio?: string;
  isBot: boolean;
  isMutualContact: boolean;
}> {
  const entity = await client.getEntity(identifier);

  if (!(entity instanceof Api.User)) {
    throw new Error('Not a user');
  }

  let bio: string | undefined;
  try {
    const fullUser = await client.invoke(
      new Api.users.GetFullUser({ id: entity })
    );
    bio = fullUser.fullUser.about ?? undefined;
  } catch {
    // Ignore
  }

  return {
    id: entity.id.toString(),
    firstName: entity.firstName ?? undefined,
    lastName: entity.lastName ?? undefined,
    username: entity.username ?? undefined,
    phone: entity.phone ?? undefined,
    bio,
    isBot: entity.bot ?? false,
    isMutualContact: entity.mutualContact ?? false,
  };
}

export async function getChatMembers(
  client: TelegramClient,
  chatIdentifier: string,
  options: { adminsOnly?: boolean; limit?: number } = {}
): Promise<{ id: string; name: string; username?: string; isAdmin: boolean }[]> {
  const { adminsOnly = false, limit = 200 } = options;
  const entity = await resolveChat(client, chatIdentifier);

  if (entity instanceof Api.Channel) {
    const filter = adminsOnly
      ? new Api.ChannelParticipantsAdmins()
      : new Api.ChannelParticipantsRecent();

    const result = await client.invoke(
      new Api.channels.GetParticipants({
        channel: entity,
        filter,
        offset: 0,
        limit,
        hash: bigInt(0),
      })
    );

    if (!(result instanceof Api.channels.ChannelParticipants)) {
      return [];
    }

    const members: { id: string; name: string; username?: string; isAdmin: boolean }[] = [];

    for (const participant of result.participants) {
      const userId = 'userId' in participant ? participant.userId : null;
      if (!userId) continue;

      const user = result.users.find(
        (u): u is Api.User => u instanceof Api.User && u.id.equals(userId)
      );

      if (user) {
        const isAdmin = participant instanceof Api.ChannelParticipantAdmin ||
                       participant instanceof Api.ChannelParticipantCreator;

        members.push({
          id: user.id.toString(),
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Unknown',
          username: user.username ?? undefined,
          isAdmin,
        });
      }
    }

    return members;
  } else if (entity instanceof Api.Chat) {
    const fullChat = await client.invoke(
      new Api.messages.GetFullChat({ chatId: entity.id })
    );

    if (!('fullChat' in fullChat) || !(fullChat.fullChat instanceof Api.ChatFull)) {
      return [];
    }

    const members: { id: string; name: string; username?: string; isAdmin: boolean }[] = [];

    if (fullChat.fullChat.participants instanceof Api.ChatParticipants) {
      for (const participant of fullChat.fullChat.participants.participants) {
        const userId = participant.userId;
        const user = fullChat.users.find(
          (u): u is Api.User => u instanceof Api.User && u.id.equals(userId)
        );

        if (user) {
          const isAdmin = participant instanceof Api.ChatParticipantAdmin ||
                         participant instanceof Api.ChatParticipantCreator;

          if (!adminsOnly || isAdmin) {
            members.push({
              id: user.id.toString(),
              name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Unknown',
              username: user.username ?? undefined,
              isAdmin,
            });
          }
        }
      }
    }

    return members;
  }

  throw new Error('Not a group chat');
}

export async function getAdminGroups(client: TelegramClient): Promise<ChatInfo[]> {
  const dialogs = await client.getDialogs({ limit: 500 });
  const adminGroups: ChatInfo[] = [];

  for (const dialog of dialogs) {
    if (dialog.isGroup || dialog.isChannel) {
      const entity = dialog.entity;

      if (entity instanceof Api.Channel) {
        if (entity.adminRights || entity.creator) {
          adminGroups.push({
            id: dialog.id?.toString() || '',
            title: dialog.title || 'Unknown',
            type: entity.megagroup ? 'supergroup' : 'channel',
            username: entity.username ?? undefined,
            unreadCount: dialog.unreadCount,
          });
        }
      } else if (entity instanceof Api.Chat) {
        // For regular groups, we need to check participants
        try {
          const fullChat = await client.invoke(
            new Api.messages.GetFullChat({ chatId: entity.id })
          );

          const me = await client.getMe() as Api.User;

          if ('fullChat' in fullChat && fullChat.fullChat instanceof Api.ChatFull) {
            if (fullChat.fullChat.participants instanceof Api.ChatParticipants) {
              const myParticipant = fullChat.fullChat.participants.participants.find(
                p => p.userId.equals(me.id)
              );

              if (myParticipant instanceof Api.ChatParticipantAdmin ||
                  myParticipant instanceof Api.ChatParticipantCreator) {
                adminGroups.push({
                  id: dialog.id?.toString() || '',
                  title: dialog.title || 'Unknown',
                  type: 'group',
                  unreadCount: dialog.unreadCount,
                });
              }
            }
          }
        } catch {
          // Skip if we can't get chat info
        }
      }
    }
  }

  return adminGroups;
}

type ResolvedEntity = Api.User | Api.Chat | Api.Channel;

async function resolveChat(client: TelegramClient, identifier: string): Promise<ResolvedEntity> {
  // Check if it's a username (starts with @)
  if (identifier.startsWith('@')) {
    const entity = await client.getEntity(identifier);
    if (entity instanceof Api.User || entity instanceof Api.Chat || entity instanceof Api.Channel) {
      return entity;
    }
    throw new Error(`Invalid entity type for: ${identifier}`);
  }

  // Try to find by exact name in dialogs
  const dialogs = await client.getDialogs({ limit: 500 });

  // First try exact match
  let dialog = dialogs.find(d => d.title?.toLowerCase() === identifier.toLowerCase());

  // Then try partial match
  if (!dialog) {
    dialog = dialogs.find(d => d.title?.toLowerCase().includes(identifier.toLowerCase()));
  }

  if (dialog && dialog.entity) {
    const entity = dialog.entity;
    if (entity instanceof Api.User || entity instanceof Api.Chat || entity instanceof Api.Channel) {
      return entity;
    }
  }

  // Try as a direct entity identifier
  try {
    const entity = await client.getEntity(identifier);
    if (entity instanceof Api.User || entity instanceof Api.Chat || entity instanceof Api.Channel) {
      return entity;
    }
    throw new Error(`Invalid entity type for: ${identifier}`);
  } catch {
    throw new Error(`Chat not found: ${identifier}`);
  }
}

function getChatTitle(entity: ResolvedEntity): string {
  if (entity instanceof Api.User) {
    return entity.firstName || entity.username || 'Unknown';
  }
  if (entity instanceof Api.Chat || entity instanceof Api.Channel) {
    return entity.title;
  }
  return 'Unknown';
}
