const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = Module.createRequire(path.join(root, 'daemon/package.json'));
req('ts-node').register({ transpileOnly: true, project: path.join(root, 'daemon/tsconfig.json') });
const fs = req('fs-extra');
const archiver = req('archiver');
const originalLoad = Module._load;
const Instance = { STATUS_STOP: 0, STATUS_RUNNING: 1, STATUS_BUSY: 2, STATUS_STARTING: 3 };
const log = { error() {}, info() {}, warn() {} };
const manager = { getConfig: () => ({ compress: false, exclusions: [] }), applyRetention() {} };
let backupRoot;
let injectedArchiver;
let routerInstance;
let injectedZipWorld;
const handlers = new Map();
Module._load = function(id, parent, main) {
  if (id === 'archiver') return (...args) => injectedArchiver ? injectedArchiver(...args) : archiver(...args);
  if (parent?.filename.includes(path.join('daemon', 'src'))) {
    if (id.endsWith('/modpack_files')) return { readLevelName: () => 'world' };
    if (id.endsWith('/system_instance')) return { __esModule: true, default: { getInstance: () => routerInstance } };
    if (id.endsWith('/system_file')) return { __esModule: true, default: { checkFileName: () => true } };
    if (id.endsWith('/service/router')) return { routerApp: { on: (name, handler) => handlers.set(name, handler) } };
    if (id.endsWith('/service/protocol')) return { response: (ctx, value) => { ctx.value = value; }, responseError: (ctx, error) => { ctx.error = error; } };
    if (id.endsWith('/service/world_service') && parent.filename.endsWith('world_router.ts')) {
      const actual = originalLoad.call(this, id, parent, main);
      return { ...actual, zipWorld: (...args) => injectedZipWorld ? injectedZipWorld(...args) : actual.zipWorld(...args) };
    }
    if (id.endsWith('/instance/instance')) return { __esModule: true, default: Instance };
    if (id.endsWith('/i18n')) return { $t: s => s };
    if (id.endsWith('/log')) return { __esModule: true, default: log };
    if (id.endsWith('/backup_service')) return { __esModule: true, default: manager, backupDir: () => backupRoot };
  }
  return originalLoad.call(this, id, parent, main);
};
const service = req(path.join(root, 'daemon/src/service/restore_service.ts'));
const { acquireInstanceOperation } = req(path.join(root, 'daemon/src/service/instance_operation_lock.ts'));
const { RestoreTask } = req(path.join(root, 'daemon/src/service/async_task_service/restore_task.ts'));
const { BackupTask } = req(path.join(root, 'daemon/src/service/async_task_service/backup_task.ts'));
const { TaskCenter } = req(path.join(root, 'daemon/src/service/async_task_service/index.ts'));
async function fixture(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-test-'));
  const cwd = path.join(dir, 'server'); await fs.ensureDir(cwd);
  try { await fn(dir, cwd); } finally { await fs.remove(dir); }
}
async function zip(file, entries) {
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file), a = archiver('zip', { store: true });
    out.on('close', resolve); out.on('error', reject); a.on('error', reject); a.pipe(out);
    for (const [name, value] of Object.entries(entries)) a.append(value, { name });
    a.finalize().catch(reject);
  });
}
function instance(cwd, initial = 1) {
  let state = initial;
  return { instanceUuid: 'fixture', calls: [], absoluteCwdPath: () => cwd, println() {},
    status(s) { if (s !== undefined) state = s; return state; },
    async execPreset(cmd) { this.calls.push(cmd); state = cmd === 'stop' ? 0 : 1; } };
}
test('lock rejects immediately and releases idempotently', () => {
  const release = acquireInstanceOperation('a');
  assert.throws(() => acquireInstanceOperation('a'), /already running/);
  release(); release(); acquireInstanceOperation('a')();
});
test('world-only Bedrock replacement preserves other worlds and removes newer files', () => fixture(async (dir, cwd) => {
  await fs.outputFile(path.join(cwd, 'worlds/active/newer'), 'new');
  await fs.outputFile(path.join(cwd, 'worlds/other/level.dat'), 'other');
  await fs.outputFile(path.join(cwd, 'server.properties'), 'keep');
  const file = path.join(dir, 'world-test.zip'); await zip(file, { 'worlds/active/level.dat': 'old' });
  const inst = instance(cwd), task = new RestoreTask(inst, file); TaskCenter.addTask(task); await task.wait();
  assert.deepEqual(inst.calls, ['stop', 'start']);
  assert.equal(await fs.pathExists(path.join(cwd, 'worlds/active/newer')), false);
  assert.equal(await fs.readFile(path.join(cwd, 'worlds/other/level.dat'), 'utf8'), 'other');
  assert.equal(await fs.readFile(path.join(cwd, 'server.properties'), 'utf8'), 'keep');
}));
test('corrupt archive fails before stopping, frees lock', () => fixture(async (dir, cwd) => {
  const file = path.join(dir, 'bad.zip'); await fs.writeFile(file, 'bad');
  const inst = instance(cwd), task = new RestoreTask(inst, file); TaskCenter.addTask(task);
  await assert.rejects(task.wait()); assert.deepEqual(inst.calls, []);
  acquireInstanceOperation(inst.instanceUuid)();
}));
test('failed apply rolls all committed units back', () => fixture(async (dir, cwd) => {
  const stage = path.join(dir, 'stage'); await fs.outputFile(path.join(stage, 'a/file'), 'old');
  await fs.outputFile(path.join(cwd, 'a/file'), 'live');
  await assert.rejects(service.applyRestore(stage, cwd, ['a', 'missing']));
  assert.equal(await fs.readFile(path.join(cwd, 'a/file'), 'utf8'), 'live');
}));
test('full restore preserves excluded top-level paths; replaces covered directories', () => fixture(async (dir, cwd) => {
  await fs.outputFile(path.join(cwd, 'excluded/file'), 'keep');
  await fs.outputFile(path.join(cwd, 'covered/newer'), 'remove');
  const file = path.join(dir, 'backup-test.zip'); await zip(file, { 'covered/old': 'old' });
  const prepared = await service.prepareRestore(file, cwd);
  await service.applyRestore(prepared.stage, cwd, prepared.units);
  assert.equal(await fs.pathExists(path.join(cwd, 'covered/newer')), false);
  assert.equal(await fs.readFile(path.join(cwd, 'excluded/file'), 'utf8'), 'keep');
}));
test('BUSY internal reset backup remains supported and competing backup is rejected', () => fixture(async (dir, cwd) => {
  backupRoot = path.join(dir, 'backups'); await fs.outputFile(path.join(cwd, 'file'), 'data');
  const inst = instance(cwd, Instance.STATUS_BUSY);
  const task = new BackupTask(inst); TaskCenter.addTask(task);
  const competing = new BackupTask(inst); TaskCenter.addTask(competing);
  await assert.rejects(competing.wait(), /already running/); await task.wait();
  assert.match((await fs.readdir(backupRoot))[0], /^backup-.*-[0-9a-f-]{36}.zip$/);
  acquireInstanceOperation(inst.instanceUuid)();
}));

test('traversal and backslash archives rejected before stop', () => fixture(async (dir, cwd) => {
  for (const bad of ['../bad', 'a\\evil']) {
    const file = path.join(dir, 'bad-path.zip'); await zip(file, { 'abcdef': 'bad' });
    const data = await fs.readFile(file);
    await fs.writeFile(file, Buffer.from(data.toString('latin1').split('abcdef').join(bad), 'latin1'));
    const inst = instance(cwd), task = new RestoreTask(inst, file); TaskCenter.addTask(task);
    await assert.rejects(task.wait()); assert.deepEqual(inst.calls, []);
  }
}));
test('archive symlink rejected before stopping', () => fixture(async (dir, cwd) => {
  const file = path.join(dir, 'link.zip');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file), a = archiver('zip', { store: true });
    out.on('close', resolve); out.on('error', reject); a.on('error', reject); a.pipe(out);
    a.symlink('link', '../outside'); a.finalize().catch(reject);
  });
  const inst = instance(cwd), task = new RestoreTask(inst, file); TaskCenter.addTask(task);
  await assert.rejects(task.wait()); assert.deepEqual(inst.calls, []);
}));
test('apply failure in actual task rolls back and never restarts', () => fixture(async (dir, cwd) => {
  await fs.outputFile(path.join(cwd, 'a/file'), 'live');
  const file = path.join(dir, 'backup-apply.zip'); await zip(file, { 'a/file': 'old', 'b/file': 'old' });
  const rename = fs.rename;
  fs.rename = async (src, dest) => {
    if (src.includes('.nexcraft-restore-') && dest === path.join(cwd, 'b')) throw new Error('injected apply failure');
    return rename(src, dest);
  };
  try {
    const inst = instance(cwd), task = new RestoreTask(inst, file); TaskCenter.addTask(task);
    await assert.rejects(task.wait(), /injected/); assert.deepEqual(inst.calls, ['stop']);
    assert.equal(await fs.readFile(path.join(cwd, 'a/file'), 'utf8'), 'live');
    acquireInstanceOperation(inst.instanceUuid)();
  } finally { fs.rename = rename; }
}));

test('Java dimension companions need no independent level.dat', () => fixture(async (dir, cwd) => {
  const file = path.join(dir, 'world-java.zip');
  await zip(file, { 'world/level.dat': 'level', 'world_nether/region/file': 'nether', 'world_the_end/region/file': 'end' });
  const prepared = await service.prepareRestore(file, cwd);
  assert.deepEqual(prepared.units.sort(), ['world', 'world_nether', 'world_the_end'].sort());
  await service.applyRestore(prepared.stage, cwd, prepared.units);
  assert.equal(await fs.readFile(path.join(cwd, 'world_nether/region/file'), 'utf8'), 'nether');
}));
test('CRC failure in data-descriptor archive occurs before stopping', () => fixture(async (dir, cwd) => {
  const file = path.join(dir, 'backup-crc.zip');
  await zip(file, { 'file': 'unique-stored-content' });
  const data = await fs.readFile(file);
  const index = data.indexOf(Buffer.from('unique-stored-content'));
  assert.ok(index >= 0); data[index] ^= 1; await fs.writeFile(file, data);
  const inst = instance(cwd), task = new RestoreTask(inst, file); TaskCenter.addTask(task);
  await assert.rejects(task.wait(), /Corrupt|CRC|crc/); assert.deepEqual(inst.calls, []);
}));
test('destination junction and archive leaf link rejected before stop', () => fixture(async (dir, cwd) => {
  const outside = path.join(dir, 'outside'); await fs.ensureDir(outside);
  await fs.symlink(outside, path.join(cwd, 'world'), process.platform === 'win32' ? 'junction' : 'dir');
  const file = path.join(dir, 'backup-link.zip'); await zip(file, { 'world/level.dat': 'bad' });
  const inst = instance(cwd), task = new RestoreTask(inst, file); TaskCenter.addTask(task);
  await assert.rejects(task.wait()); assert.deepEqual(inst.calls, []);
  // A directory junction in the archive input path must also be rejected.
  const link = path.join(dir, 'archive-dir');
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await fs.copy(file, path.join(outside, 'archive.zip'));
  await assert.rejects(service.prepareRestore(path.join(link, 'archive.zip'), cwd));
}));

test('failed rollback retains original recovery data and does not restart', () => fixture(async (dir, cwd) => {
  await fs.outputFile(path.join(cwd, 'a/file'), 'live');
  const file = path.join(dir, 'backup-rollback.zip'); await zip(file, { 'a/file': 'old', 'b/file': 'old' });
  const rename = fs.rename;
  fs.rename = async (src, dest) => {
    if ((src.includes('.nexcraft-restore-') && dest === path.join(cwd, 'b')) || src.includes('.nexcraft-rollback-'))
      throw new Error('injected failure');
    return rename(src, dest);
  };
  try {
    const inst = instance(cwd), task = new RestoreTask(inst, file); TaskCenter.addTask(task);
    await assert.rejects(task.wait(), /recovery data retained/);
    assert.deepEqual(inst.calls, ['stop']);
    const retained = (await fs.readdir(dir)).find(n => n.startsWith('.nexcraft-rollback-'));
    assert.ok(retained);
    assert.equal(await fs.readFile(path.join(dir, retained, 'a/file'), 'utf8'), 'live');
    acquireInstanceOperation(inst.instanceUuid)();
  } finally { fs.rename = rename; }
}));

const worldService = req(path.join(root, 'daemon/src/service/world_service.ts'));
req(path.join(root, 'daemon/src/routers/world_router.ts'));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
test('restore cleanup failure leaves stopped/error without success', () => fixture(async (dir, cwd) => {
  const file = path.join(dir, 'backup-cleanup.zip'); await zip(file, { 'file': 'restored' });
  const remove = fs.remove;
  const inst = instance(cwd), logs = [];
  inst.println = (...args) => logs.push(args);
  fs.remove = async target => {
    if (target.includes('.nexcraft-restore-')) throw new Error('injected stage cleanup');
    return remove(target);
  };
  try {
    const task = new RestoreTask(inst, file); TaskCenter.addTask(task);
    await assert.rejects(task.wait(), /injected stage cleanup/);
    assert.deepEqual(inst.calls, ['stop']); assert.equal(inst.status(), Instance.STATUS_STOP);
    assert.equal(logs.some(args => args.includes('TXT_CODE_backup.restoreSuccess')), false);
    assert.equal(await fs.readFile(path.join(cwd, 'file'), 'utf8'), 'restored');
    acquireInstanceOperation(inst.instanceUuid)();
  } finally { fs.remove = remove; }
}));
function delayedArchiveFailure() {
  const { EventEmitter } = require('node:events');
  const a = new EventEmitter(), out = new EventEmitter();
  const first = new Error('first archive failure');
  let aborted = false, destroyed = false;
  a.pipe = () => out; a.unpipe = () => a; a.glob = a.directory = () => a;
  a.finalize = () => { setImmediate(() => a.emit('error', first)); return Promise.resolve(); };
  a.abort = () => { aborted = true; return a; };
  a.resume = () => a;
  a.destroy = () => { destroyed = true; return a; };
  out.destroy = () => { out.emit('error', new Error('secondary shutdown error')); return out; };
  return { a, out, first, get aborted() { return aborted; }, get destroyed() { return destroyed; } };
}
for (const kind of ['full backup', 'world download']) {
  test(`${kind} retains operation lock until delayed source/output/archive shutdown`, { timeout: 2000 }, () => fixture(async (dir, cwd) => {
    backupRoot = path.join(dir, 'backups');
    await fs.outputFile(path.join(cwd, 'world/level.dat'), 'world');
    const streams = delayedArchiveFailure();
    const create = fs.createWriteStream;
    injectedArchiver = () => streams.a;
    fs.createWriteStream = () => streams.out;
    let promise, settled = false;
    try {
      if (kind === 'full backup') {
        const task = new BackupTask(instance(cwd)); TaskCenter.addTask(task);
        promise = task.wait();
      } else {
        routerInstance = instance(cwd);
        const ctx = {};
        promise = handlers.get('world/prepare_download')(ctx, { instanceUuid: 'fixture' }).then(() => { if (ctx.error) throw ctx.error; });
      }
      // Attach immediately so rejection monitoring itself cannot go unhandled.
      const result = promise.then(() => { settled = true; }, error => { settled = true; return error; });
      for (let i = 0; i < 30 && !streams.aborted; i++) await new Promise(r => setTimeout(r, 5));
      assert.equal(streams.aborted, true);
      assert.equal(settled, false);
      assert.throws(() => acquireInstanceOperation('fixture'), /already running/);
      streams.out.emit('close'); await nextTurn();
      assert.equal(settled, false); // output closure alone is insufficient
      streams.a.emit('end'); await nextTurn();
      assert.equal(streams.destroyed, true);
      assert.equal(settled, false); // archive close still pending
      assert.throws(() => acquireInstanceOperation('fixture'), /already running/);
      streams.a.emit('close');
      assert.equal(await result, streams.first); // preserve primary error
      acquireInstanceOperation('fixture')();
      if (kind === 'world download') {
        const dl = path.join(cwd, worldService.WORLD_DOWNLOAD_DIR);
        assert.deepEqual(await fs.readdir(dl), []);
      } else assert.deepEqual(await fs.readdir(backupRoot), []);
    } finally { injectedArchiver = undefined; fs.createWriteStream = create; }
  }));
}
test('repeated world download retains only latest; failed prepare removes partial', { timeout: 2000 }, () => fixture(async (dir, cwd) => {
  await fs.outputFile(path.join(cwd, 'world/level.dat'), 'world');
  routerInstance = instance(cwd);
  const prepare = async () => {
    const ctx = {}; await handlers.get('world/prepare_download')(ctx, { instanceUuid: 'fixture' }); return ctx;
  };
  const first = await prepare(); assert.ifError(first.error);
  const second = await prepare(); assert.ifError(second.error);
  assert.notEqual(first.value.relPath, second.value.relPath);
  assert.equal(await fs.pathExists(path.join(cwd, first.value.relPath)), false);
  assert.equal(await fs.pathExists(path.join(cwd, second.value.relPath)), true);
  assert.equal((await fs.readdir(path.join(cwd, worldService.WORLD_DOWNLOAD_DIR))).length, 1);
  injectedZipWorld = async (...args) => {
    await fs.outputFile(args[3], 'partial'); throw new Error('injected prepare failure');
  };
  try {
    const failed = await prepare(); assert.match(failed.error.message, /injected prepare/);
    assert.deepEqual(await fs.readdir(path.join(cwd, worldService.WORLD_DOWNLOAD_DIR)), []);
    acquireInstanceOperation('fixture')();
  } finally { injectedZipWorld = undefined; }
}));

async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('shutdown did not settle within 1000ms')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
async function failedOperation(kind, cwd) {
  if (kind === 'full backup') {
    const task = new BackupTask(instance(cwd)); TaskCenter.addTask(task);
    return task.wait();
  }
  routerInstance = instance(cwd);
  const ctx = {};
  await handlers.get('world/prepare_download')(ctx, { instanceUuid: 'fixture' });
  if (ctx.error) throw ctx.error;
}
for (const kind of ['full backup', 'world download']) {
  for (const alreadyClosed of [false, true]) {
    test(`${kind} settles when archive destroyed before end (closed=${alreadyClosed})`, { timeout: 2000 }, () => fixture(async (dir, cwd) => {
      backupRoot = path.join(dir, 'backups');
      await fs.outputFile(path.join(cwd, 'world/level.dat'), 'world');
      const streams = delayedArchiveFailure(), create = fs.createWriteStream;
      injectedArchiver = () => streams.a;
      fs.createWriteStream = () => streams.out;
      // No end event will ever occur on this failure path.
      streams.a.finalize = () => {
        setImmediate(() => {
          streams.a.destroyed = true;
          if (alreadyClosed) { streams.a.closed = true; streams.a.emit('close'); }
          streams.a.emit('error', streams.first);
          if (!alreadyClosed) setImmediate(() => { streams.a.closed = true; streams.a.emit('close'); });
        });
        return Promise.resolve();
      };
      streams.out.destroy = () => {
        setImmediate(() => { streams.out.closed = true; streams.out.emit('close'); });
        return streams.out;
      };
      try {
        await assert.rejects(within(failedOperation(kind, cwd)), error => error === streams.first);
        acquireInstanceOperation('fixture')();
      } finally { injectedArchiver = undefined; fs.createWriteStream = create; }
    }));
  }
  test(`${kind} EEXIST output error/early close settles and releases lock`, { timeout: 2000 }, () => fixture(async (dir, cwd) => {
    backupRoot = path.join(dir, 'backups');
    await fs.outputFile(path.join(cwd, 'world/level.dat'), 'world');
    const create = fs.createWriteStream;
    fs.createWriteStream = (file, options) => {
      fs.outputFileSync(file, 'existing');
      return create(file, { ...options, flags: 'wx' });
    };
    try {
      await assert.rejects(within(failedOperation(kind, cwd)), error => error.code === 'EEXIST');
      acquireInstanceOperation('fixture')();
    } finally { fs.createWriteStream = create; }
  }));
}
