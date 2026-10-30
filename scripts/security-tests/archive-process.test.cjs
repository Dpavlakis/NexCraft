const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const ts = require('../../daemon/node_modules/typescript');
const root = path.resolve(__dirname, '../..');
function load(file, mocks) {
  const filename = path.join(root, file), module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
  }).outputText;
  vm.runInThisContext(require('node:module').wrap(output), { filename })(module.exports,
    (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, filename, path.dirname(filename));
  return module.exports;
}
// All process execution is mocked; both the archive module and shared wrapper are real sources.
function harness({ unavailable = false, error, stdout = 'Everything is Ok', stderr = '', exit = 0, multi = false, ensureError } = {}) {
  const calls = [], dirs = [], logs = [], timers = [];
  const cp = {
    exec() { throw Error('shell forbidden'); }, execSync() { throw Error('shell forbidden'); },
    execFile(file, args, options, cb) { calls.push({ file, args, options }); queueMicrotask(() => cb(error || null, stdout, stderr)); },
    spawn(file, args, options) {
      calls.push({ file, args, options });
      const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
      child.kill = () => { throw Error('unexpected kill'); };
      queueMicrotask(() => { child.exitCode = exit; child.emit('exit', exit); });
      return child;
    }
  };
  // Match Node execFile's custom promisify contract ({ stdout, stderr }).
  cp.execFile[require('node:util').promisify.custom] = (...args) => new Promise((resolve, reject) => {
    cp.execFile(...args, (err, out, warnings) => err ? reject(err) : resolve({ stdout: out, stderr: warnings }));
  });
  const { ProcessWrapper: BaseWrapper } = load('common/src/process_tools.ts', { child_process: cp, 'iconv-lite': { decode: String } });
  class ProcessWrapper extends BaseWrapper {
    constructor(...args) { super(...args); timers.push({ timeout: this.timeout, code: this.code }); }
  }
  const api = load('daemon/src/common/compress.ts', {
    child_process: cp, 'fs-extra': { async ensureDir(dir) { dirs.push(dir); if (ensureError) throw ensureError; } },
    i18next: { t: (key) => key }, 'mcsmanager-common': { ProcessWrapper },
    '../const': { SEVEN_ZIP_PATH: 'tools/7 zip.exe', GOLANG_ZIP_PATH: 'tools/file zip.exe', ZIP_TIMEOUT_SECONDS: 17 },
    '../i18n': { $t: (key) => key },
    '../service/log': Object.fromEntries(['info', 'warn', 'error'].map((key) => [key, () => logs.push(key)])),
    '../service/seven_zip_service': { check7zipStatus: async () => unavailable, isZipFormat: (s) => path.extname(s) === '.zip', isMultiVolume: () => multi, getFileExtension: (s) => path.extname(s).slice(1) }
  });
  return { ...api, calls, dirs, logs, timers };
}
const names = ['世界 archive.zip', '$(archive-command).zip', '`archive-command`.zip', 'a"quoted\'name.zip', 'a & b | c; %PATH% !name! (x).zip'];
for (const name of names) test(`literal archive arguments: ${name}`, async () => {
  const h = harness(), source = path.join('source dir', name), dest = path.join('dest dir', name);
  assert.equal(await h.decompress(source, dest), true);
  assert.deepEqual(h.dirs, [path.resolve(dest)]);
  assert.deepEqual(h.calls, [{ file: 'tools/7 zip.exe', args: ['x', path.resolve(source), `-o${path.resolve(dest)}`, '-aoa'], options: { shell: false, cwd: path.dirname(path.resolve(source)), timeout: 17000 } }]);
});
for (const source of ['-oelsewhere.zip', '-an', '@archives.txt', path.join('nested dir', '..', '-oarchive.zip'), path.resolve('absolute dir', '@literal.7z')]) {
  test(`7zip resolves option-like archive and destination from caller CWD: ${source}`, async () => {
    const h = harness();
    const dest = path.join('relative output', '..', '-o世界 destination');
    const absoluteSource = path.resolve(process.cwd(), source);
    const absoluteDest = path.resolve(process.cwd(), dest);
    assert.equal(await h.decompress(source, dest), true);
    assert.deepEqual(h.dirs, [absoluteDest]);
    assert.deepEqual(h.calls, [{
      file: 'tools/7 zip.exe',
      args: ['x', absoluteSource, `-o${absoluteDest}`, '-aoa'],
      options: { shell: false, cwd: path.dirname(absoluteSource), timeout: 17000 }
    }]);
    assert.ok(path.isAbsolute(h.calls[0].args[1]));
    assert.ok(path.isAbsolute(h.calls[0].args[2].slice(2)));
  });
}
test('compression preserves basenames, Unicode, encoding, timeout and shell-free shared spawn', async () => {
  const h = harness(), dest = path.join('输出 dir', '$(zip) "archive".zip');
  assert.equal(await h.compress(dest, names.map((s) => path.join('input dir', s)), 'GBK'), true);
  assert.deepEqual(h.calls, [{ file: 'tools/file zip.exe', args: ['--mode=1', '--code=GBK', `--zipPath=${path.basename(dest)}`, ...names.map((s) => `--file=${s}`)], options: { stdio: 'pipe', windowsHide: true, cwd: path.normalize(path.dirname(dest)), shell: false } }]);
  assert.deepEqual(h.timers, [{ timeout: 17, code: 'GBK' }]);
});
for (const message of ['ENOENT', 'timeout', 'Command failed']) test(`${message} preserves ZIP fallback`, async () => {
  const h = harness({ error: Error(message) }), source = path.join('src dir', '$(literal) "quoted".zip'), dest = 'dest 世界';
  assert.equal(await h.decompress(source, dest, 'GBK'), true);
  assert.equal(h.calls[0].options.timeout, 17000);
  assert.deepEqual(h.calls[1], { file: 'tools/file zip.exe', args: ['--mode=2', `--zipPath=${path.basename(source)}`, `--distDirPath=${path.normalize(dest)}`, '--code=GBK'], options: { stdio: 'pipe', windowsHide: true, cwd: path.normalize(path.dirname(source)), shell: false } });
  assert.deepEqual(h.timers, [{ timeout: 17, code: 'GBK' }]);
});
test('archive-reported errors fall back, warnings succeed, mkdir failure avoids 7zip', async () => {
  const h = harness({ stdout: 'ERROR: invalid archive' });
  assert.equal(await h.decompress('src.zip', 'dest'), true); assert.equal(h.calls.length, 2);
  const warning = harness({ stderr: 'warning' });
  assert.equal(await warning.decompress('src.7z', 'dest'), true); assert.equal(warning.calls.length, 1); assert.ok(warning.logs.includes('warn'));
  const mkdir = harness({ ensureError: Error('denied') });
  assert.equal(await mkdir.decompress('src.zip', 'dest'), true); assert.equal(mkdir.calls.length, 1); assert.equal(mkdir.calls[0].file, 'tools/file zip.exe');
});
test('existing direct fallback, invalid format, multivolume, empty inputs and exit errors', async () => {
  const h = harness({ unavailable: true });
  assert.equal(await h.decompress('src.zip', 'dest'), true); assert.equal(h.calls[0].file, 'tools/file zip.exe');
  assert.deepEqual(h.timers, [{ timeout: 17, code: 'utf-8' }]);
  await assert.rejects(h.decompress('src.rar', 'dest'), /TXT_CODE_69c42450/);
  await assert.rejects(harness({ unavailable: true, multi: true }).decompress('src.zip', 'dest'), /TXT_CODE_91d066aa/);
  await assert.rejects(h.compress('out.zip', []), /TXT_CODE_2038ec2c/);
  await assert.rejects(harness({ exit: 2 }).compress('out.zip', ['file']), /TXT_CODE_2be83d36/);
  await assert.rejects(harness({ unavailable: true, exit: 2 }).decompress('src.zip', 'dest'), /TXT_CODE_f0512848/);
  await assert.rejects(harness({ error: Error('timeout') }).decompress('src.rar', 'dest'), /TXT_CODE_69c42450/);
});
test('NUL paths fail validation before execution', async () => {
  const h = harness();
  await assert.rejects(h.compress('bad\0.zip', ['file']), /TXT_CODE_3aa9f36/);
  await assert.rejects(h.decompress('src.zip', 'bad\0'), /TXT_CODE_3aa9f36/);
  assert.deepEqual(h.calls, []);
});
