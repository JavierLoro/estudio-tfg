import { expect, it } from 'vitest';
// @ts-expect-error Resolución bundler del cliente; Vitest transpila el helper puro.
import { DEFAULT_FILTERS, filterResources, resourceKind } from '../../web/src/lib/library';
const records:any[]=[
 {path:'a.md',title:'Artículo útil',captured:'2026-10-11',status:'inbox',tags:['tfg'],kind:'article',collections:['Lecturas'],urls:['https://example.org/datos'],note:'Notas sobre arquitectura'},
 {path:'b.md',title:'Imagen',captured:'2026-10-10',status:'revisado',tags:[],attachment:'figura.png'},
];
it('la biblioteca empieza con todos y combina búsqueda, tipo, etiqueta, colección y revisión',()=>{
 expect(filterResources(records,DEFAULT_FILTERS)).toHaveLength(2);
 expect(resourceKind(records[1])).toBe('image');
 expect(filterResources(records,{...DEFAULT_FILTERS,query:'articulo',kind:'article',tag:'tfg',collection:'Lecturas',status:'inbox'})).toEqual([records[0]]);
 expect(filterResources(records,{...DEFAULT_FILTERS,query:'ARQUITECTURA'})).toEqual([records[0]]);
 expect(filterResources(records,{...DEFAULT_FILTERS,query:'example.org/datos'})).toEqual([records[0]]);
 expect(filterResources(records,{...DEFAULT_FILTERS,kind:'image',status:'inbox'})).toEqual([]);
 expect(filterResources(records,{...DEFAULT_FILTERS,order:'oldest'})[0].path).toBe('b.md');
});
it('ordena altas bibliográficas UTC y capturas locales por su fecha real',()=>{
 const local={...records[0],path:'local.md',captured:'2026-10-12T00:47:00+02:00'};
 const utc={...records[0],path:'utc.md',captured:'2026-10-11T23:04:00Z'};
 expect(filterResources([local,utc],DEFAULT_FILTERS).map((r:any)=>r.path)).toEqual(['utc.md','local.md']);
 expect(filterResources([local,utc],{...DEFAULT_FILTERS,order:'oldest'}).map((r:any)=>r.path)).toEqual(['local.md','utc.md']);
});
