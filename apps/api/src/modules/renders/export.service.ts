import { constants } from 'node:fs';
import { copyFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { RendersRepository } from './renders.repository.js';

/** Characters no file name should carry on Linux, macOS or Windows (control characters are dropped separately). */
const UNSAFE = /[<>:"/\\|?*]/g;

/** `NN - <title>.mp4`, safe on every platform, at most ~120 characters. */
export function exportName(position: number, title: string): string {
  const printable = title.replace(/\p{Cc}/gu, '');
  const clean = printable.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 110) || 'clip';
  return `${String(position + 1).padStart(2, '0')} - ${clean}.mp4`;
}

/**
 * Copies rendered clips to where the user picked (the desktop's native dialog). The API is local, as for
 * import, so it can write there; it still refuses anything that could damage the media library or a file.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly renders: RendersRepository,
    private readonly storage: MediaStorage,
  ) {}

  async exportClip(userId: string, clipId: string, destination: string): Promise<{ path: string }> {
    const clip = await this.renders.findClipOwned(userId, clipId);
    if (!clip) throw new NotFoundException('Rendered clip not found');
    // basename() ignores a trailing slash, so check it explicitly: "/home/me/" is a folder, not a file name.
    if (/[\\/]$/.test(destination) || !basename(destination).replace(/\.mp4$/i, '').trim()) {
      throw new BadRequestException('Choose a file name to save the clip as');
    }
    const target = await this.checkDestination(destination.toLowerCase().endsWith('.mp4') ? destination : `${destination}.mp4`);
    return { path: await this.copyWithoutOverwrite(this.storage.absolute(clip.filePath), target) };
  }

  async exportRender(userId: string, renderId: string, directory: string): Promise<{ paths: string[] }> {
    const render = await this.renders.findOwned(userId, renderId);
    if (!render) throw new NotFoundException('Render not found');
    const clips = await this.renders.clipsOf(renderId);
    if (!clips.length) throw new BadRequestException('This render has no clips to export');
    await this.checkDestination(join(directory, 'probe.mp4'));
    const paths = [];
    for (const clip of clips) {
      paths.push(await this.copyWithoutOverwrite(this.storage.absolute(clip.filePath), join(resolve(directory), exportName(clip.position, clip.title))));
    }
    return { paths };
  }

  private async checkDestination(path: string): Promise<string> {
    if (!isAbsolute(path)) throw new BadRequestException('Choose an absolute location to export to');
    const target = resolve(path);
    const root = this.storage.absolute('.');
    if (target === root || target.startsWith(root + sep)) throw new BadRequestException("Exports can't go inside ClipForge's media folder");
    const parent = await stat(dirname(target)).catch(() => undefined);
    if (!parent?.isDirectory()) throw new BadRequestException(`The folder ${dirname(target)} does not exist`);
    // Follows symlinks too (the check above is only lexical): a link into the library is still the library.
    if (await this.storage.isInside(dirname(target))) throw new BadRequestException("Exports can't go inside ClipForge's media folder");
    return target;
  }

  /** "name.mp4", then "name (1).mp4", "name (2).mp4"…: an export never replaces an existing file. */
  private async copyWithoutOverwrite(source: string, target: string): Promise<string> {
    const ext = extname(target);
    const stem = join(dirname(target), basename(target, ext));
    for (let n = 0; n < 1000; n++) {
      const candidate = n === 0 ? target : `${stem} (${n})${ext}`;
      try {
        await copyFile(source, candidate, constants.COPYFILE_EXCL);
        return candidate;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') throw new ConflictException('A rendered file is missing from the library: render the clips again');
        if (code !== 'EEXIST') throw error;
      }
    }
    throw new BadRequestException('Too many files with this name in that folder');
  }
}
