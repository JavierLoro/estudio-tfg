import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AssistantSource } from '../state/assistant';
import { openFile } from '../state/workspace';

export default function AssistantMessage({ text, sources }: { text: string; sources: AssistantSource[] }) {
  const content = text.replace(/\[fuente:([a-f0-9]{24})\]/g, (original, id: string) => {
    const source = sources.find(s => s.id === id);
    return source ? `[${source.title.replace(/([\\\[\]])/g, '\\$1')}](#fuente-${id})` : original;
  });
  return <div className="space-y-2 break-words [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded [&_pre]:bg-soft [&_pre]:p-2 [&_code]:font-mono [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-2 [&_table]:block [&_table]:overflow-auto [&_td]:border [&_td]:border-line [&_td]:p-1 [&_th]:p-1">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => url.startsWith('#fuente-') ? url : /^https?:\/\//i.test(url) ? defaultUrlTransform(url) : ''} components={{
      a: ({ href, children }) => {
        const source = sources.find(s => href === '#fuente-' + s.id);
        if (source) return <button type="button" className="text-accent underline" title={source.path} onClick={() => openFile(source.root, source.path, { side: true })}>{children}</button>;
        return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">{children}</a> : <span>{children}</span>;
      },
      // Las respuestas no cargan imágenes remotas ni ejecutan HTML del modelo.
      img: ({ alt }) => <span>{alt ? `Imagen: ${alt}` : 'Imagen omitida'}</span>,
    }}>{content}</ReactMarkdown>
  </div>;
}
