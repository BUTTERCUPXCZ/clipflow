import { NotFoundException } from '@nestjs/common';
import type { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import type { Project, ProjectsRepository } from './projects.repository.js';
import { ProjectsService } from './projects.service.js';

const USER = 'user-1';
const project: Project = {
  id: 'p1',
  name: 'Podcast',
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(overrides: Partial<Record<keyof ProjectsRepository, unknown>> = {}) {
  const repo = {
    create: vi.fn(async () => project),
    listWithVideoCount: vi.fn(async () => []),
    findOwned: vi.fn(async () => project),
    update: vi.fn(async () => project),
    deleteOwned: vi.fn(async () => true),
    ...overrides,
  };
  const removeProjectDir = vi.fn(async () => {});
  const service = new ProjectsService(
    repo as unknown as ProjectsRepository,
    { removeProjectDir } as unknown as MediaStorage,
  );
  return { service, repo, removeProjectDir };
}

describe('ProjectsService', () => {
  it('stores a missing description as null', async () => {
    const { service, repo } = setup();

    await service.create(USER, { name: 'Podcast' });

    expect(repo.create).toHaveBeenCalledWith(USER, { name: 'Podcast', description: null });
  });

  it('404s when the project is not found or not owned', async () => {
    const { service } = setup({ findOwned: vi.fn(async () => undefined), update: vi.fn(async () => undefined) });

    await expect(service.get(USER, 'x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(USER, 'x', { name: 'n' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes the media directory after deleting the project', async () => {
    const { service, removeProjectDir } = setup();

    await service.delete(USER, 'p1');

    expect(removeProjectDir).toHaveBeenCalledWith(USER, 'p1');
  });

  it('touches no files when there was nothing to delete', async () => {
    const { service, removeProjectDir } = setup({ deleteOwned: vi.fn(async () => false) });

    await expect(service.delete(USER, 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(removeProjectDir).not.toHaveBeenCalled();
  });
});
