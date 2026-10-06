import { StreamLanguage, type StreamParser } from '@codemirror/language';

// Resaltado sencillo de Mermaid (fuente de los diagramas de la memoria): comentarios %%,
// palabra clave del tipo de diagrama, palabras reservadas, cadenas, flechas y etiquetas.

const DIAGRAMS = /^(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|classDiagram(-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|block-beta|architecture-beta)\b/;
const KEYWORDS = new Set([
  'subgraph', 'end', 'direction', 'participant', 'actor', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical', 'break',
  'rect', 'note', 'over', 'left', 'right', 'of', 'state', 'as', 'class', 'classDef', 'style', 'linkStyle', 'click',
  'autonumber', 'activate', 'deactivate', 'title', 'TD', 'TB', 'BT', 'LR', 'RL', 'PK', 'FK', 'UK',
]);

interface State {
  first: boolean;
}

const parser: StreamParser<State> = {
  name: 'mermaid',
  startState: () => ({ first: true }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^%%.*/)) return 'comment';
    if (state.first && stream.match(DIAGRAMS)) {
      state.first = false;
      return 'keyword';
    }
    if (stream.match(/^"[^"]*"?/)) return 'string';
    if (stream.match(/^(<<?|x|o)?(-{2,}|={2,}|\.{1,}-|-\.+-?|~{3,})(>>?|x|o|\)|\|)?/) || stream.match(/^(\|\|--|\}o--|\|o--|\}\|--|--o\{|--\|\{|--\|\||--o\|)/)) return 'operator';
    if (stream.match(/^\|[^|]*\|/)) return 'string';
    if (stream.match(/^[[({<>/\\]+/) || stream.match(/^[\])}>/\\]+/)) return 'bracket';
    if (stream.match(/^:[^\n]*/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    const w = stream.match(/^[\wÀ-ɏ-]+/) as RegExpMatchArray | null;
    if (w) {
      state.first = false;
      return KEYWORDS.has(w[0]) ? 'keyword' : 'variableName';
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '%%' } },
};

export const mermaidLanguage = StreamLanguage.define(parser);
