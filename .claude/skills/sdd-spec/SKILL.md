---
name: sdd-spec
description: Escribe especificaciones detalladas para un cambio SDD. Usar en la fase 2 del workflow.
---

# SDD — Specs

## Qué hacer

Partiendo de la proposal aprobada, escribí las especificaciones.

### Requerimientos funcionales
Qué debe hacer el sistema. Lista numerada, imperativa:
1. El sistema debe...
2. El sistema debe...

### Requerimientos no funcionales
Performance, seguridad, escalabilidad, mantenibilidad.

### Escenarios
Para cada funcionalidad:
- **Happy path**: flujo normal, datos válidos
- **Edge cases**: bordes, valores límite, estados vacíos
- **Error**: qué pasa cuando algo falla

### Criterios de aceptación
Lista verificable. Cada criterio debe poderse comprobar.

## Formato de salida

```markdown
## Specs: [nombre del cambio]

### RF1: [título]
**Escenarios:**
- Happy: ...
- Edge: ...
- Error: ...

**Criterio de aceptación:** ...

### RF2: ...
```
