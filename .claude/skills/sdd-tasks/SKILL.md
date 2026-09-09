---
name: sdd-tasks
description: Divide specs y diseño en tareas de implementación. Usar en la fase 4 del workflow.
---

# SDD — Tasks

## Qué hacer

Partiendo de specs + design, descomponé en tareas atómicas.

### Reglas
1. Cada tarea debe ser **implementable de forma independiente**
2. Cada tarea debe tener **criterio de verificación** claro
3. Ordenalas por **dependencias** (si la tarea B necesita lo de A, A va primero)
4. Estimá si el cambio total supera ~400 líneas → proponé dividir en PRs encadenados (chained PRs)

### Formato

```markdown
## Tasks: [nombre del cambio]

### Tarea 1: [nombre corto]
- **Archivos**: ...
- **Qué hacer**: ...
- **Verificación**: ...
- **Depende de**: (ninguna | Tarea X)

### Tarea 2: [nombre corto]
...
```
