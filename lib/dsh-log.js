const fs = require('fs');
const path = require('path');

// dsh 子进程输出的落盘文件名:调用方给目录(壳的 userData/logs),文件名在此单一定义。
const LOG_FILE_NAME = 'dsh.log';
// 内存里保留的诊断尾部上限:够拼进失败弹窗即可,避免 dsh 长时间运行时内存膨胀。
const MAX_BUFFER_BYTES = 64 * 1024;
const DEFAULT_TAIL_LINES = 30;

// 打开落盘写流。目录不可创建/文件不可写都不抛:日志是诊断增强项,不能反过来搞崩
// dsh 启动;失败原因回传给调用方,由 tail() 呈现给用户,不静默吞掉。
function openLogStream(dir, filePath) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return { stream: fs.createWriteStream(filePath, { flags: 'w' }), error: null };
  } catch (err) {
    return { stream: null, error: err };
  }
}

// 捕获 dsh 子进程的 stdout/stderr,三路分发:
//   1. 落盘日志文件——持久诊断,启动失败后仍可回看;
//   2. 内存环形尾部——供失败弹窗即时取用,无需用户外部复现;
//   3. 透传回父进程控制台——保留开发态 stdio:'inherit' 的可见性。
// 对外只暴露 path/attach/tail/close 四个成员,内部缓冲与写流不外泄。
function createDshLogger({ dir }) {
  const filePath = path.join(dir, LOG_FILE_NAME);
  const opened = openLogStream(dir, filePath);
  let stream = opened.stream;
  let streamError = opened.error;
  if (stream) stream.on('error', (err) => { streamError = err; });

  let buffer = '';
  const absorb = (chunk, echo) => {
    buffer += chunk;
    if (buffer.length > MAX_BUFFER_BYTES) buffer = buffer.slice(-MAX_BUFFER_BYTES);
    if (stream && !streamError) stream.write(chunk);
    echo.write(chunk);
  };

  return {
    path: filePath,
    attach(child) {
      if (child.stdout) child.stdout.on('data', (d) => absorb(d.toString(), process.stdout));
      if (child.stderr) child.stderr.on('data', (d) => absorb(d.toString(), process.stderr));
    },
    tail(maxLines = DEFAULT_TAIL_LINES) {
      const lines = buffer.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const body = lines.slice(-maxLines).join('\n');
      if (streamError) {
        return `${body}\n(注:日志文件写入不可用:${streamError.message})`.trim();
      }
      return body;
    },
    close() {
      if (stream) {
        stream.end();
        stream = null;
      }
    },
  };
}

module.exports = { createDshLogger };
