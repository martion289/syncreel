import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const procs = [
  spawn(npmCmd, ['run', 'dev', '--workspace=@syncreel/server'], { stdio: 'inherit', shell: isWin }),
  spawn(npmCmd, ['run', 'dev', '--workspace=@syncreel/web'], { stdio: 'inherit', shell: isWin })
];

function shutdown(signal) {
  for (const p of procs) {
    if (!p.killed) p.kill(signal);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
