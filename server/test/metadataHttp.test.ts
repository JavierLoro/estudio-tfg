import { EventEmitter } from 'node:events';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { createMetadataFetcher, isPublicAddress, METADATA_LIMIT, requestMetadata, type MetadataDependencies } from '../src/metadataHttp.ts';

const ok = () => ({status:200,headers:{'content-type':'text/html'},body:Buffer.from('<title>Página pública ficticia</title>')});
function fixture() {
  const lookup = vi.fn<MetadataDependencies['lookup']>().mockResolvedValue([{address:'8.8.8.8',family:4}]);
  const request = vi.fn<MetadataDependencies['request']>().mockResolvedValue(ok());
  return {lookup,request,fetch:createMetadataFetcher({lookup,request})};
}
afterEach(() => {vi.restoreAllMocks();vi.useRealTimers();});

it.each(['0.0.0.0','10.0.1.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','192.0.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','fc00::1','fe80::1','ff00::1','::ffff:127.0.0.1','::ffff:7f00:1','64:ff9b::7f00:1','2001:db8::1','2002:7f00:1::1','3fff::1'])('bloquea %s', address => expect(isPublicAddress(address)).toBe(false));
it.each(['8.8.8.8','1.1.1.1','2606:4700::1111','2001:4860:4860::8888'])('admite %s', address => expect(isPublicAddress(address)).toBe(true));

it.each(['file:///etc/passwd','ftp://example.org','https://usuario:clave@example.org','http://127.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:192.168.0.1]'])('no conecta a %s',async url => {
  const f=fixture();await expect(f.fetch(url)).rejects.toThrow();expect(f.request).not.toHaveBeenCalled();
});

it('rechaza DNS mixto IPv4/IPv6 antes de conectar',async()=>{
  const f=fixture();f.lookup.mockResolvedValue([{address:'8.8.8.8',family:4},{address:'fd00::1',family:6}]);
  await expect(f.fetch('https://mixto.example')).rejects.toThrow('privado');expect(f.request).not.toHaveBeenCalled();
});
it('rechaza redirección privada, credenciales y cambio DNS entre saltos',async()=>{
  for(const location of ['http://169.254.169.254/latest','https://u:p@other.example','/otra']) {
    const f=fixture();f.request.mockResolvedValueOnce({status:302,headers:{location},body:Buffer.alloc(0)});
    f.lookup.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]).mockResolvedValue([{address:'127.0.0.1',family:4}]);
    await expect(f.fetch('https://origen.example')).rejects.toThrow();expect(f.request).toHaveBeenCalledTimes(1);
  }
});
it('resuelve cada redirección pública y limita el número de saltos',async()=>{
  const f=fixture();f.request.mockResolvedValueOnce({status:302,headers:{location:'https://destino.example/final'},body:Buffer.alloc(0)}).mockResolvedValue(ok());
  await expect(f.fetch('https://origen.example')).resolves.toMatchObject({status:200});expect(f.lookup).toHaveBeenNthCalledWith(2,'destino.example');
  f.request.mockResolvedValue({status:302,headers:{location:'/bucle'},body:Buffer.alloc(0)});f.request.mockClear();
  await expect(f.fetch('https://origen.example')).rejects.toThrow('redirecciones');expect(f.request).toHaveBeenCalledTimes(4);
});
it('limita bytes, tipo, compresión y errores remotos',async()=>{
  for(const response of [
    {...ok(),body:Buffer.alloc(METADATA_LIMIT+1)}, {...ok(),headers:{'content-length':String(METADATA_LIMIT+1)}},
    {...ok(),headers:{'content-type':'application/pdf'}}, {...ok(),headers:{'content-encoding':'gzip'}}, {...ok(),status:503},
  ]) {const f=fixture();f.request.mockResolvedValue(response);await expect(f.fetch('https://public.example')).rejects.toThrow();}
});
it('el timeout cubre DNS y las resoluciones pendientes retienen su plaza de concurrencia',async()=>{
  vi.useFakeTimers();const finishes: ((addresses:{address:string;family:number}[])=>void)[]=[];
  const lookup=vi.fn<MetadataDependencies['lookup']>().mockImplementation(()=>new Promise(r=>{finishes.push(r);}));
  const request=vi.fn<MetadataDependencies['request']>().mockResolvedValue(ok());const fetch=createMetadataFetcher({lookup,request});
  const pending=Array.from({length:4},()=>fetch('https://public.example'));
  const asserted=Promise.all(pending.map(p=>expect(p).rejects.toThrow('4 segundos')));
  await expect(fetch('https://public.example')).rejects.toThrow('demasiadas');
  await vi.advanceTimersByTimeAsync(4001);await asserted;
  await expect(fetch('https://public.example')).rejects.toThrow('demasiadas');expect(request).not.toHaveBeenCalled();
  for(const finish of finishes) finish([{address:'8.8.8.8',family:4}]);
  await vi.advanceTimersByTimeAsync(0);expect(request).not.toHaveBeenCalled();
  lookup.mockResolvedValue([{address:'8.8.8.8',family:4}]);
  await expect(fetch('https://public.example')).resolves.toMatchObject({status:200});

});
it('timeout de transporte cancela la consulta y conserva el límite global',async()=>{
  vi.useFakeTimers();const f=fixture();f.request.mockImplementation((_url,_address,signal)=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason))));
  const pending=expect(f.fetch('https://public.example')).rejects.toThrow('4 segundos');await vi.advanceTimersByTimeAsync(4001);await pending;
  f.request.mockResolvedValue(ok());await expect(f.fetch('https://public.example')).resolves.toMatchObject({status:200});
});
it('el transporte fija la IP validada sin reenviar Authorization, Cookie ni Referer',async()=>{
  let options: any;
  const native=vi.spyOn(https,'request').mockImplementation(((url:URL,opts:any,callback:any)=>{
    options=opts;const request=new EventEmitter() as any;
    request.end=()=>{const res=new PassThrough() as any;res.statusCode=200;res.headers={'content-type':'text/html'};callback(res);res.end('<title>Simulado</title>');};
    return request;
  }) as typeof https.request);
  await requestMetadata(new URL('https://public.example'),{address:'8.8.8.8',family:4},new AbortController().signal);
  expect(native).toHaveBeenCalledOnce();expect(options.agent).toBe(false);expect(options.family).toBe(4);expect(options.maxHeaderSize).toBe(8192);
  const callback=vi.fn();options.lookup('public.example',{},callback);expect(callback).toHaveBeenCalledWith(null,'8.8.8.8',4);
  expect(Object.keys(options.headers).sort()).toEqual(['accept','accept-encoding','user-agent']);
});
it('el transporte corta una respuesta que supera el límite durante streaming',async()=>{
  vi.spyOn(https,'request').mockImplementation(((_url:any,_opts:any,callback:any)=>{
    const request=new EventEmitter() as any;
    request.end=()=>{const res=new PassThrough() as any;res.statusCode=200;res.headers={};callback(res);res.write(Buffer.alloc(METADATA_LIMIT));res.write(Buffer.alloc(1));};return request;
  }) as typeof https.request);
  await expect(requestMetadata(new URL('https://public.example'),{address:'8.8.8.8',family:4},new AbortController().signal)).rejects.toThrow('1 MB');
});
