import { readFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(__dirname, '../templates');

export default class ServiceGenerator {
  constructor(config, root) {
    this.config = config;
    this.root = root;
  }

  compile(templatePath, data) {
    const src = readFileSync(templatePath, 'utf8');
    return Handlebars.compile(src)(data);
  }

  async write(filePath, content) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }

  async generate() {
    for (const service of this.config.services) {
      const ctx = { ...service, nodeVersion: this.config.nodeVersion };
      const dir = resolve(this.root, 'services', service.name);
      // Services that have been bootstrapped then hand-extended (custom route
      // ordering, test tooling, etc.) list their hand-authored files here so
      // re-running bootstrap for config changes (new env vars, new services)
      // doesn't silently wipe them out.
      const preserve = new Set(service.preserveFiles || []);

      if (!preserve.has('Dockerfile')) {
        await this.write(
          resolve(dir, 'Dockerfile'),
          this.compile(resolve(TEMPLATES, 'docker/Dockerfile.hbs'), ctx)
        );
      }

      // Keep host node_modules, tests and local env files out of the image: the
      // Dockerfile installs its own deps, and COPY . . would otherwise overwrite them.
      if (!preserve.has('.dockerignore')) {
        await this.write(
          resolve(dir, '.dockerignore'),
          'node_modules\ntests\ncoverage\n.env\n.env.*\nnpm-debug.log*\n*.test.js\n'
        );
      }

      if (!preserve.has('package.json')) {
        await this.write(
          resolve(dir, 'package.json'),
          this.compile(resolve(TEMPLATES, 'service/package.json.hbs'), ctx)
        );
      }

      if (!preserve.has('index.js')) {
        await this.write(
          resolve(dir, 'index.js'),
          this.compile(resolve(TEMPLATES, 'service/index.js.hbs'), ctx)
        );
      }

      if (!preserve.has('db.js')) {
        await this.write(
          resolve(dir, 'db.js'),
          this.compile(resolve(TEMPLATES, 'service/db.js.hbs'), ctx)
        );
      }
    }
  }
}
