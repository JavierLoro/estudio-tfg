import type { Resource, ResourceKind } from '../api';

export const KIND_LABEL: Record<ResourceKind, string> = {
  article: 'Artículo',
  book: 'Libro',
  document: 'Documento',
  image: 'Imagen',
  web: 'Web',
  note: 'Nota',
  other: 'Otro',
};
export const kinds = Object.keys(KIND_LABEL) as ResourceKind[];
export function resourceKind(resource: Resource): ResourceKind {
  if (resource.kind) return resource.kind;
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(resource.attachment ?? '')
    ? 'image'
    : resource.attachment
      ? 'document'
      : resource.url
        ? 'web'
        : 'note';
}
export const safeUrl = (url: string) => /^https?:\/\//i.test(url);
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
export interface LibraryFilters {
  query: string;
  kind: string;
  tag: string;
  collection: string;
  status: string;
  order: string;
}
export const DEFAULT_FILTERS: LibraryFilters = { query: '', kind: '', tag: '', collection: '', status: '', order: 'recent' };
export function filterResources(resources: Resource[], filters: LibraryFilters) {
  const q = fold(filters.query.trim());
  return resources
    .filter(
      (r) =>
        (!filters.kind || resourceKind(r) === filters.kind) &&
        (!filters.tag || r.tags.includes(filters.tag)) &&
        (!filters.collection || r.collections?.includes(filters.collection)) &&
        (!filters.status || r.status === filters.status) &&
        (!q || fold([r.title, r.note ?? '', ...(r.urls ?? [r.url ?? '']), ...r.tags, ...(r.collections ?? [])].join(' ')).includes(q)),
    )
    .sort((a, b) =>
      filters.order === 'title'
        ? a.title.localeCompare(b.title, 'es')
        : filters.order === 'oldest'
          ? a.captured.localeCompare(b.captured)
          : b.captured.localeCompare(a.captured),
    );
}
