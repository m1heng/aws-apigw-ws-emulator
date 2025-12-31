import chalk from 'chalk';

export class Logger {
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  setVerbose(verbose: boolean) {
    this.verbose = verbose;
  }

  info(message: string, ...args: unknown[]) {
    console.log(chalk.blue('[INFO]'), message, ...args);
  }

  success(message: string, ...args: unknown[]) {
    console.log(chalk.green('[OK]'), message, ...args);
  }

  warn(message: string, ...args: unknown[]) {
    console.log(chalk.yellow('[WARN]'), message, ...args);
  }

  error(message: string, ...args: unknown[]) {
    console.log(chalk.red('[ERROR]'), message, ...args);
  }

  debug(message: string, ...args: unknown[]) {
    if (this.verbose) {
      console.log(chalk.gray('[DEBUG]'), message, ...args);
    }
  }

  ws(action: string, connectionId: string, detail?: string) {
    const id = chalk.cyan(connectionId.slice(0, 12));
    const act = chalk.magenta(`[${action}]`);
    if (detail) {
      console.log(act, id, chalk.gray(detail));
    } else {
      console.log(act, id);
    }
  }

  http(method: string, path: string, status: number) {
    const statusColor = status < 400 ? chalk.green : chalk.red;
    console.log(
      chalk.yellow(`[${method}]`),
      path,
      statusColor(status)
    );
  }

  banner(config: { port: number; stage: string }) {
    console.log('');
    console.log(chalk.bold.cyan('╔══════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║') + chalk.bold.white('       AWS API Gateway WebSocket - Local Emulator            ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('╠══════════════════════════════════════════════════════════════╣'));
    console.log(chalk.bold.cyan('║') + `  WebSocket:     ${chalk.green(`ws://localhost:${config.port}`)}                      ` + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + `  Management:    ${chalk.green(`http://localhost:${config.port}/@connections/{id}`)} ` + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + `  Stage:         ${chalk.yellow(config.stage)}                                       ` + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('╠══════════════════════════════════════════════════════════════╣'));
    console.log(chalk.bold.cyan('║') + chalk.gray('  Connect: ws://localhost:' + config.port + '?token=xxx') + '                  ' + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════════╝'));
    console.log('');
  }
}

export const logger = new Logger();
