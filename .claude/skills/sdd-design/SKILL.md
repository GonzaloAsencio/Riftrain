---
name: sdd-design
description: Crea el diseño técnico y la arquitectura para un cambio SDD. Usar en la fase 3 del workflow.
---

# SDD — Design

## Qué hacer

Partiendo de la proposal y specs aprobadas, diseñá la implementación.

### Arquitectura
- Diagrama de archivos propuesto
- Flujo de datos entre módulos
- Contratos/interfaces entre componentes

### Decisiones técnicas
Para cada decisión importante:
1. Qué se elige
2. Por qué (tradeoffs considerados)
3. Qué se descarta y por qué

### Archivos a tocar
Lista completa con:
- `ruta/al/archivo` — qué cambia (crear/modificar)
- Responsabilidad de cada archivo

## Formato de salida

```markdown
## Design: [nombre del cambio]

### Arquitectura
...

### Árbol de archivos
```
src/
├── nuevo-modulo/
│   ├── index.ts
│   └── types.ts
```

### Decisiones
- **Decisión 1**: ...
  - Por qué: ...
  - Descartado: ...

### Archivos afectados
- `src/nuevo-modulo/index.ts` — crear, lógica principal
- `src/existente.ts` — modificar, agregar integración
```
