#!/usr/bin/env node

import { Command } from 'commander';
import {
  authCommand,
  whoamiCommand,
  checkCommand,
  chatsCommand,
  readCommand,
  searchCommand,
  sendCommand,
  replyCommand,
  inboxCommand,
  contactCommand,
  membersCommand,
  adminsCommand,
  groupsCommand,
  syncCommand,
} from './commands/index.js';

const program = new Command();

program
  .name('tg')
  .description('Fast Telegram CLI for reading, searching, and sending messages')
  .version('0.1.0');

// Auth commands
program.addCommand(authCommand);
program.addCommand(checkCommand);
program.addCommand(whoamiCommand);

// Read commands
program.addCommand(chatsCommand);
program.addCommand(readCommand);
program.addCommand(searchCommand);
program.addCommand(inboxCommand);

// Contact/group commands
program.addCommand(contactCommand);
program.addCommand(membersCommand);
program.addCommand(adminsCommand);
program.addCommand(groupsCommand);

// Write commands
program.addCommand(sendCommand);
program.addCommand(replyCommand);

// Utilities
program.addCommand(syncCommand);

program.parse();
