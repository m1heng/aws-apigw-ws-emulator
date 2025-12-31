#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { AWSWebSocketGateway } from './server';
import { GatewayConfig, DEFAULT_CONFIG } from './types';
import { logger } from './logger';

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('aws-apigw-ws-emulator')
  .description('Local emulator for AWS API Gateway WebSocket with HTTP integration')
  .version(packageJson.version)
  .option('-p, --port <port>', 'WebSocket server port', String(DEFAULT_CONFIG.port))
  .option('-s, --stage <stage>', 'API stage name', DEFAULT_CONFIG.stage)
  .option('--idle-timeout <seconds>', 'Idle timeout in seconds', String(DEFAULT_CONFIG.idleTimeout))
  .option('--hard-timeout <seconds>', 'Hard timeout in seconds', String(DEFAULT_CONFIG.hardTimeout))
  .option('-c, --config <file>', 'Config file (YAML or JSON)')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    let fileConfig: Partial<GatewayConfig> = {};

    // Load config file if specified
    if (options.config && existsSync(options.config)) {
      try {
        const content = readFileSync(options.config, 'utf-8');
        if (options.config.endsWith('.yaml') || options.config.endsWith('.yml')) {
          fileConfig = parseYaml(content);
        } else {
          fileConfig = JSON.parse(content);
        }
        logger.info(`Loaded config from ${options.config}`);
      } catch (error) {
        logger.error(`Failed to load config file: ${(error as Error).message}`);
        process.exit(1);
      }
    }

    // Build final config: defaults <- file <- CLI
    const finalConfig: Partial<GatewayConfig> = {
      ...DEFAULT_CONFIG,
      ...fileConfig,
    };

    // CLI overrides (only if explicitly provided)
    if (options.port !== String(DEFAULT_CONFIG.port)) {
      finalConfig.port = parseInt(options.port, 10);
    }
    if (options.stage !== DEFAULT_CONFIG.stage) {
      finalConfig.stage = options.stage;
    }
    if (options.idleTimeout !== String(DEFAULT_CONFIG.idleTimeout)) {
      finalConfig.idleTimeout = parseInt(options.idleTimeout, 10);
    }
    if (options.hardTimeout !== String(DEFAULT_CONFIG.hardTimeout)) {
      finalConfig.hardTimeout = parseInt(options.hardTimeout, 10);
    }
    if (options.verbose) {
      finalConfig.verbose = true;
    }

    const gateway = new AWSWebSocketGateway(finalConfig);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await gateway.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      await gateway.start();
    } catch (error) {
      logger.error(`Failed to start server: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
