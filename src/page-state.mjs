import { readFile, writeFile, rename } from 'node:fs/promises';

export class PageState {
  constructor(file, pages) {
    this.file = file;
    this.pages = pages;
    this.savedPage = null;
    this.pending = Promise.resolve();
  }

  async load(legacyFile) {
    for (const file of [this.file, legacyFile].filter(Boolean)) {
      try {
        const { page } = JSON.parse(await readFile(file, 'utf8')) ?? {};
        if (!this.pages.includes(page)) return null;
        if (file === this.file) this.savedPage = page;
        return page;
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    }
    return null;
  }

  save(page) {
    if (!this.pages.includes(page)) throw new Error('Cannot remember a disabled information page');
    const operation = this.pending.then(async () => {
      if (page === this.savedPage) return;
      // Save on selection, rather than relying on a Windows shutdown callback.
      // Rename keeps an interrupted write from damaging the previous selection.
      await writeFile(`${this.file}.tmp`, JSON.stringify({ page }) + '\n');
      await rename(`${this.file}.tmp`, this.file);
      this.savedPage = page;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
