// Plantillas de «Nuevo diagrama» (v0.8). Todas se dibujan con la configuración de
// impresión (texto SVG puro): compruébalo al cambiarlas exportando cada una. Son
// compactas para que, al insertarlas, el texto no quede diminuto ni ocupen una página.

export interface DiagramTemplate {
  id: string;
  label: string;
  description: string;
  source: string;
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: 'flujo',
    label: 'Flujo',
    description: 'Pasos, decisiones y bucles',
    source: `flowchart TD
  inicio([Inicio]) --> leer[/Leer los datos/]
  leer --> valido{¿Son válidos?}
  valido -- Sí --> guardar[(Guardar el resultado)]
  valido -- No --> error[Mostrar el error]
  error --> leer
  guardar --> fin([Fin])
`,
  },
  {
    id: 'secuencia',
    label: 'Secuencia',
    description: 'Mensajes entre participantes',
    source: `sequenceDiagram
  actor U as Usuario
  participant W as Aplicación web
  participant S as Servidor
  participant B as Base de datos
  U->>W: Rellena el formulario
  W->>S: POST /api/pedidos
  S->>B: Inserta el pedido
  B-->>S: Identificador del pedido
  S-->>W: 201 Created
  W-->>U: Confirmación
`,
  },
  {
    id: 'estados',
    label: 'Estados',
    description: 'Estados y transiciones',
    source: `stateDiagram-v2
  state "En revisión" as Revision
  [*] --> Borrador
  Borrador --> Revision: enviar
  Revision --> Borrador: pedir cambios
  Revision --> Aprobado: aceptar
  Aprobado --> Publicado: publicar
  Publicado --> [*]
`,
  },
  {
    id: 'arquitectura',
    label: 'Arquitectura',
    description: 'Bloques agrupados en subgrafos',
    source: `flowchart TB
  web[Aplicación web]
  subgraph servidor [Servidor]
    api[API REST] --> tareas[Procesador de tareas]
  end
  subgraph datos [Datos]
    bd[(Base de datos)]
    archivos[(Almacenamiento)]
  end
  web -- HTTPS --> api
  api --> bd
  tareas --> archivos
`,
  },
  {
    id: 'er',
    label: 'Modelo de datos (ER)',
    description: 'Entidades, atributos y relaciones',
    source: `erDiagram
  direction LR
  USUARIO ||--o{ PEDIDO : realiza
  PEDIDO ||--|{ LINEA : contiene
  PRODUCTO ||--o{ LINEA : aparece
  USUARIO {
    int id PK
    string nombre
    string email
  }
  PEDIDO {
    int id PK
    int usuario_id FK
    date fecha
  }
  LINEA {
    int pedido_id FK
    int producto_id FK
    int cantidad
  }
  PRODUCTO {
    int id PK
    string descripcion
    float precio
  }
`,
  },
  {
    id: 'clases',
    label: 'Clases',
    description: 'Clases, atributos y asociaciones',
    source: `classDiagram
  direction LR
  class Usuario {
    +String nombre
    +String email
    +iniciarSesion() bool
  }
  class Pedido {
    +Date fecha
    +total() float
  }
  class Linea {
    +int cantidad
    +subtotal() float
  }
  class Producto {
    +String descripcion
    +float precio
  }
  Usuario "1" --> "*" Pedido : realiza
  Pedido "1" *-- "1..*" Linea
  Linea "*" --> "1" Producto
`,
  },
];
