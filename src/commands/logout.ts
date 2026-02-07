import { Command } from 'commander';
import { clearSession, clearAllCredentials, getConfigPath } from '../config.js';
import { disconnectClient } from '../client.js';
import chalk from 'chalk';

export const logoutCommand = new Command('logout')
  .description('Log out and clear stored session')
  .option('--all', 'Clear all credentials (API keys and session)')
  .action(async (options) => {
    try {
      // Disconnect any active client
      await disconnectClient();

      if (options.all) {
        clearAllCredentials();
        console.log(chalk.green('Logged out and cleared all credentials.'));
        console.log(chalk.gray(`Removed: ${getConfigPath()}`));
      } else {
        clearSession();
        console.log(chalk.green('Logged out and cleared session.'));
        console.log(chalk.gray('API credentials preserved. Run "tg auth" to log in again.'));
        console.log(chalk.gray('Use --all to also remove API credentials.'));
      }
    } catch (error) {
      console.error('Logout failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
