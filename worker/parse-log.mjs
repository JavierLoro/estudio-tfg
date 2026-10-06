// Parser de logs de LaTeX (pdflatex/xelatex/lualatex con -file-line-error) y
// de BibTeX/Biber (.blg). Sin dependencias.
//
// Diagnostic = { severity: "error"|"warning", file: string, line: number|null, message: string }
//
// `file` se normaliza relativo a la raíz del proyecto (sin "./"). Si el
// archivo está fuera del proyecto (p. ej. un .sty de TeX Live) se deja la ruta
// absoluta tal cual.

const TEX_EXT = /\.(tex|sty|cls|clo|def|cfg|fd|bbl|aux|toc|lof|lot|lol|out|ldf|ltx|dtx|ind|gls|nls|acr|w18|code\.tex|mkii|lua|bib|bst|pgf|tikz)$/i;

/**
 * Normaliza una ruta del log respecto a la raíz del proyecto.
 * @param {string} p
 * @param {string} [rootDir] directorio donde se compiló (temporal)
 */
export function normalizeFile(p, rootDir) {
  let f = String(p).trim().replace(/^"(.*)"$/, '$1');
  if (rootDir) {
    const root = rootDir.replace(/\/+$/, '');
    if (f === root) return '.';
    if (f.startsWith(root + '/')) f = f.slice(root.length + 1);
    // /src es la montura de solo lectura del proyecto
  }
  if (f.startsWith('/src/')) f = f.slice(5);
  while (f.startsWith('./')) f = f.slice(2);
  f = f.replace(/\/\.\//g, '/');
  return f;
}

/** Une líneas cortadas a max_print_line (79) si el log parece estar envuelto. */
// TeX corta por bytes, no por caracteres. La 1.ª línea (banner) y las
// estadísticas finales (sangradas) no se cortan, así que se excluyen del test.
function unwrap(lines) {
  const bytes = lines.map((l) => Buffer.byteLength(l, 'utf8'));
  const longer = bytes.some((b, i) => i > 0 && b > 79 && !lines[i].startsWith(' '));
  const wrapped = !longer && bytes.some((b) => b === 79);
  if (!wrapped) return lines;
  const out = [];
  let buf = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    buf += l;
    if (bytes[i] !== 79 || i === 0) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

function looksLikeFile(s) {
  if (!s) return false;
  if (/^(\.{1,2}\/|\/)/.test(s)) return /\.[A-Za-z0-9]+$/.test(s.split('/').pop());
  return TEX_EXT.test(s);
}

/**
 * Actualiza la pila de archivos abiertos leyendo los paréntesis de una línea.
 * "(" + ruta ⇒ push(ruta); "(" + otra cosa ⇒ push(null); ")" ⇒ pop.
 */
function scanParens(line, stack) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(') {
      let rest = line.slice(i + 1);
      let name;
      if (rest.startsWith('"')) {
        const end = rest.indexOf('"', 1);
        name = end > 0 ? rest.slice(1, end) : '';
        if (end > 0) i += end + 1;
      } else {
        const m = /^[^\s()[\]{}<>]*/.exec(rest);
        name = m ? m[0] : '';
        // no avanzamos i: los ")" pegados al nombre se procesan después
        if (name) i += name.length;
      }
      stack.push(looksLikeFile(name) ? name : null);
    } else if (c === ')') {
      if (stack.length) stack.pop();
    }
  }
}

function currentFile(stack) {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i];
  return null;
}

const RE_FILE_LINE = /^((?:\.{1,2}\/|\/)?[^:\s][^:]*?\.[A-Za-z0-9]+):(\d+): (.*)$/;
const RE_WARNING = /^(?:(LaTeX)|(?:Package|Class|Module) ([^\s]+)|(pdfTeX)) (Font )?[Ww]arning(?: \([^)]*\))?:? ?(.*)$/;
const RE_INPUT_LINE = /\s*on input line (\d+)\.?/;
const RE_PAGE_GROUP = /multiple pdfs with page group included in a single page/i;
const RE_IGNORE_SECTION = /^(Overfull|Underfull|Loose|Tight) \\[hv]box/;

/**
 * @param {string} text contenido del .log
 * @param {{rootDir?: string, mainFile?: string}} [opts]
 * @returns {{severity:"error"|"warning", file:string, line:number|null, message:string}[]}
 */
export function parseLog(text, opts = {}) {
  const { rootDir, mainFile = 'main.tex' } = opts;
  const lines = unwrap(String(text).replace(/\r\n?/g, '\n').split('\n'));
  const stack = [];
  const diags = [];
  const fileOf = (raw) => normalizeFile(raw ?? currentFile(stack) ?? mainFile, rootDir);

  let skipParens = 0; // 0 = normal, 1 = hasta línea en blanco, 2 = error hasta l.N + 1 línea + blanco

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (skipParens) {
      if (line.trim() === '') skipParens = 0;
      continue;
    }

    // Cajas mal ajustadas: se ignoran (y su contenido no toca la pila).
    if (RE_IGNORE_SECTION.test(line)) {
      skipParens = 1;
      continue;
    }

    // ./archivo.tex:12: mensaje   (-file-line-error)
    let m = RE_FILE_LINE.exec(line);
    if (m) {
      diags.push({ severity: 'error', file: fileOf(m[1]), line: Number(m[2]), message: cleanMsg(m[3]) });
      skipParens = 1;
      continue;
    }

    // ! Mensaje de error clásico (sin file-line-error) → buscar l.N
    if (line.startsWith('! ')) {
      let ln = null;
      for (let j = i + 1; j < Math.min(lines.length, i + 30); j++) {
        const lm = /^l\.(\d+)/.exec(lines[j]);
        if (lm) { ln = Number(lm[1]); break; }
      }
      diags.push({ severity: 'error', file: fileOf(), line: ln, message: cleanMsg(line.slice(2)) });
      skipParens = 1;
      continue;
    }

    if (/^\*\*\* \(job aborted, no legal \\end found\)/.test(line)) {
      diags.push({ severity: 'error', file: fileOf(mainFile), line: null, message: 'Falta \\end{document} (job aborted, no legal \\end found)' });
      continue;
    }

    m = RE_WARNING.exec(line);
    if (m) {
      const [, , pkg, pdftex, font, first] = m;
      if (font) { scanParens(line, stack); continue; } // LaTeX Font Warning: ruido
      let msg = first;
      // Continuaciones: "(paquete)    texto" o, para LaTeX, líneas sangradas.
      const contPrefix = pkg ? `(${pkg})` : null;
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (contPrefix && next.startsWith(contPrefix)) {
          msg += ' ' + next.slice(contPrefix.length).trim();
          i++;
        } else if (!contPrefix && /^ {4,}\S/.test(next) && !RE_FILE_LINE.test(next)) {
          msg += ' ' + next.trim();
          i++;
        } else break;
      }
      let ln = null;
      const im = RE_INPUT_LINE.exec(msg);
      if (im) {
        ln = Number(im[1]);
        msg = msg.replace(RE_INPUT_LINE, '').replace(/\s+\.$/, '.');
        if (!/[.!?]$/.test(msg)) msg += '.';
      }
      // Dos PDF incluidos en la misma página con grupo de transparencia (lo llevan siempre los
      // de cairo/rsvg-convert, p. ej. los diagramas exportados, v0.8): inofensivo.
      if (pdftex && RE_PAGE_GROUP.test(msg)) continue;
      const prefix = pkg ? `${pkg}: ` : pdftex ? 'pdfTeX: ' : '';
      diags.push({ severity: 'warning', file: fileOf(), line: ln, message: cleanMsg(prefix + msg) });
      continue;
    }

    scanParens(line, stack);
  }

  return finalize(diags);
}

/**
 * Parser del .blg de BibTeX o Biber.
 * @param {string} text
 * @param {{rootDir?: string, mainFile?: string}} [opts]
 */
export function parseBlg(text, opts = {}) {
  const { rootDir, mainFile = 'main.tex' } = opts;
  const diags = [];
  let bibSource = null; // último .bib que Biber dice estar leyendo
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m;
    // Biber: "[53] bibtex.pm:1519> INFO - Found BibTeX data source 'bibliografia.bib'"
    if ((m = /^(?:\[\d+\] [^>]*> )?INFO - (?:Found BibTeX data source|Looking for bibtex file) '([^']+)'/.exec(line))) {
      bibSource = m[1];
      continue;
    }
    // Biber: "[123] Utils.pm:409> WARN - mensaje" / "ERROR - mensaje"
    if ((m = /^(?:\[\d+\] [^>]*> )?(WARN|ERROR) - (.*)$/.exec(line))) {
      const sev = m[1] === 'ERROR' ? 'error' : 'warning';
      let msg = m[2];
      // Las citas no encontradas ya salen como "Citation ... undefined" en el .log
      if (/^I didn't find a database entry/.test(msg)) continue;
      let file = bibSource ?? mainFile;
      let ln = null;
      let fm;
      if ((fm = /file '([^']+\.bib)'.*line (\d+)/.exec(msg))) {
        file = fm[1];
        ln = Number(fm[2]);
      } else if ((fm = /^BibTeX subsystem: (.+?), line (\d+), (.*)$/.exec(msg))) {
        // Biber analiza una copia temporal (/tmp/biber_tmp_…/….utf8) con las
        // mismas líneas que el .bib que estaba leyendo.
        if (/\.bib$/i.test(fm[1])) file = fm[1];
        ln = Number(fm[2]);
        msg = fm[3];
      }
      diags.push({ severity: sev, file: normalizeFile(file, rootDir), line: ln, message: 'Biber: ' + msg });
      continue;
    }
    // BibTeX: "I was expecting a `,' or a `}'---line 5 of file main.bib"
    if ((m = /^(.*)---line (\d+) of file (.+)$/.exec(line))) {
      const file = m[3].trim();
      if (/\.bst$/i.test(file)) continue; // internos del estilo
      diags.push({ severity: 'error', file: normalizeFile(file, rootDir), line: Number(m[2]), message: 'BibTeX: ' + m[1].trim() });
      continue;
    }
    // BibTeX: "Warning--empty journal in foo"
    if ((m = /^Warning--(.*)$/.exec(line))) {
      // Las citas no encontradas ya salen como "Citation ... undefined" en el .log
      if (/^I didn't find a database entry/.test(m[1])) continue;
      diags.push({ severity: 'warning', file: normalizeFile(mainFile, rootDir), line: null, message: 'BibTeX: ' + m[1] });
    }
  }
  return finalize(diags);
}

function cleanMsg(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** Deduplica y quita ruido redundante ("Emergency stop" si hay otros errores). */
export function finalize(diags) {
  const seen = new Set();
  let out = [];
  for (const d of diags) {
    const key = `${d.severity}|${d.file}|${d.line}|${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  const isNoise = (d) => /^(Emergency stop\.?|==> Fatal error occurred.*)$/.test(d.message);
  const real = out.filter((d) => d.severity === 'error' && !isNoise(d));
  if (real.length) out = out.filter((d) => !isNoise(d));
  // errores primero, conservando el orden de aparición
  return [...out.filter((d) => d.severity === 'error'), ...out.filter((d) => d.severity === 'warning')];
}

// Avisos que solo reflejan una compilación abortada antes de tiempo (latexmk se
// detiene en el primer pdflatex con error, sin .aux/.bbl previos): todas las
// referencias y citas salen "undefined". Si hay errores, se ocultan.
const RE_RERUN_NOISE = /^(?:(?:[\w-]+: )?(?:Citation|Reference) `.*' (?:on page \S+ )?undefined|There were undefined (?:references|citations)|Label\(s\) may have changed|rerunfilecheck: |(?:[\w-]+: )?Empty bibliography|(?:[\w-]+: )?Please \(re\)run|acronym: Acronym .* is not defined)/;

/** Quita el ruido de referencias/citas indefinidas cuando la compilación tiene errores. */
export function dropRerunNoise(diags) {
  if (!diags.some((d) => d.severity === 'error')) return diags;
  return diags.filter((d) => d.severity === 'error' || !RE_RERUN_NOISE.test(d.message));
}
