import fs from 'node:fs/promises';
import path from 'node:path';

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function licenseHtml(components, tex, legal) {
  const notices = components.map(component => `<details><summary>${escape(component.name)} ${escape(component.version)} · ${escape(component.license)}</summary>` +
    component.notices.map(notice => `<h3>${escape(notice.name)}</h3><pre>${escape(notice.text)}</pre>`).join('') + '</details>').join('\n');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Licencias y componentes — Estudio TFG</title>
<style>body{font:15px system-ui;max-width:1000px;margin:32px auto;padding:0 24px;line-height:1.5;height:auto;overflow:auto;color:var(--et-fg);background:var(--et-bg)}a{color:var(--et-accent)}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{padding:10px 0;border-bottom:1px solid var(--et-border)}summary{cursor:pointer}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:5px;border-bottom:1px solid var(--et-border)}h1{font-size:24px;font-weight:600}h2{font-size:18px;font-weight:600;margin-top:32px}</style>
<h1>Licencias y componentes</h1><p>Estudio TFG se distribuye bajo GNU AGPL-3.0. La plantilla deriva de ARCO; se conserva su aviso GPL-2.0+. Los componentes, fuentes y herramientas siguientes mantienen sus licencias originales.</p>
<p><a href="https://github.com/JavierLoro/estudio-tfg">Código fuente de Estudio TFG</a>. Versiones y revisiones fijadas del motor; no se instalan paquetes automáticamente al compilar.</p>
<h2>Textos legales incluidos</h2>${Object.entries(legal).map(([name, text]) => `<details><summary>${escape(name)}</summary><pre>${escape(text)}</pre></details>`).join('\n')}
<h2>TeX Live, paquetes y fuentes</h2><table><tr><th>Componente</th><th>Revisión</th><th>Licencia / fuente</th></tr>${tex.map(component => `<tr><td>${escape(component.name)}</td><td>${escape(component.revision)}</td><td>${escape(component.license)} · <a href="${escape(component.source)}">Fuente</a></td></tr>`).join('\n')}</table>
<h2>Interfaz, Electron y servidor</h2>${notices}<p>Los avisos se reproducen en su idioma original. El motor privado conserva también LICENSE.TL, LICENSE.CTAN, COMPONENTS.json y los avisos de Perl.</p></html>`;
}

async function npmComponents(root, lockFile) {
  const lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  const components = [];
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative || entry.dev || !relative.startsWith('node_modules/')) continue;
    const dir = path.join(root, relative);
    let pkg;
    try { pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' && entry.optional) continue; throw error; }
    const notices = [];
    for (const name of await fs.readdir(dir)) {
      if (/^(licen[cs]e|copying|copyright|notice)(\.|$)/i.test(name) && (await fs.stat(path.join(dir, name))).isFile())
        notices.push({ name, text: await fs.readFile(path.join(dir, name), 'utf8') });
    }
    components.push({ name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : 'Consultar avisos incluidos', notices });
  }
  return components;
}

export async function writeCredits({ repo, runtime, assets, manifest, source }) {
  const components = [...await npmComponents(runtime, path.join(runtime, 'package-lock.json')),
    ...await npmComponents(path.join(repo, 'web'), path.join(repo, 'web/package-lock.json'))];
  const electronRoot = path.join(repo, 'desktop/node_modules/electron/dist');
  components.push({ name: 'Electron / Chromium', version: '44.7.0', license: 'MIT y licencias de Chromium', notices: [
    { name: 'Electron LICENSE', text: await fs.readFile(path.join(electronRoot, 'LICENSE'), 'utf8') },
    { name: 'Chromium avisos', text: await fs.readFile(path.join(electronRoot, 'LICENSES.chromium.html'), 'utf8') },
  ] });
  const legal = JSON.parse(await fs.readFile(path.join(assets, `legal-${manifest.platform}.json`), 'utf8'));
  components.push({ name: 'Perl', version: manifest.versions.perl, license: 'GPL-1.0-or-later / Artistic-1.0-Perl', notices: [{ name: 'Código fuente', text: `https://github.com/Perl/perl5/tree/v${manifest.versions.perl}` }] });
  legal['Estudio TFG — GNU AGPL-3.0'] = await fs.readFile(path.join(repo, 'LICENSE'), 'utf8');
  legal['Plantilla ARCO — aviso conservado'] = (await fs.readFile(path.join(repo, 'templates/base/estilo/memoria.cls'), 'utf8')).split('\n').slice(0, 45).join('\n');
  legal['Plantilla ARCO — GNU GPL-2.0'] = await fs.readFile(path.join(repo, 'desktop/licenses/GPL-2.0.txt'), 'utf8');
  for (const file of await fs.readdir(path.join(repo, 'web/public/licenses'))) legal[file] = await fs.readFile(path.join(repo, 'web/public/licenses', file), 'utf8');
  const unique = [...new Map(components.map(component => [`${component.name}@${component.version}`, component])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const css = (await fs.readdir(path.join(runtime, 'web/dist/assets'))).find(name => /^index-.*\.css$/.test(name));
  if (!css) throw new Error('Falta la hoja de estilos de la app para las licencias');
  const html = licenseHtml(unique, manifest.packages, legal).replace('https://github.com/JavierLoro/estudio-tfg">Código', escape(source) + '">Código')
    .replace('<style>', `<link rel="stylesheet" href="/assets/${escape(css)}"><style>`);
  await fs.writeFile(path.join(runtime, 'web/dist/licencias.html'), html);
  await fs.writeFile(path.join(runtime, 'desktop/components.json'), JSON.stringify({ components: unique.map(({ notices, ...component }) => component), tex: manifest.packages }, null, 2));
}
