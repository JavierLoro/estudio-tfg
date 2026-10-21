// Plantillas de «Nuevo diagrama» (v0.8). Todas se dibujan con la configuración de
// impresión (texto SVG puro): compruébalo al cambiarlas exportando cada una. Son
// compactas para que, al insertarlas, el texto no quede diminuto ni ocupen una página.

export interface DiagramTemplate {
  id: string;
  label: string;
  description: string;
  example?: string;
  source: string;
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: 'flujo',
    label: 'Flujo',
    description: 'Pasos, decisiones y bucles',
    example: `flowchart LR
  inicio([Inicio]) --> valido{¿Válido?}
  valido -- Sí --> guardar[Guardar]
  valido -- No --> revisar[Revisar]
`,
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
    example: `sequenceDiagram
  actor U as Usuario
  participant A as Aplicación
  U->>A: Guardar nota
  A-->>U: Confirmación
`,
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
    example: `stateDiagram-v2
  direction LR
  [*] --> Borrador
  Borrador --> Revision: enviar
  Revision --> Aprobado: aceptar
`,
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
    example: `flowchart LR
  web[Aplicación web] --> api[API]
  subgraph servidor [Servidor]
    api --> archivos[(Archivos)]
  end
`,
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
    example: `erDiagram
  direction LR
  USUARIO ||--o{ NOTA : escribe
  USUARIO {
    int id PK
    string nombre
  }
  NOTA {
    int id PK
    string titulo
  }
`,
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
    example: `classDiagram
  direction LR
  class Usuario {
    +String nombre
  }
  class Nota {
    +String titulo
  }
  Usuario "1" --> "*" Nota : escribe
`,
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
  {
    id: 'gantt', label: 'Gantt', description: 'Planificación de tareas y fechas',
    example: `gantt
  title Plan de trabajo
  dateFormat YYYY-MM-DD
  axisFormat %d/%m
  tickInterval 1week
  section Desarrollo
  Diseño :diseno, 2026-01-01, 2026-01-08
  Código :codigo, 2026-01-08, 2026-01-22
  Pruebas :pruebas, 2026-01-22, 2026-01-29
`,
    source: `gantt
  title Plan de trabajo
  dateFormat YYYY-MM-DD
  section Desarrollo
  Diseño :diseno, 2026-01-01, 2026-01-08
  Implementación :codigo, 2026-01-08, 2026-01-22
  Pruebas :pruebas, 2026-01-22, 2026-01-29
`,
  },
  {
    id: 'cronologia', label: 'Cronología', description: 'Periodos, hitos y acontecimientos',
    source: `timeline
  title Evolución del proyecto
  Enero : Análisis
  Febrero : Prototipo
  Marzo : Evaluación
`,
  },
  {
    id: 'mapa-mental', label: 'Mapa mental', description: 'Ideas organizadas por ramas',
    source: `mindmap
  root((Proyecto))
    Investigación
      Bibliografía
      Entrevistas
    Desarrollo
      Prototipo
      Validación
`,
  },
  {
    id: 'c4', label: 'Arquitectura C4', description: 'Personas, sistemas y relaciones',
    source: `C4Context
  title Contexto del sistema
  Person(usuario, "Usuario", "Consulta y escribe")
  System(app, "Aplicación", "Gestiona los documentos")
  System_Ext(biblioteca, "Biblioteca externa", "Aporta referencias")
  Rel(usuario, app, "Utiliza")
  Rel(app, biblioteca, "Consulta")
`,
  },
  {
    id: 'kanban', label: 'Kanban', description: 'Columnas y tarjetas de trabajo',
    source: `kanban
  pendiente[Pendiente]
    documentar[Documentar la API]
  en_curso[En curso]
    implementar[Implementar el editor]
  terminado[Terminado]
    investigar[Revisar alternativas]
`,
  },
  {
    id: 'requisitos', label: 'Requisitos', description: 'Requisitos, elementos y trazabilidad',
    source: `requirementDiagram
  requirement acceso {
    id: RF1
    text: El usuario puede consultar documentos
    risk: low
    verifymethod: test
  }
  element visor {
    type: Aplicación
  }
  visor - satisfies -> acceso
`,
  },
  {
    id: 'sectores', label: 'Sectores', description: 'Distribución de cantidades',
    source: `pie showData
  title Dedicación por actividad
  "Investigación" : 30
  "Desarrollo" : 50
  "Documentación" : 20
`,
  },
  {
    id: 'cuadrantes', label: 'Cuadrantes', description: 'Comparación con dos ejes',
    source: `quadrantChart
  title Prioridad de mejoras
  x-axis Poco esfuerzo --> Mucho esfuerzo
  y-axis Poco impacto --> Mucho impacto
  quadrant-1 Planificar
  quadrant-2 Priorizar
  quadrant-3 Posponer
  quadrant-4 Revisar
  Buscador: [0.3, 0.8]
  Editor: [0.7, 0.7]
  Temas: [0.2, 0.2]
`,
  },
  {
    id: 'sankey', label: 'Sankey', description: 'Flujos de cantidades entre categorías',
    source: `sankey-beta
Fuentes,Notas,30
Notas,Memoria,20
Notas,Anexos,10
`,
  },
];
