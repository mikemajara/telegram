import { Command } from 'commander';
import { authenticate } from '../auth.js';
import { isConfigured } from '../config.js';
import ora from 'ora';

export const authCommand = new Command('auth')
  .description('Authenticate with Telegram')
  .action(async () => {
    if (isConfigured()) {
      console.log('Already configured. Run "tg check" to verify your session.');
      console.log('To re-authenticate, delete ~/.config/tg/config.json5 and run "tg auth" again.');
      return;
    }

    try {
      const client = await authenticate();
      await client.disconnect();
    } catch (error) {
      console.error('Authentication failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
