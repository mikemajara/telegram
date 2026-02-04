import { Command } from 'commander';
import { getClient, kickUser, disconnectClient } from '../client.js';
import ora from 'ora';

export const kickCommand = new Command('kick')
  .description('Kick/remove a user from a group')
  .argument('<group>', 'Group name or username')
  .argument('<user>', 'Username to kick (e.g., @username)')
  .action(async (group, user) => {
    const spinner = ora(`Kicking ${user} from "${group}"...`).start();

    try {
      const client = await getClient();
      const result = await kickUser(client, group, user);

      if (result.success) {
        spinner.succeed(result.message);
      } else {
        spinner.fail(result.message);
        process.exit(1);
      }

      await disconnectClient();
    } catch (error) {
      spinner.fail('Failed to kick user');
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
