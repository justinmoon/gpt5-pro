#!/usr/bin/env node

import { Command } from 'commander';
import { ChatGPT, ChatGPTOptions } from './chatgpt.js';

const program = new Command();

program.enablePositionalOptions();

program
  .name('gpt5')
  .description('CLI tool to interact with ChatGPT-5 Pro')
  .version('1.0.0');

program
  .command('login')
  .description('Login to ChatGPT and save session')
  .option('-p, --profile <name>', 'Profile name for session storage', 'default')
  .option('-v, --visible', 'Show browser window (not headless)', false)
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (options: { profile?: string; visible?: boolean; verbose?: boolean }) => {
    const chatgpt = new ChatGPT({
      headless: !options.visible,
      profile: options.profile,
      verbose: options.verbose,
    });

    try {
      await chatgpt.initialize();
      await chatgpt.loginInteractive();
      await chatgpt.close();
      if (options.verbose) {
        console.log('\n✓ Login successful! You can now use the tool in headless mode.');
      } else {
        console.log('Login successful.');
      }
      process.exit(0);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : error);
      await chatgpt.close();
      process.exit(1);
    }
  });

program
  .argument('[prompt]', 'The prompt to send to ChatGPT')
  .option('-v, --visible', 'Show browser window (not headless)', false)
  .option('-p, --profile <name>', 'Profile name for session storage', 'default')
  .option('-m, --model <name>', 'Model to use (e.g., "GPT-5 Pro", "GPT-4")', 'GPT-5 Pro')
  .option('-t, --timeout <ms>', 'Timeout in milliseconds', '60000')
  .option('-r, --retries <n>', 'Number of retries', '2')
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (prompt: string | undefined, options: {
    visible?: boolean;
    profile?: string;
    model?: string;
    timeout?: string;
    retries?: string;
    verbose?: boolean;
  }) => {
    if (!prompt) {
      console.error('❌ Error: prompt is required\n');
      console.log('Usage: gpt5 "your prompt here"');
      console.log('   or: gpt5 login  (to login first)\n');
      console.log('Options:');
      console.log('  -v, --visible        Show browser window');
      console.log('  -p, --profile <name> Use specific profile (default: "default")');
      console.log('  -m, --model <name>   Specify model (default: "GPT-5 Pro")');
      console.log('  -t, --timeout <ms>   Set timeout (default: 60000)');
      console.log('  -r, --retries <n>    Set retry count (default: 2)');
      console.log('  --verbose            Enable debug logging');
      process.exit(1);
    }

    const chatgptOptions: ChatGPTOptions = {
      headless: !options.visible,
      profile: options.profile,
      model: options.model,
      timeout: options.timeout ? parseInt(options.timeout, 10) : 60000,
      retries: options.retries ? parseInt(options.retries, 10) : 2,
      verbose: options.verbose,
    };

    const chatgpt = new ChatGPT(chatgptOptions);

    try {
      await chatgpt.initialize();

      const isLoggedIn = await chatgpt.checkSession();
      if (!isLoggedIn) {
        console.error('❌ Not logged in. Please run: gpt5 login');
        if (options.profile && options.profile !== 'default') {
          console.error(`   (with profile: gpt5 login --profile ${options.profile})`);
        }
        process.exit(1);
      }

      const response = await chatgpt.query(prompt);

      if (options.verbose) {
        console.log('\n--- Response ---\n');
        console.log(response);
        console.log('\n');
      } else {
        console.log(response);
      }

      await chatgpt.close();
      process.exit(0);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : error);
      await chatgpt.close();
      process.exit(1);
    }
  });

program.parse();
