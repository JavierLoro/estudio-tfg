Muestras del texto propio de `scripts/muestras/tipografia.tex`, compuesto con
`memoria.cls` y `\fuenteTexto{times|latinmodern|palatino|heros}`. No son imágenes
de las fuentes del sistema ni se distribuyen archivos de fuentes.

Para regenerarlas: compilar una copia temporal con 12 puntos, márgenes de 10 mm,
una cara, `\modo{final}`, `\atribucion{no}` y bibliografía vacía opcional. Renderizar
la primera página con Poppler:

```sh
pdftoppm -f 1 -l 1 -r 144 -x 45 -y 45 -W 720 -H 140 -singlefile -png main.pdf muestra
```

Las familias utilizadas son NewTX (estilo Times), Latin Modern Roman,
NewPX (estilo Palatino) y TeX Gyre Heros. Las imágenes muestran el texto
a 12 puntos y su título a 18; el ejemplo de jerarquía de la interfaz
es orientativo y el PDF compilado es la referencia final.
