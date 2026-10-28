import { createHash, randomUUID } from 'node:crypto';
import { fstatSync } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { CliError } from './errors.mjs';

export const DEFAULT_MAX_INPUT_BYTES = 67_108_864;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ioError = (action, error) => new CliError('ERR_SCOPEVIEW_IO', `${action}: ${error.message}`);

/** Keep the hash/size over original bytes, including a possible leading UTF-8 BOM. */
export async function readInput(operand, limit = DEFAULT_MAX_INPUT_BYTES, stdin = process.stdin) {
  const path = operand === '-' ? '-' : resolve(operand);
  let file;
  try {
    file = path === '-' ? null : await open(path, 'r');
    const identity = file ? await file.stat() : stdinIdentity(stdin);
    if (file && !identity.isFile()) throw new Error('Input must be a regular file or stdin.');
    const canonical = file ? await realpath(path) : null;
    const stream = file ? file.createReadStream({ autoClose: false }) : stdin;
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limit)
        throw new CliError(
          'ERR_SCOPEVIEW_INPUT_LIMIT',
          `Input exceeds the ${limit}-byte limit. Use --max-input-bytes to override it.`
        );
      chunks.push(buffer);
    }
    const original = Buffer.concat(chunks, bytes);
    let document;
    try {
      document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original));
    } catch {
      throw new CliError(
        'ERR_SCOPEVIEW_JSON',
        'Input must contain valid UTF-8 JSON (one leading UTF-8 BOM is accepted).'
      );
    }
    return { document, receipt: { path, bytes, sha256: sha256(original) }, identity, canonical };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw ioError('Cannot read input', error);
  } finally {
    await file?.close();
  }
}

function stdinIdentity(stream) {
  try {
    const stat = fstatSync(stream.fd);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

const sameFile = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const alias = () =>
  new CliError(
    'ERR_SCOPEVIEW_INPUT_OUTPUT_ALIAS',
    'Output must differ from input documents and theme files, including symlinks and hard links.'
  );

async function checkDestination(path, input, force) {
  const sources = [input, ...(input.related ?? [])];
  if (sources.some((source) => path === source.receipt.path || path === source.canonical))
    throw alias();
  const stat = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && !stat.isFile())
    throw new CliError(
      'ERR_SCOPEVIEW_OUTPUT_TYPE',
      'Output must be a regular file; symlinks, directories and special files are not allowed.'
    );
  if (sources.some((source) => sameFile(stat, source.identity))) throw alias();
  if (stat && !force)
    throw new CliError(
      'ERR_SCOPEVIEW_OUTPUT_EXISTS',
      'Output already exists. Use --force to replace the regular file.'
    );
  return stat;
}

/** Prepare a closed sibling file. Publishing without force is an exclusive atomic link. */
export async function stageOutput(operand, content, input, force = false) {
  const absolute = resolve(operand);
  let temporary;
  try {
    await checkDestination(absolute, input, force);
    await mkdir(dirname(absolute), { recursive: true });
    const parent = await realpath(dirname(absolute));
    const target = join(parent, basename(absolute));
    const existing = await checkDestination(target, input, force);
    temporary = join(parent, `.scopeview-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o666);
    try {
      if (existing) await file.chmod(existing.mode & 0o7777);
      await file.writeFile(content);
    } finally {
      await file.close();
    }
    const dispose = async () => {
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    };
    return {
      async publish() {
        try {
          const current = await checkDestination(target, input, force);
          if (force) {
            // Respect the permissions of the target checked immediately before replacement.
            if (current && current.mode !== existing?.mode) {
              const file = await open(temporary, 'r+');
              try {
                await file.chmod(current.mode & 0o7777);
              } finally {
                await file.close();
              }
            }
            await rename(temporary, target);
          } else await link(temporary, target);
          await dispose();
          const bytes = Buffer.from(content);
          return { path: absolute, bytes: bytes.length, sha256: sha256(bytes) };
        } catch (error) {
          if (error instanceof CliError) throw error;
          if (error.code === 'EEXIST')
            throw new CliError(
              'ERR_SCOPEVIEW_OUTPUT_EXISTS',
              'Another writer created the output. Use a different path or --force.'
            );
          throw ioError('Cannot atomically publish output', error);
        } finally {
          await dispose();
        }
      },
      dispose
    };
  } catch (error) {
    if (temporary) await unlink(temporary).catch(() => {});
    if (error instanceof CliError) throw error;
    throw ioError('Cannot prepare output', error);
  }
}

/** Await completion/backpressure and absorb EPIPE without printing a Node stack trace. */
export function writeStream(stream, content) {
  return new Promise((resolveWrite, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(ioError('Cannot write output stream', error));
    };
    stream.once('error', fail);
    stream.write(content, (error) => {
      if (error) {
        fail(error);
        return;
      }
      stream.removeListener('error', fail);
      if (!settled) {
        settled = true;
        resolveWrite();
      }
    });
  });
}
